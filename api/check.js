import { mapRating } from "../js/rating-mapper.js";

const MIN_LEN = 15;
const MAX_LEN = 500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam
const CACHE_MAX = 200;
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 menit
const RATE_MAX = 20;

const cache = new Map();
const hits = new Map();

function trimToCore(text) {
  if (text.length <= MAX_LEN) return text;
  const cut = text.slice(0, MAX_LEN);
  const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return end > 80 ? cut.slice(0, end + 1) : cut;
}

const URL_RE = /^https?:\/\/\S+$/i;
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|172\.(1[6-9]|2\d|3[01])\.|.*\.local$)/i;

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function slugToText(urlObj) {
  const parts = urlObj.pathname.split("/").filter(Boolean);
  const best = parts.sort((a, b) => b.length - a.length)[0] || "";
  return decodeURIComponent(best)
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\d{4,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractClaimFromUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST_RE.test(u.hostname)) return null;

  try {
    const res = await fetch(u.href, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BenerGasihBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const html = (await res.text()).slice(0, 120_000);
      const og =
        html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:title|twitter:title)["']/i) ||
        html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (og?.[1]) {
        const title = decodeHtml(og[1]).replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/, "").trim();
        if (title.length >= 10) return trimToCore(title);
      }
    }
  } catch {}

  const slug = slugToText(u);
  return slug.length >= 10 ? trimToCore(slug) : null;
}

function normalizeKey(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { data, exp: Date.now() + CACHE_TTL_MS });
}

function isRateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

function formatDate(iso) {
  if (!iso) return "Tanggal tidak tercatat";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

async function queryGoogleFactCheck(claim, apiKey) {
  const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
  url.searchParams.set("query", claim);
  url.searchParams.set("pageSize", "5");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (res.status === 429) {
    const err = new Error("Kuota Google Fact Check API sedang habis. Coba lagi nanti.");
    err.code = 429;
    throw err;
  }
  if (!res.ok) {
    const err = new Error("Gagal menghubungi layanan cek fakta. Coba lagi sebentar lagi.");
    err.code = 502;
    throw err;
  }
  const data = await res.json();
  const claims = Array.isArray(data.claims) ? data.claims : [];
  const reviews = claims.flatMap((c) => (Array.isArray(c.claimReview) ? c.claimReview : []));
  if (!reviews.length) return null;

  const primary = reviews[0];
  const mapped = mapRating(primary.textualRating || "");
  const seen = new Set();
  const sources = [];
  for (const r of reviews) {
    const u = r.url || "#";
    if (u !== "#" && seen.has(u)) continue;
    seen.add(u);
    sources.push({
      publisher: r.publisher?.name || r.publisher?.site || "Sumber cek fakta",
      date: formatDate(r.reviewDate),
      url: u,
    });
    if (sources.length >= 5) break;
  }

  const result = {
    ...mapped,
    sources,
    provider: "google_factcheck",
  };
  if (result.status === "blue") {
    result.sourceName = sources[0]?.publisher;
  }
  return result;
}

const EXCLUDED_DOMAINS = [
  "linkedin.com", "facebook.com", "instagram.com",
  "tiktok.com", "twitter.com", "x.com", "pinterest.com",
];

function cleanUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|msockid|fbclid|gclid|ref|source)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    return u.href;
  } catch {
    return rawUrl || "#";
  }
}

async function queryTavily(claim, apiKey) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: claim,
      search_depth: "basic",
      max_results: 6,
      exclude_domains: EXCLUDED_DOMAINS,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const items = Array.isArray(data.results) ? data.results : [];

  const seen = new Set();
  const sources = [];
  for (const item of items) {
    if (typeof item.score === "number" && item.score < 0.45) continue;
    const url = cleanUrl(item.url || "#");
    if (url !== "#" && seen.has(url)) continue;
    seen.add(url);

    let host = "Artikel terkait";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {}
    const rawSnippet = String(item.content || "").replace(/\s+/g, " ").trim();
    const snippet = rawSnippet.length > 180 ? `${rawSnippet.slice(0, 177)}...` : rawSnippet;
    sources.push({
      publisher: item.title || host,
      date: host,
      snippet,
      url,
    });
    if (sources.length >= 4) break;
  }

  if (!sources.length) return null;

  // Hasil Tavily SELALU kuning varian "related" (liputan terkait, bukan putusan).
  return {
    status: "yellow",
    variant: "related",
    sources,
    provider: "tavily",
  };
}

