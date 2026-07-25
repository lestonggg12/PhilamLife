PhilamLife Client

React and Vite frontend for the PHILAM Village HOA management system. Theapplication uses Supabase for authentication, database access, and privatedocument storage.

Main features

Role-based portals for Admin, Secretary, and Treasurer

Homeowner ledger and payment records

Official receipts and financial reports

Expense and service-revenue tracking

Activity Log

Contact Manager

Private Document Library

Persistent Event Calendar

Supabase Auth login and password recovery

Requirements

Node.js 20 or later

npm

Access to the correct Supabase project

Local setup

Install dependencies:

npm install

Create .env.local inside client:

VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key

Start the development server:

npm run dev

Open http://localhost:5173.

Do not place the service-role key, database password, staff passwords, orprivate access tokens in frontend environment files or Git.

Commands

npm run dev
npm run build
npm run preview

Authentication

Authentication is handled by Supabase Auth. Staff accounts must use real,unique email addresses and have matching rows in public.profiles. The rolestored in a profile must be admin, secretary, or treasurer.

No test usernames or passwords are stored in this repository. Create testaccounts directly in Supabase and exchange credentials through a secureprivate channel.

For account setup and recovery configuration, see:

Authentication setup

Forgot-password setup

Production build

npm run build

Deploy the generated dist directory through the selected hosting platform.Configure single-page application rewrites so browser requests for routes suchas /login, /calendar, and /reset-password return index.html.

Add the deployed /reset-password URL to Supabase:

Authentication → URL Configuration → Redirect URLs

Project structure

client/
├── public/
├── src/
│   ├── components/
│   ├── lib/
│   ├── pages/
│   ├── services/
│   ├── App.jsx
│   └── main.jsx
├── package.json
└── vite.config.js

Database migrations and Edge Functions are maintained in the repository-levelsupabase directory.