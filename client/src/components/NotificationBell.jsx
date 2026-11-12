import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarClock,
  Coins,
  TriangleAlert,
  Ban,
  UserRound,
  Settings,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import {
  fetchSystemNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  notificationLink,
  popoverPosition,
  relativeManilaTime,
  unreadBadge,
  NOTIFICATION_LIMIT,
  isCurrentNotification,
} from '../lib/systemNotifications';
import {
  mergeLiveNotification,
  watchStaffInserts,
} from '../lib/notificationRealtime';
import { staffNotificationCopy } from '../lib/staffActivityText';
import './NotificationBell.css';

const icons = {
  collection_reminder: CalendarClock,
  collection_run: Coins,
  collection_incomplete: TriangleAlert,
  penalty_anniversary: TriangleAlert,
  transaction_voided: Ban,
  ownership_changed: UserRound,
  settings_changed: Settings,
  credit_applied: Coins,
  penalty_applied: TriangleAlert,
  monthly_balance_added: Coins,
  penalty_collected: Coins,
};

export default function NotificationBell({ user }) {
  const navigate = useNavigate();
  const panelId = useId();
  const trigger = useRef(null);
  const panel = useRef(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [noticeFilter, setNoticeFilter] = useState('all');
  const [data, setData] = useState({ items: [], unread: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState({});
  const enabled =
    ['admin', 'secretary', 'treasurer'].includes(user?.role) && !!user?.id;

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await fetchSystemNotifications(supabase);
      if (request === generation.current) {
        setData(next);
        setError('');
      }
    } catch {
      if (request === generation.current)
        setError('Notifications could not be refreshed. Please retry.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOpen(false);
    setSelectedNotice(null);
    setNoticeFilter('all');
    setData({ items: [], unread: 0 });
    setLoading(true);
    if (!enabled) return;
    const stopRealtime = watchStaffInserts(supabase, {
      table: 'notifications',
      onInsert: (row) => {
        generation.current++;
        setData((current) => mergeLiveNotification(current, row));
      },
      refresh,
    });
    void refresh();
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      generation.current++;
      stopRealtime();
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, user?.id, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const expiries = data.items
      .map((item) => Date.parse(item.expires_at))
      .filter(Number.isFinite);
    if (!expiries.length) return;
    const delay = Math.max(
      1,
      Math.min(2147483647, Math.min(...expiries) - Date.now() + 1),
    );
    const timer = window.setTimeout(() => {
      setData((current) => ({
        ...current,
        items: current.items.filter((item) => isCurrentNotification(item)),
      }));
      void refresh();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [data.items, enabled, refresh]);

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!trigger.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const next = popoverPosition(anchor, viewport, 590);
      const width = Math.min(460, viewport.width - 24);
      setPosition({
        ...next,
        width,
        left: Math.max(
          12,
          Math.min(anchor.right - width, viewport.width - width - 12),
        ),
      });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    const outside = (event) => {
      if (
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    const key = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    panel.current?.focus();
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const mark = async (item) => {
    if (busy) return false;
    if (!isCurrentNotification(item)) {
      setError(
        'This alert is no longer current. Reopen notifications for the latest updates.',
      );
      void refresh();
      return false;
    }
    setBusy(true);
    try {
      await markNotificationsRead(supabase, user.id, [item.id]);
      setOpen(false);
      const collectionDate =
        item.kind === 'collection_run' ? item.payload?.collection_date : null;
      const billingMonth = /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(
        String(collectionDate || ''),
      )
        ? String(collectionDate).slice(0, 7)
        : null;
      navigate(
        billingMonth
          ? `/billing-audit?month=${billingMonth}`
          : notificationLink(item.link, user.role),
      );
      await refresh();
      return true;
    } catch {
      setError('Could not mark this notification as read. Please retry.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const markAll = async () => {
    setBusy(true);
    try {
      await markAllNotificationsRead(supabase, user.id);
      await refresh();
    } catch {
      setError('Could not mark all notifications as read. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  const visibleItems =
    noticeFilter === 'unread'
      ? data.items.filter((item) => !item.read)
      : data.items;

  if (!enabled) return null;
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="notification-bell motion-interactive"
        aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={19} aria-hidden="true" />
        {data.unread > 0 && (
          <span className="notification-badge">{unreadBadge(data.unread)}</span>
        )}
      </button>
      {open &&
        createPortal(
          <section
            id={panelId}
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-label="System notifications"
            className="notification-panel motion-page-enter"
            style={position}
          >
            <header className="notification-panel-header">
              <div className="notification-heading-row">
                <div>
                  <span className="notification-eyebrow">Activity center</span>
                  <h2>
                    Notifications <span>{data.unread} unread</span>
                  </h2>
                </div>
                <button
                  type="button"
                  className="notification-close"
                  aria-label="Close notifications"
                  onClick={() => {
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  ×
                </button>
              </div>
              <div className="notification-toolbar">
                <div
                  className="notification-filter-tabs"
                  role="group"
                  aria-label="Filter notifications"
                >
                  <button
                    type="button"
                    className={noticeFilter === 'all' ? 'active' : ''}
                    aria-pressed={noticeFilter === 'all'}
                    onClick={() => setNoticeFilter('all')}
                  >
                    All <span>{data.items.length}</span>
                  </button>
                  <button
                    type="button"
                    className={noticeFilter === 'unread' ? 'active' : ''}
                    aria-pressed={noticeFilter === 'unread'}
                    onClick={() => setNoticeFilter('unread')}
                  >
                    Unread{' '}
                    <span>
                      {data.items.filter((item) => !item.read).length}
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  className="notification-mark-all"
                  disabled={busy || !data.unread}
                  onClick={markAll}
                >
                  Mark all as read
                </button>
              </div>
            </header>
            {error && (
              <div className="notification-error" role="alert">
                {error}{' '}
                <button type="button" onClick={refresh}>
                  Retry
                </button>
              </div>
            )}
            {loading ? (
              <div aria-busy="true" aria-label="Loading notifications">
                {[1, 2, 3].map((key) => (
                  <div key={key} className="notification-skeleton" />
                ))}
              </div>
            ) : !visibleItems.length ? (
              <div className="notification-empty">
                <Bell size={26} />
                <p>
                  {error
                    ? 'Notifications are unavailable.'
                    : 'You’re all caught up.'}
                </p>
                <small>
                  Collection reminders, account activity, voids, and settings
                  updates appear here.
                </small>
              </div>
            ) : (
              <ul>
                {visibleItems.slice(0, NOTIFICATION_LIMIT).map((item) => {
                  const copy = staffNotificationCopy(item);
                  const Icon = icons[item.kind] || Bell;
                  return (
                    <li
                      key={item.id}
                      className={item.read ? '' : 'notification-unread'}
                    >
                      <button
                        type="button"
                        className="notification-item"
                        disabled={busy}
                        onClick={() => mark(item)}
                      >
                        <span
                          className={`notification-icon-tile notice-kind-${item.kind}`}
                        >
                          <Icon
                            className="notification-kind"
                            size={18}
                            aria-hidden="true"
                          />
                        </span>
                        <span className="notification-copy">
                          <strong>{copy.title}</strong>
                          <span className="notification-body">{copy.body}</span>
                          <time
                            dateTime={item.created_at}
                            title={new Date(item.created_at).toLocaleString(
                              'en-PH',
                              {
                                timeZone: 'Asia/Manila',
                                timeZoneName: 'short',
                              },
                            )}
                          >
                            {relativeManilaTime(item.created_at)}
                          </time>
                        </span>
                        {!item.read && (
                          <span
                            className="notification-dot"
                            aria-label="Unread"
                          />
                        )}
                      </button>
                      <div className="notification-detail-action">
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            setSelectedNotice(item);
                          }}
                        >
                          View details <span aria-hidden="true">→</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>,
          document.body,
        )}
      {selectedNotice &&
        createPortal(
          <NoticeDetails
            item={selectedNotice}
            busy={busy}
            error={error}
            onClose={() => {
              setSelectedNotice(null);
              trigger.current?.focus();
            }}
            onOpen={async () => {
              if (await mark(selectedNotice)) setSelectedNotice(null);
            }}
          />,
          document.body,
        )}
    </>
  );
}

function NoticeDetails({ item, onClose, onOpen, busy, error }) {
  const copy = staffNotificationCopy(item);
  const closeButton = useRef(null);
  const dialog = useRef(null);
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const escape = (event) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const payload = item.payload || {};
  const date = new Date(item.created_at).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  function trap(event) {
    if (event.key !== 'Tab') return;
    const controls = [
      ...dialog.current.querySelectorAll('button,a[href]'),
    ].filter((node) => !node.disabled);
    const first = controls[0],
      last = controls[controls.length - 1];
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
      className="notice-detail-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="notice-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notice-detail-title"
        ref={dialog}
        onKeyDown={trap}
      >
        <header>
          <div>
            <span className="notice-detail-kicker">System notification</span>
            <h2 id="notice-detail-title">{copy.title}</h2>
          </div>
          <button
            type="button"
            ref={closeButton}
            onClick={onClose}
            aria-label="Close notification details"
          >
            ×
          </button>
        </header>
        <div className="notice-detail-body">
          <div className="notice-detail-meta">
            <span className={item.read ? 'is-read' : 'is-unread'}>
              {item.read ? 'Read' : 'Unread'}
            </span>
            <time dateTime={item.created_at}>{date} · Philippine time</time>
          </div>
          {error && (
            <p className="notice-detail-error" role="alert">
              {error}
            </p>
          )}
          <section className="notice-detail-card">
            <h3>Message</h3>
            <p>{copy.body || item.body || 'No additional message provided.'}</p>
          </section>
          {!!copy.related.length && (
            <section className="notice-detail-card">
              <h3>Related information</h3>
              <ul>
                {copy.related.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </section>
          )}
          {!!payload.top_accounts?.length && (
            <section className="notice-detail-card">
              <h3>Related accounts</h3>
              <div className="notice-account-list">
                {payload.top_accounts.map((account) => (
                  <div key={account.property_id}>
                    <span>
                      <strong>{account.name}</strong>
                      <small>
                        {String(account.block).match(/block/i)
                          ? account.block
                          : `Block ${account.block}`}{' '}
                        · Lot {account.lot_number}
                      </small>
                    </span>
                    <b>{account.amount_formatted}</b>
                  </div>
                ))}
              </div>
            </section>
          )}
          <dl className="notice-detail-facts">
            <div>
              <dt>Recorded by</dt>
              <dd>{payload.actor_name || 'System-generated alert'}</dd>
            </div>
            {payload.observed_on && (
              <div>
                <dt>Information checked</dt>
                <dd>{payload.observed_on} · Philippine time</dd>
              </div>
            )}
          </dl>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="notice-detail-primary"
            disabled={busy}
            onClick={onOpen}
          >
            {busy ? 'Opening…' : 'Open related record →'}
          </button>
        </footer>
      </section>
    </div>
  );
}
