-- Integration only: existing receipts, amounts and balances are not rewritten.
begin;
set local search_path = public, pg_temp;

-- Keep the existing typed-payment allocation, then apply general balance
-- payments once across the remaining items (oldest date, kind and ID first).
-- Voided/released effects are excluded so normal voiding restores the view.
create or replace view public.property_balance_items
with (security_invoker = true) as
with typed_items as (
WITH pools AS (
         SELECT p.id AS property_id,
            COALESCE(sum(GREATEST(COALESCE(pay.balance_effect, 0::numeric) - COALESCE(pay.effect_released, 0::numeric), 0::numeric)) FILTER (WHERE COALESCE(pay.charge_type, 'Association Dues'::text) = ANY (ARRAY['Association Dues'::text, 'Penalty / Late Fee'::text])), 0::numeric) AS dues_pool,
            COALESCE(sum(GREATEST(COALESCE(pay.balance_effect, 0::numeric) - COALESCE(pay.effect_released, 0::numeric), 0::numeric)) FILTER (WHERE pay.charge_type = 'Special Assessment'::text), 0::numeric) AS sa_pool,
            COALESCE(sum(GREATEST(COALESCE(pay.balance_effect, 0::numeric) - COALESCE(pay.effect_released, 0::numeric), 0::numeric)) FILTER (WHERE pay.charge_type = 'Sticker / ID Fee'::text), 0::numeric) AS sticker_pool,
            COALESCE(sum(GREATEST(COALESCE(pay.balance_effect, 0::numeric) - COALESCE(pay.effect_released, 0::numeric), 0::numeric)) FILTER (WHERE pay.charge_type = 'Document / Certification Fee'::text), 0::numeric) AS doc_pool
           FROM properties p
             LEFT JOIN payments pay ON pay.property_id = p.id AND pay.status IS DISTINCT FROM 'Voided'::text
          GROUP BY p.id
        ), entries AS (
         SELECT e.id,
            e.property_id,
            e.category,
            e.amount,
            e.as_of_date,
            e.description,
            e.created_by,
            e.created_by_name,
            e.created_at,
            e.voided_at,
            e.voided_by,
            e.void_reason,
                CASE e.category
                    WHEN 'Association Dues'::text THEN po.dues_pool
                    WHEN 'Special Assessment'::text THEN po.sa_pool
                    WHEN 'Sticker / ID Fee'::text THEN po.sticker_pool
                    ELSE po.doc_pool
                END AS pool,
            sum(e.amount) OVER (PARTITION BY e.property_id, e.category ORDER BY e.as_of_date, e.created_at, e.id) AS cum
           FROM balance_entries e
             JOIN pools po ON po.property_id = e.property_id
          WHERE e.voided_at IS NULL
        ), dues_entries_total AS (
         SELECT balance_entries.property_id,
            sum(balance_entries.amount) AS t
           FROM balance_entries
          WHERE balance_entries.voided_at IS NULL AND balance_entries.category = 'Association Dues'::text
          GROUP BY balance_entries.property_id
        ), pen AS (
         SELECT c.id,
            c.property_id,
            c.amount,
            c.description,
            lp.anniversary_no,
            lp.anniversary_date,
            lp.rate,
            lp.base_amount,
            sum(c.amount) OVER (PARTITION BY c.property_id ORDER BY (COALESCE(lp.anniversary_date, (c.created_at AT TIME ZONE 'Asia/Manila'::text)::date)), c.created_at, c.id) AS cum
           FROM property_charges c
             LEFT JOIN late_payment_penalties lp ON lp.charge_id = c.id
          WHERE c.charge_type = 'Penalty / Late Fee'::text AND c.voided_at IS NULL
        ), pen_total AS (
         SELECT pen.property_id,
            sum(pen.amount) AS t
           FROM pen
          GROUP BY pen.property_id
        ), dues AS (
         SELECT c.id,
            c.property_id,
            c.billing_month,
            c.amount,
            sum(c.amount) OVER (PARTITION BY c.property_id ORDER BY c.billing_month, c.created_at, c.id) AS cum
           FROM property_charges c
          WHERE c.charge_type = 'Association Dues'::text AND c.voided_at IS NULL
        )
 SELECT en.property_id,
    'entry'::text AS kind,
    en.id AS ref_id,
    en.category,
    en.as_of_date AS item_date,
    COALESCE(en.description, en.category || ' balance'::text) AS label,
    en.amount AS original,
    GREATEST(0::numeric, LEAST(en.amount, en.cum - en.pool))::numeric(12,2) AS unpaid,
    NULL::integer AS penalty_no,
    NULL::numeric AS rate,
    NULL::numeric AS base_amount
   FROM entries en
UNION ALL
 SELECT pn.property_id,
    'penalty'::text AS kind,
    pn.id AS ref_id,
    'Penalty / Late Fee'::text AS category,
    COALESCE(pn.anniversary_date, CURRENT_DATE) AS item_date,
    COALESCE(pn.description, 'Penalty / Late Fee'::text) AS label,
    pn.amount AS original,
    GREATEST(0::numeric, LEAST(pn.amount, pn.cum - GREATEST(0::numeric, po.dues_pool - COALESCE(det.t, 0::numeric))))::numeric(12,2) AS unpaid,
    pn.anniversary_no AS penalty_no,
    pn.rate,
    pn.base_amount
   FROM pen pn
     JOIN pools po ON po.property_id = pn.property_id
     LEFT JOIN dues_entries_total det ON det.property_id = pn.property_id
UNION ALL
 SELECT d.property_id,
    'dues'::text AS kind,
    d.id AS ref_id,
    'Association Dues'::text AS category,
    d.billing_month AS item_date,
    to_char(d.billing_month::timestamp with time zone, 'FMMonth YYYY'::text) || ' monthly dues'::text AS label,
    d.amount AS original,
    GREATEST(0::numeric, LEAST(d.amount, d.cum - GREATEST(0::numeric, po.dues_pool - COALESCE(det.t, 0::numeric) - COALESCE(pt.t, 0::numeric))))::numeric(12,2) AS unpaid,
    NULL::integer AS penalty_no,
    NULL::numeric AS rate,
    NULL::numeric AS base_amount
   FROM dues d
     JOIN pools po ON po.property_id = d.property_id
     LEFT JOIN dues_entries_total det ON det.property_id = d.property_id
     LEFT JOIN pen_total pt ON pt.property_id = d.property_id
), balance_payments as (
  select property_id,
    sum(greatest(coalesce(balance_effect, amount_paid, amount, 0)
      - coalesce(effect_released, 0), 0)) as applied
  from public.payments
  where charge_type = 'Balance Payment' and status is distinct from 'Voided'
  group by property_id
), ordered_items as (
  select i.*, coalesce(b.applied, 0) as balance_applied,
    sum(i.unpaid) over (partition by i.property_id
      order by i.item_date nulls first, i.kind, i.ref_id
      rows between unbounded preceding and current row) as cumulative_unpaid
  from typed_items i left join balance_payments b using (property_id)
)
select property_id, kind, ref_id, category, item_date, label, original,
  greatest(0, least(unpaid, cumulative_unpaid - balance_applied))::numeric(12,2) as unpaid,
  penalty_no, rate, base_amount
