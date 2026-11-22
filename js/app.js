import { EXAMPLES, MOCK_RESULTS, STATE_PREVIEWS, LOADING_TEXTS } from "./mock-data.js";
import { STATUS, YELLOW_NOTES, ERRORS, VALIDATION } from "./ui-text.js";

const MIN = 15, MAX = 500, MAX_SCANS = 10;
const $ = (id) => document.getElementById(id);
const el = {
  claim: $("claim"), counter: $("counter"), hint: $("hint"), scan: $("scan-btn"),
  examples: $("examples"), preview: $("state-preview"),
  loading: $("loading"), loadingText: $("loading-text"),
  error: $("error"), errorMsg: $("error-msg"), retry: $("retry-btn"),
  result: $("result"), banner: $("banner-label"), icon: $("banner-icon"),
  rclaim: $("result-claim"), note: $("result-note"), sources: $("sources"),
  share: $("share-btn"), reset: $("reset-btn"), toast: $("toast"), logo: $("logo"),
};
let scans = 0;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- input ---------- */
function trimToCore(text) {
  if (text.length <= MAX) return text;
  const cut = text.slice(0, MAX);
  const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return end > 80 ? cut.slice(0, end + 1) : cut;
}
function validate(text) {
  if (!text.trim()) return VALIDATION.empty;
  if (text.trim().length < MIN) return VALIDATION.short;
  return null;
}
el.claim.addEventListener("input", () => {
  const n = el.claim.value.length;
  el.counter.textContent = `${n} / ${MAX}`;
  el.counter.classList.toggle("over", n > MAX);
  el.hint.textContent = n > MAX ? VALIDATION.long : "";
  el.claim.classList.remove("invalid");
});

/* ---------- contoh klaim + pratinjau ---------- */
EXAMPLES.forEach((ex) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip"; b.textContent = ex.label;
  b.addEventListener("click", () => {
    el.claim.value = ex.text; el.claim.dispatchEvent(new Event("input")); el.claim.focus();
    el.claim.dataset.mock = ex.id;
  });
  el.examples.appendChild(b);
});
STATE_PREVIEWS.forEach(([key, label]) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip"; b.textContent = label;
  b.addEventListener("click", () => {
    hideAll();
    if (key === "error") return showError();
    el.rclaim.textContent = el.claim.value || "(contoh klaim untuk pratinjau state)";
    showResult(MOCK_RESULTS[key]);
  });
  el.preview.appendChild(b);
});
el.claim.addEventListener("input", () => { if (!EXAMPLES.some((e) => e.text === el.claim.value)) delete el.claim.dataset.mock; });

/* ---------- state ---------- */
function hideAll() { el.loading.hidden = el.error.hidden = el.result.hidden = true; }
function showError(msg = ERRORS.generic) { el.errorMsg.textContent = msg; el.error.hidden = false; el.error.scrollIntoView({ behavior: "smooth", block: "center" }); }

function showResult(r) {
  const s = STATUS[r.status];
  el.result.className = `result ${r.status}`;
  el.icon.textContent = s.icon;
  el.banner.textContent = s.label;
  el.note.textContent = r.status === "yellow" ? YELLOW_NOTES[r.variant](r) : s.note(r);
  el.sources.replaceChildren(...r.sources.map((x) => {
    const li = document.createElement("li");
    li.innerHTML = `<div><div class="src-name"></div><div class="src-meta"></div></div><a class="src-link" target="_blank" rel="noopener">Baca artikel asli →</a>`;
    li.querySelector(".src-name").textContent = x.publisher;
    li.querySelector(".src-meta").textContent = x.date;
    li.querySelector("a").href = x.url;
    return li;
  }));
  if (!r.sources.length) { const li = document.createElement("li"); li.textContent = "Tidak ada sumber untuk ditampilkan."; el.sources.appendChild(li); }
  el.toast.textContent = "";
  el.result.hidden = false;
  el.result.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  el.result.focus({ preventScroll: true });
}

/* ---------- scan (API) ---------- */
async function scan() {
  const text = el.claim.value;
  const err = validate(text);
  if (err) { el.hint.textContent = err; el.claim.classList.add("invalid"); el.claim.focus(); return; }
  if (scans >= MAX_SCANS) return showError("Batas scan sesi ini sudah tercapai. Muat ulang halaman untuk lanjut.");

  const claim = trimToCore(text.trim());
  hideAll();
  el.scan.disabled = true; el.scan.textContent = "MEMINDAI...";
  el.loading.hidden = false;
  let i = 0; el.loadingText.textContent = LOADING_TEXTS[0];
  const t = setInterval(() => (el.loadingText.textContent = LOADING_TEXTS[++i % LOADING_TEXTS.length]), 900);

  try {
    const res = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      el.loading.hidden = true;
      showError(data.message || ERRORS.generic);
      return;
    }
    scans++;
    el.loading.hidden = true;
    el.rclaim.textContent = claim;
    showResult(data);
  } catch {
    el.loading.hidden = true;
    showError();
  } finally {
    clearInterval(t); el.scan.disabled = false; el.scan.textContent = "SCAN SEKARANG";
  }
}
el.scan.addEventListener("click", scan);
el.retry.addEventListener("click", scan);
el.claim.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") scan(); });

/* ---------- aksi hasil ---------- */
el.reset.addEventListener("click", () => {
  hideAll(); el.claim.value = ""; delete el.claim.dataset.mock; el.claim.dispatchEvent(new Event("input"));
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }); el.claim.focus({ preventScroll: true });
});
el.share.addEventListener("click", async () => {
  const msg = `BenerGasih: "${el.rclaim.textContent}" → ${el.banner.textContent}. Scan dulu, baru share.`;
  try {
    if (navigator.share) await navigator.share({ title: "BenerGasih", text: msg, url: location.href });
    else { await navigator.clipboard.writeText(`${msg} ${location.href}`); el.toast.textContent = "Tersalin ke clipboard."; }
  } catch { el.toast.textContent = "Gagal membagikan. Salin manual ya."; }
});

/* ---------- glitch logo singkat ---------- */
if (!reduceMotion) {
  setInterval(() => { el.logo.classList.add("glitch"); setTimeout(() => el.logo.classList.remove("glitch"), 220); }, 6000);
}
