// Lettura delle date di ferie/chiusura dai comunicati del portale del lavoro (usata dal sito, solo per Benni).
// Stessa logica di widget.js: se cambi qualcosa qui, aggiornala anche lì.
// il mio reparto e la mia linea (Produzione, Superfici, linea Bos5)
var MIEI = ["produzione", "superfici", "bos5"];
var ALTRI = ["uffici", "ufficio", "magazzino", "logistica", "amministrazione", "commerciale", "profili", "montaggio", "tamburato"];
var MESI = { gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5, luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11 };
var RE_MESE = "(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)";
var isoG = (y, m, g) => y + "-" + String(m + 1).padStart(2, "0") + "-" + String(g).padStart(2, "0");

// date di ferie/chiusura scritte in italiano nel comunicato → ["2026-12-07", ...]
function dateFerie(testo, nome, oggi) {
  oggi = oggi || new Date();
  let t = String(testo || "").replace(/[’‘`´]/g, "'").replace(/(\d)\s*[°º]/g, "$1").replace(/\s+/g, " ");
  t = t.replace(new RegExp("[a-zàèéìòù']+,\\s*\\d{1,2}\\s+" + RE_MESE + "\\s+\\d{4}", "gi"), " · "); // data della lettera ("Mansuè, 2 ottobre 2026")
  t = t.replace(/\([^)]*\)/g, " "); // tra parentesi ci sono di solito le eccezioni ("saranno giornate lavorative il 28...")
  const low = t.toLowerCase(), tutto = (String(nome || "") + " " + low).toLowerCase();
  // anno di ogni mese preso dal titolo o dal testo (es. "Dicembre 2026-Gennaio 2027")
  const annoMese = {};
  for (const m of tutto.matchAll(new RegExp(RE_MESE + "\\s+(\\d{4})", "g"))) if (annoMese[m[1]] == null) annoMese[m[1]] = +m[2];
  const anno = (mese, y) => {
    if (y) return +y;
    if (annoMese[mese] != null) return annoMese[mese];
    const yn = String(nome || "").match(/\b(20\d\d)\b/); if (yn) return +yn[1];
    const Y = oggi.getFullYear(), m = MESI[mese], diff = m - oggi.getMonth();
    return diff < -5 ? Y + 1 : diff > 6 ? Y - 1 : Y;
  };
  const out = new Set();
  const aggiungi = (a, b) => { const x = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12); for (let k = 0; x <= b && k < 120; k++) { out.add(isoG(x.getFullYear(), x.getMonth(), x.getDate())); x.setDate(x.getDate() + 1); } };
  // 1) periodi: "dal 24 al 27 dicembre 2026", "dal 31 dicembre 2026 all'8 gennaio 2027", "dal 10 agosto al 21 agosto"
  const giorno = "(?:lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|lunedi|martedi|mercoledi|giovedi|venerdi)?\\s*";
  const rePeriodo = new RegExp("\\bdal(?:l')?\\s*" + giorno + "(\\d{1,2})(?:\\s+" + RE_MESE + ")?(?:\\s+(\\d{4}))?\\s+(?:al(?:l')?|fino al(?:l')?)\\s*" + giorno + "(\\d{1,2})\\s+" + RE_MESE + "(?:\\s+(\\d{4}))?", "g");
  let resto = low.replace(rePeriodo, (all, g1, m1, y1, g2, m2, y2) => {
    const yb = anno(m2, y2), mb = MESI[m2], ma = m1 ? MESI[m1] : mb;
    const ya = y1 ? +y1 : (ma > mb ? yb - 1 : (m1 ? anno(m1, null) : yb));
    const a = new Date(ya, ma, +g1, 12), b = new Date(yb, mb, +g2, 12);
    if (b >= a) aggiungi(a, b);
    return " · ";
  });
  // 2) giorni singoli o elenchi in frasi che parlano di chiusura/ferie: "resterà chiusa lunedì 7 e martedì 8 dicembre"
  resto = resto.replace(/(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|lunedi|martedi|mercoledi|giovedi|venerdi)(?![a-z])/g, " ").replace(/\s+/g, " ");
  resto.split(/[.;:!?]\s/).forEach(fr => {
    if (!/chius|ferie|ponte|festivit|non lavorat/.test(fr) || /riprend|lavorativ|apert|rientr/.test(fr)) return;
    for (const m of fr.matchAll(new RegExp("((?:\\d{1,2}\\s*(?:,|e|ed)\\s*)*\\d{1,2})\\s+" + RE_MESE + "(?:\\s+(\\d{4}))?", "g"))) {
      const y = anno(m[2], m[3]);
      m[1].split(/\s*(?:,|ed|e)\s*/).filter(Boolean).forEach(g => { const n = +g; if (n >= 1 && n <= 31) out.add(isoG(y, MESI[m[2]], n)); });
    }
  });
  return [...out].sort();
}

// è per me? sì se cita il mio reparto o la mia linea, no se cita solo altri reparti, sì se non ne cita nessuno
function perMe(testo) {
  const n = String(testo || "").toLowerCase(), compatto = n.replace(/\s+/g, "");
  if (MIEI.some(r => compatto.includes(r))) return true;
  return !ALTRI.some(r => new RegExp("\\b" + r + "\\b").test(n));
}
// solo i comunicati di ferie/chiusure, e se il nome indica un reparto, solo il mio
function eDiFerie(nome) { return /ferie|chiusur/i.test(String(nome || "")) && perMe(nome); }
