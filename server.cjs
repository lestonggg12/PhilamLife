const express = require('express');
const { generateMonthlyReport, generateAnnualReport } = require('./pdfGenerator.cjs');

const app = express();
app.use(express.json());

app.get('/api/reports/monthly', (req, res) => {
  try {
    const month = req.query.month || '2026-08';
    
    const reportData = {
      period: month,
      metrics: { totalCash: 1250000.50, delinquencyRate: 4.2, openTasks: 8 },
      aged: {
        totals: { days30: 45000, days60: 22000, days90Plus: 15000, total: 82000 }
      },
      maintenance: [
        { work_order_id: 'WO-8821', title: 'Main Clubhouse HVAC Repair', status: 'In-Progress', cost: 45000.00 },
        { work_order_id: 'WO-8825', title: 'Perimeter Gate Hinge Replacement', status: 'Open', cost: 12500.00 }
      ]
    };

    res.setHeader('Content-Disposition', `inline; filename=HOA_Monthly_Report_${month}.pdf`);
    generateMonthlyReport(reportData, res);
  } catch (error) {
    console.error('PDF Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate monthly report' });
  }
});

app.get('/api/reports/annual', (req, res) => {
  try {
    const year = req.query.year || '2026';

    const reportData = {
      year,
      financials: [
        { category: 'Common Area Maintenance', budgeted: 500000, actual: 485000 },
        { category: 'Security Services', budgeted: 750000, actual: 762000 },
        { category: 'Utilities (Water & Power)', budgeted: 300000, actual: 310000 }
      ],
      reserves: {
        currentBalance: 3200000,
        recommendedLevel: 4000000
      }
    };

    res.setHeader('Content-Disposition', `inline; filename=HOA_Annual_Report_${year}.pdf`);
    generateAnnualReport(reportData, res);
  } catch (error) {
    console.error('PDF Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate annual report' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`HOA Reporting Server running on port ${PORT}`));