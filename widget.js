// Gestionale Ledwall – widget Scriptable (caricato dal loader con FEED_TOKEN definito)
// Parametro del widget: calendario (default) | task | checklist | checklist:Nome
const FEED = "https://rliekssnvssbpkjzpash.supabase.co/functions/v1/feed?f=json&t=" + FEED_TOKEN + (typeof SOLO_TURNI !== "undefined" && SOLO_TURNI ? "&solo=turni" : "") + (typeof MIO !== "undefined" && MIO ? "&u=" + MIO : "");
const SITO = "https://ledwall-visuals.github.io/";
const fm = FileManager.local();
const cache = fm.joinPath(fm.documentsDirectory(), "ledwall-cache.json");
let d;
try { d = await new Request(FEED).loadJSON(); fm.writeString(cache, JSON.stringify(d)); }
catch (e) { d = fm.fileExists(cache) ? JSON.parse(fm.readString(cache)) : { persone: [], turni: [], eventi: [], task: [], checklist: [], oggi: new Date().toISOString().slice(0, 10) }; }

const fam = config.widgetFamily || "large";
const PARAM = String(args.widgetParameter || "").split(";")[0].trim();
// MODO fisso nello script (es. "task" o "todo"); per la to-do il parametro del widget può essere il nome della lista
const mode = (typeof MODO !== "undefined" && MODO) ? (MODO === "todo" && PARAM && !/^todo/i.test(PARAM) ? "todo:" + PARAM : MODO) : (PARAM || "calendario");
const BG = new Color("#0f1115"), CELL = new Color("#1b1f27"), TX = new Color("#e8eaef"), MUT = new Color("#7d8491"), ACC = new Color("#4f8cff"), OK = new Color("#2fbf71");
const pers = {}; (d.persone || []).forEach(p => pers[p.nome] = p);
const first = n => String(n || "").trim().split(/\s+/)[0];
const pad = n => String(n).padStart(2, "0");
const ds = dt => dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
const today = ds(new Date());
const turni = {}; (d.turni || []).forEach(t => turni[t.data] = t);
// chi non è admin vede nel calendario solo le domeniche in cui è di turno lui
if (typeof SOLO_TURNI !== "undefined" && SOLO_TURNI && typeof IO !== "undefined" && IO) {
  const io = IO.trim().split(/\s+/)[0].toLowerCase(), mio = n => !!n && n.trim().split(/\s+/)[0].toLowerCase() === io;
  Object.keys(turni).forEach(k => { const t = turni[k]; turni[k] = { data: t.data, mattina: mio(t.mattina) ? t.mattina : "", sera: mio(t.sera) ? t.sera : "" }; });
}
const evOn = s => (d.eventi || []).filter(e => e.dal <= s && s <= e.al);
const taskOn = s => (d.task || []).filter(t => t.scadenza === s);
// Turni di lavoro dal Calendario dell'iPhone: calendario il cui nome contiene "lavoro" (o "work"),
// oppure quello indicato nel parametro, es. "calendario;lavoro=Turni ufficio"
const parti = String(args.widgetParameter || "").split(";").map(x => x.trim());
// default: i calendari "Mattina", "Pomeriggio", "Notte" (o con "lavoro"/"work" nel nome); lavoro=A,B,C per sceglierli
const calNomi = ((parti.find(x => /^lavoro=/i.test(x)) || "").split("=")[1] || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
const hm = dt => pad(dt.getHours()) + ":" + pad(dt.getMinutes());
let lavoro = [];
// i turni di lavoro li vede solo chi ha "const LAVORO = true" nello script (Benni)
if (typeof LAVORO !== "undefined" && LAVORO) try {
  const cals = (await Calendar.forEvents()).filter(c => calNomi.length ? calNomi.includes(c.title.trim().toLowerCase()) : /^(mattin[ao]|pomeriggio|notte)$/i.test(c.title.trim()));
  if (cals.length) {
    const da = new Date(); da.setDate(1); da.setDate(da.getDate() - 7); da.setHours(0, 0, 0, 0);
    const a = new Date(da); a.setDate(a.getDate() + 60);
    lavoro = (await CalendarEvent.between(da, a, cals)).map(e => ({ s: e.startDate, e: e.endDate, all: e.isAllDay, t: e.title, cal: e.calendar.title, col: e.calendar.color }));
  }
} catch (e) { lavoro = []; }
// ── Ferie e chiusure dal portale del lavoro (PubblicaWeb – Studio Paladin) ──
// Il widget entra nel portale con codice fiscale e password salvati nel Portachiavi di Scriptable (mai nel codice),
// cerca i documenti con "Ferie" o "Chiusure" nel nome, legge le date dal PDF e al posto del turno mostra "Ferie".
// La prima volta va avviato dall'app Scriptable: chiede codice fiscale e password.
const PORTALE = "https://pubblicazione.dataservices.it/pubblicaweb/studiopaladin";
const KC_CF = "portale-lavoro-cf", KC_PW = "portale-lavoro-pw";
// il mio reparto e la mia linea (Produzione, Superfici, linea Bos5); nel loader si possono cambiare con const REPARTO = "a, b, c"
const MIEI = String(typeof REPARTO !== "undefined" && REPARTO ? REPARTO : "Produzione, Superfici, Bos5").toLowerCase().split(",").map(x => x.trim().replace(/\s+/g, "")).filter(Boolean);
const ALTRI = ["uffici", "ufficio", "magazzino", "logistica", "amministrazione", "commerciale", "profili", "montaggio", "tamburato"];
const MESI = { gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5, luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11 };
const RE_MESE = "(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)";
const isoG = (y, m, g) => y + "-" + String(m + 1).padStart(2, "0") + "-" + String(g).padStart(2, "0");

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

// testo del PDF con pdf.js dentro un WebView (Scriptable non sa leggere i PDF da solo)
async function testoPdf(dati) {
  const wv = new WebView();
  const v = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/";
  await wv.loadHTML(`<script src="${v}pdf.min.js"></script><script src="${v}pdf.worker.min.js"></script>`);
  return await wv.evaluateJavaScript(`(async()=>{try{
    const b=atob(${JSON.stringify(dati.toBase64String())}),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
    const doc=await pdfjsLib.getDocument({data:u,isEvalSupported:false}).promise;let s="";
    for(let p=1;p<=doc.numPages;p++){const c=await (await doc.getPage(p)).getTextContent();s+=c.items.map(x=>x.str+(x.hasEOL?"\\n":"")).join("")+"\\n";}
    completion(s)}catch(e){completion("ERRORE "+e)}})()`, true);
}

async function portale(percorso, token, metodo, corpo) {
  const r = new Request(PORTALE + percorso); r.timeoutInterval = 20;
  r.headers = Object.assign({ Accept: "application/json" }, token ? { "X-Auth-Token": token } : {}, corpo ? { "Content-Type": "application/json" } : {});
  if (metodo) r.method = metodo; if (corpo) r.body = JSON.stringify(corpo);
  const j = await r.loadJSON();
  if (r.response && r.response.statusCode >= 400) throw new Error("portale " + r.response.statusCode + " " + percorso);
  return j;
}

// tutti gli oggetti dentro una risposta JSON (alberi di cartelle, liste annidate)
function oggetti(x, out) { out = out || []; if (Array.isArray(x)) x.forEach(y => oggetti(y, out)); else if (x && typeof x === "object") { out.push(x); Object.values(x).forEach(y => { if (y && typeof y === "object") oggetti(y, out); }); } return out; }

async function credenziali(chiedi) {
  if (!chiedi && Keychain.contains(KC_CF) && Keychain.contains(KC_PW)) return [Keychain.get(KC_CF), Keychain.get(KC_PW)];
  if (config.runsInWidget) return null;
  const a = new Alert(); a.title = "Portale del lavoro"; a.message = "Codice fiscale e password del portale PubblicaWeb. Restano solo nel Portachiavi di questo iPhone.";
  a.addTextField("Codice fiscale", Keychain.contains(KC_CF) ? Keychain.get(KC_CF) : ""); a.addSecureTextField("Password", "");
  a.addAction("Salva"); a.addCancelAction("Non ora");
  if (await a.presentAlert() < 0) return null;
  const cf = a.textFieldValue(0).trim().toUpperCase(), pw = a.textFieldValue(1);
  if (!cf || !pw) return null;
  Keychain.set(KC_CF, cf); Keychain.set(KC_PW, pw); return [cf, pw];
}

// giorni di ferie: dalla cache (aggiornata al massimo ogni 6 ore); i PDF già letti non si riscaricano
async function caricaFerie() {
  const fc = fm.joinPath(fm.documentsDirectory(), "ledwall-ferie.json");
  let c = { agg: 0, doc: {} };
  try { if (fm.fileExists(fc)) c = JSON.parse(fm.readString(fc)); } catch (e) {}
  const giorni = () => [...new Set(Object.values(c.doc).flatMap(x => x.date || []))];
  if (Date.now() - (c.agg || 0) < 6 * 3600e3 && !(!config.runsInWidget && c.errore)) return giorni();
  try {
    let cr = await credenziali(false); if (!cr) return giorni();
    let login = await portale("/api/v1/account", null, "POST", { username: cr[0], password: cr[1], twoFactorEnabled: false }).catch(() => null);
    if ((!login || !login.AuthToken) && !config.runsInWidget && (cr = await credenziali(true))) login = await portale("/api/v1/account", null, "POST", { username: cr[0], password: cr[1], twoFactorEnabled: false }).catch(() => null);
    if (!login || !login.AuthToken) throw new Error("accesso al portale non riuscito");
    if (login.OtpRequired) throw new Error("il portale chiede il codice OTP");
    const tk = login.AuthToken;
    const repo = oggetti(await portale("/api/v2/repositories", tk)).filter(x => x.Id != null);
    const docs = {};
    for (const rp of repo) {
      const percorsi = new Set(["/"]);
      try { oggetti(await portale("/api/v3/Folders/GetTree?repositoryId=" + rp.Id + "&path=%2F&unread=true", tk)).forEach(o => { const p = (o.data && o.data.path) || o.path || o.Path; if (typeof p === "string") percorsi.add(p.startsWith("/") ? p : "/" + p); }); } catch (e) {}
      for (const p of percorsi) {
        let l; try { l = await portale("/api/v1/Documents?repositoryId=" + rp.Id + "&path=" + encodeURIComponent(p), tk); } catch (e) { continue; }
        oggetti(l).filter(o => o.Id != null && typeof (o.Name || o.FileName) === "string").forEach(o => docs[o.Id] = o.Name || o.FileName);
      }
    }
    for (const [id, nome] of Object.entries(docs)) {
      if (!eDiFerie(nome) || (c.doc[id] && c.doc[id].date)) continue;
      const r = new Request(PORTALE + "/api/v1/DocumentDownload?Id=" + encodeURIComponent(id)); r.headers = { "X-Auth-Token": tk }; r.timeoutInterval = 30;
      let dati = await r.load();
      // se il portale risponde con il link firmato invece del file, scarico il PDF da lì
      if (!dati.toRawString || !String(dati.toRawString() || "").startsWith("%PDF")) { const u = (String(dati.toRawString() || "").match(/https:[^"\s]+/) || [])[0]; if (u) dati = await new Request(u.replace(/\\u0026/g, "&")).load(); }
      const testo = String(await testoPdf(dati));
      if (testo.startsWith("ERRORE")) throw new Error(nome + ": " + testo);
      // l'intestazione del comunicato dice a chi è rivolto (es. "SUPERFICI, PROFILI, MONTAGGIO ... (Produzione e Uffici)")
      c.doc[id] = { nome, date: perMe(testo.slice(0, 500)) ? dateFerie(testo, nome) : [] };
    }
    try { await portale("/api/v1/account/logout?authToken=" + encodeURIComponent(tk), tk, "DELETE"); } catch (e) {}
    c.agg = Date.now(); c.errore = null;
  } catch (e) { c.errore = String(e && e.message || e); c.agg = Date.now() - 5 * 3600e3; } // riprova fra un'ora
  fm.writeString(fc, JSON.stringify(c));
  if (!config.runsInWidget) console.log("Ferie dal portale: " + (c.errore ? "ERRORE " + c.errore : Object.values(c.doc).map(x => x.nome + " → " + x.date.join(", ")).join("\n")));
  return giorni();
}

// sostituisce i turni con "Ferie" nei giorni di ferie: il turno viene spezzato e al suo posto c'è una barra "Ferie"
function applicaFerie(lav, ferie) {
  if (!ferie.length) return lav;
  const F = new Set(ferie), g0 = s => new Date(s + "T00:00"), dopo = s => { const x = new Date(s + "T12:00"); x.setDate(x.getDate() + 1); return ds(x); };
  const out = [];
  lav.forEach(l => {
    if (!l.all) { if (!F.has(ds(l.s))) out.push(l); return; }
    let s = ds(l.s), fine = ds(new Date(l.e.getTime() - 1)), da = null;
    for (; s <= fine; s = dopo(s)) {
      if (!F.has(s)) { if (!da) da = s; }
      else if (da) { out.push(Object.assign({}, l, { s: g0(da), e: g0(s) })); da = null; }
    }
    if (da) out.push(Object.assign({}, l, { s: g0(da), e: g0(dopo(fine)) }));
  });
  // una barra "Ferie" per ogni periodo di giorni consecutivi
  const ord = [...F].sort(); let i = 0;
  while (i < ord.length) { let j = i; while (j + 1 < ord.length && ord[j + 1] === dopo(ord[j])) j++; out.push({ s: g0(ord[i]), e: g0(dopo(ord[j])), all: true, t: "Ferie", cal: "Ferie", col: { hex: "30d158" }, ferie: true }); i = j + 1; }
  return out;
}
if (typeof LAVORO !== "undefined" && LAVORO) try { lavoro = applicaFerie(lavoro, await caricaFerie()); } catch (e) {}
// un turno può durare più giorni (es. Mattina da lunedì a venerdì): lo segno su ogni giorno lun-ven del periodo
const fineGiorno = l => ds(l.all ? new Date(l.e.getTime() - 1) : l.e);
const lavOn = s => { const g = new Date(s + "T12:00").getDay(); if (g === 0 || g === 6) return []; return lavoro.filter(l => ds(l.s) <= s && s <= fineGiorno(l)); };
// orari: dall'evento se ha un orario, altrimenti quelli standard del turno
const ORE = { mattina: "6–14", mattino: "6–14", pomeriggio: "14–22", notte: "22–6", ferie: "" };
const corto = x => x.replace(":00", "");
const orario = l => (!l.all && ds(l.s) === ds(l.e)) ? corto(hm(l.s)) + "–" + corto(hm(l.e)) : (!l.all ? corto(hm(l.s)) + "–" + corto(hm(l.e)) : (ORE[(l.cal || "").trim().toLowerCase()] || ""));
const lavTxt = l => orario(l) || (l.cal || l.t || "Lavoro");
// inizio e fine reali del turno (per gli eventi "tutto il giorno" uso gli orari standard del turno)
const ORE_H = { mattina: [6, 14], mattino: [6, 14], pomeriggio: [14, 22], notte: [22, 6], ferie: [0, 24] };
function intervallo(l) {
  if (!l.all) return [l.s, l.e];
  const h = ORE_H[(l.cal || "").trim().toLowerCase()] || [8, 17];
  const a = new Date(l.s); a.setHours(h[0], 0, 0, 0);
  const b = new Date(fineGiorno(l) + "T12:00"); if (h[1] <= h[0]) b.setDate(b.getDate() + 1); b.setHours(h[1], 0, 0, 0);
  return [a, b];
}
// registratore di disegno: le stesse istruzioni vengono disegnate in un canvas (WebView) per poter "ritagliare" la scritta
// dalla barra (con la tinta di iOS ogni colore diventa bianco, un buco invece resta del colore dello sfondo).
// Se il WebView non è disponibile si ridisegna tutto con DrawContext come prima.
class PathR { constructor() { this.o = []; } move(p) { this.o.push(["m", p.x, p.y]); } addLine(p) { this.o.push(["l", p.x, p.y]); } addQuadCurve(p, k) { this.o.push(["q", k.x, k.y, p.x, p.y]); } addRoundedRect(r, a) { this.o.push(["r", r.x, r.y, r.width, r.height, a]); } closeSubpath() { this.o.push(["z"]); } }
class Rec {
  constructor(w, h) { this.w = w; this.h = h; this.ops = []; this.st = {}; }
  addPath(p) { this.p = p.o; } setFillColor(c) { this.st.f = [c.hex, c.alpha]; } setStrokeColor(c) { this.st.s = [c.hex, c.alpha]; } setLineWidth(w) { this.st.lw = w; }
  fillPath() { this.ops.push({ k: "fp", p: this.p, f: this.st.f }); } strokePath() { this.ops.push({ k: "sp", p: this.p, s: this.st.s, lw: this.st.lw }); }
  fillRect(r) { this.ops.push({ k: "fr", r: [r.x, r.y, r.width, r.height], f: this.st.f }); }
  testo(t, r, col, buco) { this.ops.push({ k: "tx", t, r: [r.x, r.y, r.width, r.height], c: col, buco }); }
}
let WV = null;
async function inCanvas(rec) {
  if (WV === false) return null;
  try {
    if (!WV) { WV = new WebView(); await WV.loadHTML("<canvas id=c></canvas>"); }
    const js = `(function(R){const S=3,c=document.getElementById('c');c.width=R.w*S;c.height=R.h*S;const k=c.getContext('2d');k.scale(S,S);
const col=f=>{const h=f[0].replace('#','');return 'rgba('+parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16)+','+f[1]+')'};
const path=o=>{k.beginPath();o.forEach(a=>{if(a[0]=='m')k.moveTo(a[1],a[2]);else if(a[0]=='l')k.lineTo(a[1],a[2]);else if(a[0]=='q')k.quadraticCurveTo(a[1],a[2],a[3],a[4]);else if(a[0]=='r')k.roundRect(a[1],a[2],a[3],a[4],a[5]);else k.closePath()})};
R.ops.forEach(o=>{k.globalCompositeOperation='source-over';
if(o.k=='fp'){path(o.p);k.fillStyle=col(o.f);k.fill()}
else if(o.k=='sp'){path(o.p);k.strokeStyle=col(o.s);k.lineWidth=o.lw||1;k.stroke()}
else if(o.k=='fr'){k.fillStyle=col(o.f);k.fillRect(o.r[0],o.r[1],o.r[2],o.r[3])}
else if(o.k=='tx'){k.font='800 8px -apple-system,system-ui';k.textAlign='center';k.textBaseline='middle';if(o.buco)k.globalCompositeOperation='destination-out';k.fillStyle=o.buco?'#000':col(o.c);k.fillText(o.t,o.r[0]+o.r[2]/2,o.r[1]+o.r[3]/2)}});
return c.toDataURL('image/png')})(${JSON.stringify({ w: rec.w, h: rec.h, ops: rec.ops })})`;
    const url = await WV.evaluateJavaScript(js);
    return Image.fromData(Data.fromBase64String(String(url).split(",")[1]));
  } catch (e) { WV = false; return null; }
}
function inDrawContext(rec) {
  const c = new DrawContext(); c.size = new Size(rec.w, rec.h); c.opaque = false; c.respectScreenScale = true;
  const path = o => { const p = new Path(); o.forEach(a => { if (a[0] == "m") p.move(new Point(a[1], a[2])); else if (a[0] == "l") p.addLine(new Point(a[1], a[2])); else if (a[0] == "q") p.addQuadCurve(new Point(a[3], a[4]), new Point(a[1], a[2])); else if (a[0] == "r") p.addRoundedRect(new Rect(a[1], a[2], a[3], a[4]), a[5], a[5]); else p.closeSubpath(); }); return p; };
  rec.ops.forEach(o => {
    if (o.k == "fp") { c.addPath(path(o.p)); c.setFillColor(new Color(o.f[0], o.f[1])); c.fillPath(); }
    else if (o.k == "sp") { c.addPath(path(o.p)); c.setStrokeColor(new Color(o.s[0], o.s[1])); c.setLineWidth(o.lw || 1); c.strokePath(); }
    else if (o.k == "fr") { c.setFillColor(new Color(o.f[0], o.f[1])); c.fillRect(new Rect(o.r[0], o.r[1], o.r[2], o.r[3])); }
    else if (o.k == "tx") { c.setFont(Font.heavySystemFont(8)); c.setTextColor(o.buco ? new Color("#000000", 0.85) : new Color(o.c[0], o.c[1])); c.setTextAlignedCenter(); c.drawTextInRect(o.t, new Rect(o.r[0], o.r[1] + 4, o.r[2], o.r[3])); }
  });
  return c;
}
async function disegna(rec) { return (await inCanvas(rec)) || inDrawContext(rec); }

// barra dei turni di lavoro su una settimana: una riga continua da lunedì all'ora di inizio fino all'ora di fine
function barreSettimana(lunedi, larg, alt, cw, gap, celle) {
  const c = new Rec(larg, alt);
  // sfondo delle celle disegnato qui sotto, così le barre stanno sopra
  (celle || []).forEach((k, i) => { if (!k) return; const p = new PathR(); p.addRoundedRect(new Rect(i * (cw + gap), 0, cw, alt), 6, 6); c.addPath(p); c.setFillColor(new Color("#ffffff", k === "dim" ? 0.03 : 0.08)); c.fillPath(); });
  const t0 = new Date(lunedi); t0.setHours(0, 0, 0, 0); const t1 = new Date(t0); t1.setDate(t1.getDate() + 7);
  const xOf = dt => { const g = (dt - t0) / 864e5; const di = Math.min(6, Math.max(0, Math.floor(g))); return Math.min(larg, Math.max(0, di * (cw + gap) + (g - di) * cw)); };
  const ora = new Date(), m0 = new Date(ora.getFullYear(), ora.getMonth(), 1), m1 = new Date(ora.getFullYear(), ora.getMonth() + 1, 1);
  const xm0 = m0 <= t0 ? -1e4 : m0 >= t1 ? 1e4 : xOf(m0), xm1 = m1 >= t1 ? 1e4 : m1 <= t0 ? -1e4 : xOf(m1);
  const y = Math.round(alt / 2 - 5), hb = 18;
  // PIENO = 0.8: con la tinta di iOS le parti opache diventano bianche e la scritta sparirebbe
  const PIENO = 0.8, DIM = 0.15, F = cw; // la sfumatura finisce entro il primo giorno fuori dal mese
  const liscio = t => t * t * (3 - 2 * t);
  // trasparenza in base alla posizione: piena nel mese, sfuma dolcemente oltre il confine
  const alfa = x => { const d = Math.max(xm0 - x, x - xm1, 0); if (d <= 0) return PIENO; if (d >= F) return DIM; return PIENO - (PIENO - DIM) * liscio(d / F); };
  const barre = [];
  lavoro.forEach(l => {
    const [a, b] = intervallo(l); if (b <= t0 || a >= t1) return;
    const x0 = xOf(a < t0 ? t0 : a), x1 = xOf(b > t1 ? t1 : b); if (x1 - x0 < 3) return;
    barre.push([x0, x1]);
    const col = l.col ? l.col.hex : "ff9f0a", r = 4;
    // tratti con la stessa trasparenza uniti in una sola forma; arrotondati solo gli estremi esterni (niente righine o giunture)
    const pezzo = (u, v, a, sx2, dx2) => {
      const p = new PathR(), L = sx2 ? r : 0, R = dx2 ? r : 0;
      p.move(new Point(u + L, y)); p.addLine(new Point(v - R, y));
      if (R) p.addQuadCurve(new Point(v, y + r), new Point(v, y)); p.addLine(new Point(v, y + hb - R));
      if (R) p.addQuadCurve(new Point(v - r, y + hb), new Point(v, y + hb)); p.addLine(new Point(u + L, y + hb));
      if (L) p.addQuadCurve(new Point(u, y + hb - r), new Point(u, y + hb)); p.addLine(new Point(u, y + L));
      if (L) p.addQuadCurve(new Point(u + r, y), new Point(u, y)); p.closeSubpath();
      c.addPath(p); c.setFillColor(new Color(col, a)); c.fillPath();
    };
    let sx = x0, sa = alfa(x0 + 0.5);
    for (let x = Math.floor(x0) + 1; x < x1; x += 1) { const a2 = alfa(x + 0.5); if (Math.abs(a2 - sa) > 0.004) { pezzo(sx, x, sa, sx === x0, false); sx = x; sa = a2; } }
    pezzo(sx, x1, sa, sx === x0, true);
    const ia = Math.max(x0, xm0), ib = Math.min(x1, xm1), dentro = ib - ia > 30;
    const ta = dentro ? ia : x0, tb = dentro ? ib : x1;
    if (tb - ta > 24) c.testo((l.cal || "Lavoro").toUpperCase(), new Rect(ta, y, tb - ta, hb), ["ffffff", 0.4], dentro);
  });
  // giorno di oggi: solo una cornice, interrotta dove passa una barra
  const oggi0 = new Date(); oggi0.setHours(0, 0, 0, 0); const gi = Math.round((oggi0 - t0) / 864e5);
  if (gi >= 0 && gi < 7) {
    const L = gi * (cw + gap) + 1, R = L + cw - 2, T = 1, B = alt - 1, k = 6;
    const sopra = barre.some(([u, v]) => u < R && v > L);
    c.setStrokeColor(new Color("#4f8cff")); c.setLineWidth(2);
    const arco = (pts) => { const p = new PathR(); p.move(pts[0]); for (let q = 1; q < pts.length; q++) p.addLine(pts[q]); c.addPath(p); c.strokePath(); };
    const P = (x, yy) => new Point(x, yy);
    if (!sopra) { const p = new PathR(); p.addRoundedRect(new Rect(L, T, cw - 2, alt - 2), k, k); c.addPath(p); c.strokePath(); }
    else {
      const ya = y - 2, yb = y + hb + 2;
      arco([P(L, ya), P(L, T + k), P(L + 1.8, T + 1.8), P(L + k, T), P(R - k, T), P(R - 1.8, T + 1.8), P(R, T + k), P(R, ya)]);
      arco([P(L, yb), P(L, B - k), P(L + 1.8, B - 1.8), P(L + k, B), P(R - k, B), P(R - 1.8, B - 1.8), P(R, B - k), P(R, yb)]);
    }
  }
  return c;
}
// prossima domenica (oggi compreso)
const nx = Object.values(turni).sort((a, b) => a.data.localeCompare(b.data)).find(t => t.data >= today && (t.mattina || t.sera));
const nxNome = nx ? (nx.mattina === nx.sera ? first(nx.mattina) : [nx.mattina, nx.sera].filter(Boolean).map(first).join(" / ")) : "";

function circle(nome, size, alpha) {
  const p = pers[nome] || { iniziali: first(nome).slice(0, 2).toUpperCase(), colore: "#666666" };
  const c = new DrawContext(); c.size = new Size(size, size); c.opaque = false; c.respectScreenScale = true;
  // semi-trasparente: resta leggibile con la tinta iOS
  c.setFillColor(new Color(p.colore, alpha == null ? 0.75 : alpha)); c.fillEllipse(new Rect(0, 0, size, size)); c.setStrokeColor(new Color("#ffffff", alpha == null ? 0.5 : 0.25)); c.setLineWidth(size * 0.07); c.strokeEllipse(new Rect(size * 0.04, size * 0.04, size * 0.92, size * 0.92));
  c.setFont(Font.boldSystemFont(size * 0.42)); c.setTextColor(new Color("#ffffff", alpha == null ? 1 : 0.75)); c.setTextAlignedCenter();
  c.drawTextInRect(p.iniziali || "?", new Rect(0, size * 0.25, size, size * 0.6));
  return c.getImage();
}
function txt(stack, s, font, color) { const t = stack.addText(s); t.font = font; t.textColor = color || TX; t.lineLimit = 1; return t; }

const w = new ListWidget();
w.backgroundColor = BG; w.url = SITO; w.setPadding(10, 10, 10, 10);

// barra di avanzamento (fatti / totale)
function barra(fatti, tot, larg, col) {
  const c = new DrawContext(); c.size = new Size(larg, 5); c.opaque = false; c.respectScreenScale = true;
  const p = new Path(); p.addRoundedRect(new Rect(0, 0, larg, 5), 2.5, 2.5); c.addPath(p); c.setFillColor(new Color("#ffffff", 0.12)); c.fillPath();
  const k = tot ? Math.max(5, larg * fatti / tot) : 0;
  if (k) { const q = new Path(); q.addRoundedRect(new Rect(0, 0, k, 5), 2.5, 2.5); c.addPath(q); c.setFillColor(col); c.fillPath(); }
  return c.getImage();
}
const WLARG = fam === "small" ? 130 : 300;
const VERDE = new Color("#30d158"), ROSSO = new Color("#ff453a");
const pallino = (r, pieno, col) => { const t = r.addText(pieno ? "●" : "○"); t.font = Font.systemFont(13); t.textColor = col || MUT; return t; };

if (mode.toLowerCase().startsWith("task")) {
  w.url = SITO + "#task";
  const h = w.addStack(); h.centerAlignContent();
  txt(h, "Task", Font.heavySystemFont(fam === "small" ? 15 : 17), TX); h.addSpacer();
  txt(h, String(d.task.length), Font.heavySystemFont(fam === "small" ? 15 : 17), ACC);
  w.addSpacer(8);
  const max = fam === "small" ? 4 : fam === "medium" ? 4 : 11;
  if (!d.task.length) { w.addSpacer(); txt(w, "Niente da fare 🎉", Font.systemFont(13), MUT); }
  d.task.slice(0, max).forEach((t, i) => {
    const r = w.addStack(); r.centerAlignContent(); r.spacing = 6;
    const scad = t.scadenza && t.scadenza < today;
    pallino(r, false, scad ? ROSSO : ACC);
    const tt = txt(r, (t.mio ? "🔒 " : "") + t.testo, Font.mediumSystemFont(13)); tt.lineLimit = 1;
    r.addSpacer();
    if (fam !== "small") {
      if (t.scadenza) txt(r, new Date(t.scadenza + "T12:00").toLocaleDateString("it-IT", { day: "numeric", month: "short" }), Font.systemFont(11), scad ? ROSSO : MUT);
      if (t.chi) { const im = r.addImage(circle(t.chi, 16)); im.imageSize = new Size(16, 16); }
    }
    if (i < Math.min(max, d.task.length) - 1) w.addSpacer(fam === "large" ? 7 : 5);
  });
  if (d.task.length > max) { w.addSpacer(4); txt(w, "+ altri " + (d.task.length - max), Font.systemFont(11), MUT); }
  w.addSpacer();
} else if (mode.toLowerCase().startsWith("check") || mode.toLowerCase().startsWith("to")) {
  w.url = SITO + "#task";
  const nome = mode.split(":")[1];
  const c = (nome ? d.checklist.find(x => x.nome.toLowerCase() === nome.trim().toLowerCase()) : null) || d.checklist[0];
  if (!c) { txt(w, "To-do list", Font.heavySystemFont(17), TX); w.addSpacer(); txt(w, "Nessuna lista", Font.systemFont(13), MUT); w.addSpacer(); }
  else {
    const n = c.voci.filter(v => v.fatto).length, tot = c.voci.length;
    const h = w.addStack(); h.centerAlignContent();
    const tt = txt(h, (c.mio ? "🔒 " : "") + c.nome, Font.heavySystemFont(fam === "small" ? 14 : 17), TX); tt.lineLimit = 1; h.addSpacer(6);
    txt(h, n + "/" + tot, Font.semiboldSystemFont(13), n === tot && tot ? VERDE : MUT);
    w.addSpacer(6);
    const bi = w.addImage(barra(n, tot, WLARG, n === tot && tot ? VERDE : ACC)); bi.imageSize = new Size(WLARG, 5);
    w.addSpacer(8);
    const max = fam === "small" ? 4 : fam === "medium" ? 4 : 11;
    const L = c.voci.filter(v => !v.fatto).concat(c.voci.filter(v => v.fatto)).slice(0, max);
    if (!tot) txt(w, "Lista vuota", Font.systemFont(13), MUT);
    else if (n === tot) { w.addSpacer(); txt(w, "Tutto fatto ✓", Font.semiboldSystemFont(14), VERDE); }
    else L.forEach((v, i) => {
      const r = w.addStack(); r.centerAlignContent(); r.spacing = 6;
      pallino(r, v.fatto, v.fatto ? VERDE : ACC);
      const t = txt(r, v.testo, Font.mediumSystemFont(13), v.fatto ? MUT : TX); t.lineLimit = 1;
      if (i < L.length - 1) w.addSpacer(fam === "large" ? 7 : 5);
    });
    w.addSpacer();
  }
} else if (fam === "small") {
  // prossima domenica
  txt(w, "⛪ Prossima domenica", Font.boldSystemFont(11), ACC); w.addSpacer(4);
  if (nx) {
    txt(w, new Date(nx.data + "T12:00").toLocaleDateString("it-IT", { day: "numeric", month: "long" }), Font.systemFont(12), MUT);
    w.addSpacer(8);
    const r = w.addStack(); r.centerAlignContent();
    if (nx.mattina === nx.sera) { const im = r.addImage(circle(nx.mattina, 44)); im.imageSize = new Size(44, 44); r.addSpacer(8); txt(r, first(nx.mattina), Font.boldSystemFont(15)); }
    else { [nx.mattina, nx.sera].forEach((n, i) => { const s = r.addStack(); s.layoutVertically(); const im = s.addImage(circle(n, 34)); im.imageSize = new Size(34, 34); txt(s, (i ? "🌙 " : "☀️ ") + first(n), Font.systemFont(10)); r.addSpacer(8); }); }
  }
  let pg = null, pl = null; for (let i = 0; i < 21 && !pl; i++) { const x = new Date(); x.setDate(x.getDate() + i); const l = lavOn(ds(x))[0]; if (l) { pg = x; pl = l; } }
  if (pl) { w.addSpacer(8); const g = ds(pg) === today ? "Oggi" : pg.toLocaleDateString("it-IT", { weekday: "short", day: "numeric" }); txt(w, (pl.ferie ? "🌴 " : "💼 ") + g + " · " + (pl.cal || "Lavoro"), Font.semiboldSystemFont(11), new Color(pl.col ? pl.col.hex : "#ff9f0a")); if (orario(pl)) txt(w, orario(pl), Font.systemFont(10), MUT); }
} else {
  // calendario a griglia: large = mese intero (+ giorni fino alla domenica dopo), medium = settimana corrente e successiva
  const now = new Date(); const y = now.getFullYear(), mo = now.getMonth();
  let days = [];
  if (fam === "large") {
    const f1 = new Date(y, mo, 1), off = (f1.getDay() + 6) % 7;
    for (let i = off; i > 0; i--) days.push({ dt: new Date(y, mo, 1 - i), blank: true });
    const last = new Date(y, mo + 1, 0).getDate();
    for (let g = 1; g <= last; g++) days.push({ dt: new Date(y, mo, g) });
    const x = new Date(y, mo, last + 1);
    do { days.push({ dt: new Date(x), extra: true }); x.setDate(x.getDate() + 1); } while (new Date(x.getTime() - 864e5).getDay() !== 0);
  } else {
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    for (let i = 0; i < 14; i++) { const x = new Date(mon); x.setDate(mon.getDate() + i); days.push({ dt: x, extra: x.getMonth() !== mo }); }
  }
  const head = w.addStack(); head.centerAlignContent();
  const mn = now.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  txt(head, mn.charAt(0).toUpperCase() + mn.slice(1), Font.boldSystemFont(14)); head.addSpacer();
  if (nx) { txt(head, "⛪ " + new Date(nx.data + "T12:00").toLocaleDateString("it-IT", { day: "numeric", month: "short" }) + " · ", Font.systemFont(11), MUT); txt(head, nxNome, Font.boldSystemFont(11), nx.mattina && pers[nx.mattina] ? new Color(pers[nx.mattina].colore) : ACC); }
  else txt(head, "⛪ Ledwall", Font.systemFont(11), MUT);
  w.addSpacer(6);
  const rows = Math.ceil(days.length / 7);
  const cw = 41, ch = fam === "large" ? Math.min(46, Math.floor(280 / rows)) : 46, av = fam === "large" ? 20 : 22;
  const wd = w.addStack();
  ["L", "M", "M", "G", "V", "S", "D"].forEach((l, i) => { const c = wd.addStack(); c.size = new Size(cw + 2, 12); c.addSpacer(); txt(c, l, Font.semiboldSystemFont(9), i === 6 ? ACC : MUT); c.addSpacer(); });
  w.addSpacer(2);
  for (let r = 0; r < rows; r++) {
    const row = w.addStack(); row.spacing = 2;
    if (days[r * 7]) { const celle = days.slice(r * 7, r * 7 + 7).map(x => !x || x.blank ? null : x.extra ? "dim" : "ok"); const img = await disegna(barreSettimana(days[r * 7].dt, 7 * cw + 12, ch, cw, 2, celle)); if (img) row.backgroundImage = img; }
    for (let i = 0; i < 7; i++) {
      const it = days[r * 7 + i]; const cell = row.addStack(); cell.size = new Size(cw, ch); cell.layoutVertically(); cell.cornerRadius = 6;
      if (!it || it.blank) continue;
      const s = ds(it.dt), dim = !!it.extra;
      // sfondo cella e cornice di oggi sono disegnati nell'immagine della riga (sotto le barre)
      cell.setPadding(2, 3, 2, 2);
      const top = cell.addStack(); top.centerAlignContent();
      txt(top, String(it.dt.getDate()), Font.semiboldSystemFont(10), dim ? new Color("#7d8491", 0.6) : (s === today ? TX : MUT));
      top.addSpacer();
      if (evOn(s).length) txt(top, "●", Font.systemFont(7), ACC);
      if (taskOn(s).length) txt(top, "✓", Font.boldSystemFont(8), OK);
      const t = turni[s];
      if (t && (t.mattina || t.sera)) {
        cell.addSpacer();
        const a = cell.addStack(); a.addSpacer();
        if (t.mattina === t.sera) { const im = a.addImage(circle(t.mattina, av, dim ? 0.35 : null)); im.imageSize = new Size(av, av); }
        else { [t.mattina, t.sera].filter(Boolean).forEach(n => { const im = a.addImage(circle(n, av - 6, dim ? 0.35 : null)); im.imageSize = new Size(av - 6, av - 6); }); }
        a.addSpacer();
      }
      if (!(t && (t.mattina || t.sera))) {
        cell.addSpacer();
        const e = evOn(s)[0];
        if (e && fam === "large") txt(cell, e.nome, Font.systemFont(7), ACC);
      }
    }
    if (r < rows - 1) w.addSpacer(2);
  }
}
w.addSpacer();
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
if (config.runsInWidget) Script.setWidget(w);
else if (fam === "small") await w.presentSmall(); else if (fam === "medium") await w.presentMedium(); else await w.presentLarge();
