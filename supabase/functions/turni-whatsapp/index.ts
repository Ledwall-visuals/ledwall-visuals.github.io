// Invia ogni 1° del mese i turni della domenica nel gruppo WhatsApp del team (via Green API).
// Chiamata da pg_cron. Parametri (query string):
//   ?azione=anteprima  -> restituisce il testo senza inviarlo
//   ?azione=gruppi     -> elenca i gruppi WhatsApp del numero collegato (per trovare il chatId)
//   ?azione=prova      -> invia il messaggio nella chat con se stesso del numero collegato
//   ?mese=1            -> mese prossimo invece del mese corrente
// Configurazione nella tabella public.config_privata (leggibile solo con service role):
//   GREEN_URL, GREEN_ID, GREEN_TOKEN, GREEN_CHAT (es. 1203...@g.us), TURNI_SECRET.
// NB: la logica dei turni copia turno() di index.html: se cambia lì, aggiornarla anche qui.
import { createClient } from "npm:@supabase/supabase-js@2";

type Turni = { start: string; persone: string[]; jolly: string; slot: string[]; override: Record<string, string> };

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
    righe.push(`• Domenica ${d.getUTCDate()} ${breve}: ` + (m === s ? nm(m) : `☀️ ${nm(m)} · 🌙 ${nm(s)}`));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return `Buongiorno, questi sono i turni di ${mese} (mattina e sera):\n\n${righe.join("\n")}\n\nSe non puoi, avvisa per tempo 🙏`;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows } = await sb.from("config_privata").select("chiave,valore");
  const env: Record<string, string> = Object.fromEntries((rows || []).map((r: { chiave: string; valore: string }) => [r.chiave, r.valore]));
  if (!env.TURNI_SECRET || req.headers.get("x-turni-secret") !== env.TURNI_SECRET) return json({ errore: "non autorizzato" }, 401);
  const url = new URL(req.url);
  const azione = url.searchParams.get("azione") || "invia";
  const green = `${env.GREEN_URL || "https://api.green-api.com"}/waInstance${env.GREEN_ID}`;

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
  const r = await fetch(`${green}/sendMessage/${env.GREEN_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chatId, message: testo }),
  });
  const out = await r.json().catch(() => ({}));
  return json({ inviato: r.ok, risposta: out, testo }, r.ok ? 200 : 502);
});
