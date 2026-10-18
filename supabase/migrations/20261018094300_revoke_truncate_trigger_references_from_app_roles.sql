-- Defense in depth: app roles never need TRUNCATE (bypasses RLS), TRIGGER or REFERENCES.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;

-- Keep this true for tables created later.
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;