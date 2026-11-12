// Invia ogni 1° del mese i turni della domenica nel gruppo WhatsApp del team (via Green API).
// Chiamata da pg_cron. Parametri (query string):
//   ?azione=anteprima  -> restituisce il testo senza inviarlo
//   ?azione=gruppi     -> elenca i gruppi WhatsApp del numero collegato (per trovare il chatId)
//   ?azione=prova      -> invia il messaggio nella chat con se stesso del numero collegato
//   ?azione=configura  -> imposta su Green API il webhook dei messaggi in arrivo verso questa funzione
//   POST con typeWebhook (webhook Green API): se nel gruppo qualcuno scrive "non ci sono", lo sostituisce col prossimo della lista (il jolly solo se nessun altro può)
//   ?mese=1            -> mese prossimo invece del mese corrente
//   ?azione=auto       -> (cron ogni 10 min il lunedì mattina) invia il lunedì dopo l'ultima domenica del mese i turni del mese nuovo, a un orario variabile 8:00-11:30
// Configurazione nella tabella public.config_privata (leggibile solo con service role):
//   GREEN_URL, GREEN_ID, GREEN_TOKEN, GREEN_CHAT (es. 1203...@g.us), TURNI_SECRET,
//   TELEFONI (JSON {"39333...": "Nome"}) per riconoscere chi scrive nel gruppo.
// NB: la logica dei turni copia turno()/bloccato() di index.html: se cambia lì, aggiornarla anche qui.
import { createClient } from "npm:@supabase/supabase-js@2";

type Turni = { start: string; persone: string[]; jolly: string; slot: string[]; override: Record<string, string>; assenze?: Record<string, string[]> };

const first = (n: string) => String(n || "").trim().split(/\s+/)[0];

type Blocco = { nome: string; dal: string; al: string };
// Blocchi = tabella blocchi + assenze dette nel gruppo (turni.assenze), come tuttiBlocchi() del sito.
function tuttiBlocchi(T: Turni, B: Blocco[]): Blocco[] {
  const wa = Object.entries(T.assenze || {}).flatMap(([ds, L]) => (L || []).map((nome) => ({ nome, dal: ds, al: ds })));
  return [...B, ...wa];
}
function bloccato(T: Turni, B: Blocco[], n: string, ds: string): boolean {
  if (!n) return false;
  const f = first(n).toLowerCase();
  return tuttiBlocchi(T, B).some((b) => first(b.nome).toLowerCase() === f && b.dal <= ds && ds <= b.al);
}
// Copia di turno() del sito: se chi tocca è bloccato va il prossimo libero della lista, il jolly solo se nessuno è libero.
function turno(T: Turni, ds: string, slot: number, B: Blocco[] = []): string {
  const ov = T.override || {};
  if (ov[ds + ":" + slot] !== undefined) return ov[ds + ":" + slot];
  if (ov[ds] !== undefined) return ov[ds];
  const P = (T.persone || []).filter(Boolean);
  if (!P.length || !T.start || ds < T.start) return "";
  const w = Math.round((new Date(ds + "T12:00Z").getTime() - new Date(T.start + "T12:00Z").getTime()) / (7 * 864e5));
  if (w < 0) return "";
  for (let k = 0; k < P.length; k++) { const n = P[(w + k) % P.length]; if (!bloccato(T, B, n, ds)) return n; }
  return bloccato(T, B, T.jolly, ds) ? "" : (T.jolly || "");
}

