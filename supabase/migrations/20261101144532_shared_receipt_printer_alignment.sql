-- One editable office calibration; no payment/receipt records are changed.
begin;
create table public.receipt_print_settings (
  id integer primary key check(id=1),
  x_mm numeric(4,2) not null check(x_mm between -5 and 5),
  y_mm numeric(4,2) not null check(y_mm between -5 and 5),
  revision bigint not null default 1 check(revision>=1),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict
);
create index receipt_print_settings_updated_by_idx on public.receipt_print_settings(updated_by);
insert into public.receipt_print_settings(id,x_mm,y_mm) values(1,-2,0);
alter table public.receipt_print_settings enable row level security;
revoke all on public.receipt_print_settings from public,anon,authenticated;
grant select on public.receipt_print_settings to authenticated;
create policy "Active staff read shared receipt calibration" on public.receipt_print_settings
  for select to authenticated using ((select public.current_user_role()) in ('admin','secretary','treasurer'));

create function public.save_receipt_print_alignment(p_x_mm numeric,p_y_mm numeric,p_expected_revision bigint)
returns setof public.receipt_print_settings language plpgsql security definer set search_path='' as $$
declare
  saved public.receipt_print_settings%rowtype;
  actor uuid := auth.uid();
  audit_flag text;
  audit_rows integer;
begin
  if actor is null or coalesce(public.current_user_role(),'') not in ('admin','secretary','treasurer') then
    raise exception using errcode='42501',message='An active staff account is required to save printer alignment.';
  end if;
  if p_x_mm is null or p_y_mm is null or p_x_mm not between -5 and 5 or p_y_mm not between -5 and 5
     or round(p_x_mm,2)<>p_x_mm or round(p_y_mm,2)<>p_y_mm
     or p_expected_revision is null or p_expected_revision<1 then
    raise exception using errcode='22023',message='Use offsets between -5 and 5 mm with at most two decimal places.';
  end if;
  select * into saved from public.receipt_print_settings where id=1 for update;
  if not found then raise exception 'Shared printer alignment is missing.'; end if;
  if saved.revision<>p_expected_revision then
    raise exception using errcode='40001',message='Printer alignment changed in another session. Reload the saved alignment before saving.';
  end if;
  if saved.x_mm=p_x_mm and saved.y_mm=p_y_mm then return next saved; return; end if;
  update public.receipt_print_settings set x_mm=p_x_mm,y_mm=p_y_mm,
    revision=revision+1,updated_at=now(),updated_by=actor where id=1 returning * into saved;
  audit_flag:=current_setting('app.audit_trigger',true);
  perform set_config('app.audit_trigger','on',true);
  insert into public.activity_log(user_id,action,target) values(actor,'Printer Alignment Updated',
    format('Shared receipt calibration: horizontal %s mm; vertical %s mm; revision %s',saved.x_mm,saved.y_mm,saved.revision));
  get diagnostics audit_rows=row_count;
  perform set_config('app.audit_trigger',coalesce(audit_flag,'off'),true);
  if audit_rows<>1 then raise exception 'Printer alignment audit was not recorded.'; end if;
  return next saved;
end;
$$;
revoke all on function public.save_receipt_print_alignment(numeric,numeric,bigint) from public,anon;
grant execute on function public.save_receipt_print_alignment(numeric,numeric,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
