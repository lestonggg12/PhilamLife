Authentication Setup

PhilamLife uses Supabase Auth for staff authentication and the publicprofiles table for application roles.

Supported roles

admin

secretary

treasurer

Each authenticated user must have exactly one matching profiles row whoseid equals the Supabase Auth user ID. Route access is checked in React andmust also be enforced by Supabase Row Level Security policies.

Environment configuration

Create client/.env.local with the project URL and public anonymous key:

VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key

Only use the public anonymous key in the frontend. Never place the Supabaseservice-role key, database password, access token, or staff passwords in therepository.

Creating a staff account

Open the correct Supabase project.

Go to Authentication → Users.

Create the user with a real, unique email address that can receive accountrecovery messages.

Copy the new Auth user ID.

Add the matching row to public.profiles using that ID and one supportedlowercase role.

Confirm that the database policies grant only the permissions intended forthat role.

Test sign-in and access to permitted and forbidden routes.

Do not document or commit staff email addresses or passwords. Share initialcredentials through a secure private channel and require the user to changethe initial password.

Sign-in flow

The user selects a portal role and submits an email and password.

supabase.auth.signInWithPassword() verifies the credentials.

The application loads the matching profiles record.

The selected portal must match the stored profile role.

Protected routes redirect unauthorized users to their own dashboard.

Signing out clears the Supabase session.

Password recovery

The login page links to /forgot-password. Supabase sends a recovery emailwhose link returns to /reset-password, where the user sets a new password.See FORGOT_PASSWORD_SETUP.md for configuration andtesting.

Security checklist

Use real, unique, deliverable email addresses for all staff accounts.

Keep .env.local and every secret file out of Git.

Never commit credentials, reset links, access tokens, or service-role keys.

Enable Row Level Security on application tables.

Keep route permissions and database policies aligned.

Add both local and production reset URLs to Supabase Auth redirect URLs.

Enable leaked-password protection when available for the project.

Review authentication and Activity Log records after account changes.

Safe test procedure

Create dedicated test users in Supabase with emails controlled by the tester.Use temporary passwords that are never written in source code ordocumentation. Verify:

valid credentials open the correct role dashboard;

an incorrect portal role is rejected;

invalid credentials are rejected;

unauthorized routes redirect safely;

refresh restores a valid session;

logout clears the session; and

password recovery changes the real Supabase Auth password.