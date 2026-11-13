// Busta paga – widget per Scriptable (misura media 2x4)
// Entra nel portale PubblicaWeb (Studio Paladin) con codice fiscale e password salvati nel Portachiavi
// di questo iPhone, legge i cedolini e mostra netto, differenza col mese prima, lordo, trattenute, ore,
// grafico del netto degli ultimi 12 mesi, ferie e ROL. Sull'iPhone restano solo i numeri (ledwall-buste.json).
// La prima volta avvialo dall'app Scriptable: se serve chiede codice fiscale e password e legge tutti i cedolini.
const PORTALE = "https://pubblicazione.dataservices.it/pubblicaweb/studiopaladin";
const KC_CF = "portale-lavoro-cf", KC_PW = "portale-lavoro-pw";
const fm = FileManager.local();
const BG = new Color("#0f1115"), TX = new Color("#e8eaef"), MUT = new Color("#7d8491"), ACC = new Color("#4f8cff"), VERDE = new Color("#30d158"), ROSSO = new Color("#ff453a"), AMB = new Color("#ff9f0a");
function txt(stack, s, font, color) { const t = stack.addText(s); t.font = font; t.textColor = color || TX; t.lineLimit = 1; return t; }

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

// accesso al portale: token e tutti i documenti di tutte le cartelle { Id: oggetto del portale }
async function apriPortale() {
  let cr = await credenziali(false); if (!cr) return null;
  const entra = c => portale("/api/v1/account", null, "POST", { username: c[0], password: c[1], twoFactorEnabled: false }).catch(() => null);
  let login = await entra(cr);
  if ((!login || !login.AuthToken) && !config.runsInWidget && (cr = await credenziali(true))) login = await entra(cr);
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
      oggetti(l).filter(o => o.Id != null && typeof (o.Name || o.FileName) === "string").forEach(o => docs[o.Id] = o);
    }
  }
  return { tk, docs };
}
async function chiudiPortale(tk) { try { await portale("/api/v1/account/logout?authToken=" + encodeURIComponent(tk), tk, "DELETE"); } catch (e) {} }
const nomeDoc = o => o.Name || o.FileName;
async function scaricaPdf(tk, id) {
  const r = new Request(PORTALE + "/api/v1/DocumentDownload?Id=" + encodeURIComponent(id)); r.headers = { "X-Auth-Token": tk }; r.timeoutInterval = 30;
  let dati = await r.load();
  // se il portale risponde con il link firmato invece del file, scarico il PDF da lì
  if (!dati.toRawString || !String(dati.toRawString() || "").startsWith("%PDF")) { const u = (String(dati.toRawString() || "").match(/https:[^"\s]+/) || [])[0]; if (u) dati = await new Request(u.replace(/\\u0026/g, "&")).load(); }
  return dati;
}


// ── Buste paga dal portale (cedolini "Stampa Libro Unico" di Data Services) ──
// Dal PDF si tengono solo i numeri (nessun dato personale) nella cache ledwall-buste.json sull'iPhone.
const ePaga = o => /cedolin|busta|paga|libro unico|\blul\b/i.test(nomeDoc(o) || "") || /"PGN"/.test(JSON.stringify(o));

// scritte del PDF con la loro posizione: [{ s, x, y, w }] (y dall'alto, in punti; y è la linea di base)
async function vociPdf(dati) {
  const wv = new WebView();
  const v = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/";
  await wv.loadHTML(`<script src="${v}pdf.min.js"></script><script src="${v}pdf.worker.min.js"></script>`);
  const r = await wv.evaluateJavaScript(`(async()=>{try{
    const b=atob(${JSON.stringify(dati.toBase64String())}),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
    const p=await (await pdfjsLib.getDocument({data:u,isEvalSupported:false}).promise).getPage(1),h=p.getViewport({scale:1}).height;
    const c=await p.getTextContent();
    completion(JSON.stringify(c.items.filter(x=>x.str.trim()).map(x=>({s:x.str.trim(),x:x.transform[4],y:h-x.transform[5],w:x.width}))))}catch(e){completion("ERRORE "+e)}})()`, true);
  if (String(r).startsWith("ERRORE")) throw new Error(r);
  return JSON.parse(r);
}

// <cedolino> legge i numeri del cedolino dalle posizioni fisse del modulo (le colonne si riconoscono dal bordo destro del numero)
function leggiCedolino(it) {
  const num = s => { const m = String(s).match(/^(-?)([\d.]+,\d+|\d+)(-?)$/); if (!m) return null; const n = parseFloat(m[2].replace(/\./g, "").replace(",", ".")); return (m[1] || m[3]) ? -n : n; };
  const et = re => it.find(o => re.test(o.s));
  // valore sotto l'etichetta (riga dei valori 5–22 punti più in basso) con il bordo destro fra a e b
  const sotto = (lab, a, b) => { if (!lab) return null; const o = it.find(o => o.y > lab.y + 5 && o.y < lab.y + 22 && o.x + o.w >= a && o.x + o.w <= b && num(o.s) != null); return o ? num(o.s) : null; };
  const netto = et(/^NETTO$/), tot = et(/^RETRIBUZIONE INAIL$/), lordo = et(/^LORDO$/), ore = et(/^ORE LAVORATE$/), soc = et(/RITENUTE SOCIALI$/), irpef = et(/^DEBITO\/CREDITO/), perm = et(/^FLESSIBILITA/);
  if (!netto) return null;
  const MM = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const riga = it.filter(o => o.y > netto.y + 5 && o.y < netto.y + 22 && o.x > 395 && o.x < 520).map(o => o.s).join(" ");
  const anno = (riga.match(/\b(20\d\d)\b/) || [])[1], mi = MM.findIndex(m => new RegExp(m, "i").test(riga));
  const extra = /13|tredic/i.test(riga) ? "13" : /14|quattord/i.test(riga) ? "14" : "";
  const r = {
    mese: anno ? anno + "-" + (mi >= 0 ? String(mi + 1).padStart(2, "0") : "12") + (extra && mi < 0 ? "-" + extra : "") : null,
    netto: sotto(netto, 520, 580),
    competenze: sotto(tot, 455, 512), trattenute: sotto(tot, 518, 580),
    lordo: sotto(lordo, 60, 112), lordoAnno: sotto(lordo, 120, 175),
    ore: sotto(ore, 160, 199), giorni: sotto(ore, 199, 236),
    contributi: sotto(soc, 518, 580), irpef: sotto(irpef, 518, 580),
    ferieMat: sotto(netto, 85, 116), ferieGod: sotto(netto, 116, 145), ferie: sotto(netto, 145, 180),
    rolMat: sotto(netto, 244, 274), rolGod: sotto(netto, 274, 304), rol: sotto(netto, 304, 338),
    permessi: sotto(perm, 145, 172), oreAnno: sotto(netto, 338, 366),
    straordOre: 0, straord: 0, turni: 0
  };
  // righe delle voci: "1.0600 Maggioraz. lavoro turni" … importo nella colonna competenze/trattenute
  it.filter(o => /^\d\.\d{4}\s/.test(o.s)).forEach(v => {
    const st = it.filter(o => Math.abs(o.y - v.y) < 1.5 && o !== v), imp = st.find(o => o.x + o.w > 520 && num(o.s) != null), tm = st.find(o => o.x + o.w > 435 && o.x + o.w < 465 && num(o.s) != null);
    const d = v.s.toLowerCase(), euro = imp ? num(imp.s) : 0;
    if (/straord/.test(d)) { r.straord += euro; r.straordOre += tm && euro > 0 ? num(tm.s) : 0; }
    else if (/magg.*(turn|nott)/.test(d)) r.turni += euro;
  });
  return r.netto != null && r.mese ? r : null;
}
// </cedolino>

// cedolini già letti dalla cache; il portale si ricontrolla al massimo ogni 12 ore
async function caricaBuste() {
  const fc = fm.joinPath(fm.documentsDirectory(), "ledwall-buste.json");
  let c = { agg: 0, doc: {} };
  try { if (fm.fileExists(fc)) c = JSON.parse(fm.readString(fc)); } catch (e) {}
  if (Date.now() - (c.agg || 0) >= 12 * 3600e3 || (!config.runsInWidget && c.errore)) {
    try {
      const P = await apriPortale();
      if (P) {
        // nel widget al massimo 3 PDF nuovi per volta (iOS gli dà poco tempo); dall'app li legge tutti
        let n = config.runsInWidget ? 3 : 999, resto = false;
        for (const [id, o] of Object.entries(P.docs)) {
          if (!ePaga(o) || c.doc[id]) continue;
          if (n-- <= 0) { resto = true; break; }
          c.doc[id] = leggiCedolino(await vociPdf(await scaricaPdf(P.tk, id))) || { no: true };
        }
        await chiudiPortale(P.tk);
        c.agg = resto ? Date.now() - 11.5 * 3600e3 : Date.now(); c.errore = null;
      }
    } catch (e) { c.errore = String(e && e.message || e); c.agg = Date.now() - 11 * 3600e3; } // riprova fra un'ora
    fm.writeString(fc, JSON.stringify(c));
  }
  const m = {}; Object.values(c.doc).filter(x => x && x.mese).forEach(x => m[x.mese] = x);
  const lista = Object.values(m).sort((a, b) => a.mese.localeCompare(b.mese));
  if (!config.runsInWidget) console.log("Buste paga: " + (c.errore ? "ERRORE " + c.errore + "\n" : "") + lista.map(x => x.mese + " netto " + x.netto).join("\n"));
  return { lista, errore: c.errore };
}


const B = await caricaBuste();
const L = B.lista, ult = L[L.length - 1], prec = L[L.length - 2];
const mig = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."), euro = n => n == null ? "–" : mig(n) + " €";
const ore = n => n == null ? "–" : n.toLocaleString("it-IT", { maximumFractionDigits: 2 });
const nomeMese = (k, lungo) => { const [y, m, x] = k.split("-"); if (x) return x + "ª " + y; const s = new Date(+y, +m - 1, 15).toLocaleDateString("it-IT", lungo ? { month: "long", year: "numeric" } : { month: "long" }); return s.charAt(0).toUpperCase() + s.slice(1); };
// grafico a barre del netto (ultimi n mesi), l'ultimo mese evidenziato
function grafico(larg, alt, n, valori) {
  const c = new DrawContext(); c.size = new Size(larg, alt); c.opaque = false; c.respectScreenScale = true;
  const D = L.slice(-n), et = alt >= 50 ? 11 : 0, top = valori ? 11 : 2, h = alt - et - top, max = Math.max(...D.map(x => x.netto), 1), min = Math.min(...D.map(x => x.netto)) * 0.75;
  const sl = larg / n, bw = Math.min(16, sl * 0.62);
  D.forEach((x, i) => {
    const bx = i * sl + (sl - bw) / 2, bh = Math.max(3, h * (x.netto - min) / (max - min || 1)), by = top + h - bh, last = i === D.length - 1;
    const p = new Path(); p.addRoundedRect(new Rect(bx, by, bw, bh), Math.min(4, bw / 3), Math.min(4, bw / 3)); c.addPath(p);
    c.setFillColor(last ? ACC : new Color("#ffffff", 0.22)); c.fillPath();
    c.setTextAlignedCenter();
    if (et) { c.setFont(Font.mediumSystemFont(8)); c.setTextColor(last ? TX : MUT); c.drawTextInRect(x.mese.split("-")[2] ? x.mese.split("-")[2] + "ª" : nomeMese(x.mese).slice(0, 1), new Rect(i * sl, alt - 10, sl, 10)); }
    if (valori && (last || x.netto === max)) { c.setFont(Font.semiboldSystemFont(8)); c.setTextColor(last ? TX : MUT); const lx = Math.min(Math.max(i * sl - 10, 0), larg - sl - 20); c.drawTextInRect(mig(x.netto), new Rect(lx, by - 11, sl + 20, 10)); }
  });
  return c.getImage();
}
const delta = (s, f) => {
  if (!ult || !prec) return;
  const dd = ult.netto - prec.netto, t = txt(s, (dd >= 0 ? "▲ " : "▼ ") + euro(Math.abs(dd)) + " su " + nomeMese(prec.mese).toLowerCase(), f || Font.semiboldSystemFont(10), dd >= 0 ? VERDE : ROSSO);
  t.minimumScaleFactor = 0.7;
};

const voce = (s, k, v, col) => { const r = s.addStack(); r.centerAlignContent(); txt(r, k, Font.systemFont(10), MUT); r.addSpacer(); txt(r, v, Font.semiboldSystemFont(10), col || TX); };

const w = new ListWidget();
w.backgroundColor = BG; w.url = PORTALE + "?spa_disabled=true"; // toccando il widget si apre il portale w.setPadding(12, 14, 12, 14);
const h = w.addStack(); h.centerAlignContent();
txt(h, "💶 Busta paga", Font.boldSystemFont(12), ACC); h.addSpacer();
if (ult) txt(h, nomeMese(ult.mese, true), Font.systemFont(11), MUT);
w.addSpacer(6);
if (!ult) {
  w.addSpacer();
  txt(w, B.errore ? "⚠️ " + B.errore : "Apri lo script nell'app Scriptable per collegare il portale", Font.systemFont(11), MUT).lineLimit = 3;
} else {
  const body = w.addStack(); body.spacing = 12;
  const sx = body.addStack(); sx.layoutVertically(); sx.size = new Size(118, 0);
  txt(sx, "Netto", Font.systemFont(10), MUT);
  const t = txt(sx, euro(ult.netto), Font.heavySystemFont(26)); t.minimumScaleFactor = 0.6;
  if (prec) { const dd = ult.netto - prec.netto; txt(sx, (dd >= 0 ? "▲ " : "▼ ") + euro(Math.abs(dd)) + " su " + nomeMese(prec.mese).toLowerCase(), Font.semiboldSystemFont(10), dd >= 0 ? VERDE : ROSSO).minimumScaleFactor = 0.7; }
  sx.addSpacer(6);
  voce(sx, "Lordo", euro(ult.lordo));
  voce(sx, "Trattenute", euro(ult.trattenute));
  voce(sx, "Ore", ore(ult.ore) + (ult.giorni != null ? " · " + ore(ult.giorni) + " gg" : ""));
  const dx = body.addStack(); dx.layoutVertically();
  const im = dx.addImage(grafico(176, 92, 12, true)); im.imageSize = new Size(176, 92);
  dx.addSpacer(6);
  const f = dx.addStack(); f.centerAlignContent(); f.spacing = 8;
  txt(f, "🌴 Ferie " + (ult.ferie == null ? "–" : ore(ult.ferie) + " h"), Font.semiboldSystemFont(10), ult.ferie < 0 ? AMB : TX);
  txt(f, "ROL " + ore(ult.rol) + " h", Font.semiboldSystemFont(10), ult.rol < 0 ? AMB : TX);
}
w.addSpacer();
w.refreshAfterDate = new Date(Date.now() + 3 * 3600 * 1000);
if (config.runsInWidget) Script.setWidget(w); else await w.presentMedium();
Script.complete();
