-- Observers only: this migration never posts, recalculates, or reverses money.
-- Notifications and their immutable account history commit with the source action.
begin;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in
 ('collection_reminder','collection_run','penalty_anniversary','transaction_voided','ownership_changed','settings_changed','credit_applied','penalty_applied'));
alter table public.notifications drop constraint notifications_link_check;
alter table public.notifications add constraint notifications_link_check check(
 link in ('/overdue-accounts','/activity-log','/expenses','/system-settings') or link ~ '^/homeowners/[1-9][0-9]*$');

create table public.account_activity (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid references public.notifications(id) on delete set null,
 -- Retain the historic lot/account ID even if an account is later removed.
 -- No FK to properties: notification history must not change deletion behavior.
 property_id bigint not null,
 dedupe_key text not null unique,
 kind text not null,
 title text not null,
 body text not null,
 payload jsonb not null default '{}'::jsonb,
 occurred_at timestamptz not null default now()
);
create index account_activity_property_date_idx on public.account_activity(property_id,occurred_at desc,id desc);
create index account_activity_notification_idx on public.account_activity(notification_id);
alter table public.account_activity enable row level security;
revoke all on public.account_activity from public,anon,authenticated;
grant select on public.account_activity to authenticated;
create policy account_activity_staff_read on public.account_activity for select to authenticated
 using ((select public.current_user_role()) in ('admin','secretary','treasurer'));

create function system_notification_private.rate_label(p_rate numeric)
returns text language sql immutable set search_path='' as $$
 select rtrim(rtrim(to_char(p_rate*100,'FM990.0000'),'0'),'.')||'%'
$$;

create function system_notification_private.emit_event(
 p_key text,p_kind text,p_title text,p_body text,p_properties bigint[],p_payload jsonb,
 p_actor uuid,p_at timestamptz,p_link text,p_bell boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare nid uuid; pid bigint; actor_name text; info jsonb; subjects jsonb;
begin
 select full_name into actor_name from public.profiles where id=p_actor;
 actor_name:=coalesce(nullif(btrim(actor_name),''),case when p_actor is null then 'System' else 'Staff (name unavailable)' end);
 select coalesce(jsonb_agg(jsonb_build_object('property_id',p.id,'name',p.homeowner_name,
   'block',p.block,'lot_number',p.lot_number,'classification',p.property_classification) order by p.id),'[]'::jsonb)
 into subjects from public.properties p where p.id=any(coalesce(p_properties,array[]::bigint[]));
 if jsonb_array_length(subjects)>0 then
   p_body:=p_body||format(' Account: %s (Block %s, Lot %s).',subjects->0->>'name',subjects->0->>'block',subjects->0->>'lot_number');
 end if;
 info:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('actor_id',p_actor,'actor_name',actor_name,'accounts',subjects);
 if p_bell then
   insert into public.notifications(kind,dedupe_key,title,body,severity,payload,link,created_at)
   values(p_kind,p_key,p_title,p_body||' Recorded by '||actor_name||'.',
     case when p_kind='transaction_voided' then 'warning' else 'info' end,info,p_link,coalesce(p_at,now()))
   on conflict(dedupe_key) do nothing returning id into nid;
   if nid is null then select id into nid from public.notifications where dedupe_key=p_key; end if;
 end if;
 foreach pid in array coalesce(p_properties,array[]::bigint[]) loop
   if pid is null then continue; end if;
   insert into public.account_activity(notification_id,property_id,dedupe_key,kind,title,body,payload,occurred_at)
   values(nid,pid,p_key||':property:'||pid,p_kind,p_title,p_body,info,coalesce(p_at,now()))
   on conflict(dedupe_key) do nothing;
 end loop;
end $$;

create function system_notification_private.related_voids(p_table text,p_id text)
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.kind,x.reference),'[]'::jsonb) from (
   select 'Penalty reversed' as kind,c.id::text as reference,c.amount,
     system_notification_private.peso(c.amount) as amount_formatted
   from public.property_charges c where c.voided_at is not null and (
     exists(select 1 from public.annual_penalty_assessments a join public.annual_penalty_schedules s on s.id=a.schedule_id
       where a.charge_id=c.id and s.source_ref::text=p_id
         and ((p_table='balance_entries' and s.source_kind='entry') or
           (p_table='property_charges' and s.source_kind in ('dues','charge','penalty')) or
           (p_table='account_adjustments' and s.source_kind='adjustment')))
     or exists(select 1 from public.late_payment_penalties l where l.charge_id=c.id
       and p_table='balance_entries' and l.balance_entry_id::text=p_id))
   union all
   select 'Discount reversed',d.id::text,d.discount_amount,system_notification_private.peso(d.discount_amount)
   from public.manual_payment_discounts d join public.account_adjustments a on a.id=d.adjustment_id
   where a.reversed_at is not null and ((p_table='payments' and d.payment_id::text=p_id)
     or (p_table='property_charges' and d.charge_id::text=p_id))
 ) x