// Numeri pseudo-casuali ripetibili a partire da una stringa (stesso giorno/mese → stessi valori).
function seme(str: string) {
  return (k: number) => {
    let h = 2166136261;
    for (const c of `${str}#${k}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return ((h >>> 0) % 10000) / 10000;
  };
}

function messaggio(T: Turni, off: number, B: Blocco[]): string {
  const oggi = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const d = new Date(Date.UTC(oggi.getFullYear(), oggi.getMonth() + off, 1, 12));
  const mo = d.getUTCMonth();
  const mese = d.toLocaleDateString("it-IT", { month: "long", timeZone: "UTC" });
  const breve = mese.slice(0, 1).toUpperCase() + mese.slice(1, 3);
  const nm = (n: string) => (n ? first(n) : "da definire");
  const righe: string[] = [];
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCMonth() === mo) {
    const ds = d.toISOString().slice(0, 10);
    const m = turno(T, ds, 0, B), s = turno(T, ds, 1, B);
    if (!m && !s && T.start && ds < T.start) { d.setUTCDate(d.getUTCDate() + 7); continue; }
    righe.push(`• Domenica ${d.getUTCDate()} ${breve}: ` + (m === s ? nm(m) : `☀️ ${nm(m)} · 🌙 ${nm(s)}`));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  // Testo un po' diverso ogni mese (scelta di Beniamin: non deve sembrare un bot). Il seme dipende dal mese, così l'anteprima coincide con l'invio.
  const r = seme(`${d.getUTCFullYear()}-${mo}`);
  const pick = <X,>(L: X[], k: number) => L[Math.floor(r(k) * L.length)];
  const saluto = pick(["Buongiorno", "Buongiorno a tutti", "Ciao ragazzi", "Buondì", "Ciao a tutti", "Buongiorno ragazzi"], 1);
  const intro = pick([
    `ecco i turni di ${mese}`, `questi sono i turni di ${mese}`, `vi mando i turni di ${mese}`,
    `ecco come siamo messi a ${mese}`, `i turni di ${mese} sono questi`, `ecco le domeniche di ${mese}`,
  ], 2);
  const fine = pick([
    "Se non puoi, avvisa per tempo 🙏", "Se qualcuno non c'è, ditelo prima possibile 🙏", "Se avete impegni, avvisate per tempo 👍",
    "Chi non può, avvisi appena lo sa 🙏", "Se c'è qualche problema, scrivete qui 👍", "Se non ci siete, fatelo sapere per tempo 🙏",
  ], 3);
  const punto = pick([",", "!", ","], 4);
  return `${saluto}${punto} ${punto === "!" ? intro[0].toUpperCase() + intro.slice(1) : intro}:\n\n${righe.join("\n")}\n\n${fine}`;
}

const ROME = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const breveDi = (ds: string) => {
  const d = new Date(ds + "T12:00Z");
  const m = d.toLocaleDateString("it-IT", { month: "long", timeZone: "UTC" });
  return `${d.getUTCDate()} ${m[0].toUpperCase()}${m.slice(1, 3)}`;
};
// Testo normalizzato: minuscolo e senza accenti/diacritici (così "sarò", "nu reușesc", "înlocuiesc" diventano "saro", "nu reusesc", "inlocuiesc").
const norm = (t: string) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’`]/g, "'").toLowerCase();
// "Non ci sono" in italiano e in rumeno (testo già normalizzato).
const ASSENZA = new RegExp([
  String.raw`\bnon\s+(ci\s+)?(sono|saro|posso|riesco|vengo|ce\s+la\s+faccio)\b(?!\s+problem)`, String.raw`\bassente\b`, String.raw`\bmanco\b`,
  String.raw`\bnu\s+(pot|sunt|sint|vin|ajung|reusesc|o\s+sa\s+(fiu|pot|vin|ajung)|voi\s+(fi|putea|veni)|am\s+cum|ma\s+pot)\b`, String.raw`\blipsesc\b`, String.raw`\babsent\b`,
].join("|"));
// "Posso sostituirti io" e simili, in italiano e in rumeno.
const OFFERTA = new RegExp([
  String.raw`\b(posso|potrei)\s+(sostituir\w*|coprir\w*|venire|andare|farlo|esserci|prenderl\w*)`, String.raw`\bti\s+(sostituisco|copro)\b`,
  String.raw`\b(lo\s+|la\s+|li\s+)?(sostituisco|copro)\s+io\b`, String.raw`\b(vado|vengo|ci\s+sono|lo\s+faccio|faccio|ci\s+vado|lo\s+prendo)\s+io\b`,
  String.raw`\bio\s+(ci\s+sono|vado|vengo|posso|lo\s+faccio|sostituisco|copro)\b`,
  String.raw`\bpot\s+(eu|sa\s+(te|il|o|va)\s+inlocuiesc|sa\s+vin|sa\s+merg|veni|merge)\b`, String.raw`\b(te|il|o|va)\s+inlocuiesc\b`, String.raw`\binlocuiesc\s+eu\b`,
  String.raw`\b(vin|merg|fac|preiau|ma\s+ocup)\s+eu\b`, String.raw`\beu\s+(pot|vin|merg|fac|preiau|te\s+inlocuiesc)\b`,
].join("|"));
const MATTINA = /mattin|diminea/, SERA = /\bsera\b|\bseara\b|stasera|diseara/;

// Cerca la domenica (oggi o futura, entro 8 settimane) in cui `chi` ha un turno e che corrisponde al testo.
function trovaTurno(T: Turni, B: Blocco[], chi: string, testo: string): { ds: string; slots: number[] } | null {
  const t = testo.toLowerCase();
  const soloMattina = MATTINA.test(t) && !SERA.test(t), soloSera = SERA.test(t) && !MATTINA.test(t);
  const giorno = t.match(/\b([0-9]{1,2})\b/);
  const d = ROME(); d.setHours(12, 0, 0, 0);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  for (let i = 0; i < 8; i++, d.setDate(d.getDate() + 7)) {
    const ds = iso(d);
    if (giorno && d.getDate() !== +giorno[1]) continue;
    const slots = [0, 1].filter((sl) => (!soloMattina || sl === 0) && (!soloSera || sl === 1) && first(turno(T, ds, sl, B)).toLowerCase() === first(chi).toLowerCase());
    if (slots.length) return { ds, slots };
  }
  return null;
}

// Firma in cima ai messaggi del sistema: tolta su richiesta di Beniamin (ora il bot ha un numero suo).
const FIRMA = "";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const caricaBlocchi = async (): Promise<Blocco[]> => {
    const da = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const { data } = await sb.from("blocchi").select("nome,dal,al").gte("al", da);
    return (data || []) as Blocco[];
  };
  const { data: rows } = await sb.from("config_privata").select("chiave,valore");
  const env: Record<string, string> = Object.fromEntries((rows || []).map((r: { chiave: string; valore: string }) => [r.chiave, r.valore]));
  const auth = req.headers.get("x-turni-secret") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.TURNI_SECRET || auth !== env.TURNI_SECRET) return json({ errore: "non autorizzato" }, 401);
  const url = new URL(req.url);
  const azione = url.searchParams.get("azione") || "invia";
  const green = `${env.GREEN_URL || "https://api.green-api.com"}/waInstance${env.GREEN_ID}`;
  const invia = async (chatId: string, message: string, quotedMessageId?: string) => {
    const r = await fetch(`${green}/sendMessage/${env.GREEN_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId, message: FIRMA + message, ...(quotedMessageId ? { quotedMessageId } : {}) }),
    });
    return { ok: r.ok, risposta: await r.json().catch(() => ({})) };
  };

  if (azione === "configura") {
    const r = await fetch(`${green}/setSettings/${env.GREEN_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        webhookUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/turni-whatsapp?azione=webhook`,
        webhookUrlToken: env.TURNI_SECRET,
        incomingWebhook: "yes", outgoingWebhook: "no", outgoingMessageWebhook: "no", outgoingAPIMessageWebhook: "no",
        stateWebhook: "no", deviceWebhook: "no", pollMessageWebhook: "no", incomingCallWebhook: "no",
      }),
    });
    return json(await r.json().catch(() => ({ status: r.status })));
  }

  if (azione === "webhook") {
    // Webhook Green API: si guardano solo i messaggi in arrivo nel gruppo del team, tutto il resto viene ignorato.
    const ev = await req.json().catch(() => ({}));
    const sd = ev?.senderData || {}, md = ev?.messageData || {};
    if (ev?.typeWebhook !== "incomingMessageReceived" || sd.chatId !== env.GREEN_CHAT) return json({ ok: true });
    const grezzo: string = md.textMessageData?.textMessage || md.extendedTextMessageData?.text || "";
    const testo = norm(grezzo);
    const assenza = ASSENZA.test(testo), offerta = !assenza && OFFERTA.test(testo);
    if (!assenza && !offerta) return json({ ok: true });
    const tel: Record<string, string> = JSON.parse(env.TELEFONI || "{}");
    const nomeDi = (jid?: string) => tel[String(jid || "").replace(/@.*/, "")];
    const chi = nomeDi(sd.sender);
    if (!chi) return json({ ok: true, nota: "numero non riconosciuto" });

    const { data: row, error } = await sb.from("condiviso").select("data").eq("id", "main").maybeSingle();
    if (error || !row?.data?.turni) return json({ errore: error?.message || "turni non trovati" }, 500);
    const DB = row.data, T = DB.turni as Turni;
    const B = await caricaBlocchi();
    T.override = T.override || {};
    T.assenze = T.assenze || {};
    const stesso = (a?: string, b?: string) => !!a && !!b && first(a).toLowerCase() === first(b).toLowerCase();
    const salva = async (log: string) => {
      DB._t = Date.now();
      const { error: e } = await sb.from("condiviso").update({ data: DB, updated_at: new Date().toISOString(), updated_by: null }).eq("id", "main");
      if (!e) await sb.from("registro").insert({ user_id: null, nome: "WhatsApp", testo: log });
      return e;
    };

    if (offerta) {
      // Qualcuno si offre di sostituire: si cerca la domenica giusta.
      // 1) data scritta nel messaggio (o nel messaggio citato); 2) chi ha scritto il messaggio citato (risposta a "non ci sono");
      // 3) altrimenti la prossima domenica in cui qualcuno ha detto che non c'è.
      const q = md.quotedMessage || {};
      const citato = nomeDi(q.participant || md.extendedTextMessageData?.participant);
      const testoQ = norm(q.textMessage || q.text || q.caption || "");
      const num = (testo.match(/\b([0-9]{1,2})\b/) || testoQ.match(/\b([0-9]{1,2})\b/) || [])[1];
      const d = ROME(); d.setHours(12, 0, 0, 0);
      while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
      const domeniche: string[] = [];
      for (let i = 0; i < 8; i++, d.setDate(d.getDate() + 7)) domeniche.push(iso(d));
      const assenti = (ds: string) => T.assenze![ds] || [];
      let ds = num ? domeniche.find((x) => +x.slice(8) === +num) : undefined;
      if (!ds && citato) ds = domeniche.find((x) => assenti(x).some((n) => stesso(n, citato))) || domeniche.find((x) => [0, 1].some((sl) => stesso(turno(T, x, sl, B), citato)));
      if (!ds) ds = domeniche.find((x) => assenti(x).length && ![0, 1].every((sl) => stesso(turno(T, x, sl, B), chi)));
      if (!ds) return json({ ok: true, nota: "offerta senza domenica da coprire" });
      const sl = MATTINA.test(testo) && !SERA.test(testo) ? 0 : SERA.test(testo) && !MATTINA.test(testo) ? 1 : -1;
      const prima = turno(T, ds, sl < 0 ? 0 : sl, B);
      if (sl < 0) { T.override[ds] = chi; delete T.override[`${ds}:0`]; delete T.override[`${ds}:1`]; }
      else T.override[`${ds}:${sl}`] = chi;
      if (T.assenze[ds]) T.assenze[ds] = T.assenze[ds].filter((n) => !stesso(n, chi));
      const quandoO = sl < 0 ? "mattina e sera" : sl === 0 ? "mattina" : "sera";
      const e = await salva(`Turni: ${first(chi)} si offre per domenica ${breveDi(ds)} (${quandoO})` + (prima && !stesso(prima, chi) ? `, al posto di ${first(prima)}` : ""));
      if (e) return json({ errore: e.message }, 500);
      return json({ ok: true, offerta: { ds, sl, chi, prima }, inviato: false });
    }

    const f = trovaTurno(T, B, chi, testo);
    if (!f) return json({ ok: true, nota: "nessun turno trovato" });
    const quando = f.slots.length === 2 ? "mattina e sera" : f.slots[0] === 0 ? "mattina" : "sera";
    const io = (n?: string) => n !== undefined && first(n).toLowerCase() === first(chi).toLowerCase();
    if (f.slots.length === 2) {
      // Tutta la giornata: si segna l'assenza e la rotazione del sito/feed sceglie il prossimo libero.
      T.assenze[f.ds] = [...new Set([...(T.assenze[f.ds] || []), chi])];
      for (const k of [f.ds, `${f.ds}:0`, `${f.ds}:1`]) if (io(T.override[k])) delete T.override[k];
    } else {
      // Solo mattina o solo sera: override di quel turno col prossimo libero (escluso chi scrive).
      const sl = f.slots[0];
      const tmp: Turni = { ...T, override: { ...T.override }, assenze: { ...T.assenze, [f.ds]: [...(T.assenze[f.ds] || []), chi] } };
      delete tmp.override[`${f.ds}:${sl}`]; if (io(tmp.override[f.ds])) delete tmp.override[f.ds];
      T.override[`${f.ds}:${sl}`] = turno(tmp, f.ds, sl, B);
    }
    const chiSost = turno(T, f.ds, f.slots[0], B);
    DB._t = Date.now();
    const { error: e2 } = await sb.from("condiviso").update({ data: DB, updated_at: new Date().toISOString(), updated_by: null }).eq("id", "main");
    if (e2) return json({ errore: e2.message }, 500);
    await sb.from("registro").insert({ user_id: null, nome: "WhatsApp", testo: `Turni: ${first(chi)} non c'è domenica ${breveDi(f.ds)} (${quando}), ` + (chiSost ? `sostituito da ${first(chiSost)}` : "nessun sostituto disponibile") });
    const risposta = chiSost
      ? `✅ Ok ${first(chi)}, domenica ${breveDi(f.ds)} (${quando}) ti sostituisce ${first(chiSost)}. Turni aggiornati nel gestionale.`
      : `⚠️ Ok ${first(chi)}, ma per domenica ${breveDi(f.ds)} (${quando}) non c'è nessun sostituto disponibile. ${first(T.jolly)}, ci pensi tu?`;
    // Modalità silenziosa (scelta di Beniamin): il bot legge e aggiorna il gestionale ma non scrive nel gruppo,
    // a meno che in config_privata ci sia RISPOSTE = "si".
    if (env.RISPOSTE !== "si") return json({ ok: true, cambio: f, inviato: false, risposta });
    const out = await invia(env.GREEN_CHAT, risposta, md.idMessage || ev.idMessage);
    return json({ ok: true, cambio: f, inviato: out.ok });
  }

  if (azione === "stato") {
    const r = await fetch(`${green}/getStateInstance/${env.GREEN_TOKEN}`);
    return json(await r.json().catch(() => ({ status: r.status })));
  }
  if (azione === "gruppi") {
    const r = await fetch(`${green}/getContacts/${env.GREEN_TOKEN}`);
    const c = await r.json();
    return json(Array.isArray(c) ? c.filter((x: { type?: string; id: string }) => x.type === "group" || x.id.endsWith("@g.us")) : c);
  }

  // azione=auto (cron ogni giorno): invia il lunedì dopo l'ultima domenica del mese,
  // con i turni del mese della domenica successiva (scelta di Beniamin).
  let mese = +(url.searchParams.get("mese") || 0);
  if (azione === "auto") {
    const oggi = ROME();
    const fra = (n: number) => { const x = new Date(oggi); x.setDate(x.getDate() + n); return x; };
    const ieri = fra(-1);
    if (oggi.getDay() !== 1 || fra(6).getMonth() === ieri.getMonth()) return json({ ok: true, nota: "oggi non si invia" });
    mese = fra(6).getMonth() === oggi.getMonth() ? 0 : 1;
    // Orario diverso ogni volta: il cron gira ogni 10 minuti la mattina, si invia dopo un minuto "a caso" tra le 8:00 e le 11:30.
    const target = 8 * 60 + Math.floor(seme(iso(oggi))(7) * 210);
    if (oggi.getHours() * 60 + oggi.getMinutes() < target) return json({ ok: true, nota: `si invia dopo le ${Math.floor(target / 60)}:${String(target % 60).padStart(2, "0")}` });
    if (env.ULTIMO_INVIO === iso(oggi)) return json({ ok: true, nota: "già inviato oggi" });
  }
  if (!env.GREEN_CHAT && azione !== "anteprima") return json({ errore: "GREEN_CHAT non impostato" }, 400);
  const { data, error } = await sb.from("condiviso").select("data").eq("id", "main").maybeSingle();
  if (error || !data?.data?.turni) return json({ errore: error?.message || "turni non trovati" }, 500);
  const testo = messaggio(data.data.turni as Turni, mese, await caricaBlocchi());
  if (azione === "anteprima") return json({ testo });

  let chatId = env.GREEN_CHAT;
  if (azione === "prova") {
    const st = await (await fetch(`${green}/getSettings/${env.GREEN_TOKEN}`)).json();
    chatId = st.wid;
  }
  const out = await invia(chatId, testo);
  if (azione === "auto" && out.ok) await sb.from("config_privata").upsert({ chiave: "ULTIMO_INVIO", valore: iso(ROME()) });
  return json({ inviato: out.ok, risposta: out.risposta, testo }, out.ok ? 200 : 502);
});
