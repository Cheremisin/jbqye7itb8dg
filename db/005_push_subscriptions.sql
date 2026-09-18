-- ============================================================
-- 005_push_subscriptions.sql — подписки на Web Push
-- Применяется после 001_auth.sql. Таблица push-подписок браузеров;
-- ребёнок/родитель сохраняют подписку со своих устройств.
-- ============================================================

create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  kid_id     uuid not null references public.kid_profiles(id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,        -- {p256dh, auth}
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create index if not exists push_sub_kid_idx on public.push_subscriptions(kid_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_select on public.push_subscriptions;
create policy push_select on public.push_subscriptions
  for select using (exists (
    select 1 from public.kid_profiles k
    where k.id = push_subscriptions.kid_id
      and (k.parent = auth.uid() or k.id = auth.uid())
  ));

drop policy if exists push_insert on public.push_subscriptions;
create policy push_insert on public.push_subscriptions
  for insert with check (exists (
    select 1 from public.kid_profiles k
    where k.id = push_subscriptions.kid_id
      and (k.parent = auth.uid() or k.id = auth.uid())
  ));

drop policy if exists push_update on public.push_subscriptions;
create policy push_update on public.push_subscriptions
  for update using (exists (
    select 1 from public.kid_profiles k
    where k.id = push_subscriptions.kid_id
      and (k.parent = auth.uid() or k.id = auth.uid())
  ));

drop policy if exists push_delete on public.push_subscriptions;
create policy push_delete on public.push_subscriptions
  for delete using (exists (
    select 1 from public.kid_profiles k
    where k.id = push_subscriptions.kid_id
      and (k.parent = auth.uid() or k.id = auth.uid())
  ));

-- планировщик + исходящие HTTP для Edge Function, которая шлёт уведомления
create extension if not exists pg_cron;
create extension if not exists pg_net;

notify pgrst, 'reload schema';