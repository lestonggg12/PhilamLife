-- Put pg_temp explicitly last so temp objects can never shadow public ones in SECURITY DEFINER functions.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.prosecdef
      and not coalesce(p.proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;