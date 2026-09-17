-- ============================================================
-- 001_auth.sql — аккаунты, прогресс по детям, регистрации
-- Требуется для crypt() / gen_salt() при создании детских аккаунтов.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
-- Семейный образовательный портал (этап 1: авторизация)
--
-- КАК ПРИМЕНИТЬ:
--  1. Заведите проект на supabase.com (бесплатно, вход через GitHub).
--     Имя проекта любое, пароль БД сохраните.
--  2. Supabase → SQL Editor → New query → вставьте ВЕСЬ этот файл → Run.
--  3. Project Settings → API: скопируйте Project URL и anon public key
--     и впишите в data/sync-config.js (поля url, key — family трогать не надо).
--  4. Готово: кнопка «Вход» появится на всех страницах после публикации.
--
-- ПРИМЕЧАНИЕ ПРО EMAIL-ПОДТВЕРЖДЕНИЕ:
-- для детских аккаунтов и для родителя удобнее, когда письма не требуются.
-- Project Settings → Authentication → Providers → Email: выключите
-- «Confirm email». (Можно оставить и включённым — ребёнок и родитель
-- просто подтвердят почту по ссылке при первом входе.)
-- ============================================================

-- ---------- ПРОФИЛИ: родитель и дети ----------
create table if not exists public.kid_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'kid' check (role in ('parent','kid')),
  name       text,                                  -- нейтральное имя («Дочь»/«Сын»)
  cls        text check (cls is null or cls in ('u','y')),  -- позывной из data/config.js
  parent     uuid references public.kid_profiles(id) on delete cascade, -- заполнен только у детей
  created_at timestamptz not null default now()
);

-- ---------- ПРОГРЕСС: отметки и значения по путям (как в localStorage) ----------
create table if not exists public.progress (
  kid_id     uuid not null references public.kid_profiles(id) on delete cascade,
  path       text not null,          -- например 'tasks.u-zftsh' или 'diary.2026-09-13'
  value      jsonb not null default '{}'::jsonb,
  ts         bigint not null default 0,   -- момент изменения (Date.now())
  updated_at timestamptz not null default now(),
  primary key (kid_id, path)
);

-- ---------- РЕГИСТРАЦИИ: куда и когда записались ----------
create table if not exists public.registrations (
  id           bigint generated always as identity primary key,
  kid_id       uuid not null references public.kid_profiles(id) on delete cascade,
  title        text not null,       -- «Олимпиада по математике», «ЗФТШ»…
  place        text,                -- где (организатор/сайт)
  date         date,                -- когда событие
  deadline     date,                -- когда надо зарегистрироваться
  link         text,
  note         text,
  done_at      timestamptz,         -- когда поставили галочку «записались»
  created_at   timestamptz not null default now()
);

create index if not exists progress_kid_idx  on public.progress(kid_id);
create index if not exists registrations_kid_idx on public.registrations(kid_id, deadline);

-- ---------- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ РАЗГРАНИЧЕНИЯ ПРАВ ----------
-- Возвращает список id, которым авторизован текущий пользователь:
--  родитель — свой id и все «свои» дети; ребёнка — только себя.
-- security definer: читает kid_profiles без RLS, иначе политика на
-- той же таблице вызывает сама себя (бесконечная рекурсия → 500).
-- Безопасность сохраняется: отдаёт только id, привязанные к auth.uid().
create or replace function public.kid_visible()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.kid_profiles where parent = auth.uid() or id = auth.uid()
$$;

-- ---------- RLS: включаем защиту на всех таблицах ----------
alter table public.kid_profiles  enable row level security;
alter table public.progress      enable row level security;
alter table public.registrations enable row level security;

-- Политики без вспомогательных функций: только прямые сравнения с auth.uid().
-- Так исключены рекурсии (функция, читающая ту же таблицу, вызывала сама
-- себя через политику — «stack depth exceeded»).
drop policy if exists kid_profiles_select on public.kid_profiles;
create policy kid_profiles_select on public.kid_profiles
  for select using (id = auth.uid() or parent = auth.uid());

