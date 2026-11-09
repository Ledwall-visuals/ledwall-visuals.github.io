// Invia ogni 1° del mese i turni della domenica nel gruppo WhatsApp del team (via Green API).
// Chiamata da pg_cron. Parametri (query string):
//   ?azione=anteprima  -> restituisce il testo senza inviarlo
//   ?azione=gruppi     -> elenca i gruppi WhatsApp del numero collegato (per trovare il chatId)
//   ?azione=prova      -> invia il messaggio nella chat con se stesso del numero collegato
//   ?azione=configura  -> imposta su Green API il webhook dei messaggi in arrivo verso questa funzione
//   POST con typeWebhook (webhook Green API): se nel gruppo qualcuno scrive "non ci sono", lo sostituisce col prossimo della lista (il jolly solo se nessun altro può)
//   ?mese=1            -> mese prossimo invece del mese corrente
// Configurazione nella tabella public.config_privata (leggibile solo con service role):
//   GREEN_URL, GREEN_ID, GREEN_TOKEN, GREEN_CHAT (es. 1203...@g.us), TURNI_SECRET,
//   TELEFONI (JSON {"39333...": "Nome"}) per riconoscere chi scrive nel gruppo.
// NB: la logica dei turni copia turno() di index.html: se cambia lì, aggiornarla anche qui.
import { createClient } from "npm:@supabase/supabase-js@2";

type Turni = { start: string; persone: string[]; jolly: string; slot: string[]; override: Record<string, string>; assenze?: Record<string, string[]> };

const first = (n: string) => String(n || "").trim().split(/\s+/)[0];

function turno(T: Turni, ds: string, slot: number): string {
  const ov = T.override || {};
  if (ov[ds + ":" + slot] !== undefined) return ov[ds + ":" + slot];
  if (ov[ds] !== undefined) return ov[ds];
  const P = (T.persone || []).filter(Boolean);
  if (!P.length || !T.start || ds < T.start) return "";
  const w = Math.round((new Date(ds + "T12:00Z").getTime() - new Date(T.start + "T12:00Z").getTime()) / (7 * 864e5));
  if (w < 0) return "";
  return P[w % P.length];
}

function messaggio(T: Turni, off: number): string {
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
    const m = turno(T, ds, 0), s = turno(T, ds, 1);
    if (!m && !s && T.start && ds < T.start) { d.setUTCDate(d.getUTCDate() + 7); continue; }
    righe.push(`• Domenica ${d.getUTCDate()} ${breve}: ` + (m === s ? nm(m) : `☀️ ${nm(m)} · 🌙 ${nm(s)}`));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return `Buongiorno, questi sono i turni di ${mese} (mattina e sera):\n\n${righe.join("\n")}\n\nSe non puoi, avvisa per tempo 🙏`;
}

const ROME = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const breveDi = (ds: string) => {
  const d = new Date(ds + "T12:00Z");
  const m = d.toLocaleDateString("it-IT", { month: "long", timeZone: "UTC" });
  return `${d.getUTCDate()} ${m[0].toUpperCase()}${m.slice(1, 3)}`;
};
const ASSENZA = /(non\s+(ci\s+)?(sono|saro|sarò|posso|riesco|vengo|ce\s+la\s+faccio))|\bassente\b|\bmanco\b/i;

// Sostituto: il prossimo nella lista dopo chi è assente, saltando chi ha già detto di non esserci quel giorno;
// e chi ha un blocco di indisponibilità (tabella blocchi) su quella data; il jolly solo se nessuno della lista è disponibile.
function sostituto(T: Turni, chi: string, ds: string, bloccati: string[] = []): string | null {
  const no = new Set([...(T.assenze?.[ds] || []), ...bloccati, chi].map((n) => first(n).toLowerCase()));
  const P = (T.persone || []).filter(Boolean);
  const i = P.findIndex((p) => first(p).toLowerCase() === first(chi).toLowerCase());
  for (let k = 1; k <= P.length; k++) {
    const p = P[((i < 0 ? -1 : i) + k) % P.length];
    if (!no.has(first(p).toLowerCase())) return p;
  }
  return no.has(first(T.jolly).toLowerCase()) ? null : T.jolly;
}

