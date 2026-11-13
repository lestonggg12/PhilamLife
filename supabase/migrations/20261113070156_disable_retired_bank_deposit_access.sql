
-- Retire the unused Bank Deposits API.
-- This does not delete tables, receipts, or financial records.

REVOKE EXECUTE ON FUNCTION
  public.create_deposit_fund(text)
FROM PUBLIC, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.record_bank_deposit(uuid, date, text, numeric)
FROM PUBLIC, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.link_bank_deposit_receipt(uuid, bigint, uuid, numeric)
FROM PUBLIC, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.unlink_bank_deposit_receipt(uuid, text)
FROM PUBLIC, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.clear_bank_deposit(uuid, text)
FROM PUBLIC, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.reconcile_bank_deposit(uuid, text)
FROM PUBLIC, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.void_pending_bank_deposit(uuid, text)
FROM PUBLIC, authenticated;