async function analyzeWithGemini(claim, sources, apiKey) {
  const evidence = sources.length
    ? sources.map((s, i) => `${i + 1}. [${s.date}] ${s.publisher}: ${s.snippet || "(tanpa cuplikan)"}`).join("\n")
    : "(Tidak ada hasil pencarian yang relevan)";

  const prompt = [
    "Kamu adalah asisten verifikasi fakta yang objektif dan ringkas (bahasa Indonesia).",
    "Tugasmu menilai klaim berdasarkan bukti pencarian dan fakta umum/ilmiah yang mapan.",
    "Aturan status:",
    '- "red": jika klaim jelas salah, hoaks, mustahil secara realita/ilmiah (misal manusia ke Mars saat ini, atau jabatan negara yang jelas keliru), atau bertentangan langsung dengan fakta/bukti.',
    '- "blue": jika fakta mapan atau bukti lintas media kredibel jelas mengonfirmasi inti klaim tersebut benar.',
    '- "yellow": HANYA jika klaim masih mungkin terjadi tapi bukti belum cukup, atau benar sebagian/menyesatkan/hilang konteks.',
    '- "sourcesRelevant": true jika bukti pencarian di bawah benar-benar membahas topik klaim, false jika hasil pencarian melenceng/tidak nyambung.',
    "Balas HANYA JSON valid dengan format:",
    '{"status":"red|yellow|blue","variant":"misleading|related|empty","sourcesRelevant":true,"summary":"Penjelasan objektif 2-3 kalimat. Jika relevan, bedakan fakta inti dan konteks penting."}',
    "",
    `Klaim: ${claim}`,
    "Bukti pencarian:",
    evidence,
  ].join("\n");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return { _aiError: `http_${res.status}` };
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = JSON.parse(text);
    if (!["red", "yellow", "blue"].includes(parsed.status) || !parsed.summary) {
      return { _aiError: "invalid_json" };
    }
    const finalSources = parsed.sourcesRelevant === false ? [] : sources;
    const out = {
      status: parsed.status,
      summary: String(parsed.summary).trim(),
      sources: finalSources,
      provider: "gemini+tavily",
    };
    if (out.status === "yellow") {
      out.variant = ["misleading", "related", "empty"].includes(parsed.variant)
        ? parsed.variant
        : (finalSources.length ? "related" : "empty");
    }
    return out;
  } catch {
    return { _aiError: "timeout_or_network" };
  }
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed", message: "Gunakan metode POST." });
    return;
  }

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    res.status(429).json({
      error: "rate_limited",
      message: "Terlalu banyak permintaan dari perangkat ini. Tunggu beberapa menit lalu coba lagi.",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "invalid_json", message: "Format permintaan tidak valid." });
      return;
    }
  }

  const rawInput = typeof body?.claim === "string" ? body.claim.trim() : "";
  const isLink = URL_RE.test(rawInput);
  if (!isLink && rawInput.length < MIN_LEN) {
    res.status(400).json({ error: "claim_too_short", message: "Klaim terlalu pendek (minimal 15 karakter)." });
    return;
  }

  let claim = isLink ? await extractClaimFromUrl(rawInput) : trimToCore(rawInput);
  if (!claim) {
    res.status(400).json({
      error: "unreadable_link",
      message: "Judul dari link tidak bisa dibaca. Coba salin teks judul atau klaimnya langsung ya.",
    });
    return;
  }

  const key = normalizeKey(claim);

  // 1. Cek cache dulu
  const cached = getCache(key);
  if (cached) {
    res.status(200).json({ ...cached, scannedClaim: claim, cached: true });
    return;
  }

  const googleKey = process.env.GOOGLE_FACTCHECK_KEY;
  const tavilyKey = process.env.TAVILY_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!googleKey && !tavilyKey && !geminiKey) {
    res.status(503).json({
      error: "missing_api_key",
      message: "Server belum memiliki API key. Atur GOOGLE_FACTCHECK_KEY / TAVILY_KEY / GEMINI_API_KEY di environment variable.",
    });
    return;
  }

  try {
    // 2. Google Fact Check API (putusan publisher resmi)
    let result = null;
    if (googleKey) {
      result = await queryGoogleFactCheck(claim, googleKey);
    }

    // 3. Tavily HANYA kalau Google kosong
    if (!result && tavilyKey) {
      result = await queryTavily(claim, tavilyKey);
    }

    // 4. Analisis AI berbasis bukti (Gemini) jika belum ada putusan publisher resmi
    let aiStatus = geminiKey ? "ok" : "missing_key";
    if ((!result || result.provider === "tavily") && geminiKey) {
      const aiResult = await analyzeWithGemini(claim, result?.sources || [], geminiKey);
      if (aiResult && !aiResult._aiError) {
        result = aiResult;
      } else {
        aiStatus = aiResult?._aiError || "error";
      }
    }

    // 5. Kalau semuanya kosong -> kuning varian "empty"
    if (!result) {
      result = { status: "yellow", variant: "empty", sources: [], provider: "none" };
    }

    setCache(key, result);
    res.status(200).json({ ...result, aiStatus, scannedClaim: claim, cached: false });
  } catch (err) {
    const code = err?.code || 502;
    res.status(code).json({
      error: code === 429 ? "quota_exceeded" : "upstream_error",
      message: err?.message || "Pemindaian gagal karena gangguan teknis. Ini bukan hasil cek fakta.",
    });
  }
}
