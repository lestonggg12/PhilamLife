-- 25 policies called current_user_role() once per ROW (about 14 microseconds each), which was the dominant cost of
-- every read at scale (0.7 s per 50,000 payments). Wrapping the call in (select ...) makes Postgres evaluate it once
-- per query. The expression, the roles and the commands are otherwise unchanged, so who can do what does not change.
-- Measured on a synthetic 50,000-payment dataset: Ledger list 704 -> 17 ms, Admin dashboard 530 -> 25 ms,
-- full payments fetch 699 -> 10 ms, payments search 1,051 -> 342 ms.
do $$
declare pol record; q text; wc text;
begin
  for pol in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%current_user_role()%'
      and (coalesce(qual, '') || coalesce(with_check, '')) !~* 'select\s+(public\.)?current_user_role\(\)'
  loop
    q  := case when pol.qual is not null then replace(pol.qual, 'current_user_role()', '(select public.current_user_role())') end;
    wc := case when pol.with_check is not null then replace(pol.with_check, 'current_user_role()', '(select public.current_user_role())') end;
    execute format('alter policy %I on public.%I %s %s', pol.policyname, pol.tablename,
                   case when q  is not null then 'using (' || q || ')' else '' end,
                   case when wc is not null then 'with check (' || wc || ')' else '' end);
  end loop;
end $$;