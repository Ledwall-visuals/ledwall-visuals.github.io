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
