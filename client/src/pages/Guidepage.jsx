import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useOrganization } from '../context/OrganizationContext';
import { GUIDE_CONTENT } from '../content/guideContent';
import '../styles/GuidePage.css';

const VALID_ROLES = ['Admin', 'Secretary', 'Treasurer'];

export default function GuidePage() {
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();

  const roleFromUrl = VALID_ROLES.find(
    (role) => role.toLowerCase() === (searchParams.get('role') || '').toLowerCase(),
  );
  const [activeRole, setActiveRole] = useState(roleFromUrl || null);
  const [activeSectionId, setActiveSectionId] = useState(null);

  useEffect(() => {
    if (roleFromUrl) setActiveRole(roleFromUrl);
  }, [roleFromUrl]);

  const guide = activeRole ? GUIDE_CONTENT[activeRole] : null;

  useEffect(() => {
    if (guide) setActiveSectionId(guide.sections[0]?.id || null);
  }, [activeRole]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickRole(role) {
    setActiveRole(role);
    setSearchParams({ role }, { replace: true });
  }

  function scrollToSection(id) {
    setActiveSectionId(id);
    const el = document.getElementById(`guide-section-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!guide) {
    return (
      <div className="guide-page">
        <div className="guide-topbar">
          <button className="guide-back-link" onClick={() => navigate('/')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to Home
          </button>
        </div>

        <div className="guide-role-select">
          <h1>{organization.hoaName} — User Guide</h1>
          <p>Choose your role to see the guide built for what you'll actually use.</p>
          <div className="guide-role-select-options">
            {VALID_ROLES.map((role) => (
              <button key={role} className="guide-role-select-btn" onClick={() => pickRole(role)} type="button">
                {role}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="guide-page">
      <div className="guide-topbar">
        <button className="guide-back-link" onClick={() => navigate('/')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to Home
        </button>

        <div className="guide-role-switch">
          {VALID_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              className={`guide-role-switch-btn ${role === activeRole ? 'active' : ''}`}
              onClick={() => pickRole(role)}
            >
              {role}
            </button>
          ))}
        </div>

        <button className="guide-login-cta" onClick={() => navigate(`/login?role=${activeRole}`)}>
          Sign in as {activeRole} →
        </button>
      </div>

      <div className="guide-hero">
        <span className="guide-hero-eyebrow">{organization.hoaName.toUpperCase()} — USER GUIDE</span>
        <h1 className="guide-hero-title">{guide.role} Manual</h1>
        <p className="guide-hero-tagline">{guide.tagline}</p>
        <p className="guide-hero-intro">{guide.intro}</p>
      </div>

      <div className="guide-body">
        <nav className="guide-toc" aria-label="Guide sections">
          <span className="guide-toc-label">On this page</span>
          {guide.sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`guide-toc-link ${activeSectionId === section.id ? 'active' : ''}`}
              onClick={() => scrollToSection(section.id)}
            >
              {section.title}
            </button>
          ))}
          <button
            type="button"
            className={`guide-toc-link ${activeSectionId === 'common-tasks' ? 'active' : ''}`}
            onClick={() => scrollToSection('common-tasks')}
          >
            Common Tasks
          </button>
        </nav>

        <div className="guide-content">
          {guide.sections.map((section) => (
            <section key={section.id} id={`guide-section-${section.id}`} className="guide-section">
              <h2 className="guide-section-title">{section.title}</h2>
              <p className="guide-section-summary">{section.summary}</p>
              <ul className="guide-section-steps">
                {section.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ul>
            </section>
          ))}

          <section id="guide-section-common-tasks" className="guide-section guide-common-tasks">
            <h2 className="guide-section-title">Common Tasks</h2>
            <p className="guide-section-summary">
              Step-by-step walkthroughs for the things you'll do most often as {guide.role}.
            </p>
            <div className="guide-task-grid">
              {guide.commonTasks.map((task, index) => (
                <div key={index} className="guide-task-card">
                  <h3 className="guide-task-title">{task.title}</h3>
                  <ol className="guide-task-steps">
                    {task.steps.map((step, stepIndex) => (
                      <li key={stepIndex}>{step}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>

          <div className="guide-footer-cta">
            <p>Ready to get started?</p>
            <button className="guide-login-cta" onClick={() => navigate(`/login?role=${activeRole}`)}>
              Sign in as {activeRole} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}