// Data tiruan untuk fase UI statis. Nanti diganti respons dari /api/check.
export const EXAMPLES = [
  { id: "red", label: "🔴 Air lemon sembuhkan kanker", text: "Minum air lemon hangat setiap pagi bisa menyembuhkan kanker." },
  { id: "yellow", label: "🟡 Vitamin D cegah semua virus", text: "Vitamin D dosis tinggi mencegah semua jenis infeksi virus." },
  { id: "blue", label: "🔵 Cuci tangan kurangi penyakit", text: "Mencuci tangan dengan sabun mengurangi risiko penyebaran penyakit menular." },
];

const src = (publisher, date, url = "#") => ({ publisher, date, url });

export const MOCK_RESULTS = {
  red: {
    status: "red",
    sources: [
      src("Turnbackhoax.id (Mafindo)", "12 Mar 2025"),
      src("Cek Fakta Kompas.com", "14 Mar 2025"),
    ],
  },
  blue: {
    status: "blue",
    sourceName: "Cek Fakta Tempo",
    sources: [src("Cek Fakta Tempo", "2 Feb 2025")],
  },
  "yellow-misleading": {
    status: "yellow", variant: "misleading",
    sources: [src("Cek Fakta Liputan6", "5 Jan 2025")],
  },
  "yellow-empty": { status: "yellow", variant: "empty", sources: [] },
  "yellow-related": {
    status: "yellow", variant: "related",
    sources: [
      { publisher: "Detik Health — Manfaat dan Batas Aman Vitamin D", date: "health.detik.com", snippet: "Para dokter menyebut vitamin D membantu daya tahan tubuh, tetapi tidak mencegah semua jenis infeksi virus.", url: "#" },
      { publisher: "CNN Indonesia — Memahami Peran Vitamin D bagi Imunitas", date: "cnnindonesia.com", snippet: "Konsumsi dosis tinggi tanpa pengawasan medis justru berisiko menimbulkan efek samping.", url: "#" },
    ],
  },
  "yellow-unknown": {
    status: "yellow", variant: "unknown", rawRating: "Needs more context",
    sources: [src("Snopes", "9 Jun 2025")],
  },
};

// Pratinjau state untuk mode demo
export const STATE_PREVIEWS = [
  ["red", "🔴 Terbantah"],
  ["blue", "🔵 Terverifikasi"],
  ["yellow-misleading", "🟡 Menyesatkan"],
  ["yellow-empty", "🟡 Tidak ada hasil"],
  ["yellow-related", "🟡 Artikel terkait"],
  ["yellow-unknown", "🟡 Rating asing"],
  ["error", "⚠ Error"],
];

export const LOADING_TEXTS = [
  "menyusup ke database cek fakta...",
  "membaca arsip para pengecek fakta...",
  "mencocokkan klaim dengan sinyal...",
];
