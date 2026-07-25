Forgot Password Setup

PhilamLife uses Supabase Auth's email recovery flow. It does not generate orstore verification codes in the browser.

Application routes

/forgot-password requests a secure recovery email.

/reset-password receives the Supabase recovery session and lets the userset a new password.

The implementation is in:

client/src/pages/ForgotPasswordPage.jsx

client/src/App.jsx

Required Supabase configuration

Open the correct Supabase project.

Go to Authentication → URL Configuration.

Set the production application URL as the Site URL.

Add the local recovery URL:

http://localhost:5173/reset-password

Add the deployed recovery URL, for example:

https://your-production-domain.example/reset-password

Configure an SMTP provider before production use so recovery messages aredelivered reliably.

Review the recovery email template and keep its redirect link intact.

Enable leaked-password protection when available.

Account email requirements

Every Auth account must use a real, unique primary email address that its ownercan access. Supabase does not provide a separate backup-email field for thisflow. Placeholder addresses cannot receive recovery links.

Do not commit staff email addresses, passwords, recovery links, or tokens.

Recovery flow

The user selects Forgot password? on the login page.

The user enters the registered email address.

The application calls supabase.auth.resetPasswordForEmail() with/reset-password as the redirect.

Supabase sends a secure recovery link.

Opening the link creates a temporary recovery session.

The application verifies that session and callssupabase.auth.updateUser() with the new password.

The application signs out all sessions and returns the user to Login.

The request screen intentionally displays the same success message whether ornot an email exists. This reduces account-discovery risk.

Password rules

The current interface requires:

at least eight characters;

at least one uppercase letter;

at least one lowercase letter; and

at least one number.

Supabase Auth password policy should be configured to match or exceed theseclient-side requirements.

Test checklist

A registered test email receives a recovery message.

The link opens /reset-password.

An expired or reused link is rejected.

Mismatched passwords are rejected.

Weak passwords are rejected.

A successful reset changes the real Supabase password.

Existing sessions are signed out after a successful reset.

The new password works on Login.

The old password no longer works.

Use a dedicated test account and a password that is not written in source code,documentation, screenshots, or issue comments.