const { Pool } = require('pg');
const { differenceInDays, parseISO } = require('date-fns');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Calculates Aged Receivables bucketed into 30, 60, and 90+ Days Past Due
 * @param {string} asOfDate - Target calculation date (YYYY-MM-DD)
 */
async function calculateAgedReceivables(asOfDate = new Date().toISOString().split('T')[0]) {
  const query = `
    SELECT 
      p.id AS property_id,
      p.account_number,
      CONCAT(h.first_name, ' ', h.last_name) AS homeowner_name,
      p.street_address,
      ft.id AS transaction_id,
      ft.amount,
      ft.due_date,
      ft.line_item_category
    FROM properties p
    JOIN homeowners h ON p.homeowner_id = h.id
    JOIN financial_transactions ft ON p.id = ft.property_id
    WHERE ft.type IN ('DUE_ASSESSMENT', 'LATE_FEE', 'SPECIAL_ASSESSMENT')
      AND ft.due_date <= $1
    ORDER BY p.id, ft.due_date ASC;
  `;

  const paymentsQuery = `
    SELECT property_id, SUM(ABS(amount)) as total_paid
    FROM financial_transactions
    WHERE type = 'PAYMENT' AND transaction_timestamp <= $1
    GROUP BY property_id;
  `;

  const { rows: charges } = await pool.query(query, [asOfDate]);
  const { rows: payments } = await pool.query(paymentsQuery, [`${asOfDate}T23:59:59Z`]);

  const paymentMap = new Map(payments.map(p => [p.property_id, parseFloat(p.total_paid)]));
  
  const propertiesMap = {};

  for (const charge of charges) {
    const propId = charge.property_id;
    if (!propertiesMap[propId]) {
      propertiesMap[propId] = {
        accountNumber: charge.account_number,
        homeownerName: charge.homeowner_name,
        address: charge.street_address,
        unpaidCredits: paymentMap.get(propId) || 0,
        days30: 0,
        days60: 0,
        days90Plus: 0,
        totalOutstanding: 0
      };
    }

    let chargeAmount = parseFloat(charge.amount);
    let prop = propertiesMap[propId];

    // Apply remaining payment credits (FIFO)
    if (prop.unpaidCredits > 0) {
      if (prop.unpaidCredits >= chargeAmount) {
        prop.unpaidCredits -= chargeAmount;
        chargeAmount = 0;
      } else {
        chargeAmount -= prop.unpaidCredits;
        prop.unpaidCredits = 0;
      }
    }

    if (chargeAmount > 0) {
      const daysOverdue = differenceInDays(parseISO(asOfDate), parseISO(charge.due_date));

      if (daysOverdue >= 90) {
        prop.days90Plus += chargeAmount;
      } else if (daysOverdue >= 60) {
        prop.days60 += chargeAmount;
      } else if (daysOverdue >= 30) {
        prop.days30 += chargeAmount;
      }

      prop.totalOutstanding += chargeAmount;
    }
  }

  const result = Object.values(propertiesMap).filter(p => p.totalOutstanding > 0);
  
  const totals = result.reduce((acc, curr) => ({
    days30: acc.days30 + curr.days30,
    days60: acc.days60 + curr.days60,
    days90Plus: acc.days90Plus + curr.days90Plus,
    total: acc.total + curr.totalOutstanding
  }), { days30: 0, days60: 0, days90Plus: 0, total: 0 });

  return { detailed: result, totals };
}

module.exports = { calculateAgedReceivables };