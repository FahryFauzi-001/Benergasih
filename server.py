"""Server lokal tanpa dependensi untuk menjalankan UI + backend /api/check.
Membaca API key dari file .env di folder proyek. Jalankan: python server.py
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from datetime import datetime
import json
import os
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
        "query": f"cek fakta {claim}",
        "search_depth": "basic",
        "max_results": 3,
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
    for item in items[:3]:
        host = urlparse(item.get("url", "")).netloc.removeprefix("www.") or "Artikel terkait"
        sources.append({
            "publisher": f"Artikel terkait — {item.get('title') or host}",
            "date": host,
            "url": item.get("url") or "#",
        })
    return {"status": "yellow", "variant": "related", "sources": sources, "provider": "tavily"}


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
        if len(raw) < MIN_LEN:
            return self.send_json(400, {"error": "claim_too_short", "message": "Klaim terlalu pendek (minimal 15 karakter)."})

        claim = trim_to_core(raw)
        key = " ".join(claim.lower().split())
        now = time.time()
        hit = CACHE.get(key)
        if hit and now < hit[1]:
            return self.send_json(200, {**hit[0], "cached": True})

        gkey = os.environ.get("GOOGLE_FACTCHECK_KEY", "").strip()
        tkey = os.environ.get("TAVILY_KEY", "").strip()
        if not gkey and not tkey:
            return self.send_json(503, {
                "error": "missing_api_key",
                "message": "Server belum memiliki API key. Buat file .env dan isi GOOGLE_FACTCHECK_KEY / TAVILY_KEY.",
            })

        try:
            result = query_google(claim, gkey) if gkey else None
            if not result and tkey:
                result = query_tavily(claim, tkey)
            if not result:
                result = {"status": "yellow", "variant": "empty", "sources": [], "provider": "none"}
            if len(CACHE) >= CACHE_MAX:
                CACHE.pop(next(iter(CACHE)))
            CACHE[key] = (result, now + CACHE_TTL)
            return self.send_json(200, {**result, "cached": False})
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