$$;

create function system_notification_private.observe_void()
returns trigger language plpgsql security definer set search_path='' as $$
declare o jsonb:=to_jsonb(old); n jsonb:=to_jsonb(new); pid bigint; label text;
 amount numeric; reference text; note text; stamp timestamptz; title text; message text;
 properties bigint[]; actor uuid; related jsonb;
begin
 if tg_table_name in ('payments','expenses','service_transactions') then
   if lower(coalesce(o->>case when tg_table_name='service_transactions' then 'payment_status' else 'status' end,''))='voided'
     or lower(coalesce(n->>case when tg_table_name='service_transactions' then 'payment_status' else 'status' end,''))<>'voided' then return new; end if;
 else
   if o->>'voided_at' is not null or n->>'voided_at' is null then return new; end if;
 end if;
 -- Cascaded charge reversals are described by their original balance/charge event.
 if tg_table_name='property_charges' and pg_trigger_depth()>1 then return new; end if;
 pid:=nullif(n->>'property_id','')::bigint;
 amount:=coalesce(nullif(n->>'amount_paid','')::numeric,nullif(n->>'amount','')::numeric,0);
 label:=case tg_table_name when 'payments' then 'Payment receipt'
   when 'service_transactions' then case when n->>'balance_of' is null then 'Amenity/service receipt' else 'Service settlement receipt' end
   when 'balance_entries' then 'Entered balance' when 'expenses' then 'Expense'
   else coalesce(n->>'charge_type','Charge')||' charge' end;
 reference:=coalesce(nullif(n->>'receipt_number',''),nullif(n->>'reference_number',''),n->>'id');
 note:=coalesce(nullif(n->>'void_reason',''),'Reason not recorded');
 stamp:=coalesce(nullif(n->>'voided_at','')::timestamptz,now());
 actor:=coalesce(nullif(n->>'voided_by','')::uuid,auth.uid());
 properties:=case when pid is null then array[]::bigint[] else array[pid] end;
 related:=system_notification_private.related_voids(tg_table_name,n->>'id');
 title:=label||' voided';
 message:=format('%s %s (%s) was voided. Reason: %s.',label,reference,system_notification_private.peso(amount),note);
 if jsonb_array_length(related)>0 then message:=message||format(' %s linked penalty/discount reversal(s) are included in the details.',jsonb_array_length(related)); end if;
 perform system_notification_private.emit_event('void:'||tg_table_name||':'||(n->>'id')||':'||stamp,
   'transaction_voided',title,message,properties,
   jsonb_build_object('source_table',tg_table_name,'source_id',n->>'id','reference',reference,
     'amount',amount,'amount_formatted',system_notification_private.peso(amount),'reason',note,'related_reversals',related),
   actor,stamp,case when pid is not null then '/homeowners/'||pid when tg_table_name='expenses' then '/expenses' else '/activity-log' end);
 return new;
end $$;

-- Alphabetically AFTER the inspected financial AFTER triggers, including zz_reverse_*.
create trigger zzzz_notification_void after update on public.payments for each row execute function system_notification_private.observe_void();
create trigger zzzz_notification_void after update on public.property_charges for each row execute function system_notification_private.observe_void();
create trigger zzzz_notification_void after update on public.balance_entries for each row execute function system_notification_private.observe_void();
create trigger zzzz_notification_void after update on public.service_transactions for each row execute function system_notification_private.observe_void();
create trigger zzzz_notification_void after update on public.expenses for each row execute function system_notification_private.observe_void();

