// Content for the role-based user manual (/guide?role=Admin|Secretary|Treasurer).
// Kept in one place, separate from GuidePage.jsx, so it's easy to update as
// features change without touching layout code.

const SHARED_SECTIONS = {
  activityLog: {
    id: 'activity-log',
    title: 'Activity Log',
    summary:
      'A running, read-only feed of who did what — homeowners added or edited, payments recorded, blocks renamed, documents deleted, and more.',
    steps: [
      'Open Activity Log from the sidebar.',
      'Use it to double-check recent changes, or to see who performed a specific action if something looks off.',
      'Entries are added automatically by the system — there is nothing to fill in here.',
    ],
  },
  eventCalendar: {
    id: 'calendar',
    title: 'Event Calendar',
    summary: 'Community events — general assemblies, maintenance schedules, clean-up drives — shown on a monthly calendar.',
    steps: [
      'Open Event Calendar and click a date to add an event, or click an existing event to edit or delete it.',
      'Give the event a title, date, and optional time/description.',
      'Events are visible to Admin, Secretary, and Treasurer accounts.',
    ],
  },
  contactManager: {
    id: 'contacts',
    title: 'Contact Manager',
    summary:
      'Homeowner contact details (phone, email) plus their occupancy status — active, moved out, or transferred.',
    steps: [
      'Search or browse to a homeowner and update their phone/email as needed.',
      'To mark someone as moved out or transferred, use the status change action and set the effective date — this keeps them out of dues calculations, overdue lists, and payment pickers going forward, while keeping their payment history intact.',
    ],
  },
  overdueAccounts: {
    id: 'overdue-accounts',
    title: 'Overdue Accounts',
    summary:
      'Every homeowner with a balance past due, aged into buckets (current, 1–30, 31–60, 61–90, 90+ days), based on the due day and grace period set in System Settings.',
    steps: [
      'Filter by aging bucket or search by name/block/lot to find an account.',
      'Log a collection action (a call, a notice sent, a visit) against an account to keep a paper trail.',
      'Only active homeowners appear here — moved-out or transferred accounts are excluded automatically.',
    ],
  },
  documentLibrary: {
    id: 'documents',
    title: 'Document Library',
    summary: 'Shared files — HOA rules, meeting minutes, forms — organized for staff and, where enabled, homeowners to access.',
    steps: [
      'Upload a file, give it a title/category, and it appears in the library immediately.',
      'Delete outdated documents from here as well (Admin and Secretary can delete; Treasurer has view access).',
    ],
  },
  ledger: {
    id: 'ledger',
    title: 'Ledger',
    summary:
      'The homeowner-by-homeowner view of dues, payments, and balances. Search by name, block, or lot to pull up an account.',
    steps: [
      'Search for a homeowner (the table stays empty until you search, so it loads fast even as the roster grows).',
      'Review their charges, amount paid, current balance, and last payment date.',
      'Click Statement to see a running list of that homeowner\'s payment history, and print or save it as a PDF.',
    ],
  },
  payments: {
    id: 'payments',
    title: 'Payments',
    summary: 'Where new dues payments are recorded against a homeowner\'s account.',
    steps: [
      'Click Record Payment, search for the homeowner (moved-out homeowners won\'t appear in this list), and enter the amount, method, and reference number.',
      'The system calculates the new remaining balance automatically from their previous balance.',
      'If a payment was entered in error, use Void rather than deleting it — voided payments are excluded from every total but stay visible for the audit trail.',
    ],
  },
};

