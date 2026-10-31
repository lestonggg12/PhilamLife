-- NOT RUN. Export any real case records before rollback.
begin;
do $$ begin
 if exists(select 1 from public.grievance_cases) then
   raise exception 'Rollback stopped: grievance records exist. Export and review them before removing this module.';
 end if;
end $$;
drop function public.grievance_statement(date,date);
drop function public.save_grievance(uuid,integer,jsonb,text);
drop table public.grievance_events;
drop table public.grievance_cases;
commit;
