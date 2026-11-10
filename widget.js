// Gestionale Ledwall – widget Scriptable (caricato dal loader con FEED_TOKEN definito)
// Parametro del widget: calendario (default) | task | checklist | checklist:Nome
const FEED = "https://rliekssnvssbpkjzpash.supabase.co/functions/v1/feed?f=json&t=" + FEED_TOKEN + (typeof SOLO_TURNI !== "undefined" && SOLO_TURNI ? "&solo=turni" : "");
const SITO = "https://fascinating-sable-5fbcf3.netlify.app";
const fm = FileManager.local();
const cache = fm.joinPath(fm.documentsDirectory(), "ledwall-cache.json");
let d;
try { d = await new Request(FEED).loadJSON(); fm.writeString(cache, JSON.stringify(d)); }
catch (e) { d = fm.fileExists(cache) ? JSON.parse(fm.readString(cache)) : { persone: [], turni: [], eventi: [], task: [], checklist: [], oggi: new Date().toISOString().slice(0, 10) }; }

const fam = config.widgetFamily || "large";
const mode = String(args.widgetParameter || "calendario").split(";")[0].trim() || "calendario";
const BG = new Color("#0f1115"), CELL = new Color("#1b1f27"), TX = new Color("#e8eaef"), MUT = new Color("#7d8491"), ACC = new Color("#4f8cff"), OK = new Color("#2fbf71");
const pers = {}; (d.persone || []).forEach(p => pers[p.nome] = p);
const first = n => String(n || "").trim().split(/\s+/)[0];
const pad = n => String(n).padStart(2, "0");
const ds = dt => dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
const today = ds(new Date());
const turni = {}; (d.turni || []).forEach(t => turni[t.data] = t);
const evOn = s => (d.eventi || []).filter(e => e.dal <= s && s <= e.al);
const taskOn = s => (d.task || []).filter(t => t.scadenza === s);
// Turni di lavoro dal Calendario dell'iPhone: calendario il cui nome contiene "lavoro" (o "work"),
// oppure quello indicato nel parametro, es. "calendario;lavoro=Turni ufficio"
const parti = String(args.widgetParameter || "").split(";").map(x => x.trim());
// default: i calendari "Mattina", "Pomeriggio", "Notte" (o con "lavoro"/"work" nel nome); lavoro=A,B,C per sceglierli
const calNomi = ((parti.find(x => /^lavoro=/i.test(x)) || "").split("=")[1] || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
const hm = dt => pad(dt.getHours()) + ":" + pad(dt.getMinutes());
let lavoro = [];
try {
  const cals = (await Calendar.forEvents()).filter(c => calNomi.length ? calNomi.includes(c.title.trim().toLowerCase()) : /^(mattin[ao]|pomeriggio|notte)$|lavoro|work/i.test(c.title.trim()));
  if (cals.length) {
    const da = new Date(); da.setDate(1); da.setDate(da.getDate() - 7); da.setHours(0, 0, 0, 0);
    const a = new Date(da); a.setDate(a.getDate() + 60);
    lavoro = (await CalendarEvent.between(da, a, cals)).map(e => ({ s: e.startDate, e: e.endDate, all: e.isAllDay, t: e.title, cal: e.calendar.title, col: e.calendar.color }));
  }
} catch (e) { lavoro = []; }
// un turno può durare più giorni (es. Mattina da lunedì a venerdì): lo segno su ogni giorno lun-ven del periodo
const fineGiorno = l => ds(l.all ? new Date(l.e.getTime() - 1) : l.e);
const lavOn = s => { const g = new Date(s + "T12:00").getDay(); if (g === 0 || g === 6) return []; return lavoro.filter(l => ds(l.s) <= s && s <= fineGiorno(l)); };
// orari: dall'evento se ha un orario, altrimenti quelli standard del turno
const ORE = { mattina: "6–14", mattino: "6–14", pomeriggio: "14–22", notte: "22–6" };
const corto = x => x.replace(":00", "");
const orario = l => (!l.all && ds(l.s) === ds(l.e)) ? corto(hm(l.s)) + "–" + corto(hm(l.e)) : (!l.all ? corto(hm(l.s)) + "–" + corto(hm(l.e)) : (ORE[(l.cal || "").trim().toLowerCase()] || ""));
const lavTxt = l => orario(l) || (l.cal || l.t || "Lavoro");
// inizio e fine reali del turno (per gli eventi "tutto il giorno" uso gli orari standard del turno)
const ORE_H = { mattina: [6, 14], mattino: [6, 14], pomeriggio: [14, 22], notte: [22, 6] };
function intervallo(l) {
  if (!l.all) return [l.s, l.e];
  const h = ORE_H[(l.cal || "").trim().toLowerCase()] || [8, 17];
  const a = new Date(l.s); a.setHours(h[0], 0, 0, 0);
  const b = new Date(fineGiorno(l) + "T12:00"); if (h[1] <= h[0]) b.setDate(b.getDate() + 1); b.setHours(h[1], 0, 0, 0);
  return [a, b];
}
// barra dei turni di lavoro su una settimana: una riga continua da lunedì all'ora di inizio fino all'ora di fine
function barreSettimana(lunedi, larg, alt, cw, gap, dimDa) {
  const c = new DrawContext(); c.size = new Size(larg, alt); c.opaque = false; c.respectScreenScale = true;
  const t0 = new Date(lunedi); t0.setHours(0, 0, 0, 0); const t1 = new Date(t0); t1.setDate(t1.getDate() + 7);
  const xOf = dt => { const g = (dt - t0) / 864e5; const di = Math.min(6, Math.max(0, Math.floor(g))); return Math.min(larg, Math.max(0, di * (cw + gap) + (g - di) * cw)); };
  let n = 0;
  lavoro.forEach(l => {
    const [a, b] = intervallo(l); if (b <= t0 || a >= t1) return;
    const x0 = xOf(a < t0 ? t0 : a), x1 = xOf(b > t1 ? t1 : b); if (x1 - x0 < 3) return; n++;
    // barra sottile al centro della riga: parte e finisce all'ora del turno, titolo in maiuscolo al centro
    const col = l.col ? l.col.hex : "ff9f0a", fuori = dimDa && a >= dimDa, y = Math.round(alt / 2 - 5), hb = 18; // stessa altezza di partenza, più alta solo verso il basso
    const p = new Path(); p.addRoundedRect(new Rect(x0, y, x1 - x0, hb), 4, 4);
    c.addPath(p); c.setFillColor(new Color(col, fuori ? 0.35 : 0.9)); c.fillPath();
    if (x1 - x0 > 24) { c.setFont(Font.heavySystemFont(8)); c.setTextColor(new Color("#ffffff", fuori ? 0.6 : 1)); c.setTextAlignedCenter(); c.drawTextInRect((l.cal || "Lavoro").toUpperCase(), new Rect(x0, y + 4, x1 - x0, hb)); }
  });
  return n ? c.getImage() : null;
}
// prossima domenica (oggi compreso)
const nx = (d.turni || []).find(t => t.data >= today);
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

if (mode.toLowerCase().startsWith("task")) {
  txt(w, "✅ Task", Font.boldSystemFont(14), ACC); w.addSpacer(6);
  const max = fam === "small" ? 4 : fam === "medium" ? 5 : 12;
  if (!d.task.length) txt(w, "Niente da fare 🎉", Font.systemFont(12), MUT);
  d.task.slice(0, max).forEach(t => {
    const r = w.addStack(); r.centerAlignContent();
    if (t.chi) { const im = r.addImage(circle(t.chi, 16)); im.imageSize = new Size(16, 16); r.addSpacer(6); }
    txt(r, t.testo, Font.systemFont(12)); r.addSpacer();
    if (t.scadenza && fam !== "small") txt(r, new Date(t.scadenza + "T12:00").toLocaleDateString("it-IT", { day: "numeric", month: "short" }), Font.systemFont(11), t.scadenza < today ? new Color("#e5484d") : MUT);
    w.addSpacer(4);
  });
} else if (mode.toLowerCase().startsWith("check")) {
  const nome = mode.split(":")[1];
  const c = (nome ? d.checklist.find(x => x.nome.toLowerCase() === nome.trim().toLowerCase()) : null) || d.checklist[0];
  if (!c) txt(w, "📋 Nessuna checklist", Font.boldSystemFont(14), ACC);
  else {
    const h = w.addStack(); txt(h, "📋 " + c.nome, Font.boldSystemFont(14), ACC); h.addSpacer();
    txt(h, c.voci.filter(v => v.fatto).length + "/" + c.voci.length, Font.boldSystemFont(12), MUT); w.addSpacer(6);
    const max = fam === "small" ? 5 : fam === "medium" ? 5 : 13;
    c.voci.filter(v => !v.fatto).concat(c.voci.filter(v => v.fatto)).slice(0, max)
      .forEach(v => { txt(w, (v.fatto ? "✓  " : "○  ") + v.testo, Font.systemFont(12), v.fatto ? MUT : TX); w.addSpacer(3); });
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
  if (pl) { w.addSpacer(8); const g = ds(pg) === today ? "Oggi" : pg.toLocaleDateString("it-IT", { weekday: "short", day: "numeric" }); txt(w, "💼 " + g + " · " + (pl.cal || "Lavoro"), Font.semiboldSystemFont(11), new Color(pl.col ? pl.col.hex : "#ff9f0a")); if (orario(pl)) txt(w, orario(pl), Font.systemFont(10), MUT); }
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
    if (days[r * 7]) { const dimDa = days.slice(r * 7, r * 7 + 7).find(x => x && x.extra); const img = barreSettimana(days[r * 7].dt, 7 * cw + 12, ch, cw, 2, dimDa ? new Date(ds(dimDa.dt) + "T00:00") : null); if (img) row.backgroundImage = img; }
    for (let i = 0; i < 7; i++) {
      const it = days[r * 7 + i]; const cell = row.addStack(); cell.size = new Size(cw, ch); cell.layoutVertically(); cell.cornerRadius = 6;
      if (!it || it.blank) continue;
      const s = ds(it.dt), dim = !!it.extra;
      cell.backgroundColor = s === today ? new Color("#4f8cff", 0.35) : new Color("#ffffff", dim ? 0.03 : 0.08);
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
