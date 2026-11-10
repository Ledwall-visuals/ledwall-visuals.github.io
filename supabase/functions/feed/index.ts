// Feed pubblico (protetto da token) per calendario iOS (.ics) e widget Scriptable (.json)
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Turni = { start: string; persone: string[]; jolly: string; slot: string[]; override: Record<string, string>; assenze?: Record<string, string[]> };
type Blocco = { nome: string; dal: string; al: string };
let BLOCCHI: Blocco[] = [];
const low1 = (n: string) => String(n || "").trim().split(/\s+/)[0].toLowerCase();
function bloccato(T: Turni, n: string, ds: string) {
  if (!n) return false; const f = low1(n);
  if ((T.assenze?.[ds] || []).some((x) => low1(x) === f)) return true;
  return BLOCCHI.some((b) => low1(b.nome) === f && b.dal <= ds && ds <= b.al);
}

// Una persona per domenica; mattina (0) e sera (1) modificabili singolarmente
function turno(T: Turni, ds: string, slot?: number): string {
  if (slot !== undefined) { const os = T.override?.[ds + ":" + slot]; if (os !== undefined) return os; }
  const o = T.override?.[ds];
  if (o !== undefined) return o;
  const P = (T.persone || []).filter(Boolean);
  if (!P.length || !T.start || ds < T.start) return "";
  const w = Math.round((Date.parse(ds + "T12:00:00Z") - Date.parse(T.start + "T12:00:00Z")) / (7 * 864e5));
  if (w < 0) return "";
  // assente -> prossimo libero in lista; jolly solo se nessuno è libero (stessa logica del sito)
  for (let k = 0; k < P.length; k++) { const n = P[(w + k) % P.length]; if (!bloccato(T, n, ds)) return n; }
  return bloccato(T, T.jolly, ds) ? "" : (T.jolly || "");
}
function iso(d: Date) { return d.toISOString().slice(0, 10); }
function sundays(from: string, k: number) {
  const d = new Date(from + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  const out: string[] = []; for (let i = 0; i < k; i++) { out.push(iso(d)); d.setUTCDate(d.getUTCDate() + 7); } return out;
}
function addDay(ds: string, n = 1) { const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
function icsEsc(s: string) { return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function fold(line: string) { const out: string[] = []; let s = line; while (s.length > 72) { out.push(s.slice(0, 72)); s = " " + s.slice(72); } out.push(s); return out.join("\r\n"); }

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const t = url.searchParams.get("t") || "";
  const { data: tok } = await sb.from("feed_token").select("token").eq("id", 1).single();
  if (!tok || t !== tok.token) return new Response("Non autorizzato", { status: 401 });
  const { data: row } = await sb.from("condiviso").select("data").eq("id", "main").maybeSingle();
  const DB = (row?.data || {}) as any;
  // task e to-do list: solo quelle comuni (il link del feed è condiviso nel team)
  // u = token personale: aggiunge anche le task e liste "Solo io" di quella persona
  const u = url.searchParams.get("u") || "";
  let uid = "";
  if (/^[0-9a-f]{32}$/.test(u)) { const { data: tp } = await sb.from("token_personale").select("user_id").eq("token", u).maybeSingle(); uid = tp?.user_id || ""; }
  const { data: att } = await sb.from("attivita").select("*").or(uid ? `comune.eq.true,user_id.eq.${uid}` : "comune.eq.true").order("created_at");
  DB.tasks = (att || []).filter((x: any) => x.tipo === "task");
  DB.checklists = (att || []).filter((x: any) => x.tipo === "lista").map((x: any) => ({ nome: x.testo, voci: x.voci || [], mio: !x.comune }));
  const T: Turni | null = DB.turni || null;
  const { data: bl } = await sb.from("blocchi").select("nome,dal,al").gte("al", new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10));
  BLOCCHI = (bl || []) as Blocco[];
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // ~ora italiana
  const f = url.searchParams.get("f") || "ics";
  // p = nome della persona: mostra solo i suoi turni e task (vuoto = tutti)
  const p = (url.searchParams.get("p") || "").trim().toLowerCase();
  const first = (n: string) => String(n || "").trim().split(/\s+/)[0].toLowerCase();
  const mine = (n: string) => !p || (!!n && first(n) === first(p));
  // solo=turni: utenti non admin, niente eventi (le task/liste comuni nel json le vedono tutti)
  const solo = url.searchParams.get("solo") === "turni";

  if (f === "json") {
    const eventi = solo ? [] : (DB.events || []).filter((e: any) => e.start && (e.end || e.start) >= today.slice(0, 8) + "01")
      .sort((a: any, b: any) => a.start.localeCompare(b.start)).slice(0, 40)
      .map((e: any) => ({ nome: e.name, luogo: e.place || "", dal: e.start, al: e.end || e.start }));
    // domeniche dall'inizio del mese corrente per 10 settimane (per il calendario a griglia)
    const turni = T ? sundays(today.slice(0, 8) + "01", 10).map((ds) => ({ data: ds, mattina: turno(T, ds, 0), sera: turno(T, ds, 1) })) : [];
    const PAL = ["#e5484d", "#4f8cff", "#2fbf71", "#f0a020", "#a855f7", "#14b8a6", "#ec4899", "#84cc16"];
    const ini = (n: string) => { const p = String(n || "?").trim().split(/\s+/); return (p[1] ? p[0][0] + p[1][0] : (p[0] || "?").slice(0, 2)).toUpperCase(); };
    const persone = T ? [...(T.persone || []), T.jolly].filter(Boolean).map((n, i) => ({ nome: n, iniziali: ini(n), colore: PAL[i % PAL.length] })) : [];
    const task = (DB.tasks || []).filter((x: any) => !x.fatto).sort((a: any, b: any) => (a.scadenza || "9").localeCompare(b.scadenza || "9")).map((x: any) => ({ testo: x.testo, chi: x.chi || "", scadenza: x.scadenza || "", mio: !x.comune }));
    const checklist = (DB.checklists || []).map((c: any) => ({ nome: c.nome, mio: !!c.mio, voci: (c.voci || []).map((v: any) => ({ testo: v.testo, fatto: !!v.fatto })) }));
    return new Response(JSON.stringify({ oggi: today, persone, eventi, turni, task, checklist }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gestionale Ledwall//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + (p ? "Ledwall – i miei turni" : "Gestionale Ledwall"), "X-WR-TIMEZONE:Europe/Rome", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const add = (uid: string, ds: string, de: string, title: string, desc = "", loc = "") => {
    L.push("BEGIN:VEVENT", "UID:" + uid + "@gestionale-ledwall", "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + ds.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addDay(de).replace(/-/g, ""),
      fold("SUMMARY:" + icsEsc(title)));
    if (desc) L.push(fold("DESCRIPTION:" + icsEsc(desc)));
    if (loc) L.push(fold("LOCATION:" + icsEsc(loc)));
    L.push("END:VEVENT");
  };
  for (const e of solo ? [] : DB.events || []) {
    if (!e.start) continue;
    const scr = (e.screens || []).map((s: any) => `${s.name}: ${s.w}x${s.h} ${s.mode || "moduli"}`).join("\n");
    add("ev-" + e.id, e.start, e.end || e.start, "🎛️ " + (e.name || "Evento"), [e.notes, scr].filter(Boolean).join("\n\n"), e.place || "");
  }
  if (T) {
    const from = addDay(today, -28);
    for (const ds of sundays(from, 30)) {
      const m = turno(T, ds, 0), e = turno(T, ds, 1);
      const s0 = T.slot?.[0] || "Mattina", s1 = T.slot?.[1] || "Sera";
      if (m && m === e) { if (mine(m)) add(`turno-${ds}`, ds, ds, `⛪ Turno domenica: ${m}`, `${s0} e ${s1}`); }
      else {
        if (m && mine(m)) add(`turno-${ds}-0`, ds, ds, `☀️ ${s0}: ${m}`);
        if (e && mine(e)) add(`turno-${ds}-1`, ds, ds, `🌙 ${s1}: ${e}`);
      }
    }
  }
  for (const x of solo ? [] : DB.tasks || []) {
    if (x.scadenza && !x.fatto && (!x.chi || mine(x.chi))) add("task-" + x.id, x.scadenza, x.scadenza, "✅ " + x.testo + (x.chi ? ` (${x.chi})` : ""));
  }
  L.push("END:VCALENDAR");
  return new Response(L.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "inline; filename=gestionale-ledwall.ics", "Cache-Control": "no-store" } });
});
