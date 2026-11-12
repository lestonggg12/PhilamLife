import './GrievancesPage.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { downloadGrievanceBackup } from '../lib/grievanceBackup';
import { supabase } from '../lib/supabaseClient';
import GrievanceCloudCreate from '../components/GrievanceCloudCreate';
import GrievanceCloudReview from '../components/GrievanceCloudReview';
import GrievancePeriodStatement from '../components/GrievancePeriodStatement';
import DateField from '../components/DateField';
import { createPortal } from 'react-dom';

// Resolve the date in the HOA timezone rather than freezing a past calendar date.
// This is refreshed when the page is reloaded; live midnight rollover is a separate follow-up.
const TODAY = (() => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
})();
const STORAGE_KEY = 'philamlife.grievances.panel.cases';
const CATEGORIES = [
  'Noise',
  'Parking',
  'Pets',
  'Maintenance',
  'Neighbor dispute',
  'Dues or payment dispute',
  'Rule violation',
  'Officer conduct',
  'Other',
];
const STATUSES = ['Open', 'In progress', 'Resolved'];
const EMPTY_RECORD = {
  id: '',
  category: 'Noise',
  title: '',
  filedBy: '',
  concerns: '',
  lot: '',
  location: '',
  incidentDate: '',
  filedDate: TODAY,
  handler: '',
  followUp: '',
  status: 'Open',
  description: '',
  requestedAction: '',
  outcome: '',
  history: [],
};

const dateObject = (value) => new Date(`${value}T00:00:00`);
const formatDate = (value) =>
  value
    ? dateObject(value).toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
const dayDifference = (from, to) =>
  Math.round((dateObject(to) - dateObject(from)) / 86400000);
const isClosedCase = (item) =>
  ['Resolved', 'Dismissed', 'Withdrawn'].includes(item.status);
const isOpenCase = (item) =>
  item.status === 'Open' || item.status === 'Received';
const isInProgress = (item) => !isClosedCase(item) && !isOpenCase(item);
const isOverdue = (item) =>
  item.followUp && !isClosedCase(item) && item.followUp <= TODAY;
const isDueSoon = (item) =>
  item.followUp &&
  !isClosedCase(item) &&
  dayDifference(TODAY, item.followUp) >= 0 &&
  dayDifference(TODAY, item.followUp) <= 3;
const slug = (value) => value.toLowerCase().replace(' ', '-');

