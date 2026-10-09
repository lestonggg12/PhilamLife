import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOrganization } from '../context/OrganizationContext';
import '../styles/LandingPage.css';
import '../styles/LegalPage.css';

const LAST_UPDATED = 'October 2026';

// Draft policy text. Have the HOA board / legal counsel review before go-live.
function buildDocuments(hoaName) {
  return {
    privacy: {
      eyebrow: 'LEGAL',
      title: 'Privacy Policy',
      intro: `${hoaName} respects your privacy. This policy explains what personal information the Ledger & Payment System collects, why we collect it, how it is protected, and the rights you have under the Data Privacy Act of 2012 (Republic Act No. 10173).`,
      sections: [
        {
          heading: 'Information we collect',
          items: [
            'Homeowner and household details such as names, property (block and lot) information, and contact details.',
            'Financial records such as monthly dues, charges, payments, official receipts, and collection actions.',
            'Association documents, event records, and related correspondence.',
            'Account details of authorized officers, such as email address, assigned role, and sign-in activity.',
            'Activity logs that record which officer performed which action in the system, and when.',
          ],
        },
        {
          heading: 'Why we collect it',
          items: [
            'To bill, record, and reconcile association dues and other charges.',
            'To issue official receipts and keep accurate financial records.',
            'To manage community records, documents, and events.',
            'To follow up on overdue accounts and send association notices.',
            'To keep the system secure and maintain an audit trail.',
          ],
        },
        {
          heading: 'Who can see your information',
          paragraphs: [
            'Access is limited to authorized association officers (Admin, Secretary, and Treasurer), and each role can only open the modules it needs. We do not sell personal information and we do not share it with third parties for marketing.',
            "Information may be disclosed when required by law, or to our hosting and technology providers who store and process data on the association's behalf under appropriate safeguards.",
          ],
        },
        {
          heading: 'Storage and protection',
          paragraphs: [
            'Data is stored with a managed cloud database provider. Access is controlled through role-based permissions enforced at the database level, uploaded documents are kept in private storage, and connections are encrypted in transit. See our Security page for more detail.',
          ],
        },
        {
          heading: 'How long we keep it',
          paragraphs: [
            'We keep records only as long as needed for association operations, accounting, and legal or regulatory requirements. Records that are no longer needed are archived or securely deleted.',
          ],
        },
        {
          heading: 'Your rights',
          paragraphs: ['Under the Data Privacy Act, you have the right to:'],
          items: [
            'Be informed about how your personal data is processed.',
            'Access the personal data we hold about you.',
            'Correct inaccurate or outdated data.',
            'Object to processing, or request that your data be blocked, removed, or destroyed where allowed by law.',
            'Receive a copy of your data in a commonly used format where applicable.',
            'File a complaint with the National Privacy Commission if you believe your rights were violated.',
          ],
        },
        {
          heading: 'Contact us',
          paragraphs: [
            `To exercise your rights or ask a privacy question, please contact the officers of ${hoaName} through the association office. We will respond within a reasonable time.`,
          ],
        },
        {
          heading: 'Changes to this policy',
          paragraphs: [
            'We may update this policy from time to time. The "Last updated" date at the top of this page shows the latest revision.',
          ],
        },
      ],
    },
    terms: {
      eyebrow: 'LEGAL',
      title: 'Terms of Service',
      intro: `These terms govern your use of the ${hoaName} Ledger & Payment System. By signing in, you agree to follow them.`,
      sections: [
        {
          heading: 'Authorized use only',
          paragraphs: [
            'This system is intended for authorized association officers. Access is granted by the association administrator, and may be changed or removed at any time.',
          ],
        },
        {
          heading: 'Your account',
          items: [
            'Keep your password confidential and do not share your account with anyone.',
            'You are responsible for all activity performed under your account.',
            'Tell the administrator immediately if you suspect your account has been compromised.',
          ],
        },
        {
          heading: 'Acceptable use',
          paragraphs: ['You agree not to:'],
          items: [
            'Access, copy, or share homeowner or financial information except as needed for your role.',
            'Enter false, misleading, or unauthorized records.',
            'Attempt to bypass permissions, probe for vulnerabilities, or disrupt the service.',
            'Use the system for any unlawful or personal commercial purpose.',
          ],
        },
        {
          heading: 'Accuracy and records',
          paragraphs: [
            'Officers are responsible for the accuracy of the data they enter. Corrections to payments and charges are recorded as voids, reversals, or adjustments so the history stays traceable. Actions in the system are logged for audit purposes.',
          ],
        },
        {
          heading: 'Availability',
          paragraphs: [
            'We work to keep the system available but do not guarantee uninterrupted service. Maintenance, updates, or events outside our control may cause temporary downtime.',
          ],
        },
        {
          heading: 'Suspension and termination',
          paragraphs: [
            'The association may suspend or remove access at any time, including when an officer leaves their post or these terms are violated.',
          ],
        },
        {
          heading: 'Limitation of liability',
          paragraphs: [
            `To the extent permitted by law, ${hoaName} is not liable for indirect or consequential losses arising from the use of, or inability to use, the system.`,
          ],
        },
        {
          heading: 'Governing law',
          paragraphs: [
            'These terms are governed by the laws of the Republic of the Philippines.',
          ],
        },
        {
          heading: 'Changes to these terms',
          paragraphs: [
            'We may revise these terms. Continued use of the system after a change means you accept the updated terms.',
          ],
        },
      ],
    },
    security: {
      eyebrow: 'LEGAL',
      title: 'Security',
      intro: `Homeowner and financial records are sensitive. Here is how the ${hoaName} Ledger & Payment System protects them.`,
      sections: [
        {
          heading: 'Role-based access',
          paragraphs: [
            'Each officer signs in with a personal account and is assigned a role: Admin, Secretary, or Treasurer. Each role can only reach the modules and actions it needs.',
          ],
        },
        {
          heading: 'Database-level protection',
          paragraphs: [
            'Permissions are enforced inside the database itself, not only in the app. Even if someone bypasses the screens, the database still checks their role before returning or changing any record.',
          ],
        },
        {
          heading: 'Private document storage',
          paragraphs: [
            'Association documents are stored in a private bucket. Files can only be opened by signed-in officers whose role allows it.',
          ],
        },
        {
          heading: 'Accounts and sessions',
          items: [
            'Accounts are created by the administrator; there is no public sign-up.',
            'Deactivated accounts lose access to association data immediately.',
            'Passwords can be reset securely by email.',
            'Signing out ends the session on that device.',
          ],
        },
        {
          heading: 'Encryption',
          paragraphs: [
            'Data is encrypted in transit over HTTPS, and encrypted at rest by our hosting provider.',
          ],
        },
        {
          heading: 'Audit trail',
          paragraphs: [
            'Important actions, such as recording payments, voiding charges, and managing users, are written to an activity log showing who did what and when.',
          ],
        },
        {
          heading: 'Your part',
          items: [
            'Use a strong, unique password and never share it.',
            'Sign out on shared or public computers.',
            'Report anything suspicious to the administrator right away.',
          ],
        },
        {
          heading: 'Report a security concern',
          paragraphs: [
            `If you believe you found a vulnerability or suspect misuse of the system, please contact the officers of ${hoaName} through the association office so it can be investigated promptly.`,
          ],
        },
      ],
    },
  };
}

