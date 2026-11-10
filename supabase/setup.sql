-- Gestionale Ledwall: tabella dati (una riga per utente) con accesso solo al proprietario
create table if not exists public.stato (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.stato enable row level security;
drop policy if exists "solo_proprietario" on public.stato;
create policy "solo_proprietario" on public.stato
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Assenze / blocchi di indisponibilità (chiunque aggiunge i propri; admin cancellano tutti)
-- create table public.blocchi (id bigint generated always as identity primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
--   nome text not null, dal date not null, al date not null, nota text default '', created_at timestamptz default now(), check (al >= dal));
-- RLS: select tutti gli autenticati; insert con user_id = auth.uid(); delete se proprio o app_metadata.ruolo = 'admin'. Tabella in supabase_realtime.

-- Task e to-do list (10 nov 2026): tabella public.attivita (tipo task|lista, comune true/false, voci jsonb).
-- RLS: vedi comuni o tue; crea le tue; modifica comuni o tue; elimina tue (o admin sulle comuni). Trigger attivita_guard.
-- token_personale (10 nov 2026): un token per utente; il feed con &u=<token> aggiunge le task/liste "Solo io" di quella persona.
