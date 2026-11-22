// Pemetaan teks rating bebas -> status.
// URUTAN PENTING: negasi/sebagian dulu -> salah -> benar. Jangan dibalik!
const NEGATION_OR_PARTIAL = [
  "tidak benar", "bukan fakta", "tidak terbukti", "sebagian benar", "sebagian salah",
  "half true", "partly", "mostly false", "mixture", "not true", "not accurate",
  "misleading", "menyesatkan", "missing context", "tanpa konteks", "unproven",
  "belum terbukti", "satire", "satir", "parodi", "out of context",
];
const NEGATION_FALSE = ["tidak benar", "bukan fakta", "not true", "not accurate", "mostly false"];
const FALSE_WORDS = [
  "hoaks", "hoax", "salah", "palsu", "keliru", "bohong", "disinformasi", "misinformasi",
  "false", "fake", "fabricated", "pants on fire", "altered", "manipulated", "manipulasi",
];
const TRUE_WORDS = ["benar", "fakta", "true", "correct", "accurate", "valid", "terbukti"];
const MISLEADING = [
  "menyesatkan", "misleading", "sebagian", "half", "partly", "mixture",
  "missing context", "tanpa konteks", "out of context", "satire", "satir", "parodi",
];

export function mapRating(raw = "") {
  const t = String(raw).toLowerCase().trim();
  const has = (list) => list.some((w) => t.includes(w));

  if (has(NEGATION_OR_PARTIAL)) {
    if (has(NEGATION_FALSE)) return { status: "red" };
    return { status: "yellow", variant: has(MISLEADING) ? "misleading" : "unknown", rawRating: raw };
  }
  if (has(FALSE_WORDS)) return { status: "red" };
  if (has(TRUE_WORDS)) return { status: "blue" };
  return { status: "yellow", variant: "unknown", rawRating: raw };
}