create function system_notification_private.observe_adjustment_reversal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.reversed_at is not null or new.reversed_at is null or pg_trigger_depth()>1 then return new; end if;
 perform system_notification_private.emit_event('adjustment_reversed:'||new.id||':'||new.reversed_at,
 'transaction_voided','Balance adjustment reversed',format('Balance adjustment %s (%s signed balance effect) was reversed. Reason: %s.',
 new.id,system_notification_private.peso(new.balance_effect),coalesce(new.reversal_reason,'Not recorded')),
 array[new.property_id],jsonb_build_object('source_table','account_adjustments','source_id',new.id,'reason',new.reversal_reason,
 'amount',new.balance_effect,'amount_formatted',system_notification_private.peso(new.balance_effect),
 'related_reversals',system_notification_private.related_voids('account_adjustments',new.id::text)),
 coalesce(new.reversed_by,auth.uid()),new.reversed_at,'/homeowners/'||new.property_id);
 return new;
end $$;
create trigger zzzz_notification_reversal after update on public.account_adjustments for each row execute function system_notification_private.observe_adjustment_reversal();

create function system_notification_private.observe_monthly_credit()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.properties%rowtype; used numeric; before_credit numeric;
begin
 if new.charge_type is distinct from 'Association Dues' or new.billing_month is null or new.voided_at is not null or new.amount<=0 then return new; end if;
 -- apply_charge_to_balance has already run and holds this account's row lock.
 -- Its inspected INSERT effect is precisely current_balance := current_balance + new.amount.
 select * into strict p from public.properties where id=new.property_id;
 before_credit:=greatest(new.amount-p.current_balance,0);
 used:=least(before_credit,new.amount);
 if used<=0 then return new; end if;
 perform system_notification_private.emit_event('monthly_credit:'||new.id,'credit_applied','Advance credit used for monthly dues',
 format('The system deducted %s from %s''s advance credit for %s association dues of %s. Remaining advance credit: %s; unpaid portion of this charge: %s.',
 system_notification_private.peso(used),p.homeowner_name,to_char(new.billing_month,'FMMonth YYYY'),system_notification_private.peso(new.amount),
 system_notification_private.peso(greatest(-p.current_balance,0)),system_notification_private.peso(new.amount-used)),
 array[p.id],jsonb_build_object('source_table','property_charges','source_id',new.id,'billing_month',new.billing_month,
 'credit_used',used,'credit_used_formatted',system_notification_private.peso(used),'credit_before',before_credit,
 'credit_after',greatest(-p.current_balance,0),'charge_amount',new.amount,'unpaid_charge',new.amount-used),
 null,new.created_at,'/homeowners/'||p.id);
 return new;
end $$;
create trigger zzzz_notification_monthly_credit after insert on public.property_charges for each row execute function system_notification_private.observe_monthly_credit();

create function system_notification_private.observe_penalty()
returns trigger language plpgsql security definer set search_path='' as $$
declare n jsonb:=to_jsonb(new); p public.properties%rowtype; rate_text text; cid text;
begin
 if new.penalty_amount<=0 or new.charge_id is null then return new; end if;
 select * into strict p from public.properties where id=new.property_id;
 rate_text:=system_notification_private.rate_label(new.rate);
 cid:=new.charge_id::text;
 perform system_notification_private.emit_event('penalty_charge:'||cid,'penalty_applied','Annual late penalty applied',
 format('The system added a %s annual penalty of %s to %s''s eligible unpaid balance of %s. Anniversary: %s. Classification: %s.',
 rate_text,system_notification_private.peso(new.penalty_amount),p.homeowner_name,system_notification_private.peso(new.base_amount),
 new.anniversary_date,replace(p.property_classification,'_',' ')),array[p.id],
 jsonb_build_object('source_table',tg_table_name,'source_id',n->>'id','charge_id',cid,'rate',new.rate,'rate_formatted',rate_text,
 'base_amount',new.base_amount,'base_formatted',system_notification_private.peso(new.base_amount),
 'penalty_amount',new.penalty_amount,'penalty_formatted',system_notification_private.peso(new.penalty_amount),
 'anniversary_date',new.anniversary_date,'origin',coalesce(n->>'origin','legacy_assessment')),
 coalesce(nullif(n->>'actor_user_id','')::uuid,auth.uid()),new.posted_at,'/homeowners/'||p.id);
 return new;
end $$;
create trigger zzzz_notification_penalty after insert on public.annual_penalty_assessments for each row execute function system_notification_private.observe_penalty();
create trigger zzzz_notification_penalty after insert on public.late_payment_penalties for each row execute function system_notification_private.observe_penalty();

