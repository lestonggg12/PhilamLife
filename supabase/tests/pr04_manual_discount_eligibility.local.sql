-- Run with the disposable PR-04 finance fixture. Never run against live data.
begin;
insert into public.properties(id) values (11),(12),(13),(14),(15);
insert into public.balance_entries(property_id,amount,as_of_date,category)
values (13,800,'2026-11-01','Association Dues'),(14,500,'2026-11-01','Association Dues');
insert into public.property_charges(property_id,charge_type,amount)
values (13,'Association Dues',200),(13,'Sticker / ID Fee',500);
insert into public.payments(property_id,amount,amount_paid,charge_type)
values (12,150,150,'Association Dues');

do $test$
declare
  attempt record;
  denied boolean;
  key uuid := gen_random_uuid();
  result jsonb;
begin
  for attempt in select * from (values
    (11,1000,'Association Dues',0,'There is no outstanding debt eligible for this discount.'),
    (12,1000,'Association Dues',-150,'There is no outstanding debt eligible for this discount.'),
    (13,1001,'Association Dues',1500,'The original amount exceeds the unpaid charges for this payment purpose.'),
    (13,501,'Sticker / ID Fee',1500,'The original amount exceeds the unpaid charges for this payment purpose.'),
    (14,501,'Balance Payment',500,'The original amount exceeds the unpaid charges for this payment purpose.')
  ) as cases(lot,gross,purpose,balance,message) loop
    denied := false;
    begin
      perform public.record_payment_with_optional_discount(
        attempt.lot,attempt.gross,100,attempt.purpose,'Fixture payment','Cash',null,null,gen_random_uuid());
    exception when sqlstate '22023' then
      if sqlerrm <> attempt.message then raise; end if;
      denied := true;
    end;
    if not denied then
      raise exception 'Invalid discounted payment was accepted for lot %',attempt.lot;
    end if;
    if (select current_balance from public.properties where id=attempt.lot) is distinct from attempt.balance::numeric
      or exists (select 1 from public.manual_payment_discounts where property_id=attempt.lot)
      or exists (select 1 from public.account_adjustments where property_id=attempt.lot)
      or (select count(*) from public.payments where property_id=attempt.lot)
        <> (case when attempt.lot=12 then 1 else 0 end) then
      raise exception 'Rejected payment left data behind for lot %',attempt.lot;
    end if;
  end loop;

  result := public.record_payment_with_optional_discount(
    13,1000,100,'Association Dues','Fixture payment','Cash',null,null,key);
  if (result #>> '{payment,amount_paid}')::numeric is distinct from 900
    or (select current_balance from public.properties where id=13) is distinct from 500 then
    raise exception 'Eligible dues payment failed or affected unrelated debt.';
  end if;
  result := public.record_payment_with_optional_discount(
    13,1000,100,'Association Dues','Fixture payment','Cash',null,null,key);
  if (result->>'already_recorded')::boolean is distinct from true
    or (select count(*) from public.payments where property_id=13) <> 1 then
    raise exception 'An identical retry posted a second payment.';
  end if;

  result := public.record_payment_with_optional_discount(
    15,50,5,'Balance Payment','Fixture payment','Cash',null,null,gen_random_uuid());
  if (result #>> '{payment,amount_paid}')::numeric is distinct from 45
    or (select current_balance from public.properties where id=15) is distinct from 0 then
    raise exception 'Eligibility did not use the fresh balance after penalty posting.';
  end if;
  if exists (select 1 from public.financial_invariant_report
    where property_id between 11 and 15 and reconciliation_difference <> 0) then
    raise exception 'Fixture financial invariant failed.';
  end if;
end
$test$;
rollback;
