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
