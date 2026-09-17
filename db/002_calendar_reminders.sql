-- ============================================================
-- 002_calendar_reminders.sql — календарь и напоминания
-- Применяется ПОСЛЕ db/001_auth.sql.
-- ============================================================

create table if not exists public.reminders (
  id           bigint generated always as identity primary key,
  kid_id       uuid not null references public.kid_profiles(id) on delete cascade,
  title        text not null,
  remind_at    timestamptz not null,
  kind         text not null default 'training'
               check (kind in ('training', 'registration', 'event', 'other')),
  link         text,
  note         text,
  done_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists reminders_kid_time_idx
  on public.reminders(kid_id, remind_at);

alter table public.reminders enable row level security;

drop policy if exists reminders_select on public.reminders;
create policy reminders_select on public.reminders
  for select using (exists (
    select 1 from public.kid_profiles k
    where k.id = reminders.kid_id
      and (k.parent = auth.uid() or k.id = auth.uid())
  ));

drop policy if exists reminders_insert on public.reminders;
create policy reminders_insert on public.reminders
  for insert with check (exists (
    select 1 from public.kid_profiles k
    where k.id = reminders.kid_id
      and (k.parent = auth.uid() or k.id = auth.uid())
  ));

drop policy if exists reminders_update on public.reminders;
create policy reminders_update on public.reminders
  for update using (exists (
    select 1 from public.kid_profiles k
    where k.id = reminders.kid_id
      and (k.parent = auth.uid() or k.id = auth.uid())
  ));

drop policy if exists reminders_delete on public.reminders;
create policy reminders_delete on public.reminders
  for delete using (exists (
    select 1 from public.kid_profiles k
    where k.id = reminders.kid_id
      and (k.parent = auth.uid() or k.id = auth.uid())
  ));

notify pgrst, 'reload schema';