export const GUIDE_CONTENT = {
  Admin: {
    role: 'Admin',
    tagline: 'Full system oversight — every module, plus user management and system-wide settings.',
    intro:
      'As Admin, you have access to every page in the system. Most day-to-day dues collection is handled by the Secretary and Treasurer roles, so your workspace is built around oversight: watching the numbers, keeping the roster accurate, and controlling how the system behaves for everyone else.',
    sections: [
      {
        id: 'dashboard',
        title: 'Dashboard',
        summary:
          'Your landing page after login. Four headline stats — Total Users, Properties, Total Collections, and System Status — give you an at-a-glance system health check.',
        steps: [
          'Check the account status breakdown (Paid / Balance Due / No Payment Record) to see collection health across the whole village.',
          'Use the quick links (View All Data, System Settings, Activity Log, Financial Reports, Homeowner Ledger) to jump straight into any module.',
        ],
      },
      SHARED_SECTIONS.activityLog,
      SHARED_SECTIONS.eventCalendar,
      SHARED_SECTIONS.contactManager,
      {
        id: 'homeowners',
        title: 'Homeowners',
        summary: 'The master directory of every property and homeowner — add, edit, or remove homeowner records, and manage blocks.',
        steps: [
          'Add a new homeowner from here or from the Ledger page — either updates the same directory.',
          'Manage Blocks lets you rename or add subdivisions/blocks; renaming a block automatically updates every homeowner assigned to it.',
          'The directory only shows active homeowners by default — moved-out/transferred ones are filtered out, not deleted.',
        ],
      },
      SHARED_SECTIONS.overdueAccounts,
      SHARED_SECTIONS.documentLibrary,
      SHARED_SECTIONS.ledger,
      SHARED_SECTIONS.payments,
      {
        id: 'reports',
        title: 'Reports',
        summary:
          'Generates the full HOA Monthly Report — income, expenses, net position, and outstanding dues for a chosen month — viewable on-screen and downloadable as a PDF.',
        steps: [
          'Pick a month, review the figures on screen, then export to PDF if you need a printable/shareable copy for the board.',
          'The on-screen view and the PDF always show identical numbers — they\'re built from the same calculation, so there\'s nothing to reconcile between them.',
        ],
      },
      {
        id: 'system-settings',
        title: 'System Settings',
        summary: 'Admin-only. Controls the HOA name/branding, monthly dues amount, due day, grace period, and late penalty used throughout the system.',
        steps: [
          'Changes here affect every calculation across the app — overdue aging, late fees, dashboard totals — so double-check figures before saving.',
          'This is also where you\'d update the association name/address if it ever changes.',
        ],
      },
    ],
    commonTasks: [
      {
        title: 'Check overall collection health for the month',
        steps: [
          'Go to Dashboard and look at Total Collections and the Paid / Balance Due breakdown.',
          'For a deeper monthly breakdown with income vs. expenses, go to Reports and select the month.',
        ],
      },
      {
        title: 'A homeowner moved out — update their status',
        steps: [
          'Go to Contact Manager, find their record, and set their status to Moved or Transferred with an effective date.',
          'They\'ll automatically disappear from Overdue Accounts, dues totals, and payment pickers, while their payment history stays intact in the Ledger.',
        ],
      },
      {
        title: 'Something looks wrong in the numbers — who changed it?',
        steps: [
          'Go to Activity Log and scan recent entries, or search by the homeowner/block name involved.',
        ],
      },
    ],
  },

  Secretary: {
    role: 'Secretary',
    tagline: 'The day-to-day front desk — homeowners, payments, services, and community records.',
    intro:
      'As Secretary, your workspace centers on the people side of the HOA: keeping the homeowner roster accurate, recording payments and service charges, issuing receipts, and keeping the community informed. You won\'t see Expenses or System Settings — those belong to Treasurer and Admin.',
    sections: [
      {
        id: 'dashboard',
        title: 'Dashboard',
        summary: 'Your workspace overview — Total Homeowners, Collections This Month, Collections This Year, and Outstanding Accounts.',
        steps: [
          'Use this to gauge collection pace at a glance before diving into individual accounts.',
        ],
      },
      SHARED_SECTIONS.activityLog,
      SHARED_SECTIONS.eventCalendar,
      SHARED_SECTIONS.contactManager,
      {
        id: 'homeowners',
        title: 'Homeowners',
        summary: 'The master directory — this is typically where you add a new homeowner when someone moves in, or update an existing record.',
        steps: [
          'Add New Homeowner: enter their name, assign a block, and a lot number.',
          'Use Manage Blocks if you need to add a new subdivision block or rename an existing one.',
        ],
      },
      SHARED_SECTIONS.overdueAccounts,
      SHARED_SECTIONS.documentLibrary,
      {
        id: 'payables',
        title: 'Payables & Collections',
        summary: 'A block-by-block view of who owes what, useful when you\'re following up with an entire block rather than one homeowner at a time.',
        steps: [
          'Expand a block to see every active homeowner in it, along with their balance.',
        ],
      },
      SHARED_SECTIONS.ledger,
      SHARED_SECTIONS.payments,
      {
        id: 'services',
        title: 'Services',
        summary: 'Record payments for village amenities/services (clubhouse rental, pool use, etc.) separate from monthly dues.',
        steps: [
          'Select the homeowner, the service, and the amount paid — the system flags it as fully paid or partial automatically based on what\'s owed.',
          'A payment amount of zero won\'t be accepted; enter the actual amount received.',
        ],
      },
      {
        id: 'receipts',
        title: 'Official Receipts',
        summary: 'A combined, searchable list of every dues payment and service payment issued, each shown as a receipt.',
        steps: [
          'Search by homeowner name, receipt number, or date range to pull up a specific transaction.',
          'Voided payments are excluded from the Total Collected figure at the top, but stay visible in the list for the record.',
        ],
      },
    ],
    commonTasks: [
      {
        title: 'A new homeowner just moved in',
        steps: [
          'Go to Homeowners → Add New Homeowner, enter their name, block, and lot.',
          'If they need contact info on file, add it via Contact Manager.',
        ],
      },
      {
        title: 'Record a monthly dues payment',
        steps: [
          'Go to Payments → Record Payment, search their name, and enter the amount, method, and reference number.',
          'Confirm the new balance shown matches what you collected before closing the form.',
        ],
      },
      {
        title: 'Someone paid for clubhouse rental',
        steps: [
          'Go to Services, select the homeowner and the service, and enter the amount paid.',
          'The receipt appears automatically in Official Receipts afterward.',
        ],
      },
      {
        title: 'Made a mistake on a payment entry',
        steps: [
          'Find the payment in Payments or Official Receipts and use Void — do not try to delete it.',
          'Voiding removes it from every total while keeping the record visible for the audit trail; then record the correct payment separately.',
        ],
      },
    ],
  },

  Treasurer: {
    role: 'Treasurer',
    tagline: 'The financial control center — ledger, collections, expenses, amenity revenue, and reporting.',
    intro:
      'As Treasurer, your workspace is built entirely around money in and money out: what\'s been collected, what\'s outstanding, what\'s been spent, and how it all nets out. You have the widest financial visibility of any role, including Expenses and Reports, but you won\'t manage the homeowner roster directly — that stays with Secretary.',
    sections: [
      {
        id: 'dashboard',
        title: 'Dashboard',
        summary:
          'Your financial command center: Collected this month, Outstanding receivables, Overdue balance, and Net cash activity (dues + amenities − expenses), plus an aging breakdown and a list of exceptions (unreconciled deposits, adjustments needing review).',
        steps: [
          'Check Net cash activity first for a fast read on whether the month is trending positive or negative.',
          'The exceptions panel flags anything that needs a closer look — treat it as your daily to-do list.',
        ],
      },
      SHARED_SECTIONS.activityLog,
      SHARED_SECTIONS.eventCalendar,
      SHARED_SECTIONS.contactManager,
      SHARED_SECTIONS.overdueAccounts,
      SHARED_SECTIONS.documentLibrary,
      {
        id: 'payables',
        title: 'Payables & Collections',
        summary: 'Block-by-block view of collections — useful for spotting which blocks are lagging on dues.',
        steps: [
          'Expand any block to see every active homeowner\'s balance within it.',
        ],
      },
      SHARED_SECTIONS.ledger,
      {
        id: 'service-revenue',
        title: 'Amenity Revenue',
        summary: 'A financial rollup of amenity/service income recorded by the Secretary (clubhouse, pool, etc.), separate from dues collections.',
        steps: [
          'Use this to see amenity income by period without digging through individual receipts.',
        ],
      },
      SHARED_SECTIONS.payments,
      {
        id: 'expenses',
        title: 'Expenses',
        summary: 'Where HOA operating expenses are logged — utilities, maintenance, salaries, supplies, and more, by category.',
        steps: [
          'Add an expense with its category, amount, and date — the This Month total updates immediately.',
          'To correct a mistaken entry, void it rather than deleting — this keeps the expense history complete and auditable.',
        ],
      },
      {
        id: 'reports',
        title: 'Reports',
        summary: 'Generates the full HOA Monthly Report (income, expenses, net position, outstanding dues) for board presentation, on-screen or as a PDF.',
        steps: [
          'Select the month, review the figures, then export to PDF for distribution.',
        ],
      },
    ],
    commonTasks: [
      {
        title: 'Close out the month\'s financial picture',
        steps: [
          'Go to Dashboard and review Net cash activity and the exceptions panel.',
          'Go to Reports, select the month, and export the Monthly Report as a PDF for the board.',
        ],
      },
      {
        title: 'Log a new operating expense',
        steps: [
          'Go to Expenses, choose the category, enter the amount and date, and save.',
        ],
      },
      {
        title: 'See which blocks are behind on dues',
        steps: [
          'Go to Payables & Collections and scan by block, or go to Overdue Accounts and filter by aging bucket for individual homeowners.',
        ],
      },
      {
        title: 'A payment or expense was entered wrong',
        steps: [
          'Find it in Payments or Expenses and use Void, then re-enter the correct figure — never delete a financial record outright.',
        ],
      },
    ],
  },
};