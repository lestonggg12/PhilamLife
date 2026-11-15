import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Skeleton from "../components/skeleton/Skeleton";
import { supabase } from "../lib/supabaseClient";
import {
  compareActivityNewest,
  loadActivityMonth,
} from "../lib/activityArchive";
import ActivityArchiveStatus from "../components/ActivityArchiveStatus";
import Select from "../components/Select";
import { Activity, CreditCard, Users, Zap } from "../components/Icons";
import {
  staffActivityCopy,
  staffActionLabel,
  loadStaffActivityContext,
} from "../lib/staffActivityText";
import "./ActivityLogPage.css";

const ZONE = "Asia/Manila";
const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const fullFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: ZONE,
  dateStyle: "full",
  timeStyle: "short",
  hour12: true,
});
const groupFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const clockTime = new Intl.DateTimeFormat("en-PH", {
  timeZone: ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const clockDate = new Intl.DateTimeFormat("en-PH", {
  timeZone: ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const dateFull = new Intl.DateTimeFormat("en-PH", {
  timeZone: ZONE,
  dateStyle: "full",
});
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});
const RANGE_LABELS = {
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  all: "Selected month",
  custom: "Custom",
};
const DEFAULT_RANGE = "today";
const PAYMENT_RECORD_ACTIONS = new Set([
  "Payment Recorded",
  "Service Payment Recorded",
  "Service Balance Collected",
]);
function middleTruncate(value, limit) {
  const text = String(value);
  if (text.length <= limit) return text;
  const extensionIndex = text.lastIndexOf(".");
  const extension = extensionIndex > 0 ? text.slice(extensionIndex) : "";
  const available = Math.max(limit - extension.length - 1, 2);
  const left = Math.ceil(available / 2);
  const right = Math.floor(available / 2);
  return `${text.slice(0, left)}…${extension ? text.slice(-right - extension.length, -extension.length) : text.slice(-right)}${extension}`;
}

function actionIcon(action) {
  const value = String(action || "");
  const path = /payment|charge|expense|revenue/i.test(value) ? (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M7 14h3" />
    </>
  ) : /document/i.test(value) ? (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ) : /grievance/i.test(value) ? (
    <>
      <path d="M5 5h14v10H9l-4 4z" />
      <path d="M9 9h6M9 12h4" />
    </>
  ) : /homeowner|block|lot/i.test(value) ? (
    <>
      <path d="m3 11 9-7 9 7" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </>
  ) : (
    <circle cx="12" cy="12" r="3" />
  );
  return (
    <svg
      className="al-action-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}
function dateKey(value = new Date()) {
  const parts = Object.fromEntries(
    dayFormat.formatToParts(value).map(({ type, value: part }) => [type, part]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDays(key, days) {
  const value = new Date(`${key}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function shiftMonth(key, amount) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1))
    .toISOString()
    .slice(0, 7);
}
// Display-only parsing. Unknown action formats retain the complete original string.
const ACTIVITY_FIELD_LABELS = {
  price_per_sqm: "Price per square meter",
};

function humanizeActivityFields(value) {
  return String(value).replace(
    /(^|; )([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?=:)/g,
    (_, prefix, key) =>
      prefix +
      (ACTIVITY_FIELD_LABELS[key] ||
        key
          .replaceAll("_", " ")
          .replace(/\b\w/g, (letter) => letter.toUpperCase())),
  );
}

export function activityDisplay(log) {
  const raw = String(log.target || log.description || "");
  const actor = String(log.user || "").trim();
  const suffixPattern = actor
    ? new RegExp(
        ` \\((?:by )?${actor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)$`,
      )
    : null;
  const cleaned = suffixPattern ? raw.replace(suffixPattern, "") : raw;
  const text =
    log.action === "Settings Updated"
      ? humanizeActivityFields(cleaned)
      : cleaned;
  const parts = text.split(" — ");
  const expected = {
    "Payment Recorded": 3,
    "Charge Added": 3,
    "Payment Voided": 4,
    "Charge Voided": 4,
    "Document Uploaded": 2,
    "Document Deleted": 2,
  };
  const moneyAction =
    /^(Payment Recorded|Charge Added|Payment Voided|Charge Voided)$/.test(
      log.action || "",
    );
  const parsed =
    parts.length === expected[log.action] &&
    parts.every((part) => part.trim()) &&
    (!moneyAction || /^₱\s*-?[\d,]+(?:\.\d{1,2})?$/.test(parts[2]));
  const structuredAmount =
    typeof log.amount === "number" && Number.isFinite(log.amount)
      ? log.amount
      : null;
  const action = String(log.action || "");
  const expenseParts = /^(Expense Recorded|Expense Voided)$/.test(action)
    ? parts
    : null;
  const grievanceMatch = /^Grievance (Recorded|Updated)$/.test(action)
    ? /^(GR-[\w-]+) - (.+) - (.+)$/.exec(text)
    : null;
  const blockMatch = action === "Block Added" ? /^[\w-]+$/.exec(text) : null;
  const homeownerMatch =
    action === "Homeowner Added"
      ? /^(.+) — (\S+), Lot (\S+)$/.exec(text)
      : null;
  const documentMatch =
    /^(Document Uploaded|Document Deleted)$/.test(action) && parsed
      ? parts
      : null;
  const expenseSubject = expenseParts?.[0];
  const expenseDetail = expenseParts
    ?.slice(1)
    .filter(
      (part, index) =>
        !(
          index === 0 &&
          /^₱\s*-?[\d,]+(?:\.\d{1,2})?(?:\s+\([^)]*\))?(?:\s+\[Expense: [^\]]+\])?$/.test(
            part,
          )
        ),
    )
    .join(" — ");
  const parsedSubject =
    expenseParts && expenseSubject
      ? expenseSubject
      : grievanceMatch
        ? grievanceMatch[1]
        : blockMatch
          ? `Block ${blockMatch[0]}`
          : homeownerMatch
            ? homeownerMatch[1]
            : documentMatch
              ? middleTruncate(documentMatch[0], 44)
              : parsed
                ? parts[0]
                : text;
  const parsedDetail =
    expenseParts && expenseSubject
      ? expenseDetail
      : grievanceMatch
        ? `${grievanceMatch[2]} · ${grievanceMatch[3]}`
        : homeownerMatch
          ? `Block ${homeownerMatch[2]}, Lot ${homeownerMatch[3]}`
          : documentMatch
            ? ""
            : parsed
              ? parts
                  .slice(1)
                  .filter(
                    (part) =>
                      !/^₱\s*-?[\d,.]+$/.test(part) &&
                      part.replace(/\.[^.]+$/, "") !== parts[0],
                  )
                  .join(" — ")
              : "";
  const subject = documentMatch
    ? parsedSubject
    : log.subject || parsedSubject || "Unknown record";

  // Format service audit descriptions without changing their stored text.
  const servicePayment =
    action === "Service Payment Recorded"
      ? /^(SR-[\w-]+) — (.+) for (.+)$/.exec(text)
      : null;

  const serviceBalance =
    action === "Service Balance Collected"
      ? /^(SR-[\w-]+) — (₱\s*[\d,]+(?:\.\d{1,2})?) for (SR-[\w-]+) — (.+)$/.exec(
          text,
        )
      : null;

  const serviceVoid =
    action === "Service Receipt Voided"
      ? /^(SR-[\w-]+) — (.+) for (.+) — (₱\s*[\d,]+(?:\.\d{1,2})?) — (.+)$/.exec(
          text,
        )
      : null;

  // Only read an amount from the known amount field. Notes and setting changes
  // can mention peso values without representing a transaction.
  const balanceAmount = /^Balance (Added|Voided)$/.test(action)
    ? /^(.+?) as of \d{4}-\d{2}-\d{2}/.exec(parts[2] || "")?.[1]
    : null;
  const amountField =
    serviceBalance?.[2] ||
    serviceVoid?.[4] ||
    expenseParts?.[1] ||
    balanceAmount ||
    (parsed && moneyAction ? parts[2] : null);
  const money =
    /^₱\s*(-?\d[\d,]*(?:\.\d{1,2})?)(?:\s+\([^)]*\))?(?:\s+\[Expense: [^\]]+\])?$/.exec(
      amountField || "",
    );
  const amount =
    structuredAmount ?? (money ? Number(money[1].replaceAll(",", "")) : null);

  const serviceSubject =
    servicePayment?.[1] || serviceBalance?.[1] || serviceVoid?.[1];

  const serviceDetail = servicePayment
    ? `${servicePayment[2]} · ${servicePayment[3]}`
    : serviceBalance
      ? `Balance payment for ${serviceBalance[3]} · ${serviceBalance[4]}`
      : serviceVoid
        ? `${serviceVoid[2]} · ${serviceVoid[3]} · Reason: ${serviceVoid[5]}`
        : null;

  return {
    raw,
    text,
    subject: serviceSubject || subject,
    detail: serviceDetail ?? parsedDetail,
    amount,
    status: /fail|error/i.test(action)
      ? "failed"
      : /\b(deleted|voided|cancelled|canceled|removed)\b/i.test(action)
        ? "warning"
        : "",
  };
}

export function matchesActivitySearch(log, search) {
  const term = String(search || "")
    .trim()
    .toLowerCase();
  if (!term) return true;
  const original = activityDisplay(log);
  const display = {
    ...original,
    ...staffActivityCopy(log, original, log.staffContext),
  };
  return `${original.raw} ${original.text} ${display.action} ${log.user || ""} ${log.role || ""} ${log.action || ""} ${display.subject} ${display.detail}`
    .toLowerCase()
    .includes(term);
}

export function summarizeActivity(logs) {
  const actors = new Map();
  const actions = new Map();
  let payments = 0;
  for (const log of logs) {
    const actorId = log.user_id || "system";
    const actor = actors.get(actorId) || {
      label: log.user || "System",
      count: 0,
    };
    actor.count += 1;
    actors.set(actorId, actor);
    const action = log.action || "Other activity";
    actions.set(action, (actions.get(action) || 0) + 1);
    if (PAYMENT_RECORD_ACTIONS.has(action)) payments += 1;
  }
  const mostActive = [...actors.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  )[0];
  const topAction = [...actions].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  return {
    total: logs.length,
    mostActive: mostActive ? `${mostActive.label} (${mostActive.count})` : "—",
    topAction: topAction
      ? `${staffActionLabel(topAction[0])} (${topAction[1]})`
      : "—",
    payments,
  };
}

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="al-clock" role="timer" aria-label="Current date and time">
      <time dateTime={now.toISOString()}>{clockTime.format(now)}</time>
      <span>{clockDate.format(now)}</span>
      <small>Philippine time</small>
    </div>
  );
}

function ActivityRow({ log, onOpen }) {
  const original = activityDisplay(log);
  const detail = activityDetailView(log);
  const display = {
    ...original,
    ...staffActivityCopy(log, original, log.staffContext),
  };
  if (detail.changes.length) {
    display.subject = detail.subtitle.startsWith("Review")
      ? detail.title
      : detail.subtitle;
    display.detail = detail.summary;
  }
  const tone = display.status
    ? "void"
    : /payment|collected/i.test(log.action)
      ? "payment"
      : /rate|settings|rule/i.test(log.action)
        ? "settings"
        : /receipt/i.test(log.action)
          ? "receipt"
          : "";
  return (
    <tr
      className={`al-entry ${display.status ? `al-${display.status}` : ""}`}
      data-id={log.id}
    >
      <td>
        <div className="al-user">
          <i
            className={`al-row-avatar ${String(log.role || "").toLowerCase()}`}
            aria-hidden="true"
          >
            {initials(log.user)}
          </i>
          <div>
            <strong>{log.user}</strong>
            <span>
              {log.role
                ? log.role.charAt(0).toUpperCase() + log.role.slice(1)
                : "Role not recorded"}
            </span>
          </div>
        </div>
      </td>
      <td>
        <span className={`al-badge ${tone}`}>
          {actionIcon(log.action)}
          <span>{display.action}</span>
        </span>
      </td>
      <td>
        <div className="al-summary">
          {display.status && (
            <span
              className="al-exception"
              role="img"
              aria-label={
                display.status === "failed"
                  ? "Failed event"
                  : "Destructive action"
              }
            >
              {display.status === "failed" ? "!" : "⚠"}
            </span>
          )}
          <div className="al-summary-text">
            <strong>{display.subject}</strong>
            {display.detail && <span>{display.detail}</span>}
          </div>
        </div>
      </td>
      <td
        className={`al-amount ${display.amount === null ? "al-no-amount" : tone === "payment" ? "al-received" : ""}`}
      >
        {display.amount !== null ? (
          peso.format(display.amount)
        ) : (
          <span aria-label="Not applicable">—</span>
        )}
      </td>
      <td className="al-time">
        <time
          dateTime={log.created_at}
          title={fullFormat.format(new Date(log.created_at))}
        >
          {timeFormat.format(new Date(log.created_at))}
        </time>
      </td>
      <td className="al-row-action">
        <button
          type="button"
          className="al-expand"
          data-expand-id={log.id}
          aria-haspopup="dialog"
          aria-label={`View ${display.action} details for ${log.user}`}
          onClick={() => onOpen(log.id)}
        >
          View{" "}
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9 5 7 7-7 7" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

const initials = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "S";

const DETAIL_LABELS = {
  property_classification: "Account classification",
  effective_from: "Effective date",
  effective_date: "Effective date",
  annual_rate: "Annual penalty rate",
  late_penalty_rate: "Annual penalty rate",
  price_per_sqm: "Association dues rate per sqm",
  homeowner_name: "Homeowner name",
  homeowner_status: "Residency status",
  contact_phone: "Phone number",
  contact_email: "Email address",
  billing_day: "Billing day",
  due_day: "Payment deadline day",
  grace_period_days: "Grace period days",
  late_penalty_first_after_months: "Months before first annual penalty",
  require_strong_password: "Strong passwords",
  session_timeout: "Session timeout (minutes)",
  hoa_name: "Association name",
  lot_size_sqm: "Lot size (sqm)",
};
const missingDetailValue = (value) =>
  /^(?:\(empty\)|empty|null|undefined|not recorded)?$/i.test(
    String(value ?? "").trim(),
  );
function detailKey(label) {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, "_");
  return (
    {
      account_classification: "property_classification",
      property_type: "property_classification",
      annual_penalty_rate: "annual_rate",
      effective_date: "effective_from",
    }[key] || key
  );
}
function detailValue(key, value) {
  const text = String(value ?? "").trim();
  if (missingDetailValue(text)) return null;
  if (
    ["annual_rate", "late_penalty_rate"].includes(key) &&
    /^-?\d+(?:\.\d+)?$/.test(text)
  ) {
    const rate = Number(text);
    if (Number.isFinite(rate))
      return new Intl.NumberFormat("en-PH", {
        style: "percent",
        maximumFractionDigits: 4,
      }).format(rate);
  }
  if (/date|effective|_on$/.test(key) && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    if (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === text
    )
      return new Intl.DateTimeFormat("en-PH", {
        timeZone: "UTC",
        dateStyle: "long",
      }).format(date);
  }
  if (
    key === "price_per_sqm" &&
    /^\d+(?:\.\d+)?$/.test(text) &&
    Number.isFinite(Number(text))
  )
    return `${peso.format(Number(text))} / sqm`;
  if (["property_classification", "homeowner_status"].includes(key))
    return (
      {
        homeowner: "Homeowner",
        lot_owner: "Lot owner",
        active: "Active",
        moved: "Moved out",
        transferred: "Transferred",
        unclassified: "Unclassified",
      }[text] || text
    );
  if (text === "true") return "Enabled";
  if (text === "false") return "Disabled";
  return text;
}

// Presentation only: no database values or original audit strings are changed.
export function activityDetailView(log) {
  const original = activityDisplay(log);
  const display = {
    ...original,
    ...staffActivityCopy(log, original, log.staffContext),
  };
  const source = original.raw.replace(/â€”/g, " — ").replace(/â†’/g, " → ");
  const changes = [];
  // Field-name/value records emitted by the existing audit triggers. A semicolon
  // inside a free-text value is ambiguous: leave that record in the raw fallback.
  for (const match of source.matchAll(
    /(?:^|;\s*| — )([a-zA-Z][a-zA-Z0-9_ /()-]*):\s*([^;]*?)\s*(?:→|->)\s*([^;]*)(?=;|$)/g,
  )) {
    const key = detailKey(match[1]);
    if (/→|->/.test(match[2]) || /→|->/.test(match[3])) continue;
    changes.push({
      key,
      label:
        DETAIL_LABELS[key] ||
        match[1]
          .trim()
          .replaceAll("_", " ")
          .replace(/\b\w/g, (letter) => letter.toUpperCase()),
      before: detailValue(key, match[2]),
      after: detailValue(key, match[3]),
    });
  }
  const action = display.action || staffActionLabel(log.action);
  const classification = changes.find(
    (change) => change.key === "property_classification",
  );
  const rate = changes.find((change) =>
    ["annual_rate", "late_penalty_rate"].includes(change.key),
  );
  const effective = changes.find((change) =>
    ["effective_from", "effective_date"].includes(change.key),
  );
  const newRule =
    /Penalty Rate Rule Created/i.test(log.action || "") &&
    changes.length > 0 &&
    changes.every((change) => change.before === null);
  let summary =
    display.text || original.text || "No additional description was recorded.";
  if (changes.length)
    summary = changes
      .map(
        (change) =>
          `${change.label}: ${change.before ?? "Not set"} → ${change.after ?? "Not set"}.`,
      )
      .join(" ");
  if (newRule && rate?.after)
    summary = `Scheduled a ${rate.after} annual penalty rate${classification?.after ? ` for ${classification.after.toLowerCase()} accounts` : ""}${effective?.after ? `, effective ${effective.after}` : ""}.`;
  const subject = display.subject || "";
  return {
    ...display,
    title: action,
    changes,
    summary,
    subtitle:
      newRule && classification?.after
        ? `New rule for ${classification.after.toLowerCase()} accounts`
        : subject &&
            subject !== original.raw &&
            subject.length <= 100 &&
            !subject.includes("→")
          ? subject
          : "Review this activity and its recorded details.",
    rawDetails: JSON.stringify(
      {
        id: log.id,
        action: log.action,
        target: log.target,
        description: log.description,
        created_at: log.created_at,
        user_id: log.user_id,
        from_archive: Boolean(log.from_archive),
      },
      null,
      2,
    ),
  };
}

// Browses the same filtered list; preserves keyboard navigation and original data.
function ActivityModal({ logs, id, onChange, onClose }) {
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const index = logs.findIndex((log) => log.id === id);
  const log = logs[index];
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.documentElement.style.overflow;
    const root = document.getElementById("root");
    const wasInert = root?.inert;
    document.documentElement.style.overflow = "hidden";
    if (root) root.inert = true;
    dialogRef.current?.querySelector("button")?.focus({ preventScroll: true });
    return () => {
      document.documentElement.style.overflow = overflow;
      if (root) root.inert = wasInert;
      const trigger =
        document.querySelector(
          `[data-expand-id="${CSS.escape(String(id))}"]`,
        ) || previous;
      trigger?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!log) onClose();
  }, [log, onClose]);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    dialogRef.current?.querySelectorAll("details[open]").forEach((node) => {
      node.open = false;
    });
  }, [id]);
  if (!log) return null;
  const display = activityDetailView(log);
  const time = new Date(log.created_at);
  const validTime = Number.isFinite(time.getTime());
  const go = (direction) => {
    const next = logs[index + direction];
    if (next) onChange(next.id);
  };
  function keys(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (
      ["ArrowLeft", "ArrowRight"].includes(event.key) &&
      !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) &&
      !event.target.isContentEditable &&
      !event.target.closest("pre")
    ) {
      event.preventDefault();
      go(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "Tab") {
      const nodes = [
        ...dialogRef.current.querySelectorAll(
          'button:not(:disabled),summary,a[href],[tabindex="0"]',
        ),
      ].filter(
        (node) =>
          !node.closest("details:not([open])") || node.tagName === "SUMMARY",
      );
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
  return createPortal(
    <div
      className="al-modal-layer al-detail-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`al-modal al-detail-v2 ${display.status || ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="al-modal-title"
        aria-describedby="al-detail-subtitle"
        tabIndex={-1}
        onKeyDown={keys}
      >
        <header className="al-v2-head">
          <div className="al-v2-heading">
            <span className="al-v2-icon" aria-hidden="true">
              {actionIcon(log.action)}
            </span>
            <div>
              <p className="al-v2-eyebrow">
                Activity details{log.from_archive ? " · Archived record" : ""}
              </p>
              <h2 id="al-modal-title">{display.title}</h2>
              <p id="al-detail-subtitle" className="al-v2-subtitle">
                {display.subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="al-v2-close"
            onClick={onClose}
            aria-label="Close details"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="al-v2-body" ref={bodyRef}>
          {display.status && (
            <p className={`al-v2-banner ${display.status}`} role="note">
              {display.status === "failed"
                ? "This event failed. Review the recorded details below."
                : "This activity cancelled or removed a record. Review the recorded details below."}
            </p>
          )}
          <div className="al-v2-meta">
            <div className="al-v2-meta-item">
              <span className="al-v2-avatar" aria-hidden="true">
                {initials(log.user)}
              </span>
              <div>
                <span className="al-v2-label">Recorded by</span>
                <strong>{log.user || "Staff name unavailable"}</strong>
                <small>
                  {log.role
                    ? log.role.charAt(0).toUpperCase() + log.role.slice(1)
                    : "Role not recorded"}
                </small>
              </div>
            </div>
            <div className="al-v2-meta-item">
              <span className="al-v2-meta-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M7 3v4M17 3v4M3 11h18" />
                </svg>
              </span>
              <div>
                <span className="al-v2-label">
                  Recorded on · Philippine time
                </span>
                <strong>
                  {validTime
                    ? `${new Intl.DateTimeFormat("en-PH", { timeZone: ZONE, month: "short", day: "numeric", year: "numeric" }).format(time)} · ${timeFormat.format(time)}`
                    : "Date not recorded"}
                </strong>
              </div>
            </div>
          </div>
          {display.amount !== null && (
            <div className="al-v2-amount">
              <span>Recorded amount</span>
              <strong>{peso.format(display.amount)}</strong>
            </div>
          )}
          <div className="al-v2-summary">
            <span aria-hidden="true">ⓘ</span>
            <p>{display.summary}</p>
          </div>
          {display.changes.length > 0 && (
            <section aria-labelledby="al-change-title">
              <div className="al-v2-section-head">
                <h3 id="al-change-title">What changed</h3>
                <span>
                  {display.changes.length}{" "}
                  {display.changes.length === 1 ? "field" : "fields"}
                </span>
              </div>
              <div className="al-v2-table-wrap">
                <table className="al-v2-table">
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">Before</th>
                      <th scope="col">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {display.changes.map((change, i) => (
                      <tr key={`${change.key}-${i}`}>
                        <th scope="row">{change.label}</th>
                        <td>
                          {change.before === null ? (
                            <span className="al-v2-unset">Not set</span>
                          ) : (
                            change.before
                          )}
                        </td>
                        <td>
                          {change.after === null ? (
                            <span className="al-v2-unset">Not set</span>
                          ) : (
                            change.after
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="al-v2-clarifier">
                “Not set” means the activity record contains no value for that
                field.
              </p>
            </section>
          )}
        </div>
        <footer className="al-v2-foot">
          <button
            type="button"
            className="al-m-nav"
            onClick={() => go(-1)}
            disabled={index === 0}
          >
            ← Newer
          </button>
          <span className="al-v2-position" aria-live="polite">
            {index + 1} of {logs.length}
            <small>← → Browse · Esc Close</small>
          </span>
          <button
            type="button"
            className="al-m-nav"
            onClick={() => go(1)}
            disabled={index === logs.length - 1}
          >
            Older →
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// Kept in this file so replacing the page does not require another component.
function ActivityCalendar({
  today,
  range,
  start,
  end,
  archiveMonth,
  activityDates = [],
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(
    (range === "all" ? archiveMonth : start || today).slice(0, 7),
  );
  const [rangeMode, setRangeMode] = useState(false);
  const [from, setFrom] = useState(start);
  const [through, setThrough] = useState(end);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [position, setPosition] = useState({});
  const trigger = useRef(null);
  const popup = useRef(null);
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    function place() {
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(500, window.innerWidth - 24);
      const below = window.innerHeight - box.bottom - 12;
      const above = box.top - 12;
      const height = popup.current?.offsetHeight || 390;
      const flip = below < Math.min(height, 300) && above > below;
      setPosition({
        width,
        left: Math.max(
          12,
          Math.min(box.right - width, window.innerWidth - width - 12),
        ),
        top: flip
          ? Math.max(12, box.top - Math.min(height, above) - 8)
          : box.bottom + 8,
        maxHeight: Math.max(100, (flip ? above : below) - 8),
      });
    }
    function outside(event) {
      if (
        !popup.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    }
    function keys(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", keys);
    };
  }, [open, month, rangeMode, message, close]);
  useEffect(() => {
    if (open)
      popup.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [open]);
  function select(value, a = from, b = through, selectedMonth = month) {
    onSelect(value, a, b, selectedMonth);
    close();
  }
  function apply() {
    if (!from || !through || from > through || through > today) {
      setMessage("Choose dates in order, through today.");
      return;
    }
    if (through.slice(0, 7) >= shiftMonth(from.slice(0, 7), 12)) {
      setMessage("Choose up to 12 calendar months at a time.");
      return;
    }
    select("custom");
  }
  const first = `${month}-01`;
  const gridStart = addDays(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
  const single =
    range === "today"
      ? today
      : range === "custom" && start === end
        ? start
        : null;
  const label =
    range === "today"
      ? `Today · ${today.slice(5, 7)}/${today.slice(8)}/${today.slice(0, 4)}`
      : range === "custom"
        ? start === end
          ? groupFormat.format(new Date(`${start}T00:00:00Z`))
          : `${start} – ${end}`
        : range === "all"
          ? new Intl.DateTimeFormat("en", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(`${archiveMonth}-01T00:00:00Z`))
          : RANGE_LABELS[range];
  return (
    <div className="al-date-switch">
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => {
          const day = addDays(single || start || today, -1);
          onSelect("custom", day, day, day.slice(0, 7));
        }}
      >
        ‹
      </button>
      <button
        type="button"
        ref={trigger}
        className="al-date-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "al-calendar-popup" : undefined}
        onClick={() => {
          if (open) close();
          else {
            setFrom(start);
            setThrough(end);
            setMonth(
              (range === "all" ? archiveMonth : start || today).slice(0, 7),
            );
            setMessage("");
            setPending(false);
            setOpen(true);
          }
        }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 3v4M17 3v4M3 11h18" />
        </svg>
        {label}
      </button>
      <button
        type="button"
        aria-label="Next day"
        disabled={!single || single >= today}
        onClick={() => {
          const day = addDays(single, 1);
          onSelect(
            day === today ? "today" : "custom",
            day,
            day,
            day.slice(0, 7),
          );
        }}
      >
        ›
      </button>
      {range !== "today" && (
        <button
          type="button"
          onClick={() => onSelect("today", today, today, today.slice(0, 7))}
        >
          Today
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={popup}
            id="al-calendar-popup"
            className="al-calendar-popup"
            role="dialog"
            aria-label="Choose activity dates"
            style={position}
          >
            <aside className="al-calendar-presets">
              <h3>Quick select</h3>
              {[
                ["today", "Today"],
                ["yesterday", "Yesterday"],
                ["week", "Last 7 days"],
                ["month", "Last 30 days"],
                ["all", "Selected month"],
              ].map(([key, text]) => (
                <button
                  type="button"
                  key={key}
                  className={range === key ? "is-active" : ""}
                  onClick={() =>
                    key === "yesterday"
                      ? select("custom", addDays(today, -1), addDays(today, -1))
                      : select(key)
                  }
                >
                  {text}
                </button>
              ))}
              <div className="al-choose-month">
                <label>
                  Activity month
                  <input
                    type="month"
                    value={month}
                    max={today.slice(0, 7)}
                    onChange={(event) => {
                      if (
                        event.target.value &&
                        event.target.value <= today.slice(0, 7)
                      )
                        setMonth(event.target.value);
                    }}
                  />
                </label>
                <button type="button" onClick={() => select("all")}>
                  View month
                </button>
              </div>
            </aside>
            <div className="al-calendar-main">
              <nav aria-label="Calendar month">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setMonth(shiftMonth(month, -1))}
                >
                  ‹
                </button>
                <strong>
                  {new Intl.DateTimeFormat("en", {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(new Date(`${first}T00:00:00Z`))}
                </strong>
                <button
                  type="button"
                  aria-label="Next month"
                  disabled={month >= today.slice(0, 7)}
                  onClick={() => setMonth(shiftMonth(month, 1))}
                >
                  ›
                </button>
              </nav>
              <div className="al-calendar-weekdays" aria-hidden="true">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="al-calendar-grid">
                {Array.from({ length: 42 }, (_, i) => {
                  const day = addDays(gridStart, i);
                  return (
                    <button
                      type="button"
                      key={day}
                      disabled={day > today}
                      aria-label={groupFormat.format(
                        new Date(`${day}T00:00:00Z`),
                      )}
                      aria-pressed={
                        rangeMode
                          ? day >= from && day <= through
                          : day === single
                      }
                      className={`${day.slice(0, 7) !== month ? "is-outside" : ""} ${day === today ? "is-today" : ""} ${activityDates.includes(day) ? "has-activity" : ""}`}
                      onClick={() => {
                        if (!rangeMode)
                          select(day === today ? "today" : "custom", day, day);
                        else if (!pending) {
                          setFrom(day);
                          setThrough(day);
                          setPending(true);
                        } else {
                          setFrom(day < from ? day : from);
                          setThrough(day < from ? from : day);
                          setPending(false);
                        }
                      }}
                    >
                      {Number(day.slice(-2))}
                    </button>
                  );
                })}
              </div>
              <div className="al-calendar-legend">
                <span>
                  <i aria-hidden="true" />
                  Loaded activity
                </span>{" "}
                <label className="al-range-checkbox">
                  <input
                    type="checkbox"
                    checked={rangeMode}
                    onChange={(event) => {
                      setRangeMode(event.target.checked);
                      setPending(false);
                    }}
                  />
                  Custom range
                </label>
              </div>
              {rangeMode && (
                <div className="al-calendar-range">
                  <label>
                    From
                    <input
                      type="date"
                      value={from}
                      max={today}
                      onChange={(event) => setFrom(event.target.value)}
                    />
                  </label>
                  <label>
                    Through
                    <input
                      type="date"
                      value={through}
                      min={from}
                      max={today}
                      onChange={(event) => setThrough(event.target.value)}
                    />
                  </label>
                </div>
              )}

              {message && (
                <p role="alert" className="al-calendar-error">
                  {message}
                </p>
              )}
            </div>
            <footer>
              <span>
                {rangeMode
                  ? pending
                    ? "Pick an end date."
                    : "Choose the first and last day, then apply."
                  : "Click a day to view its activity."}
              </span>
              <button type="button" onClick={close}>
                Close
              </button>
              {rangeMode && (
                <button
                  type="button"
                  className="is-active"
                  disabled={pending}
                  onClick={apply}
                >
                  Apply range
                </button>
              )}
            </footer>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function ActivityLogPage() {
  const [today, setToday] = useState(dateKey());
  const [archiveMonth, setArchiveMonth] = useState(today.slice(0, 7));
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [user, setUser] = useState("");
  const [role, setRole] = useState("");
  const [action, setAction] = useState("");
  const [logs, setLogs] = useState([]);
  const [loadedScope, setLoadedScope] = useState(null);
  const [error, setError] = useState("");
  const [profileWarning, setProfileWarning] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [revision, setRevision] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const panelRef = useRef(null);
  const filterButton = useRef(null);
  const toolbarRef = useRef(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const first =
    range === "all"
      ? `${archiveMonth || today.slice(0, 7)}-01`
      : range === "custom"
        ? start
        : addDays(today, range === "week" ? -6 : range === "month" ? -29 : 0);
  const last =
    range === "all"
      ? addDays(`${shiftMonth(archiveMonth || today.slice(0, 7), 1)}-01`, -1)
      : range === "custom"
        ? end
        : today;
  // Read each requested month from the live table and verified private archives.
  // Each requested month is read separately; filters and 25-row disclosure are local.
  const firstMonth = first?.slice(0, 7);
  const lastMonth = last?.slice(0, 7);
  let dateError = "";
  if (range === "custom") {
    if (!start || !end || start > end || end > today) {
      dateError = "Choose a start and end date in order, through today.";
    } else if (lastMonth >= shiftMonth(firstMonth, 12)) {
      dateError = "Choose up to 12 calendar months at a time.";
    }
  }
  const requestScope = dateError
    ? null
    : `${firstMonth}:${lastMonth}:${revision}`;
  const loading = requestScope !== null && loadedScope !== requestScope;
  const summariesAvailable = !loading && !error && !dateError;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const updateDay = () => setToday(dateKey());
    const timer = window.setInterval(updateDay, 60000);
    window.addEventListener("focus", updateDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateDay);
    };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      setToolbarHeight(toolbarRef.current?.getBoundingClientRect().height || 0),
    );
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!panelOpen) return undefined;
    panelRef.current?.querySelector(".sel-trigger, input")?.focus();
    function close(event) {
      if (event.key === "Escape") {
        setPanelOpen(false);
        filterButton.current?.focus();
      }
    }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [panelOpen]);

  useEffect(() => {
    let cancelled = false;
    async function loadActivityLogs() {
      if (requestScope === null) {
        setLogs([]);
        setLoadedScope(null);
        setError("");
        setProfileWarning(false);
        return;
      }
      setError("");
      setProfileWarning(false);
      try {
        const activityData = [];
        for (
          let visibleMonth = firstMonth;
          visibleMonth <= lastMonth;
          visibleMonth = shiftMonth(visibleMonth, 1)
        ) {
          const { data: fetchedLogs, error: activityError } =
            await loadActivityMonth(supabase, visibleMonth);
          if (cancelled) return;
          if (activityError) throw activityError;
          activityData.push(...(fetchedLogs || []));
        }
        const userIds = [
          ...new Set(
            activityData
              .filter(
                (log) =>
                  !log.archived_actor?.name || log.archived_actor?.role == null,
              )
              .map((log) => log.user_id)
              .filter(Boolean),
          ),
        ];
        const profileMap = new Map();
        for (let offset = 0; offset < userIds.length; offset += 100) {
          try {
            const { data: profiles, error: profileError } = await supabase
              .from("profiles")
              .select("id, full_name, email, role")
              .in("id", userIds.slice(offset, offset + 100));
            if (!profileError) {
              for (const profile of profiles || [])
                profileMap.set(profile.id, profile);
            }
          } catch {
            // Keep audit entries even when their staff profiles cannot be read.
          }
          if (cancelled) return;
        }
        const staffContext = await loadStaffActivityContext(
          supabase,
          activityData,
        );
        if (cancelled) return;
        const prepared = activityData.map((log) => {
          const profile = profileMap.get(log.user_id);
          return {
            ...log,
            dateKey: dateKey(new Date(log.created_at)),
            staffContext,
            user:
              log.archived_actor?.name ||
              profile?.full_name ||
              profile?.email ||
              (log.user_id ? "Staff name unavailable" : "System"),
            role: log.archived_actor?.role ?? profile?.role ?? "",
            description: log.target || log.description || "",
          };
        });
        prepared.sort(compareActivityNewest);
        setProfileWarning(userIds.some((id) => !profileMap.has(id)));
        setLogs(prepared);
      } catch (failure) {
        if (!cancelled) {
          setLogs([]);
          setError(
            `Activity logs could not be loaded: ${failure.message || "Please try again."}`,
          );
        }
      } finally {
        if (!cancelled) setLoadedScope(requestScope);
      }
    }
    loadActivityLogs();
    return () => {
      cancelled = true;
    };
  }, [firstMonth, lastMonth, requestScope]);

  const dateRows = useMemo(
    () =>
      summariesAvailable
        ? logs.filter((log) => log.dateKey >= first && log.dateKey <= last)
        : [],
    [logs, first, last, summariesAvailable],
  );
  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return dateRows.filter(
      (log) =>
        (!user || String(log.user_id || "system") === user) &&
        (!role || log.role.toLowerCase() === role) &&
        (!action || log.action === action) &&
        matchesActivitySearch(log, term),
    );
  }, [dateRows, user, role, action, debouncedSearch]);
  const activityStats = useMemo(() => summarizeActivity(filtered), [filtered]);
  useEffect(() => {
    setPage(1);
  }, [first, last, user, role, action, debouncedSearch, revision]);
  const users = [
    ...new Map(
      dateRows.map((log) => [String(log.user_id || "system"), log.user]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const actions = [
    ...new Set(dateRows.map((log) => log.action).filter(Boolean)),
  ].sort();
  if (user && !users.some(([id]) => id === user))
    users.unshift([user, "Selected user · no events in range"]);
  if (action && !actions.includes(action)) actions.unshift(action);
  const chips = [
    search && {
      key: "search",
      label: `Search: ${search}`,
      clear: () => {
        setSearch("");
        setDebouncedSearch("");
      },
    },
    user && {
      key: "user",
      label: `User: ${users.find(([id]) => id === user)?.[1] || "Unknown user"}`,
      clear: () => setUser(""),
    },
    role && { key: "role", label: `Role: ${role}`, clear: () => setRole("") },
    action && {
      key: "action",
      label: staffActionLabel(action),
      clear: () => setAction(""),
    },
    range !== DEFAULT_RANGE && {
      key: "date",
      label:
        range === "custom"
          ? `${start || "Start"} – ${end || "End"}`
          : RANGE_LABELS[range],
      clear: () => setRange(DEFAULT_RANGE),
    },
    range === "all" &&
      archiveMonth !== today.slice(0, 7) && {
        key: "archive",
        label: archiveMonth,
        clear: () => setArchiveMonth(today.slice(0, 7)),
      },
  ].filter(Boolean);
  const closeModal = useCallback(() => setOpenId(null), []);
  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setUser("");
    setRole("");
    setAction("");
    setRange(DEFAULT_RANGE);
    setArchiveMonth(today.slice(0, 7));
    setStart(today);
    setEnd(today);
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageNumbers = [
    ...new Set([
      1,
      pageCount,
      ...Array.from({ length: 5 }, (_, index) => currentPage + index - 2),
    ]),
  ]
    .filter((number) => number >= 1 && number <= pageCount)
    .sort((a, b) => a - b);
  const groups = new Map();
  filtered.slice(pageStart, pageStart + pageSize).forEach((log) => {
    if (!groups.has(log.dateKey)) groups.set(log.dateKey, []);
    groups.get(log.dateKey).push(log);
  });
  const dateLabel = (key) =>
    key === today
      ? "Today"
      : key === addDays(today, -1)
        ? "Yesterday"
        : groupFormat.format(new Date(`${key}T00:00:00Z`));
  const select = (label, value, onChange, options) => (
    <label key={label}>
      <span>{label}</span>
      <Select
        ariaLabel={label}
        value={value}
        onChange={onChange}
        options={options.map(([key, name]) => ({ value: key, label: name }))}
      />
    </label>
  );

  return (
    <div
      className="activity-log-page"
      style={{ "--al-toolbar-height": `${toolbarHeight}px` }}
    >
      <header className="al-header">
        <div className="al-header-heading">
          <span className="al-header-icon" aria-hidden="true">
            <Activity size={28} />
          </span>
          <div className="al-header-copy">
            <p className="al-header-eyebrow">System workspace</p>
            <h1>Activity Log</h1>
            <p>Review changes, receipts, and staff activity.</p>
          </div>
        </div>
        <HeaderClock />
      </header>
      <details className="al-archive-panel">
        <summary>
          Activity history preservation<span>Archive settings</span>
        </summary>
        <ActivityArchiveStatus
          onChanged={() => setRevision((value) => value + 1)}
        />
      </details>
      <section
        className="al-stats-grid"
        aria-label="Activity summaries"
        aria-busy={loading}
      >
        <article className="al-stat-card">
          <div className="al-stat-top">
            <span>Total Events</span>
            <span className="al-stat-icon al-stat-icon-blue">
              <Activity size={18} />
            </span>
          </div>
          <strong>
            {summariesAvailable
              ? activityStats.total.toLocaleString("en-PH")
              : "—"}
          </strong>
          <small>Matching the current filters</small>
          <div className="al-stat-footer">
            <span aria-hidden="true" />
            Events matching current filters
          </div>
        </article>
        <article className="al-stat-card">
          <div className="al-stat-top">
            <span>Most Active User</span>
            <span className="al-stat-icon al-stat-icon-green">
              <Users size={18} />
            </span>
          </div>
          <strong className="al-stat-value-text">
            {summariesAvailable ? activityStats.mostActive : "—"}
          </strong>
          <small>Events in the selected range</small>
          <div className="al-stat-footer">
            <span aria-hidden="true" />
            User with the most matching events
          </div>
        </article>
        <article className="al-stat-card">
          <div className="al-stat-top">
            <span>Top Action</span>
            <span className="al-stat-icon al-stat-icon-blue">
              <Zap size={18} />
            </span>
          </div>
          <strong className="al-stat-value-text">
            {summariesAvailable ? activityStats.topAction : "—"}
          </strong>
          <small>Most common recorded action</small>
          <div className="al-stat-footer">
            <span aria-hidden="true" />
            Most frequent matching action
          </div>
        </article>
        <article className="al-stat-card">
          <div className="al-stat-top">
            <span>Payments Recorded</span>
            <span className="al-stat-icon al-stat-icon-green">
              <CreditCard size={18} />
            </span>
          </div>
          <strong>
            {summariesAvailable
              ? activityStats.payments.toLocaleString("en-PH")
              : "—"}
          </strong>
          <small>Regular and service payments recorded</small>
          <div className="al-stat-footer">
            <span aria-hidden="true" />
            Recorded payment activity
          </div>
        </article>
      </section>
      <div className="al-history-panel">
        <div className="al-history-heading">
          <div>
            <h2>Activity history</h2>
            <p>
              Latest system changes and staff activity. Open a record to see its
              complete details.
            </p>
          </div>
          <span>Live + archived activity</span>
        </div>
        <section
          className="al-toolbar"
          ref={toolbarRef}
          aria-label="Activity controls"
        >
          <div className="al-toolbar-main">
            <div className="al-search-row">
              <label className="al-search">
                <span className="al-sr-only">Search activity</span>
                <svg
                  className="al-search-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m16 16 4 4" />
                </svg>
                <input
                  type="search"
                  aria-label="Search activity"
                  placeholder="Search staff, receipt number, action, or activity details"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <ActivityCalendar
                today={today}
                range={range}
                start={range === "today" ? today : first}
                end={last > today ? today : last}
                archiveMonth={archiveMonth}
                activityDates={logs.map((log) => log.dateKey)}
                onSelect={(value, a, b, month) => {
                  setStart(a);
                  setEnd(b);
                  setArchiveMonth(month);
                  setRange(value);
                }}
              />
              <button
                type="button"
                className="al-filter-toggle"
                ref={filterButton}
                aria-expanded={panelOpen}
                aria-controls="activity-filters"
                onClick={() => setPanelOpen(!panelOpen)}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M4 7h16M7 12h10M10 17h4" />
                </svg>
                Filters{chips.length ? ` (${chips.length})` : ""}
              </button>
              <span className="al-record-count" role="status">
                {loading
                  ? "Loading…"
                  : error || dateError
                    ? "Unavailable"
                    : `${filtered.length.toLocaleString("en-PH")} records`}
              </span>
            </div>
            <div
              id="activity-filters"
              ref={panelRef}
              className={`al-filters ${panelOpen ? "al-open" : ""}`}
            >
              {select("User", user, setUser, [["", "All users"], ...users])}
              {select("Role", role, setRole, [
                ["", "All roles"],
                ["admin", "Admin"],
                ["secretary", "Secretary"],
                ["treasurer", "Treasurer"],
              ])}
              {select("Action type", action, setAction, [
                ["", "All actions"],
                ...actions.map((value) => [value, staffActionLabel(value)]),
              ])}
              <button
                type="button"
                className="al-refresh"
                onClick={() => setRevision((value) => value + 1)}
                disabled={loading}
                aria-label="Refresh activity"
                title="Refresh"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 11a8.1 8.1 0 0 0-14.9-4.3L3 9" />
                  <path d="M3 4v5h5" />
                  <path d="M4 13a8.1 8.1 0 0 0 14.9 4.3L21 15" />
                  <path d="M21 20v-5h-5" />
                </svg>
                <span>Refresh</span>
              </button>{" "}
              <button
                type="button"
                className="al-filter-clear"
                onClick={clearFilters}
              >
                Clear filters
              </button>
              <button
                type="button"
                className="al-filter-done"
                onClick={() => {
                  setPanelOpen(false);
                  filterButton.current?.focus();
                }}
              >
                Done
              </button>
            </div>
          </div>
          {chips.length > 0 && (
            <div className="al-chips" aria-label="Active filters">
              {chips.map((chip) => (
                <button
                  type="button"
                  key={chip.key}
                  onClick={chip.clear}
                  aria-label={`Remove ${chip.label} filter`}
                >
                  {chip.label}
                  <span aria-hidden="true"> ×</span>
                </button>
              ))}
              <button type="button" className="al-clear" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}
          {dateError && <p role="alert">{dateError}</p>}
        </section>
        <section
          className="al-list"
          aria-label="Activity entries"
          aria-busy={loading}
        >
          {profileWarning && summariesAvailable && (
            <p className="al-notice" role="status">
              Some staff details could not be found. Their activity is still
              shown; unavailable names and roles are labelled clearly.
            </p>
          )}
          <div className="al-table-wrap">
            <table className="al-history-table">
              <caption className="al-sr-only">
                Recorded staff activity, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Staff member</th>
                  <th scope="col">Activity</th>
                  <th scope="col">Record &amp; change</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Time</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              {loading ? (
                <tbody aria-label="Loading activity">
                  {Array.from({ length: 6 }, (_, index) => (
                    <tr key={index}>
                      <td colSpan={6}>
                        <div className="al-skeleton" aria-hidden="true">
                          {Array.from({ length: 6 }, (_, cell) => (
                            <Skeleton
                              key={cell}
                              variant="rect"
                              width="100%"
                              height="1em"
                            />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ) : dateError ? (
                <tbody>
                  <tr>
                    <td colSpan={6}>
                      <div className="al-state">
                        Choose a valid date range to see activity.
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : error ? (
                <tbody>
                  <tr>
                    <td colSpan={6}>
                      <div className="al-state" role="alert">
                        <h2>Unable to load activity</h2>
                        <p>{error}</p>
                        <button
                          type="button"
                          onClick={() => setRevision((value) => value + 1)}
                        >
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : filtered.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={6}>
                      <div className="al-state">
                        <h2>
                          {chips.length
                            ? "No matching activity"
                            : range === DEFAULT_RANGE
                              ? "No activity today"
                              : "No activity yet"}
                        </h2>
                        <p>
                          {chips.length
                            ? "Try another search or date range."
                            : "Recorded activity will appear here for the selected date range."}
                        </p>
                        {chips.length > 0 && (
                          <button type="button" onClick={clearFilters}>
                            Clear filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : (
                [...groups.entries()].map(([key, entries]) => (
                  <tbody key={key}>
                    <tr className="al-day-row">
                      <th colSpan={6} scope="rowgroup">
                        <div>
                          <span>
                            {dateLabel(key)}
                            {entries.some((log) => log.from_archive)
                              ? " · Includes archived records"
                              : ""}
                          </span>
                          <small>
                            {
                              filtered.filter((log) => log.dateKey === key)
                                .length
                            }{" "}
                            events · Philippine time
                          </small>
                        </div>
                      </th>
                    </tr>
                    {entries.map((log) => (
                      <ActivityRow key={log.id} log={log} onOpen={setOpenId} />
                    ))}
                  </tbody>
                ))
              )}
            </table>
          </div>
          {openId !== null && (
            <ActivityModal
              logs={filtered}
              id={openId}
              onChange={setOpenId}
              onClose={closeModal}
            />
          )}
          {summariesAvailable && (
            <footer className="al-footer">
              <span role="status" aria-live="polite">
                Showing {filtered.length ? pageStart + 1 : 0}–
                {Math.min(pageStart + pageSize, filtered.length)} of{" "}
                {filtered.length.toLocaleString("en-PH")} records
              </span>
              <nav className="al-pagination" aria-label="Activity pages">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  ← Previous
                </button>
                {pageNumbers.map((number, index) => (
                  <React.Fragment key={number}>
                    {index > 0 && number - pageNumbers[index - 1] > 1 && (
                      <span className="al-page-gap" aria-hidden="true">
                        …
                      </span>
                    )}
                    <button
                      type="button"
                      className="al-page-number"
                      aria-label={`Page ${number}`}
                      aria-current={number === currentPage ? "page" : undefined}
                      onClick={() => setPage(number)}
                    >
                      {number}
                    </button>
                  </React.Fragment>
                ))}
                <button
                  type="button"
                  disabled={currentPage === pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next →
                </button>
              </nav>
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}
