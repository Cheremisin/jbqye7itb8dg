-- ============================================================
-- 003_safe_kid_signup.sql — безопасное связывание Auth-пользователя
-- Применить после 001_auth.sql.
-- Новая версия сайта создаёт Auth-пользователя через штатный signUp,
-- а эта функция только добавляет профиль ребёнка.
-- ============================================================

create or replace function public.link_kid_profile(
  p_kid_id uuid,
  p_name text,
  p_cls text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $link_kid_profile$
begin
  if not exists (
    select 1 from public.kid_profiles
    where id = auth.uid() and role = 'parent'
  ) then
    raise exception 'only parent can link kid profile';
  end if;

  if exists (select 1 from public.kid_profiles where id = p_kid_id) then
    raise exception 'profile already exists';
  end if;

  if p_cls not in ('u', 'y') then
    raise exception 'class must be u or y';
  end if;

  insert into public.kid_profiles (id, role, name, cls, parent)
  values (p_kid_id, 'kid', nullif(btrim(p_name), ''), p_cls, auth.uid());

  return p_kid_id;
end;
$link_kid_profile$;

grant execute on function public.link_kid_profile(uuid, text, text)
to authenticated;

notify pgrst, 'reload schema';