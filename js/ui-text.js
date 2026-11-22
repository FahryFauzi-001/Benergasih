// Semua teks status di satu tempat: santai di tombol, SERIUS dan jernih di keterangan.
export const STATUS = {
  red: { label: "TERBANTAH", icon: "✕", note: () => "Publisher cek fakta memberi rating salah/hoaks untuk klaim ini." },
  blue: { label: "TERVERIFIKASI", icon: "✓", note: (r) => `Benar menurut ${r.sourceName || r.sources?.[0]?.publisher || "sumber cek fakta"}.` },
  yellow: { label: "BELUM ADA CEK FAKTA", icon: "?" },
};

export const YELLOW_LABELS = {
  misleading: "PERLU KONTEKS",
  empty: "BELUM ADA CEK FAKTA",
  related: "ADA LIPUTAN TERKAIT",
  unknown: "PERLU KONTEKS",
};

export const YELLOW_NOTES = {
  misleading: () => "Publisher menilai klaim ini menyesatkan: ada bagian yang benar, tetapi disajikan tanpa konteks yang utuh. Belum terbukti, bukan berarti salah.",
  empty: () => "Sinyal nggak ketemu, belum ada yang ngecek klaim ini di sumber yang kami pindai. Belum terbukti, bukan berarti salah.",
  related: () => "Tidak ditemukan bantahan cek fakta untuk topik ini, namun ada beberapa liputan berita terkait di bawah. Artikel berita bukan putusan cek fakta — baca sumber aslinya untuk memastikan konteksnya.",
  unknown: (r) => `Rating dari publisher tidak kami kenali: "${r.rawRating}". Kami tidak menebak, baca sumber aslinya. Belum terbukti, bukan berarti salah.`,
};

export const ERRORS = {
  generic: "Pemindaian belum bisa dilakukan karena gangguan teknis atau kuota habis. Ini bukan hasil cek fakta. Coba lagi sebentar lagi.",
};

export const VALIDATION = {
  empty: "Kotak masih kosong. Tempel klaim atau link dulu ya.",
  short: "Terlalu pendek, tulis minimal 15 karakter biar bisa dipindai.",
  long: "Terlalu panjang. Kami akan memotongnya ke kalimat inti saat scan.",
};