// Cerca la domenica (oggi o futura, entro 8 settimane) in cui `chi` ha un turno e che corrisponde al testo.
function trovaTurno(T: Turni, chi: string, testo: string): { ds: string; slots: number[] } | null {
  const t = testo.toLowerCase();
  const soloMattina = /mattin/.test(t) && !/sera/.test(t), soloSera = /sera/.test(t) && !/mattin/.test(t);
  const giorno = t.match(/\b([0-9]{1,2})\b/);
  const d = ROME(); d.setHours(12, 0, 0, 0);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  for (let i = 0; i < 8; i++, d.setDate(d.getDate() + 7)) {
    const ds = iso(d);
    if (giorno && d.getDate() !== +giorno[1]) continue;
    const slots = [0, 1].filter((sl) => (!soloMattina || sl === 0) && (!soloSera || sl === 1) && first(turno(T, ds, sl)).toLowerCase() === first(chi).toLowerCase());
    if (slots.length) return { ds, slots };
  }
  return null;
}

// Firma in cima a ogni messaggio mandato dal sistema (richiesta di Beniamin).
const FIRMA = "Ledwall Bot 🤖\n\n";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
    const testo: string = md.textMessageData?.textMessage || md.extendedTextMessageData?.text || "";
    if (!ASSENZA.test(testo)) return json({ ok: true });
    const tel: Record<string, string> = JSON.parse(env.TELEFONI || "{}");
    const chi = tel[String(sd.sender || "").replace(/@.*/, "")];
    if (!chi) return json({ ok: true, nota: "numero non riconosciuto" });

    const { data: row, error } = await sb.from("condiviso").select("data").eq("id", "main").maybeSingle();
    if (error || !row?.data?.turni) return json({ errore: error?.message || "turni non trovati" }, 500);
    const DB = row.data, T = DB.turni as Turni;
    const f = trovaTurno(T, chi, testo);
    if (!f) return json({ ok: true, nota: "nessun turno trovato" });
    T.assenze = T.assenze || {};
    T.assenze[f.ds] = [...new Set([...(T.assenze[f.ds] || []), chi])];
    const { data: bl } = await sb.from("blocchi").select("nome").lte("dal", f.ds).gte("al", f.ds);
    const chiSost = sostituto(T, chi, f.ds, (bl || []).map((b: { nome: string }) => b.nome));
    const quando = f.slots.length === 2 ? "mattina e sera" : f.slots[0] === 0 ? "mattina" : "sera";
    T.override = T.override || {};
    if (chiSost) for (const sl of f.slots) T.override[`${f.ds}:${sl}`] = chiSost;
    else for (const sl of f.slots) T.override[`${f.ds}:${sl}`] = "";
    DB._t = Date.now();
    const { error: e2 } = await sb.from("condiviso").update({ data: DB, updated_at: new Date().toISOString(), updated_by: null }).eq("id", "main");
    if (e2) return json({ errore: e2.message }, 500);
    await sb.from("registro").insert({ user_id: null, nome: "WhatsApp", testo: `Turni: ${first(chi)} non c'è domenica ${breveDi(f.ds)} (${quando}), ` + (chiSost ? `sostituito da ${first(chiSost)}` : "nessun sostituto disponibile") });
    const risposta = chiSost
      ? `✅ Ok ${first(chi)}, domenica ${breveDi(f.ds)} (${quando}) ti sostituisce ${first(chiSost)}. Turni aggiornati nel gestionale.`
      : `⚠️ Ok ${first(chi)}, ma per domenica ${breveDi(f.ds)} (${quando}) non c'è nessun sostituto disponibile. ${first(T.jolly)}, ci pensi tu?`;
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

  if (!env.GREEN_CHAT && azione !== "anteprima") return json({ errore: "GREEN_CHAT non impostato" }, 400);
  const { data, error } = await sb.from("condiviso").select("data").eq("id", "main").maybeSingle();
  if (error || !data?.data?.turni) return json({ errore: error?.message || "turni non trovati" }, 500);
  const testo = messaggio(data.data.turni as Turni, +(url.searchParams.get("mese") || 0));
  if (azione === "anteprima") return json({ testo });

  let chatId = env.GREEN_CHAT;
  if (azione === "prova") {
    const st = await (await fetch(`${green}/getSettings/${env.GREEN_TOKEN}`)).json();
    chatId = st.wid;
  }
  const out = await invia(chatId, testo);
  return json({ inviato: out.ok, risposta: out.risposta, testo }, out.ok ? 200 : 502);
});