create function system_notification_private.observe_ownership()
returns trigger language plpgsql security definer set search_path='' as $$
declare a public.properties%rowtype; b public.properties%rowtype; msg text;
begin
 if tg_table_name='homeowner_balance_transfers' then
   select * into strict a from public.properties where id=new.previous_property_id;
   select * into strict b from public.properties where id=new.new_property_id;
   msg:=format('Ownership transferred from %s to %s for Block %s, Lot %s, effective %s. %s of %s was transferred. Reason: %s.',
     a.homeowner_name,b.homeowner_name,a.block,a.lot_number,new.effective_date,
     system_notification_private.peso(abs(new.transferred_balance)),case when new.transferred_balance<0 then 'advance credit' else 'outstanding balance' end,
     coalesce(new.note,'Not recorded'));
   perform system_notification_private.emit_event('ownership_transfer:'||new.id,'ownership_changed','Property ownership transferred',msg,
     array[a.id,b.id],jsonb_build_object('source_table',tg_table_name,'source_id',new.id,'previous_owner',a.homeowner_name,
       'new_owner',b.homeowner_name,'effective_date',new.effective_date,'reason',new.note,'transferred_balance',new.transferred_balance,
       'amount_formatted',system_notification_private.peso(abs(new.transferred_balance))),
     coalesce(new.created_by,auth.uid()),new.created_at,'/homeowners/'||b.id);
 else
   -- Deferred to the end of the transaction so a real transfer journal can suppress a duplicate status event.
   if old.homeowner_status is not distinct from new.homeowner_status and old.homeowner_id is not distinct from new.homeowner_id then return new; end if;
   if new.homeowner_status='transferred' and exists(select 1 from public.homeowner_balance_transfers where previous_property_id=new.id) then return new; end if;
   if new.homeowner_status='moved' and old.homeowner_status is distinct from 'moved' then
     msg:=format('%s was marked as moved from Block %s, Lot %s, effective %s. Reason: %s.',new.homeowner_name,new.block,new.lot_number,new.status_effective_date,coalesce(new.status_reason,'Not recorded'));
   elsif old.homeowner_id is distinct from new.homeowner_id then
     msg:=format('Property ownership changed from %s to %s for Block %s, Lot %s.',old.homeowner_name,new.homeowner_name,new.block,new.lot_number);
   elsif new.homeowner_status in ('transferred','active') then
     msg:=format('%s''s account status changed from %s to %s for Block %s, Lot %s. Reason: %s.',new.homeowner_name,old.homeowner_status,new.homeowner_status,new.block,new.lot_number,coalesce(new.status_reason,'Not recorded'));
   else return new; end if;
   perform system_notification_private.emit_event('ownership_status:'||new.id||':'||pg_current_xact_id()||':'||new.homeowner_status,
     'ownership_changed','Homeowner move / ownership update',msg,array[new.id],jsonb_build_object('source_table','properties','source_id',new.id,
       'previous_status',old.homeowner_status,'new_status',new.homeowner_status,'previous_owner',old.homeowner_name,
       'new_owner',new.homeowner_name,'reason',new.status_reason,'effective_date',new.status_effective_date),auth.uid(),now(),case when new.homeowner_status='moved' then '/activity-log' else '/homeowners/'||new.id end);
 end if;
 return new;
end $$;
create trigger zzzz_notification_transfer after insert on public.homeowner_balance_transfers for each row execute function system_notification_private.observe_ownership();
create constraint trigger zzzz_notification_ownership after update on public.properties deferrable initially deferred for each row
 when (old.homeowner_status is distinct from new.homeowner_status or old.homeowner_id is distinct from new.homeowner_id)
 execute function system_notification_private.observe_ownership();

