-- Removes only the new transfer option. Completed transfers and all money/history
-- remain intact. The original new-homeowner transfer RPC is unchanged.
begin;
drop function if exists public.transfer_homeowner_to_existing(bigint,bigint,date,text);
commit;
