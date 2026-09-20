-- ============================================================
-- 007_cleanup.sql — убрать опасную неиспользуемую функцию
--
-- ЗАЧЕМ. В 001_auth.sql есть функция create_kid(), которая писала
-- напрямую в служебные таблицы auth.users и auth.identities. Это
-- рискованный приём: он обходит собственную логику Supabase Auth
-- (хеширование, нормализация почты, связывание identity, триггеры),
-- и при обновлении Supabase такая запись может сломать вход.
--
-- Сайт ею НЕ пользуется: с 003_safe_kid_signup.sql детские аккаунты
-- создаются штатным signUp, а функция link_kid_profile() только
-- добавляет профиль. То есть create_kid() — мёртвый код с правами
-- security definer. Удаляем.
--
-- КАК ПРИМЕНИТЬ: Supabase → SQL Editor → New query → вставить → Run.
-- Безопасно: если функции уже нет, команда просто ничего не сделает.
-- ============================================================

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_kid'
  ) then
    revoke all on function public.create_kid(text, text, text, text) from authenticated;
    drop function public.create_kid(text, text, text, text);
    raise notice 'create_kid() удалена';
  else
    raise notice 'create_kid() уже отсутствует — ничего не делаем';
  end if;
end $$;

notify pgrst, 'reload schema';
