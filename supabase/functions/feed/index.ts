// Feed pubblico (protetto da token) per calendario iOS (.ics) e widget Scriptable (.json)
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Turni = { start: string; persone: string[]; jolly: string; slot: string[]; override: Record<string, string> };

function turno(T: Turni, ds: string, slot: number): string {
  const o = T.override?.[ds + ":" + slot];
  if (o !== undefined) return o;
  const P = (T.persone || []).filter(Boolean);
  if (!P.length || !T.start || ds < T.start) return "";
  const w = Math.round((Date.parse(ds + "T12:00:00Z") - Date.parse(T.start + "T12:00:00Z")) / (7 * 864e5));
  if (w < 0) return "";
  const k = w * 2 + slot, n = P.length, c = Math.floor(k / n);
  return P[(k + c) % n];
}
function iso(d: Date) { return d.toISOString().slice(0, 10); }
function sundays(from: string, k: number) {
  const d = new Date(from + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  const out: string[] = []; for (let i = 0; i < k; i++) { out.push(iso(d)); d.setUTCDate(d.getUTCDate() + 7); } return out;
}
function addDay(ds: string, n = 1) { const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
function icsEsc(s: string) { return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function fold(line: string) { const out: string[] = []; let s = line; while (s.length > 72) { out.push(s.slice(0, 72)); s = " " + s.slice(72); } out.push(s); return out.join("\r\n"); }

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const t = url.searchParams.get("t") || "";
  const { data: tok } = await sb.from("feed_token").select("token").eq("id", 1).single();
  if (!tok || t !== tok.token) return new Response("Non autorizzato", { status: 401 });
  const { data: row } = await sb.from("condiviso").select("data").eq("id", "main").maybeSingle();
  const DB = (row?.data || {}) as any;
  const T: Turni | null = DB.turni || null;
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // ~ora italiana
  const f = url.searchParams.get("f") || "ics";
  // p = nome della persona: mostra solo i suoi turni e task (vuoto = tutti)
  const p = (url.searchParams.get("p") || "").trim().toLowerCase();
  const first = (n: string) => String(n || "").trim().split(/\s+/)[0].toLowerCase();
  const mine = (n: string) => !p || (!!n && first(n) === first(p));

  if (f === "json") {
    const eventi = (DB.events || []).filter((e: any) => e.start && (e.end || e.start) >= today)
      .sort((a: any, b: any) => a.start.localeCompare(b.start)).slice(0, 10)
      .map((e: any) => ({ nome: e.name, luogo: e.place || "", dal: e.start, al: e.end || e.start }));
    const turni = T ? sundays(today, 6).map((ds) => ({ data: ds, mattina: turno(T, ds, 0), sera: turno(T, ds, 1), nomi: T.slot })) : [];
    const task = (DB.tasks || []).filter((x: any) => !x.fatto).map((x: any) => ({ testo: x.testo, chi: x.chi || "", scadenza: x.scadenza || "" }));
    const checklist = (DB.checklists || []).map((c: any) => ({ nome: c.nome, voci: (c.voci || []).map((v: any) => ({ testo: v.testo, fatto: !!v.fatto })) }));
    return new Response(JSON.stringify({ oggi: today, eventi, turni, task, checklist }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
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
  for (const e of DB.events || []) {
    if (!e.start) continue;
    const scr = (e.screens || []).map((s: any) => `${s.name}: ${s.w}x${s.h} ${s.mode || "moduli"}`).join("\n");
    add("ev-" + e.id, e.start, e.end || e.start, "🎛️ " + (e.name || "Evento"), [e.notes, scr].filter(Boolean).join("\n\n"), e.place || "");
  }
  if (T) {
    const from = addDay(today, -28);
    for (const ds of sundays(from, 30)) {
      for (const sl of [0, 1]) {
        const n = turno(T, ds, sl);
        if (n && mine(n)) add(`turno-${ds}-${sl}`, ds, ds, `${sl ? "🌙" : "☀️"} ${T.slot?.[sl] || (sl ? "Sera" : "Mattina")}: ${n}`);
      }
    }
  }
  for (const x of DB.tasks || []) {
    if (x.scadenza && !x.fatto && (!x.chi || mine(x.chi))) add("task-" + x.id, x.scadenza, x.scadenza, "✅ " + x.testo + (x.chi ? ` (${x.chi})` : ""));
  }
  L.push("END:VCALENDAR");
  return new Response(L.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "inline; filename=gestionale-ledwall.ics", "Cache-Control": "no-store" } });
});
