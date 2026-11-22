"""Server lokal tanpa dependensi untuk menjalankan UI + backend /api/check.
Membaca API key dari file .env di folder proyek. Jalankan: python server.py
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode, urlparse, unquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from datetime import datetime
import html
import json
import os
import re
import time

PORT = int(os.environ.get("PORT", "3000"))
MIN_LEN = 15
MAX_LEN = 500
CACHE_TTL = 6 * 60 * 60
CACHE_MAX = 200
CACHE = {}

NEGATION_OR_PARTIAL = [
    "tidak benar", "bukan fakta", "tidak terbukti", "sebagian benar", "sebagian salah",
    "half true", "partly", "mostly false", "mixture", "not true", "not accurate",
    "misleading", "menyesatkan", "missing context", "tanpa konteks", "unproven",
    "belum terbukti", "satire", "satir", "parodi", "out of context",
]
NEGATION_FALSE = ["tidak benar", "bukan fakta", "not true", "not accurate", "mostly false"]
FALSE_WORDS = [
    "hoaks", "hoax", "salah", "palsu", "keliru", "bohong", "disinformasi", "misinformasi",
    "false", "fake", "fabricated", "pants on fire", "altered", "manipulated", "manipulasi",
]
TRUE_WORDS = ["benar", "fakta", "true", "correct", "accurate", "valid", "terbukti"]
MISLEADING = [
    "menyesatkan", "misleading", "sebagian", "half", "partly", "mixture",
    "missing context", "tanpa konteks", "out of context", "satire", "satir", "parodi",
]


def load_env(path=".env"):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def map_rating(raw=""):
    t = str(raw).lower().strip()
    has = lambda words: any(w in t for w in words)
    if has(NEGATION_OR_PARTIAL):
        if has(NEGATION_FALSE):
            return {"status": "red"}
        return {"status": "yellow", "variant": "misleading" if has(MISLEADING) else "unknown", "rawRating": raw}
    if has(FALSE_WORDS):
        return {"status": "red"}
    if has(TRUE_WORDS):
        return {"status": "blue"}
    return {"status": "yellow", "variant": "unknown", "rawRating": raw}


def trim_to_core(text):
    if len(text) <= MAX_LEN:
        return text
    cut = text[:MAX_LEN]
    end = max(cut.rfind("."), cut.rfind("!"), cut.rfind("?"))
    return cut[: end + 1] if end > 80 else cut


URL_RE = re.compile(r"^https?://\S+$", re.I)
PRIVATE_HOST_RE = re.compile(
    r"^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|172\.(1[6-9]|2\d|3[01])\.|.*\.local$)", re.I
)


def extract_claim_from_url(raw_url):
    u = urlparse(raw_url)
    if u.scheme not in ("http", "https") or not u.hostname or PRIVATE_HOST_RE.match(u.hostname):
        return None
    try:
        req = Request(raw_url, headers={"User-Agent": "Mozilla/5.0 (compatible; BenerGasihBot/1.0)"})
        with urlopen(req, timeout=5) as resp:
            chunk = resp.read(120_000).decode("utf-8", errors="ignore")
        patterns = [
            r'<meta[^>]+(?:property|name)=["\'](?:og:title|twitter:title)["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:title|twitter:title)["\']',
            r"<title[^>]*>([\s\S]*?)</title>",
        ]
        for pat in patterns:
            m = re.search(pat, chunk, re.I)
            if m:
                title = html.unescape(re.sub(r"\s+", " ", m.group(1))).strip()
                title = re.sub(r"\s+[-|–—]\s+[^-|–—]{2,40}$", "", title).strip()
                if len(title) >= 10:
                    return trim_to_core(title)
    except Exception:
        pass
    parts = [p for p in u.path.split("/") if p]
    best = max(parts, key=len, default="")
    slug = re.sub(r"\.(html?|php|aspx?)$", "", unquote(best), flags=re.I)
    slug = re.sub(r"\s+", " ", re.sub(r"\b\d{4,}\b", "", re.sub(r"[-_]+", " ", slug))).strip()
    return trim_to_core(slug) if len(slug) >= 10 else None


def format_date(iso):
    if not iso:
        return "Tanggal tidak tercatat"
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
        return f"{d.day} {months[d.month - 1]} {d.year}"
    except ValueError:
        return iso


def query_google(claim, api_key):
    qs = urlencode({"query": claim, "pageSize": "5", "key": api_key})
    req = Request(f"https://factchecktools.googleapis.com/v1alpha1/claims:search?{qs}")
    with urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    reviews = [r for c in data.get("claims", []) for r in c.get("claimReview", [])]
    if not reviews:
        return None
    mapped = map_rating(reviews[0].get("textualRating", ""))
    seen, sources = set(), []
    for r in reviews:
        u = r.get("url") or "#"
        if u != "#" and u in seen:
            continue
        seen.add(u)
        sources.append({
            "publisher": (r.get("publisher") or {}).get("name") or (r.get("publisher") or {}).get("site") or "Sumber cek fakta",
            "date": format_date(r.get("reviewDate")),
            "url": u,
        })
        if len(sources) >= 5:
            break
    res = {**mapped, "sources": sources, "provider": "google_factcheck"}
    if res["status"] == "blue":
        res["sourceName"] = sources[0]["publisher"]
    return res


def query_tavily(claim, api_key):
    payload = json.dumps({
        "api_key": api_key,
        "query": claim,
        "search_depth": "basic",
        "max_results": 4,
    }).encode("utf-8")
    req = Request("https://api.tavily.com/search", data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError):
        return None
    items = data.get("results", [])
    if not items:
        return None
    sources = []
    for item in items[:4]:
        host = urlparse(item.get("url", "")).netloc.removeprefix("www.") or "Artikel terkait"
        raw_sn = " ".join(str(item.get("content") or "").split())
        snippet = f"{raw_sn[:177]}..." if len(raw_sn) > 180 else raw_sn
        sources.append({
            "publisher": item.get("title") or host,
            "date": host,
            "snippet": snippet,
            "url": item.get("url") or "#",
        })
    return {"status": "yellow", "variant": "related", "sources": sources, "provider": "tavily"}


def analyze_with_gemini(claim, sources, api_key):
    if sources:
        evidence = "\n".join(
            f"{i + 1}. [{s['date']}] {s['publisher']}: {s.get('snippet') or '(tanpa cuplikan)'}"
            for i, s in enumerate(sources)
        )
    else:
        evidence = "(Tidak ada hasil pencarian yang relevan)"

    prompt = "\n".join([
        "Kamu adalah asisten verifikasi fakta yang objektif dan ringkas (bahasa Indonesia).",
        "Tugasmu menilai klaim berdasarkan bukti pencarian dan fakta umum yang mapan.",
        "Aturan status:",
        '- "red": jika klaim jelas salah, hoaks, mustahil, atau bertentangan langsung dengan fakta/bukti.',
        '- "blue": jika bukti lintas media kredibel jelas mengonfirmasi inti klaim tersebut benar terjadi.',
        '- "yellow": jika bukti belum cukup, klaim menyesatkan/hilang konteks, atau masih berupa rumor.',
        "Balas HANYA JSON valid dengan format:",
        '{"status":"red|yellow|blue","variant":"misleading|related|empty","summary":"Penjelasan objektif 2-3 kalimat. Jika relevan, bedakan fakta inti dan konteks penting."}',
        "",
        f"Klaim: {claim}",
        "Bukti pencarian:",
        evidence,
    ])

    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
    }).encode("utf-8")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    req = Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
        if parsed.get("status") not in ("red", "yellow", "blue") or not parsed.get("summary"):
            return None
        out = {
            "status": parsed["status"],
            "summary": str(parsed["summary"]).strip(),
            "sources": sources,
            "provider": "gemini+tavily",
        }
        if out["status"] == "yellow":
            v = parsed.get("variant")
            out["variant"] = v if v in ("misleading", "related", "empty") else ("related" if sources else "empty")
        return out
    except Exception:
        return None


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/check":
            return self.send_json(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            return self.send_json(400, {"error": "invalid_json", "message": "Format permintaan tidak valid."})

        raw = body.get("claim", "").strip() if isinstance(body.get("claim"), str) else ""
        is_link = bool(URL_RE.match(raw))
        if not is_link and len(raw) < MIN_LEN:
            return self.send_json(400, {"error": "claim_too_short", "message": "Klaim terlalu pendek (minimal 15 karakter)."})

        claim = extract_claim_from_url(raw) if is_link else trim_to_core(raw)
        if not claim:
            return self.send_json(400, {
                "error": "unreadable_link",
                "message": "Judul dari link tidak bisa dibaca. Coba salin teks judul atau klaimnya langsung ya.",
            })

        key = " ".join(claim.lower().split())
        now = time.time()
        hit = CACHE.get(key)
        if hit and now < hit[1]:
            return self.send_json(200, {**hit[0], "scannedClaim": claim, "cached": True})

        gkey = os.environ.get("GOOGLE_FACTCHECK_KEY", "").strip()
        tkey = os.environ.get("TAVILY_KEY", "").strip()
        mkey = os.environ.get("GEMINI_API_KEY", "").strip()
        if not gkey and not tkey and not mkey:
            return self.send_json(503, {
                "error": "missing_api_key",
                "message": "Server belum memiliki API key. Buat file .env dan isi GOOGLE_FACTCHECK_KEY / TAVILY_KEY / GEMINI_API_KEY.",
            })

        try:
            result = query_google(claim, gkey) if gkey else None
            if not result and tkey:
                result = query_tavily(claim, tkey)
            if (not result or result.get("provider") == "tavily") and mkey:
                ai_res = analyze_with_gemini(claim, (result or {}).get("sources", []), mkey)
                if ai_res:
                    result = ai_res
            if not result:
                result = {"status": "yellow", "variant": "empty", "sources": [], "provider": "none"}
            if len(CACHE) >= CACHE_MAX:
                CACHE.pop(next(iter(CACHE)))
            CACHE[key] = (result, now + CACHE_TTL)
            return self.send_json(200, {**result, "scannedClaim": claim, "cached": False})
        except HTTPError as e:
            code = 429 if e.code == 429 else 502
            msg = "Kuota Google Fact Check API sedang habis. Coba lagi nanti." if code == 429 else "Gagal menghubungi layanan cek fakta."
            return self.send_json(code, {"error": "upstream_error", "message": msg})
        except Exception:
            return self.send_json(502, {"error": "upstream_error", "message": "Pemindaian gagal karena gangguan teknis. Ini bukan hasil cek fakta."})


if __name__ == "__main__":
    load_env()
    print(f"BenerGasih berjalan di http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