const LEGAL_LINKS = [
  { key: 'privacy', to: '/privacy', label: 'Privacy Policy' },
  { key: 'terms', to: '/terms', label: 'Terms of Service' },
  { key: 'security', to: '/security', label: 'Security' },
];

export default function LegalPage({ page }) {
  const { organization } = useOrganization();
  const documents = buildDocuments(organization.hoaName);
  const doc = documents[page] || documents.privacy;

  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = `${doc.title} | ${organization.hoaName}`;
  }, [page, doc.title, organization.hoaName]);

  return (
    <div className="lp-container">
      <div className="lp-orb lp-orb-1"></div>
      <div className="lp-orb lp-orb-2"></div>
      <div className="lp-orb lp-orb-3"></div>

      <nav className="lp-navbar">
        <div className="lp-navbar-content">
          <Link to="/" className="lp-brand legal-brand-link">
            <div className="lp-brand-icon">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 2L28 8V18H8V8L18 2Z" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 18V28C8 29.1 8.9 30 10 30H26C27.1 30 28 29.1 28 28V18" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 22V28" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 22V28" stroke="#1766a0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="lp-brand-name">{organization.hoaName}</span>
          </Link>
          <Link to="/" className="legal-back">← Back to home</Link>
        </div>
      </nav>

      <main className="legal-main">
        <article className="legal-card">
          <div className="legal-eyebrow">{doc.eyebrow}</div>
          <h1 className="legal-title">{doc.title}</h1>
          <p className="legal-updated">Last updated: {LAST_UPDATED}</p>
          <p className="legal-intro">{doc.intro}</p>

          {doc.sections.map((section) => (
            <section className="legal-section" key={section.heading}>
              <h2 className="legal-heading">{section.heading}</h2>
              {section.paragraphs &&
                section.paragraphs.map((text, index) => (
                  <p className="legal-text" key={index}>{text}</p>
                ))}
              {section.items && (
                <ul className="legal-list">
                  {section.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </article>
      </main>

      <footer className="legal-footer">
        <div className="legal-footer-inner">
          <span className="lp-footer-copyright">
            © {new Date().getFullYear()} {organization.hoaName}. All rights reserved.
          </span>
          <div className="legal-footer-links">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.key}
                to={link.to}
                className={`lp-footer-link${link.key === page ? ' is-current' : ''}`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}