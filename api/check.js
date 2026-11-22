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

async function queryTavily(claim, apiKey) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: `cek fakta ${claim}`,
      search_depth: "basic",
      max_results: 3,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const items = Array.isArray(data.results) ? data.results : [];
  if (!items.length) return null;

  // Hasil Tavily SELALU kuning varian "related" (bukan putusan).
  return {
    status: "yellow",
    variant: "related",
    sources: items.slice(0, 3).map((item) => {
      let host = "Artikel terkait";
      try {
        host = new URL(item.url).hostname.replace(/^www\./, "");
      } catch {}
      return {
        publisher: `Artikel terkait — ${item.title || host}`,
        date: host,
        url: item.url || "#",
      };
    }),
    provider: "tavily",
  };
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

  const rawClaim = typeof body?.claim === "string" ? body.claim.trim() : "";
  if (rawClaim.length < MIN_LEN) {
    res.status(400).json({ error: "claim_too_short", message: "Klaim terlalu pendek (minimal 15 karakter)." });
    return;
  }

  const claim = trimToCore(rawClaim);
  const key = normalizeKey(claim);

  // 1. Cek cache dulu
  const cached = getCache(key);
  if (cached) {
    res.status(200).json({ ...cached, cached: true });
    return;
  }

  const googleKey = process.env.GOOGLE_FACTCHECK_KEY;
  const tavilyKey = process.env.TAVILY_KEY;

  if (!googleKey && !tavilyKey) {
    res.status(503).json({
      error: "missing_api_key",
      message: "Server belum memiliki API key. Atur GOOGLE_FACTCHECK_KEY / TAVILY_KEY di environment variable.",
    });
    return;
  }

  try {
    // 2. Google Fact Check API
    let result = null;
    if (googleKey) {
      result = await queryGoogleFactCheck(claim, googleKey);
    }

    // 3. Tavily HANYA kalau Google kosong
    if (!result && tavilyKey) {
      result = await queryTavily(claim, tavilyKey);
    }

    // 4. Kalau keduanya kosong -> kuning varian "empty"
    if (!result) {
      result = { status: "yellow", variant: "empty", sources: [], provider: "none" };
    }

    setCache(key, result);
    res.status(200).json({ ...result, cached: false });
  } catch (err) {
    const code = err?.code || 502;
    res.status(code).json({
      error: code === 429 ? "quota_exceeded" : "upstream_error",
      message: err?.message || "Pemindaian gagal karena gangguan teknis. Ini bukan hasil cek fakta.",
    });
  }
}