create function system_notification_private.setting_value(p_key text,p_value jsonb)
returns text language sql immutable set search_path='' as $$
 select case when p_value is null or p_value='null'::jsonb then 'Not recorded'
 when p_key='price_per_sqm' then system_notification_private.peso((p_value#>>'{}')::numeric)||'/sqm'
 when p_key='late_penalty_rate' then system_notification_private.rate_label((p_value#>>'{}')::numeric)
 else p_value#>>'{}' end
$$;
create function system_notification_private.observe_settings()
returns trigger language plpgsql security definer set search_path='' as $$
declare o jsonb:='{}'::jsonb; n jsonb:=to_jsonb(new); k text; changes jsonb:='[]'::jsonb; msg text:='';
 previous numeric; rate_text text; before_text text; after_text text; label text; effective date;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old); end if;
 if tg_table_name='system_settings' then
   foreach k in array array['hoa_name','address','contact_email','contact_phone','due_day','grace_period_days','late_penalty',
    'email_on_payment','email_on_overdue','sms_reminders','weekly_digest','reminder_days_before','require_strong_password',
    'session_timeout','two_factor','currency','timezone','date_format','billing_day','price_per_sqm','late_penalty_rate','late_penalty_first_after_months'] loop
     if o->k is not distinct from n->k then continue; end if;
     before_text:=system_notification_private.setting_value(k,o->k); after_text:=system_notification_private.setting_value(k,n->k);
     changes:=changes||jsonb_build_array(jsonb_build_object('field',k,'before',o->k,'after',n->k,'before_formatted',before_text,'after_formatted',after_text));
     msg:=msg||case when msg='' then '' else '; ' end||replace(k,'_',' ')||': '||before_text||' → '||after_text;
   end loop;
   if jsonb_array_length(changes)=0 then return new; end if;
   perform system_notification_private.emit_event('settings:'||new.id||':'||pg_current_xact_id()||':'||md5(changes::text),
    'settings_changed','System settings updated',msg,array[]::bigint[],jsonb_build_object('changes',changes),coalesce(new.updated_by,auth.uid()),now(),'/system-settings');
 elsif tg_table_name='expense_budgets' then
   if tg_op='UPDATE' and old.approved_annual_amount is not distinct from new.approved_annual_amount then return new; end if;
   msg:=format('%s expense budget for %s changed from %s to %s. Reason: %s.',new.category,new.budget_year,
     case when o->>'approved_annual_amount' is null then 'Not recorded' else system_notification_private.peso((o->>'approved_annual_amount')::numeric) end,
     system_notification_private.peso(new.approved_annual_amount),coalesce(new.approval_note,'Not recorded'));
   perform system_notification_private.emit_event('budget:'||new.budget_year||':'||new.category||':'||pg_current_xact_id()||':'||md5(n::text),
     'settings_changed','Expense budget updated',msg,array[]::bigint[],jsonb_build_object('year',new.budget_year,'category',new.category,
       'before',o->'approved_annual_amount','after',new.approved_annual_amount,'reason',new.approval_note),
     coalesce(new.updated_by,auth.uid()),new.updated_at,'/system-settings');
 else
   -- Both the immutable future rules and same-day override register are covered.
   select r.annual_rate into previous from (
     select rr.id,rr.annual_rate,rr.effective_from,0 as priority from public.annual_penalty_rate_rules rr
       where not exists(select 1 from public.annual_penalty_rate_supersessions ss where ss.rule_id=rr.id)
         and property_classification=new.property_classification and effective_from<=new.effective_from
         and (tg_table_name<>'annual_penalty_rate_rules' or rr.id<>new.id)
     union all select id,annual_rate,effective_from,1 from public.annual_penalty_rate_overrides
       where property_classification=new.property_classification and effective_from<=new.effective_from
         and (tg_table_name<>'annual_penalty_rate_overrides' or id<>new.id)
   ) r order by r.effective_from desc,r.priority desc limit 1;
   rate_text:=system_notification_private.rate_label(new.annual_rate);
   label:=replace(new.property_classification,'_',' ');
   msg:=format('Annual %s penalty rate changed from %s to %s, effective %s. Reason: %s.',label,
     case when previous is null then 'Not recorded' else system_notification_private.rate_label(previous) end,rate_text,new.effective_from,coalesce(new.rule_note,'Not recorded'));
   perform system_notification_private.emit_event('penalty_rate:'||tg_table_name||':'||new.id,
     'settings_changed',case when new.effective_from>public.hoa_manila_today() then 'Annual penalty rate scheduled' else 'Annual penalty rate updated' end,
     msg,array[]::bigint[],jsonb_build_object('classification',new.property_classification,'before',previous,'after',new.annual_rate,
       'effective_from',new.effective_from,'reason',new.rule_note,'source_table',tg_table_name),coalesce(new.created_by,auth.uid()),new.created_at,'/system-settings');
 end if;
 return new;
end $$;
create trigger zzzz_notification_settings after update on public.system_settings for each row execute function system_notification_private.observe_settings();
create trigger zzzz_notification_budget after insert or update on public.expense_budgets for each row execute function system_notification_private.observe_settings();
create trigger zzzz_notification_rate after insert on public.annual_penalty_rate_rules for each row execute function system_notification_private.observe_settings();
create trigger zzzz_notification_rate after insert on public.annual_penalty_rate_overrides for each row execute function system_notification_private.observe_settings();

revoke all on all functions in schema system_notification_private from public,anon,authenticated;
commit;
