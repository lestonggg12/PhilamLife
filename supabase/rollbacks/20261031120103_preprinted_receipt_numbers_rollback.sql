-- Safe only before numbers have been assigned. Never erase an issued paper
-- invoice link as part of a routine rollback.
begin;
do $$ begin
  if exists (select 1 from public.receipt_paper_numbers) then
    raise exception 'Paper invoice numbers have already been assigned. Keep this history and review the rollback with the administrator.';
  end if;
end $$;
drop table public.receipt_paper_numbers;
drop function public.audit_paper_invoice_number();
commit;