drop policy if exists progress_select on public.progress;
create policy progress_select on public.progress
  for select using (exists (select 1 from public.kid_profiles k
                            where k.id = progress.kid_id
                              and (k.parent = auth.uid() or k.id = auth.uid())));

drop policy if exists progress_insert on public.progress;
create policy progress_insert on public.progress
  for insert with check (exists (select 1 from public.kid_profiles k
                                where k.id = progress.kid_id
                                  and (k.parent = auth.uid() or k.id = auth.uid())));

drop policy if exists progress_update on public.progress;
create policy progress_update on public.progress
  for update using (exists (select 1 from public.kid_profiles k
                            where k.id = progress.kid_id
                              and (k.parent = auth.uid() or k.id = auth.uid())));

drop policy if exists progress_delete on public.progress;
create policy progress_delete on public.progress
  for delete using (exists (select 1 from public.kid_profiles k
                            where k.id = progress.kid_id
                              and (k.parent = auth.uid() or k.id = auth.uid())));

drop policy if exists registrations_select on public.registrations;
create policy registrations_select on public.registrations
  for select using (exists (select 1 from public.kid_profiles k
                            where k.id = registrations.kid_id
                              and (k.parent = auth.uid() or k.id = auth.uid())));

drop policy if exists registrations_insert on public.registrations;
create policy registrations_insert on public.registrations
  for insert with check (exists (select 1 from public.kid_profiles k
                                where k.id = registrations.kid_id
                                  and (k.parent = auth.uid() or k.id = auth.uid())));

drop policy if exists registrations_update on public.registrations;
create policy registrations_update on public.registrations
  for update using (exists (select 1 from public.kid_profiles k
                            where k.id = registrations.kid_id
                              and (k.parent = auth.uid() or k.id = auth.uid())));

drop policy if exists registrations_delete on public.registrations;
create policy registrations_delete on public.registrations
  for delete using (exists (select 1 from public.kid_profiles k
                            where k.id = registrations.kid_id
                              and (k.parent = auth.uid() or k.id = auth.uid())));

-- ---------- ФУНКЦИЯ: родитель регистрируется сам ----------
create or replace function public.create_parent_profile()
returns boolean
language plpgsql
security definer       -- работает с правами владельца (обходит RLS)
set search_path = public
as $$
begin
  insert into public.kid_profiles (id, role, name, cls, parent)
  values (auth.uid(), 'parent', null, null, null)
  on conflict (id) do nothing;
  return true;
end $$;

grant execute on function public.create_parent_profile() to authenticated;

-- ---------- ФУНКЦИЯ: родитель создаёт детский аккаунт ----------
-- Папка: parent (auth.uid()) → создаёт пользователя auth + профиль ребёнка
-- Вызывается только от имени залогиненного родителя.
create or replace function public.create_kid(
  email text,
  pwd text,
  nm text,
  cl text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $create_kid$
declare
  uid uuid;
  mail text := lower(btrim(email));
begin
  -- только родитель (профиль с role='parent') может создавать детей
  if not exists (select 1 from public.kid_profiles where id = auth.uid() and role = 'parent') then
    raise exception 'only parent can create kids';
  end if;

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
     mail, crypt(pwd, gen_salt('bf')), now(),
     jsonb_build_object('provider','email','providers',array['email']),
     jsonb_build_object('kid_name', nm, 'cls', cl),
     now(), now())
  returning id into uid;

  -- В новых версиях Supabase auth.identities.email вычисляется автоматически.
  insert into auth.identities
    (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values
    (uid::text, uid,
     jsonb_build_object('sub', uid::text, 'email', mail),
     'email', now(), now(), now());

  insert into public.kid_profiles (id, role, name, cls, parent)
  values (uid, 'kid', nullif(btrim(nm),''), nullif(btrim(cl),''), auth.uid());

  return uid;
end;
$create_kid$;

grant execute on function public.create_kid(text, text, text, text) to authenticated;

-- ---------- ТРИГГЕР: обновлять updated_at при изменении прогресса ----------
create or replace function public.touch_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists progress_touch on public.progress;
create trigger progress_touch before insert or update on public.progress
  for each row execute function public.touch_progress();