from ordered_items;

-- Preserve existing view column names/order and cash totals for compatibility.
-- Balance Payment is a collection category of its own, never a fee/charge.
create or replace view public.monthly_collections
with (security_invoker = true) as
SELECT b.month_start,
    COALESCE(d.dues_collected, 0::numeric) AS dues_collected,
    COALESCE(d.dues_receipts, 0) AS dues_receipts,
    COALESCE(s.service_collected, 0::numeric) AS service_collected,
    COALESCE(s.service_receipts, 0) AS service_receipts,
    COALESCE(d.dues_only_collected, 0::numeric) AS dues_only_collected,
    COALESCE(d.dues_only_receipts, 0) AS dues_only_receipts,
    COALESCE(d.fees_collected, 0::numeric) AS fees_collected,
    COALESCE(d.fees_receipts, 0) AS fees_receipts,
    COALESCE(d.balance_collected, 0::numeric) AS balance_collected,
    COALESCE(d.balance_receipts, 0) AS balance_receipts
   FROM ( SELECT m.m::date AS month_start,
            (m.m::timestamp without time zone AT TIME ZONE 'Asia/Manila'::text) AS lo,
            ((m.m + '1 mon'::interval)::timestamp without time zone AT TIME ZONE 'Asia/Manila'::text) AS hi
           FROM generate_series((( SELECT date_trunc('month'::text, (LEAST(( SELECT min(payments.paid_at) AS min
                           FROM payments), ( SELECT min(service_transactions.paid_at) AS min
                           FROM service_transactions)) AT TIME ZONE 'Asia/Manila'::text)) AS date_trunc))::date::timestamp with time zone, (( SELECT date_trunc('month'::text, (GREATEST(( SELECT max(payments.paid_at) AS max
                           FROM payments), ( SELECT max(service_transactions.paid_at) AS max
                           FROM service_transactions)) AT TIME ZONE 'Asia/Manila'::text)) AS date_trunc))::date::timestamp with time zone, '1 mon'::interval) m(m)) b
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(COALESCE(x.amount_paid, x.amount)), 0::numeric) AS dues_collected,
            count(*)::integer AS dues_receipts,
            COALESCE(sum(COALESCE(x.amount_paid, x.amount)) FILTER (WHERE COALESCE(x.charge_type, 'Association Dues'::text) = 'Association Dues'::text), 0::numeric) AS dues_only_collected,
            count(*) FILTER (WHERE COALESCE(x.charge_type, 'Association Dues'::text) = 'Association Dues'::text)::integer AS dues_only_receipts,
            COALESCE(sum(COALESCE(x.amount_paid, x.amount)) FILTER (WHERE COALESCE(x.charge_type, 'Association Dues'::text) NOT IN ('Association Dues'::text, 'Balance Payment'::text)), 0::numeric) AS fees_collected,
            count(*) FILTER (WHERE COALESCE(x.charge_type, 'Association Dues'::text) NOT IN ('Association Dues'::text, 'Balance Payment'::text))::integer AS fees_receipts
,
            COALESCE(sum(COALESCE(x.amount_paid, x.amount)) FILTER (WHERE x.charge_type = 'Balance Payment'), 0::numeric) AS balance_collected,
            count(*) FILTER (WHERE x.charge_type = 'Balance Payment')::integer AS balance_receipts
           FROM payments x
          WHERE x.status IS DISTINCT FROM 'Voided'::text AND x.paid_at >= b.lo AND x.paid_at < b.hi) d
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(COALESCE(t.amount_paid, 0::numeric)), 0::numeric) AS service_collected,
            count(*)::integer AS service_receipts
           FROM service_transactions t
          WHERE lower(COALESCE(t.payment_status, 'paid'::text)) <> 'voided'::text AND t.paid_at >= b.lo AND t.paid_at < b.hi) s
  WHERE d.dues_receipts > 0 OR s.service_receipts > 0;

commit;