function Icon({ name, size = 18 }) {
  const paths = {
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 0 0-14.8-4L3 10M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14M21 19v-5h-5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    file: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    warning: (
      <>
        <path d="m12 4 8 15H4L12 4Z" />
        <path d="M12 9v4M12 16h.01" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8 12 2.5 2.5L16 9" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function statusPill(status) {
  return (
    <span className={`status-pill ${slug(status)}`}>
      <i />
      {status}
    </span>
  );
}

function Field({
  label,
  optional = false,
  required = false,
  children,
  wide = false,
}) {
  return (
    <label className={wide ? 'form-field wide' : 'form-field'}>
      <span>
        {label}{' '}
        <em>{required ? '(required)' : optional ? '(optional)' : ''}</em>
      </span>
      {children}
    </label>
  );
}

export default function GrievancesPage() {
  const [cases, setCases] = useState(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [tab, setTab] = useState('register');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All categories');
  const [handler, setHandler] = useState('All handlers');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [showCloudForm, setShowCloudForm] = useState(false);
  const [sharedReviewId, setSharedReviewId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [cloudCheck, setCloudCheck] = useState({
    state: 'checking',
    count: null,
  });
  const [sharedCases, setSharedCases] = useState([]);
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const lastFocus = useRef(null);

  const displayCases = useMemo(() => {
    const cloud =
      cloudCheck.state === 'ready'
        ? sharedCases.map((item) => {
            const filed = item.filed_at
              ? new Intl.DateTimeFormat('en-US', {
                  timeZone: 'Asia/Manila',
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).formatToParts(new Date(item.filed_at))
              : [];
            const part = (type) =>
              filed.find((value) => value.type === type)?.value || '';
            return {
              id: 'GR-' + item.case_number,
              title: item.title,
              category: item.category,
              filedBy: item.complainant,
              concerns: item.respondent || '',
              location: item.location || '',
              lot: '',
              handler: item.assigned_handler || '',
              status: item.status,
              followUp: item.follow_up_date || '',
              filedDate: filed.length
                ? [part('year'), part('month'), part('day')].join('-')
                : '',
              _shared: true,
              _cloudId: item.id,
            };
          })
        : [];
    return [...cloud, ...cases];
  }, [cases, sharedCases, cloudCheck.state]);

  const handlerOptions = useMemo(
    () => [
      'All handlers',
      ...new Set(displayCases.map((item) => item.handler).filter(Boolean)),
    ],
    [displayCases],
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return displayCases.filter((item) => {
      const text = [
        item.id,
        item.category,
        item.title,
        item.filedBy,
        item.concerns,
        item.lot,
        item.location,
        item.handler,
      ]
        .join(' ')
        .toLowerCase();
      const matchesFilter =
        filter === 'all' ||
        (filter === 'active' && !isClosedCase(item)) ||
        (filter === 'overdue' && isOverdue(item)) ||
        (filter === 'resolved' && isClosedCase(item)) ||
        (filter === 'open' && isOpenCase(item)) ||
        (filter === 'progress' && isInProgress(item));
      return (
        (!term || text.includes(term)) &&
        (category === 'All categories' || item.category === category) &&
        (handler === 'All handlers' || item.handler === handler) &&
        matchesFilter
      );
    });
  }, [displayCases, search, category, handler, filter]);
  const chipCounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = displayCases.filter((item) => {
      const text = [
        item.id,
        item.category,
        item.title,
        item.filedBy,
        item.concerns,
        item.lot,
        item.location,
        item.handler,
      ]
        .join(' ')
        .toLowerCase();
      return (
        (!term || text.includes(term)) &&
        (category === 'All categories' || item.category === category) &&
        (handler === 'All handlers' || item.handler === handler)
      );
    });
    return {
      all: base.length,
      open: base.filter(isOpenCase).length,
      progress: base.filter(isInProgress).length,
      resolved: base.filter((item) => item.status === 'Resolved').length,
      overdue: base.filter(isOverdue).length,
    };
  }, [displayCases, search, category, handler]);
  const stats = useMemo(() => {
    const resolved = displayCases.filter((item) => item.status === 'Resolved');
    const active = displayCases.filter((item) => !isClosedCase(item));
    const due = displayCases.filter(isOverdue);
    const oldest = due.reduce(
      (max, item) => Math.max(max, dayDifference(item.followUp, TODAY)),
      0,
    );
    const total = displayCases.length;
    return {
      total,
      filed: displayCases.filter(
        (item) => item.filedDate?.slice(0, 7) === TODAY.slice(0, 7),
      ).length,
      active: active.length,
      progress: displayCases.filter(isInProgress).length,
      open: displayCases.filter(isOpenCase).length,
      due: due.length,
      oldest,
      resolved: resolved.length,
      rate: total ? Math.round((resolved.length / total) * 100) : 0,
    };
  }, [displayCases]);
  const selectedCase =
    modal?.type === 'case' ? cases.find((item) => item.id === modal.id) : null;

  // Read the full authorized shared register; the first 25 are shown in the compact preview.
  // Existing browser-local cases are never modified by this query.
  useEffect(() => {
    let active = true;
    async function loadSharedRegister() {
      const rows = [];
      const pageSize = 250;
      let count = 0;
      try {
        for (let start = 0; start < 100000; start += pageSize) {
          const {
            data,
            count: total,
            error,
          } = await supabase
            .from('grievance_cases')
            .select(
              'id,case_number,title,status,category,complainant,respondent,location,assigned_handler,filed_at,follow_up_date',
              { count: 'exact' },
            )
            .order('filed_at', { ascending: false })
            .range(start, start + pageSize - 1);
          if (error) throw error;
          if (!Array.isArray(data))
            throw new Error('Shared grievance records are unavailable.');
          rows.push(...data);
          count = total ?? rows.length;
          if (rows.length >= count || data.length < pageSize) break;
        }
        if (active) {
          setSharedCases(rows);
          setCloudCheck({ state: 'ready', count });
        }
      } catch {
        if (active) {
          setSharedCases([]);
          setCloudCheck({ state: 'error', count: null });
        }
      }
    }
    void loadSharedRegister();
    return () => {
      active = false;
    };
  }, [cloudRefresh]);

  useEffect(() => {
    document.body.style.overflow =
      modal || showCloudForm || sharedReviewId ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [modal, showCloudForm, sharedReviewId]);
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  }, [cases]);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (
        event.key === '/' &&
        !modal &&
        !showCloudForm &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        event.preventDefault();
        document.querySelector('[data-grievance-search]')?.focus();
      }
      if (event.key === 'Escape' && showCloudForm) setShowCloudForm(false);
      if (event.key === 'Escape' && sharedReviewId) {
        setSharedReviewId(null);
        window.setTimeout(() => lastFocus.current?.focus?.(), 0);
      }
      if (
        event.key === 'Escape' &&
        modal &&
        (modal.type === 'case' || modal.type === 'form')
      )
        closeModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, showCloudForm, sharedReviewId]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function closeModal() {
    setModal(null);
    setDraft(null);
    setFormError('');
    window.setTimeout(() => lastFocus.current?.focus?.(), 0);
  }
  function openForm(record = null, trigger) {
    if (!record) {
      setShowCloudForm(true);
      return;
    }
    lastFocus.current = trigger || document.activeElement;
    setDraft({ ...record });
    setFormError('');
    setModal({ type: 'form', editing: true });
  }
  function openCase(record, trigger) {
    if (record._shared) {
      lastFocus.current = trigger || document.activeElement;
      setSharedReviewId(record._cloudId);
      return;
    }
    lastFocus.current = trigger || document.activeElement;
    setDraft({ ...record });
    setFormError('');
    setModal({ type: 'case', id: record.id });
  }
  function closeSharedReview() {
    setSharedReviewId(null);
    window.setTimeout(() => lastFocus.current?.focus?.(), 0);
  }
  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function clearFilters() {
    setSearch('');
    setCategory('All categories');
    setHandler('All handlers');
    setFilter('all');
  }
  function toggleFilter(value) {
    setFilter((current) => (current === value ? 'all' : value));
  }
  function refresh() {
    setRefreshing(true);
    setCloudRefresh((value) => value + 1);
    window.setTimeout(() => {
      setRefreshing(false);
      setToast('Grievance register refreshed');
    }, 350);
  }
  function backUpLocalCases() {
    try {
      const saved = downloadGrievanceBackup(cases);
      setToast(
        saved
          ? 'Grievance backup downloaded. Store this file securely.'
          : 'There are no local grievances to back up.',
      );
    } catch {
      setToast(
        'The backup could not be downloaded. Your existing records were not changed.',
      );
    }
  }
  function validateRecord(record, note, editing) {
    if (
      !record.title.trim() ||
      !record.filedBy.trim() ||
      !record.concerns.trim() ||
      !record.location.trim() ||
      !record.description.trim()
    )
      return 'Complete the title, people involved, location and description.';
    if (!note.trim()) return 'Add a note explaining this record or update.';
    if (record.incidentDate && record.incidentDate > TODAY)
      return 'The incident date cannot be in the future.';
    if (editing && record.status === 'Resolved' && !record.outcome.trim())
      return 'Add an outcome before resolving this case.';
    return '';
  }
  function saveForm(event) {
    event.preventDefault();
    const note = draft.updateNote || draft.filingNote || '';
    const error = validateRecord(draft, note, modal.editing);
    if (error) {
      setFormError(error);
      return;
    }
    const id = modal.editing
      ? draft.id
      : `GR-${String(cases.length + 1).padStart(5, '0')}`;
    const historyEntry = {
      date: TODAY,
      title: modal.editing
        ? `Status: ${selectedCase?.status || 'Open'} → ${draft.status}`
        : 'Complaint received',
      note: note.trim(),
      by: 'Secretary',
    };
    const next = {
      ...draft,
      id,
      filedDate: draft.filedDate || TODAY,
      filingNote: undefined,
      updateNote: undefined,
      history: modal.editing
        ? [...(selectedCase?.history || []), historyEntry]
        : [historyEntry],
    };
    setCases((current) =>
      modal.editing
        ? current.map((item) => (item.id === id ? next : item))
        : [next, ...current],
    );
    setToast(`${id} ${modal.editing ? 'updated' : 'recorded'} successfully.`);
    clearFilters();
    closeModal();
  }
  function saveCaseUpdate(event) {
    event.preventDefault();
    const note = draft.updateNote?.trim() || '';
    if (!note) {
      setFormError('Add a note explaining this record or update.');
      return;
    }
    if (draft.status === 'Resolved' && !draft.outcome?.trim()) {
      setFormError('Add an outcome before resolving this case.');
      return;
    }
    const previous = selectedCase.status;
    const historyEntry = {
      date: TODAY,
      title:
        previous === draft.status
          ? 'Case note added'
          : `Status: ${previous} → ${draft.status}`,
      note,
      by: 'Secretary',
    };
    setCases((current) =>
      current.map((item) =>
        item.id === draft.id
          ? {
              ...draft,
              updateNote: undefined,
              history: [...(item.history || []), historyEntry],
            }
          : item,
      ),
    );
    setToast(`${draft.id} updated successfully.`);
    closeModal();
  }

  const hasFilters = Boolean(
    search ||
    category !== 'All categories' ||
    handler !== 'All handlers' ||
    filter !== 'all',
  );
  const chips = [
    ['all', 'All', chipCounts.all],
    ['open', 'Open', chipCounts.open],
    ['progress', 'In progress', chipCounts.progress],
    ['resolved', 'Resolved', chipCounts.resolved],
    ['overdue', 'Follow-up due', chipCounts.overdue],
  ];
  return (
    <>
      <main className="grievance-app">
        <header className="grievance-hero">
          <div>
            <p className="grievance-eyebrow">Secretary workspace</p>
            <h1>Grievances</h1>
            <p className="grievance-subtitle">
              Record complaints, follow their progress and prepare period
              statements.
            </p>
          </div>
          <div className="grievance-actions">
            <button
              className="button-outline"
              type="button"
              onClick={backUpLocalCases}
            >
              Back up cases
            </button>
            <button
              className="button-outline"
              type="button"
              onClick={refresh}
              disabled={refreshing}
            >
              <Icon name="refresh" size={16} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              className="button-primary"
              type="button"
              onClick={(event) => openForm(null, event.currentTarget)}
            >
              <Icon name="plus" size={17} />
              Record grievance
            </button>
          </div>
        </header>
        <section className="grievance-stats" aria-label="Grievance summaries">
          <StatCard
            label="Total cases"
            value={stats.total}
            note={`${stats.filed} filed this month`}
            icon="file"
            selected={filter === 'all'}
            onClick={() => {
              setTab('register');
              toggleFilter('all');
            }}
          />
          <StatCard
            label="Active cases"
            value={stats.active}
            note={`${stats.progress} in progress, ${stats.open} not started`}
            icon="clock"
            tone="amber"
            selected={filter === 'active'}
            onClick={() => {
              setTab('register');
              toggleFilter('active');
            }}
          />
          <StatCard
            label="Follow-up due"
            value={stats.due}
            note={
              stats.due
                ? `Oldest is ${stats.oldest} days overdue`
                : 'Nothing overdue'
            }
            icon="warning"
            tone="red"
            danger={stats.due > 0}
            selected={filter === 'overdue'}
            onClick={() => {
              setTab('register');
              toggleFilter('overdue');
            }}
          />
          <StatCard
            label="Resolution rate"
            value={`${stats.rate}%`}
            note={`${stats.resolved} of ${stats.total} resolved`}
            icon="check"
            tone="green"
            selected={filter === 'resolved'}
            onClick={() => {
              setTab('register');
              toggleFilter('resolved');
            }}
            progress={stats.rate}
          />
        </section>
        {cloudCheck.state === 'error' && (
          <p className="grievance-cloud-status" role="alert">
            Shared grievance storage is unavailable. Browser records are
            unchanged. Refresh to retry.
          </p>
        )}
        <nav
          className="grievance-tabs"
          role="tablist"
          aria-label="Grievance views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            className={tab === 'register' ? 'is-active' : ''}
            onClick={() => setTab('register')}
          >
            Case register
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'statement'}
            className={tab === 'statement' ? 'is-active' : ''}
            onClick={() => setTab('statement')}
          >
            Period statement
          </button>
        </nav>
        {tab === 'statement' ? (
          <GrievancePeriodStatement />
        ) : (
          <>
            <section className="register-panel">
              <div className="register-heading">
                <div>
                  <h2>Case register</h2>
                  <p>
                    Find a complaint, check its follow-up, or open the full case
                    details.
                  </p>
                </div>
                <span className="case-count">
                  {filtered.length} matching cases
                </span>
              </div>
              <div className="status-chips" aria-label="Case status filters">
                {chips.map(([value, label, count]) => (
                  <button
                    type="button"
                    key={value}
                    className={`${filter === value ? 'is-active' : ''} ${value === 'overdue' && filter === value ? 'is-danger' : ''}`}
                    onClick={() => toggleFilter(value)}
                    aria-pressed={filter === value}
                  >
                    {label}
                    <span>{count}</span>
                  </button>
                ))}
              </div>
              <div className="filter-bar">
                <label className="search-field">
                  <span className="sr-only">Search cases</span>
                  <Icon name="search" size={17} />
                  <input
                    data-grievance-search
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search people, title, location or handler…"
                  />
                  <kbd>/</kbd>
                </label>
                <label>
                  <span className="sr-only">Category</span>
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    <option>All categories</option>
                    {CATEGORIES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Handler</span>
                  <select
                    value={handler}
                    onChange={(event) => setHandler(event.target.value)}
                  >
                    {handlerOptions.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                {hasFilters && (
                  <button
                    className="clear-link"
                    type="button"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                )}
              </div>
              <div
                className="case-table"
                role="table"
                aria-label="Grievance cases"
              >
                <div className="case-heading" role="row">
                  <span>Case ID</span>
                  <span>Case / homeowner</span>
                  <span>Lot</span>
                  <span>Handler</span>
                  <span>Follow-up</span>
                  <span>Status</span>
                  <span />
                </div>
                {filtered.map((item) => (
                  <button
                    className="case-row"
                    role="row"
                    type="button"
                    key={item.id}
                    onClick={(event) => openCase(item, event.currentTarget)}
                  >
                    <span className="case-id">
                      <strong>{item.id}</strong>
                      <small>{item.category}</small>
                    </span>
                    <span className="case-title">
                      <strong>{item.title}</strong>
                      <small>
                        Filed by {item.filedBy} <b>→</b> {item.concerns}
                      </small>
                    </span>
                    <span data-label="Lot">{item.lot || '—'}</span>
                    <span data-label="Handler">{item.handler || '—'}</span>
                    <span
                      data-label="Follow-up"
                      className={`follow-up ${isOverdue(item) ? 'is-overdue' : isDueSoon(item) ? 'is-soon' : ''}`}
                    >
                      {isOverdue(item) && <Icon name="warning" size={14} />}
                      {formatDate(item.followUp)}
                    </span>
                    <span data-label="Status">{statusPill(item.status)}</span>
                    <span className="row-chevron">
                      <Icon name="chevron" size={18} />
                    </span>
                  </button>
                ))}
                {!filtered.length && (
                  <EmptyState
                    filtered={hasFilters}
                    onClear={clearFilters}
                    onRecord={(event) => openForm(null, event.currentTarget)}
                  />
                )}
              </div>
              <footer className="table-footer">
                <span>
                  Showing {filtered.length} of {displayCases.length} cases
                </span>
                <span>Click a row to view or update</span>
              </footer>
            </section>
          </>
        )}
      </main>
      {showCloudForm && (
        <CloudGrievanceModal
          label="Record a grievance"
          onClose={() => setShowCloudForm(false)}
        >
          {cloudCheck.state === 'ready' ? (
            <GrievanceCloudCreate
              onSaved={() => setCloudRefresh((value) => value + 1)}
              onClose={() => setShowCloudForm(false)}
            />
          ) : (
            <div className="gc-modal-content">
              <header className="gc-header">
                <h2>Shared storage unavailable</h2>
                <button
                  type="button"
                  className="gc-icon-close"
                  onClick={() => setShowCloudForm(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>
              <div className="gc-body">
                <p role="alert">
                  Shared grievance storage is not connected. Please try again
                  when it is available.
                </p>
              </div>
              <footer className="gc-footer">
                <button
                  type="button"
                  className="gc-button gc-button-secondary"
                  onClick={() => setShowCloudForm(false)}
                >
                  Close
                </button>
              </footer>
            </div>
          )}
        </CloudGrievanceModal>
      )}
      {sharedReviewId && (
        <CloudGrievanceModal
          label="Review shared grievance"
          onClose={closeSharedReview}
        >
          <GrievanceCloudReview
            caseId={sharedReviewId}
            onClose={closeSharedReview}
            onSaved={() => setCloudRefresh((value) => value + 1)}
          />
        </CloudGrievanceModal>
      )}
      {modal?.type === 'case' && selectedCase && (
        <CaseDialog
          draft={draft}
          setDraft={setDraft}
          onClose={closeModal}
          onEdit={() => {
            lastFocus.current = document.activeElement;
            setModal({ type: 'form', editing: true });
          }}
          onSave={saveCaseUpdate}
          error={formError}
        />
      )}
      {modal?.type === 'form' && draft && (
        <FormDialog
          draft={draft}
          setDraft={setDraft}
          editing={modal.editing}
          onClose={closeModal}
          onSave={saveForm}
          error={formError}
        />
      )}
      {toast && (
        <div className="grievance-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}

// Only the pilot cloud form uses this portal. Legacy grievance dialogs are unchanged.
function CloudGrievanceModal({ children, label, onClose }) {
  const panelRef = useRef(null);
  const restoreFocusRef = useRef(null);
  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    panelRef.current?.querySelector('input,select,textarea,button')?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, []);

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = [
      ...panelRef.current.querySelectorAll(
        'input,select,textarea,button,[tabindex]',
      ),
    ].filter(
      (node) =>
        !node.disabled &&
        node.tabIndex !== -1 &&
        node.getClientRects().length > 0,
    );
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="grievance-dialog-scope"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        boxSizing: 'border-box',
        overflowY: 'auto',
        background: 'rgba(15, 63, 106, 0.55)',
        '--blue': '#1464a0',
        '--dark': '#0f3f6a',
        '--ink': '#071e30',
        '--body': '#2a5470',
        '--muted': '#5a7a92',
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={trapFocus}
        style={{
          width: 'min(960px, calc(100vw - 24px))',
          maxHeight: '90dvh',
          overflow: 'hidden',
          margin: 'auto',
          borderRadius: 18,
          border: '1px solid #c5dfed',
          background: '#edf6fd',
          boxShadow: '0 24px 70px rgba(7,30,48,.33)',
          boxSizing: 'border-box',
        }}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}

function StatCard({
  label,
  value,
  note,
  icon,
  tone = 'blue',
  danger = false,
  selected,
  onClick,
  progress,
}) {
  return (
    <button
      type="button"
      className={`stat-card ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${tone}`}>
          <Icon name={icon} size={17} />
        </span>
      </span>
      <strong className={danger ? 'danger-number' : ''}>{value}</strong>
      <small>{note}</small>
      {progress !== undefined && (
        <span className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </span>
      )}
    </button>
  );
}
function EmptyState({ filtered, onClear, onRecord }) {
  return (
    <div className="empty-state">
      <span className="statement-icon">
        <Icon name={filtered ? 'search' : 'file'} size={22} />
      </span>
      <h2>
        {filtered ? 'No cases match these filters' : 'No grievances found'}
      </h2>
      <p>
        {filtered
          ? 'Try clearing a filter or searching for a different case.'
          : 'Record a complaint or adjust your search filters.'}
      </p>
      {filtered ? (
        <button className="button-outline" type="button" onClick={onClear}>
          Clear filters
        </button>
      ) : (
        <button className="button-primary" type="button" onClick={onRecord}>
          <Icon name="plus" size={16} />
          Record grievance
        </button>
      )}
    </div>
  );
}

function CaseDialog({ draft, setDraft, onClose, onEdit, onSave, error }) {
  return (
    <Dialog
      className="case-dialog"
      label={`${draft.id} case details`}
      onClose={onClose}
      backdropClose
    >
      <header className="dialog-top">
        <div>
          <p className="drawer-kicker">
            {draft.id} · {draft.category}
          </p>
          <h2>{draft.title}</h2>
          <div className="case-meta">
            {statusPill(draft.status)}
            <span>
              Filed {formatDate(draft.filedDate)} by {draft.filedBy || '—'}
            </span>
            <span className={isOverdue(draft) ? 'is-overdue' : ''}>
              Follow-up {formatDate(draft.followUp)}
            </span>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="Close case"
        >
          <Icon name="close" size={19} />
        </button>
      </header>
      <div className="case-dialog-grid">
        <div className="case-content">
          <InfoCard title="What happened">
            <p>{draft.description || 'No description recorded.'}</p>
          </InfoCard>
          <InfoCard title="Requested action">
            <p>{draft.requestedAction || 'No requested action recorded.'}</p>
          </InfoCard>
          {draft.outcome && (
            <InfoCard title="Outcome">
              <p>{draft.outcome}</p>
            </InfoCard>
          )}
          <InfoCard title="Case history">
            <div className="timeline">
              {(draft.history || [])
                .slice()
                .reverse()
                .map((entry, index) => (
                  <article key={`${entry.date}-${index}`}>
                    <span className="timeline-dot" />
                    <strong>{entry.title}</strong>
                    <small>
                      {formatDate(entry.date)} · {entry.by}
                    </small>
                    <p>{entry.note}</p>
                  </article>
                ))}
            </div>
          </InfoCard>
        </div>
        <div className="case-side">
          <section className="dialog-card">
            <h3>Update status</h3>
            <div className="segmented-status">
              {STATUSES.map((status) => (
                <button
                  type="button"
                  key={status}
                  className={
                    draft.status === status ? `is-active ${slug(status)}` : ''
                  }
                  onClick={() => setDraft({ ...draft, status })}
                >
                  {status}
                </button>
              ))}
            </div>
            {draft.status === 'Resolved' && (
              <Field label="Outcome" required>
                <textarea
                  rows={3}
                  value={draft.outcome}
                  onChange={(event) =>
                    setDraft({ ...draft, outcome: event.target.value })
                  }
                />
              </Field>
            )}
            <Field label="Update note" required>
              <textarea
                rows={4}
                value={draft.updateNote || ''}
                onChange={(event) =>
                  setDraft({ ...draft, updateNote: event.target.value })
                }
              />
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button-primary full-button"
              type="button"
              onClick={onSave}
            >
              Save update
            </button>
          </section>
          <section className="dialog-card">
            <h3>Details</h3>
            <dl className="details-list">
              <div>
                <dt>Filed by</dt>
                <dd>{draft.filedBy || '—'}</dd>
              </div>
              <div>
                <dt>Concerns</dt>
                <dd>{draft.concerns || '—'}</dd>
              </div>
              <div>
                <dt>Lot</dt>
                <dd>{draft.lot || '—'}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{draft.location || '—'}</dd>
              </div>
              <div>
                <dt>Incident date</dt>
                <dd>{formatDate(draft.incidentDate)}</dd>
              </div>
              <div>
                <dt>Handler</dt>
                <dd>{draft.handler || '—'}</dd>
              </div>
              <div>
                <dt>Follow-up</dt>
                <dd>{formatDate(draft.followUp)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
      <footer className="dialog-footer">
        <button className="button-outline" type="button" onClick={onEdit}>
          Edit details
        </button>
      </footer>
    </Dialog>
  );
}
function InfoCard({ title, children }) {
  return (
    <section className="dialog-card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function FormDialog({ draft, setDraft, editing, onClose, onSave, error }) {
  const update = (key, value) => setDraft({ ...draft, [key]: value });
  return (
    <Dialog
      className="form-dialog"
      label={editing ? `${draft.id} edit details` : 'Record a grievance'}
      onClose={onClose}
    >
      <header className="dialog-top">
        <div>
          <p className="drawer-kicker">
            {editing ? draft.id : 'New complaint'}
          </p>
          <h2>{editing ? 'Edit details' : 'Record a grievance'}</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="Close form"
        >
          <Icon name="close" size={19} />
        </button>
      </header>
      <form onSubmit={onSave}>
        <div className="form-grid">
          <Field label="Title" required wide>
            <input
              value={draft.title}
              onChange={(event) => update('title', event.target.value)}
            />
          </Field>
          <Field label="Category" required>
            <select
              value={draft.category}
              onChange={(event) => update('category', event.target.value)}
            >
              {CATEGORIES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field label="Assigned person or committee" optional>
            <input
              value={draft.handler}
              onChange={(event) => update('handler', event.target.value)}
            />
          </Field>
          <Field label="Person making the complaint" required>
            <input
              value={draft.filedBy}
              onChange={(event) => update('filedBy', event.target.value)}
            />
          </Field>
          <Field label="Person or group the complaint concerns" required>
            <input
              value={draft.concerns}
              onChange={(event) => update('concerns', event.target.value)}
            />
          </Field>
          <Field label="Affected lot" optional>
            <input
              list="lot-suggestions"
              value={draft.lot}
              onChange={(event) => update('lot', event.target.value)}
              placeholder="e.g. B3 · L07"
            />
            <datalist id="lot-suggestions">
              <option value="A1 · L12" />
              <option value="B3 · L07" />
              <option value="C2 · L03" />
            </datalist>
          </Field>
          <Field label="Location or common area" required>
            <input
              value={draft.location}
              onChange={(event) => update('location', event.target.value)}
            />
          </Field>
          <Field label="Incident date" optional>
            <DateField
              ariaLabel="Incident date"
              max={TODAY}
              value={draft.incidentDate}
              onChange={(value) => update('incidentDate', value)}
            />
          </Field>
          <Field label="Next follow-up date" optional>
            <DateField
              ariaLabel="Next follow-up date"
              value={draft.followUp}
              onChange={(value) => update('followUp', value)}
            />
          </Field>
          <Field label="What happened?" required wide>
            <textarea
              rows={4}
              value={draft.description}
              onChange={(event) => update('description', event.target.value)}
            />
          </Field>
          <Field label="What action is requested?" optional wide>
            <textarea
              rows={3}
              value={draft.requestedAction}
              onChange={(event) =>
                update('requestedAction', event.target.value)
              }
            />
          </Field>
          <Field label={editing ? 'Update note' : 'Filing note'} required wide>
            <textarea
              rows={3}
              value={editing ? draft.updateNote || '' : draft.filingNote || ''}
              onChange={(event) =>
                update(
                  editing ? 'updateNote' : 'filingNote',
                  event.target.value,
                )
              }
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button className="button-outline" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button-primary"
            type="submit"
            style={{
              backgroundColor: '#1464a0',
              borderColor: '#1464a0',
              color: '#fff',
            }}
          >
            {editing ? 'Save changes' : 'Record grievance'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function Dialog({
  children,
  className,
  label,
  onClose,
  backdropClose = false,
}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('input,textarea,select,button')?.focus();
  }, []);
  function trap(event) {
    if (event.key !== 'Tab') return;
    const nodes = [
      ...ref.current.querySelectorAll('button,input,select,textarea'),
    ].filter((node) => !node.disabled);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return (
    <div
      className="modal-overlay grievance-dialog-scope"
      onMouseDown={(event) => {
        if (backdropClose && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className={`dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={trap}
      >
        {children}
      </section>
    </div>
  );
}
