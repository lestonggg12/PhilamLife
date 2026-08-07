const pdfmake = require('pdfmake/build/pdfmake');
const vfsFonts = require('pdfmake/build/vfs_fonts');

pdfmake.vfs = vfsFonts.pdfMake ? vfsFonts.pdfMake.vfs : vfsFonts.vfs;

const formatPeso = (val) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val || 0);

function buildDocDefinition(title, periodLabel, contentBlocks) {
  return {
    pageSize: 'A4',
    pageMargins: [36, 54, 36, 54],
    header: function (currentPage, pageCount) {
      return {
        columns: [
          { text: 'HOA REPORTING SYSTEM', fontSize: 8, color: '#718096', margin: [36, 20, 0, 0] },
          { text: `Generated: ${new Date().toLocaleString('en-PH')}`, alignment: 'right', fontSize: 8, color: '#718096', margin: [0, 20, 36, 0] }
        ]
      };
    },
    footer: function (currentPage, pageCount) {
      return {
        columns: [
          { text: 'Confidential - Board & Operations Distribution Only', fontSize: 8, color: '#a0aec0', margin: [36, 0, 0, 0] },
          { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right', fontSize: 8, color: '#4a5568', margin: [0, 0, 36, 0] }
        ]
      };
    },
    content: [
      { text: title, style: 'reportTitle' },
      { text: periodLabel, style: 'reportSubTitle' },
      { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 523, y2: 5, lineWidth: 1, lineColor: '#cbd5e0' }] },
      { text: '', margin: [0, 0, 0, 10] },
      ...contentBlocks
    ],
    styles: {
      reportTitle: { fontSize: 18, bold: true, color: '#1a202c' },
      reportSubTitle: { fontSize: 11, color: '#4a5568', margin: [0, 2, 0, 8] },
      sectionHeader: { fontSize: 13, bold: true, color: '#2b6cb0', margin: [0, 12, 0, 6] },
      tableHeader: { bold: true, fontSize: 9, fillColor: '#edf2f7', color: '#2d3748', alignment: 'left' },
      tableCell: { fontSize: 8, color: '#2d3748' },
      metricLabel: { fontSize: 9, color: '#718096' },
      metricValue: { fontSize: 14, bold: true, color: '#1a202c' }
    }
  };
}

function generateMonthlyReport(data, res) {
  const content = [
    { style: 'sectionHeader', text: 'Executive Summary' },
    {
      table: {
        widths: ['33%', '33%', '34%'],
        body: [[
          { stack: [{ text: 'Total Liquid Cash', style: 'metricLabel' }, { text: formatPeso(data.metrics.totalCash), style: 'metricValue' }] },
          { stack: [{ text: 'Delinquency Rate', style: 'metricLabel' }, { text: `${data.metrics.delinquencyRate}%`, style: 'metricValue' }] },
          { stack: [{ text: 'Open Tasks / Violations', style: 'metricLabel' }, { text: `${data.metrics.openTasks}`, style: 'metricValue' }] }
        ]]
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 15]
    },
    { text: 'Aged Receivables Summary', style: 'sectionHeader' },
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: ['*', '20%', '20%', '20%', '20%'],
        body: [
          [
            { text: 'Category', style: 'tableHeader' },
            { text: '30 Days', style: 'tableHeader', alignment: 'right' },
            { text: '60 Days', style: 'tableHeader', alignment: 'right' },
            { text: '90+ Days', style: 'tableHeader', alignment: 'right' },
            { text: 'Total Due', style: 'tableHeader', alignment: 'right' }
          ],
          [
            { text: 'Outstanding Dues', style: 'tableCell' },
            { text: formatPeso(data.aged.totals.days30), style: 'tableCell', alignment: 'right' },
            { text: formatPeso(data.aged.totals.days60), style: 'tableCell', alignment: 'right' },
            { text: formatPeso(data.aged.totals.days90Plus), style: 'tableCell', alignment: 'right' },
            { text: formatPeso(data.aged.totals.total), style: 'tableCell', alignment: 'right' }
          ]
        ]
      },
      margin: [0, 0, 0, 15]
    },
    { text: 'Active Operations & Maintenance', style: 'sectionHeader' },
    {
      table: {
        headerRows: 1,
        widths: ['18%', '42%', '20%', '20%'],
        body: [
          [
            { text: 'Work Order', style: 'tableHeader' },
            { text: 'Title', style: 'tableHeader' },
            { text: 'Status', style: 'tableHeader' },
            { text: 'Est. Cost', style: 'tableHeader', alignment: 'right' }
          ],
          ...data.maintenance.map(m => [
            { text: m.work_order_id, style: 'tableCell' },
            { text: m.title, style: 'tableCell' },
            { text: m.status, style: 'tableCell' },
            { text: formatPeso(m.cost), style: 'tableCell', alignment: 'right' }
          ])
        ]
      }
    }
  ];

  const docDef = buildDocDefinition('MONTHLY EXECUTIVE PACKET', `Period: ${data.period}`, content);
  const pdfDoc = pdfmake.createPdf(docDef);
  pdfDoc.getBuffer((buffer) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  });
}

function generateAnnualReport(data, res) {
  const content = [
    { text: 'Audited Year-End Financial Performance', style: 'sectionHeader' },
    {
      table: {
        headerRows: 1,
        widths: ['30%', '23%', '23%', '24%'],
        body: [
          [
            { text: 'Category', style: 'tableHeader' },
            { text: 'Budgeted', style: 'tableHeader', alignment: 'right' },
            { text: 'Actual', style: 'tableHeader', alignment: 'right' },
            { text: 'Variance', style: 'tableHeader', alignment: 'right' }
          ],
          ...data.financials.map(f => [
            { text: f.category, style: 'tableCell' },
            { text: formatPeso(f.budgeted), style: 'tableCell', alignment: 'right' },
            { text: formatPeso(f.actual), style: 'tableCell', alignment: 'right' },
            { text: formatPeso(f.actual - f.budgeted), style: 'tableCell', alignment: 'right' }
          ])
        ]
      },
      margin: [0, 0, 0, 15]
    },
    { text: 'Reserve Fund Health Assessment', style: 'sectionHeader' },
    {
      table: {
        widths: ['50%', '50%'],
        body: [
          [
            { text: 'Current Reserve Balance', style: 'metricLabel' },
            { text: formatPeso(data.reserves.currentBalance), style: 'metricValue' }
          ],
          [
            { text: 'Recommended Reserve Level (Benchmark)', style: 'metricLabel' },
            { text: formatPeso(data.reserves.recommendedLevel), style: 'metricValue' }
          ],
          [
            { text: 'Funded Ratio', style: 'metricLabel' },
            { text: `${((data.reserves.currentBalance / data.reserves.recommendedLevel) * 100).toFixed(1)}%`, style: 'metricValue' }
          ]
        ]
      }
    }
  ];

  const docDef = buildDocDefinition('ANNUAL COMMUNITY REPORT', `Fiscal Year: ${data.year}`, content);
  const pdfDoc = pdfmake.createPdf(docDef);
  pdfDoc.getBuffer((buffer) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  });
}

module.exports = { generateMonthlyReport, generateAnnualReport };