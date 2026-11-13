import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  FileText,
  Info,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { fetchAll } from "../lib/fetchAll";
import {
  groupMonthlyBillingAudit,
  summarizeMonthlyBillingAudit,
} from "../lib/monthlyBillingAudit";
import "./MonthlyBillingAuditPage.css";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});
const count = (value) => Number(value).toLocaleString("en-PH");
const monthNow = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .replace(/^(\d{4})-(\d{2}).*/, "$1-$2");
const validMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || "");
const monthLabel = (value) =>
  new Intl.DateTimeFormat("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T00:00:00Z`));
const PER_PAGE = 10;
const FILTERS = [
  ["all", "All accounts"],
  ["credit", "Credit used"],
  ["unpaid", "New unpaid"],
  ["covered", "Fully covered"],
  ["unknown", "No linked detail"],
];
const statusFor = (row) =>
  row.voided_at
    ? ["Voided", "voided"]
    : !row.hasEvidence
      ? ["No linked detail", "unknown"]
      : row.fullyCovered
        ? ["Covered by credit", "covered"]
        : row.unpaidAdded > 0
          ? ["Unpaid portion added", "unpaid"]
          : ["Recorded", "recorded"];
const nameFor = (row) =>
  row.properties?.homeowner_name || `Property ${row.property_id}`;
const classFor = (row) =>
  String(row.properties?.property_classification || "Unclassified").replaceAll(
    "_",
    " ",
  );
const matchesFilter = (row, filter) =>
  filter === "all" ||
  (filter === "credit" && row.creditUsed > 0) ||
  (filter === "unpaid" && row.unpaidAdded > 0) ||
  (filter === "covered" && row.fullyCovered) ||
  (filter === "unknown" && !row.hasEvidence);
const csvCell = (value) => {
  const text = String(value ?? "");
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
};

function Status({ row }) {
  const [label, tone] = statusFor(row);
  return <span className={`ba-status ba-status-${tone}`}>{label}</span>;
}
function Amount({ value, tone = "" }) {
  return value == null ? (
    <span
      className="ba-missing"
      title="No matching saved activity; this does not mean zero"
    >
      Not recorded
    </span>
  ) : (
    <span className={tone}>{peso.format(value)}</span>
  );
}

function Overlay({ title, drawer = false, onClose, children, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const root = document.getElementById("root");
    const oldInert = root?.inert;
    if (root) root.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector("button")?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = [
        ...ref.current.querySelectorAll(
          'a[href],button:not(:disabled),select,input,textarea,[tabindex="0"]',
        ),
      ].filter((node) => !node.hidden);
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      if (root) root.inert = oldInert;
      previous?.isConnected && previous.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div
      className={`ba-overlay ${drawer ? "ba-overlay-drawer" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className={drawer ? "ba-drawer" : "ba-guide-modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ba-dialog-title"
      >
        <header className="ba-dialog-head">
          <div>
            <h2 id="ba-dialog-title">{title}</h2>
          </div>
          <button
            type="button"
            className="ba-icon-button"
            aria-label="Close details"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="ba-dialog-body">{children}</div>
        {footer && <footer className="ba-dialog-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

export default function MonthlyBillingAuditPage() {
  const [params, setParams] = useSearchParams();
  const month = validMonth(params.get("month"))
    ? params.get("month")
    : monthNow();
  const view = params.get("view") === "year" ? "year" : "month";
  const year = month.slice(0, 4);
  const scope = view === "year" ? `year:${year}` : month;
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "", direction: 1 });
  const [compact, setCompact] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [guide, setGuide] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({
    scope: "",
    loading: true,
    error: "",
    rows: [],
    report: null,
  });
  const recordsRef = useRef(null);
  const searchRef = useRef(null);
  const closeDrawer = React.useCallback(() => setSelectedId(null), []);
  const closeGuide = React.useCallback(() => setGuide(false), []);

  function changePeriod(nextMonth, nextView = view) {
    const next = new URLSearchParams(params);
    next.set("month", nextMonth);
    if (nextView === "year") next.set("view", "year");
    else next.delete("view");
    setParams(next);
    setSelectedId(null);
  }
  function stepPeriod(delta) {
    const date = new Date(`${month}-01T00:00:00Z`);
    if (view === "year") date.setUTCFullYear(date.getUTCFullYear() + delta);
    else date.setUTCMonth(date.getUTCMonth() + delta);
    const next = date.toISOString().slice(0, 7);
    if (validMonth(next)) changePeriod(next);
  }
  useEffect(() => {
    let cancelled = false;
    setData({ scope, loading: true, error: "", rows: [], report: null });
    async function load() {
      const start = `${year}-01-01`,
        end = `${Number(year) + 1}-01-01`;
      const charges = await fetchAll(() => {
        let query = supabase
          .from("property_charges")
          .select(
            "id,property_id,billing_month,amount,description,created_at,created_by_name,voided_at,properties!inner(homeowner_name,block,lot_number,property_classification)",
          )
          .eq("charge_type", "Association Dues");
        query =
          view === "year"
            ? query.gte("billing_month", start).lt("billing_month", end)
            : query.eq("billing_month", `${month}-01`);
        return query.order("property_id").order("id");
      });
      if (charges.error) throw charges.error;
      const activity = await fetchAll(() => {
        let query = supabase
          .from("account_activity")
          .select("kind,payload")
          .in("kind", ["credit_applied", "monthly_balance_added"]);
        return view === "year"
          ? query
              .gte("payload->>billing_month", start)
              .lt("payload->>billing_month", end)
          : query.eq("payload->>billing_month", `${month}-01`);
      });
      if (activity.error) throw activity.error;
      let report = null;
      if (view === "month") {
        const latest = await supabase
          .from("notifications")
          .select("kind,title,body,payload,created_at")
          .eq("kind", "collection_run")
          .order("created_at", { ascending: false })
          .limit(24);
        if (latest.error) throw latest.error;
        report =
          (latest.data || []).find(
            (item) =>
              String(item.payload?.collection_date || "").slice(0, 7) === month,
          ) || null;
      }
      if (!cancelled)
        setData({
          scope,
          loading: false,
          error: "",
          rows: groupMonthlyBillingAudit(
            charges.data || [],
            activity.data || [],
          ),
          report,
        });
    }
    void load().catch((error) => {
      if (!cancelled)
        setData({
          scope,
          loading: false,
          error: error?.message || "Billing audit unavailable.",
          rows: [],
          report: null,
        });
    });
    return () => {
      cancelled = true;
    };
  }, [scope, month, year, view, revision]);
  useEffect(() => {
    setPage(1);
    setSelectedId(null);
  }, [scope, search, filter, sort]);
  useEffect(() => {
    const handler = (event) => {
      if (
        event.key === "/" &&
        !guide &&
        selectedId == null &&
        !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) &&
        !event.target.isContentEditable &&
        view === "month"
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [guide, selectedId, view]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const ready = data.scope === scope && !data.loading && !data.error;
  const totals = useMemo(
    () => summarizeMonthlyBillingAudit(ready ? data.rows : []),
    [ready, data.rows],
  );
  const searched = useMemo(
    () =>
      (ready ? data.rows : []).filter((row) => {
        const p = row.properties || {};
        return `${nameFor(row)} block ${p.block ?? ""} lot ${p.lot_number ?? ""} ${row.property_id} ${row.id}`
          .toLowerCase()
          .includes(search.trim().toLowerCase());
      }),
    [ready, data.rows, search],
  );
  const rows = useMemo(() => {
    const result = searched.filter((row) => matchesFilter(row, filter));
    if (!sort.key) return result;
    const value = (row) =>
      ({
        name: nameFor(row),
        due: Number(row.amount),
        credit: row.creditUsed ?? -Infinity,
        unpaid: row.unpaidAdded ?? -Infinity,
        status: statusFor(row)[0],
      })[sort.key];
    return [...result].sort((a, b) => {
      const av = value(a),
        bv = value(b);
      return (
        (typeof av === "string"
          ? av.localeCompare(bv, "en", { numeric: true })
          : av === bv
            ? 0
            : av < bv
              ? -1
              : 1) * sort.direction
      );
    });
  }, [searched, filter, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const currentPage = Math.min(page, pages);
  const visible = rows.slice(
    (currentPage - 1) * PER_PAGE,
    currentPage * PER_PAGE,
  );
  const selectedIndex = rows.findIndex((row) => row.id === selectedId);
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null;
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const key = `${year}-${String(i + 1).padStart(2, "0")}`;
        const matching = ready
          ? data.rows.filter(
              (row) => String(row.billing_month).slice(0, 7) === key,
            )
          : [];
        return {
          key,
          hasCharges: matching.length > 0,
          ...summarizeMonthlyBillingAudit(matching),
        };
      }),
    [ready, data.rows, year],
  );
  const billedMonths = months.filter((item) => item.billed > 0).length;
  const maxChart = Math.max(
    1,
    ...months.map((item) => Math.max(item.assessed, item.verifiedUnpaid)),
  );
  const evidenceCount = Math.max(0, totals.billed - totals.unknown);
  const kpis = [
    [
      "Total billed",
      peso.format(totals.assessed),
      "Assessed, not collected",
      BookOpen,
      "hero",
    ],
    [
      view === "year" ? "Months billed" : "Charges",
      view === "year" ? `${billedMonths} of 12` : count(totals.billed),
      view === "year" ? "Months with active charges" : "Non-voided dues",
      view === "year" ? CalendarDays : FileText,
      "hero",
    ],
    [
      "Credit used",
      peso.format(totals.verifiedCredit),
      "Verified advance balance applied",
      ArrowDownLeft,
      "",
    ],
    [
      "Unpaid portion",
      peso.format(totals.verifiedUnpaid),
      "Verified amount added at billing",
      Clock3,
      "",
    ],
    [
      "No linked detail",
      count(totals.unknown),
      `${count(evidenceCount)} of ${count(totals.billed)} have detail`,
      AlertTriangle,
      "flag",
    ],
  ];
  function sortColumn(key) {
    setSort((current) =>
      current.key !== key
        ? { key, direction: 1 }
        : current.direction === 1
          ? { key, direction: -1 }
          : { key: "", direction: 1 },
    );
  }
  function sortHead(key, title, numeric = false) {
    return (
      <th
        scope="col"
        className={numeric ? "ba-number" : ""}
        aria-sort={
          sort.key === key
            ? sort.direction === 1
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        <button type="button" onClick={() => sortColumn(key)}>
          {title}
          <span aria-hidden="true">
            {sort.key === key ? (sort.direction === 1 ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  }
  function goPage(next) {
    setPage(next);
    recordsRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  }
  function exportCsv() {
    const values = [
      [
        "Account",
        "Block",
        "Lot",
        "Class",
        "Charge ID",
        "Billing month",
        "Dues assessed",
        "Credit used",
        "New unpaid",
        "Status",
      ],
      ...rows.map((row) => [
        nameFor(row),
        row.properties?.block,
        row.properties?.lot_number,
        classFor(row),
        row.id,
        row.billing_month,
        row.amount,
        row.creditUsed,
        row.unpaidAdded,
        statusFor(row)[0],
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        [
          "\uFEFF" +
            values.map((row) => row.map(csvCell).join(",")).join("\r\n"),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `billing-audit-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${count(rows.length)} matching charges.`);
  }
  async function copyId() {
    try {
      await navigator.clipboard.writeText(String(selected.id));
      setNotice("Charge ID copied.");
    } catch {
      setNotice("Could not copy. Select the charge ID to copy it manually.");
    }
  }

  return (
    <main className={`billing-audit-page ${compact ? "ba-compact" : ""}`}>
      <header className="ba-card ba-header">
        <div className="ba-header-heading">
          <span className="ba-header-icon" aria-hidden="true">
            <ClipboardCheck size={28} strokeWidth={1.8} />
          </span>
          <div>
            <div className="ba-eyebrow">
              Finance <span>Read-only report</span>
            </div>
            <h1>Monthly Billing Audit</h1>
            <p>
              Dues charges and adjustments for the{" "}
              {view === "year" ? "year" : "month"}.
            </p>
          </div>
        </div>
        <div className="ba-header-actions">
          <div className="ba-segment" role="group" aria-label="Audit view">
            {[
              ["month", "Month"],
              ["year", "All year"],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={view === key}
                onClick={() => changePeriod(month, key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ba-period" role="group" aria-label="Billing period">
            <button
              type="button"
              className="ba-button ba-icon-button"
              aria-label={`Previous ${view}`}
              onClick={() => stepPeriod(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <output aria-live="polite">
              {view === "year" ? year : monthLabel(month)}
            </output>
            <button
              type="button"
              className="ba-button ba-icon-button"
              aria-label={`Next ${view}`}
              disabled={
                view === "year"
                  ? year >= monthNow().slice(0, 4)
                  : month >= monthNow()
              }
              onClick={() => stepPeriod(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button
            type="button"
            className="ba-button"
            disabled={data.loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={16} />
            {data.loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="ba-button"
            onClick={() => setGuide(true)}
          >
            <Info size={16} />
            Guide
          </button>
        </div>
      </header>

      {!ready ? (
        data.error && data.scope === scope ? (
          <div className="ba-error" role="alert">
            <strong>Billing audit unavailable.</strong> {data.error}{" "}
            <button
              type="button"
              className="ba-button"
              onClick={() => setRevision((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="ba-card ba-loading" role="status">
            Loading billing audit…
          </div>
        )
      ) : (
        <>
          <section
            className={`ba-confidence ${view === "month" && (!data.report || data.report.payload?.snapshot_missing) ? "ba-confidence-review" : ""}`}
            aria-label="Billing run status"
          >
            {view === "month" &&
            (!data.report || data.report.payload?.snapshot_missing) ? (
              <Info size={22} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={22} aria-hidden="true" />
            )}
            <p>
              <strong>
                {view === "year"
                  ? `${year} overview`
                  : data.report?.payload?.snapshot_missing
                    ? "Billing snapshot unavailable"
                    : data.report?.title ||
                      "Automatic run not confirmed by this view"}
              </strong>
              {view === "year"
                ? ` · ${billedMonths} of 12 months have active recorded charges.`
                : ` · ${count(totals.billed)} non-voided dues charges recorded.`}
            </p>
            <button
              type="button"
              className="ba-text-button"
              aria-expanded={expanded}
              aria-controls="ba-confidence-details"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Hide details" : "Details"}
            </button>
            {expanded && (
              <div id="ba-confidence-details" className="ba-confidence-details">
                {view === "year" ? (
                  "This overview summarizes saved charges and linked activity, not proof of completed billing runs."
                ) : data.report ? (
                  <>
                    <p>{data.report.body}</p>
                    <p>
                      Summary recorded{" "}
                      {new Date(data.report.created_at).toLocaleString(
                        "en-PH",
                        { timeZone: "Asia/Manila" },
                      )}{" "}
                      (Manila).
                    </p>
                  </>
                ) : (
                  "No matching completion notification is available. It may be missing, expired, or inaccessible; this does not mean billing failed. An authorized administrator can check the scheduled job logs."
                )}
                <p>
                  Only recorded charges are assessed here. Credit used and new
                  unpaid are verified subsets with saved linked evidence;
                  missing evidence is not zero. No cash receipt or current
                  outstanding balance is implied.
                </p>
              </div>
            )}
          </section>
          <section className="ba-kpis" aria-label="Billing totals">
            {kpis.map(([label, value, note, Icon, type]) => (
              <article className={`ba-kpi ba-kpi-${type}`} key={label}>
                <div className="ba-kpi-top">
                  <h2>{label}</h2>
                  <span className="ba-kpi-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                </div>
                <strong>{value}</strong>
                <p>{note}</p>
                {type === "flag" && (
                  <div
                    className="ba-meter"
                    aria-label={`${evidenceCount} of ${totals.billed} active charges have linked detail`}
                  >
                    <i
                      style={{
                        width: `${totals.billed ? (evidenceCount / totals.billed) * 100 : 0}%`,
                      }}
                    />
                  </div>
                )}
              </article>
            ))}
          </section>
          {view === "year" ? (
            <section aria-label="Year overview" className="ba-year">
              <div className="ba-card ba-year-chart">
                <div className="ba-record-heading">
                  <div>
                    <h2>{year} by month</h2>
                    <p>Choose a month to open its charge records.</p>
                  </div>
                  <div className="ba-chart-key">
                    <span>
                      <i />
                      Billed
                    </span>
                    <span>
                      <i className="ba-key-unpaid" />
                      Verified unpaid
                    </span>
                  </div>
                </div>
                <div className="ba-bars">
                  {months.map((item) => (
                    <button
                      type="button"
                      className="ba-bar"
                      key={item.key}
                      disabled={!item.hasCharges}
                      onClick={() => changePeriod(item.key, "month")}
                      aria-label={`${monthLabel(item.key)}, ${item.hasCharges ? `${peso.format(item.assessed)} billed` : "no recorded charges"}`}
                    >
                      <span className="ba-bar-columns">
                        <i
                          style={{
                            height: `${(item.assessed / maxChart) * 100}%`,
                          }}
                        />
                        <i
                          className="ba-bar-unpaid"
                          style={{
                            height: `${(item.verifiedUnpaid / maxChart) * 100}%`,
                          }}
                        />
                      </span>
                      <b>{monthLabel(item.key).split(" ")[0].slice(0, 3)}</b>
                    </button>
                  ))}
                </div>
              </div>
              <div className="ba-card ba-records">
                <div className="ba-table-wrap">
                  <table className="ba-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th className="ba-number">Charges</th>
                        <th className="ba-number">Total billed</th>
                        <th className="ba-number">Credit used</th>
                        <th className="ba-number">Unpaid portion</th>
                        <th className="ba-number">No linked detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((item) => (
                        <tr key={item.key}>
                          <td data-label="Month">
                            <button
                              type="button"
                              className="ba-text-button"
                              disabled={!item.hasCharges}
                              onClick={() => changePeriod(item.key, "month")}
                            >
                              {monthLabel(item.key).split(" ")[0]}
                            </button>
                          </td>
                          {item.hasCharges ? (
                            <>
                              <td data-label="Charges" className="ba-number">
                                {count(item.billed)}
                              </td>
                              <td
                                data-label="Total billed"
                                className="ba-number ba-money"
                              >
                                {peso.format(item.assessed)}
                              </td>
                              <td
                                data-label="Credit used"
                                className="ba-number"
                              >
                                {peso.format(item.verifiedCredit)}
                              </td>
                              <td
                                data-label="Unpaid portion"
                                className="ba-number"
                              >
                                {peso.format(item.verifiedUnpaid)}
                              </td>
                              <td
                                data-label="No linked detail"
                                className="ba-number"
                              >
                                {count(item.unknown)}
                              </td>
                            </>
                          ) : (
                            <td
                              colSpan={5}
                              data-label="Status"
                              className="ba-year-empty"
                            >
                              No recorded charges
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th>Total</th>
                        <td className="ba-number">{count(totals.billed)}</td>
                        <td className="ba-number">
                          {peso.format(totals.assessed)}
                        </td>
                        <td className="ba-number">
                          {peso.format(totals.verifiedCredit)}
                        </td>
                        <td className="ba-number">
                          {peso.format(totals.verifiedUnpaid)}
                        </td>
                        <td className="ba-number">{count(totals.unknown)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </section>
          ) : (
            <section
              className="ba-card ba-records"
              ref={recordsRef}
              id="billing-audit-records"
              aria-label="Billing charge records"
            >
              <div className="ba-record-tools">
                <div className="ba-record-heading">
                  <div>
                    <h2>Billing records</h2>
                    <p>
                      {count(rows.length)} matching charges · {PER_PAGE} per
                      page · {monthLabel(month)}
                    </p>
                  </div>
                  <div className="ba-tools">
                    <label className="ba-search">
                      <Search size={18} aria-hidden="true" />
                      <input
                        ref={searchRef}
                        aria-label="Search account"
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Name, block, lot or ID"
                      />
                      <kbd aria-hidden="true">/</kbd>
                    </label>
                    <div
                      className="ba-segment ba-density"
                      role="group"
                      aria-label="Row density"
                    >
                      <button
                        type="button"
                        aria-pressed={!compact}
                        onClick={() => setCompact(false)}
                      >
                        Comfortable
                      </button>
                      <button
                        type="button"
                        aria-pressed={compact}
                        onClick={() => setCompact(true)}
                      >
                        Compact
                      </button>
                    </div>
                    <button
                      type="button"
                      className="ba-button"
                      disabled={!rows.length}
                      onClick={exportCsv}
                    >
                      <Download size={16} />
                      Export CSV
                    </button>
                  </div>
                </div>
                <div
                  className="ba-chips"
                  role="group"
                  aria-label="Filter by status"
                >
                  {FILTERS.map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      aria-pressed={filter === key}
                      onClick={() => setFilter(key)}
                    >
                      {label}
                      <span>
                        {count(
                          searched.filter((row) => matchesFilter(row, key))
                            .length,
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="ba-table-wrap">
                <table className="ba-table">
                  <thead>
                    <tr>
                      {sortHead("name", "Account")}
                      <th scope="col">Class</th>
                      {sortHead("due", "Dues assessed", true)}
                      {sortHead("credit", "Credit used", true)}
                      {sortHead("unpaid", "New unpaid", true)}
                      {sortHead("status", "Status")}
                      <th scope="col">
                        <span className="ba-sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr
                        key={row.id}
                        className={`${selectedId === row.id ? "ba-selected" : ""} ${row.voided_at ? "ba-voided-row" : ""}`}
                      >
                        <td data-label="Account" className="ba-account">
                          <button
                            type="button"
                            onClick={() => setSelectedId(row.id)}
                          >
                            {nameFor(row)}
                          </button>
                          <small>
                            Block {row.properties?.block ?? "—"} · Lot{" "}
                            {row.properties?.lot_number ?? "—"} ·{" "}
                            <code title={String(row.id)}>
                              #{String(row.id).slice(0, 8)}
                            </code>
                          </small>
                        </td>
                        <td data-label="Class">
                          <span className="ba-class">{classFor(row)}</span>
                        </td>
                        <td
                          data-label="Dues assessed"
                          className="ba-number ba-money"
                        >
                          {peso.format(Number(row.amount))}
                        </td>
                        <td data-label="Credit used" className="ba-number">
                          <Amount value={row.creditUsed} tone="ba-positive" />
                        </td>
                        <td data-label="New unpaid" className="ba-number">
                          <Amount value={row.unpaidAdded} tone="ba-unpaid" />
                        </td>
                        <td data-label="Status">
                          <Status row={row} />
                        </td>
                        <td data-label="Details">
                          <button
                            type="button"
                            className="ba-row-open"
                            aria-label={`View charge details for ${nameFor(row)}`}
                            onClick={() => setSelectedId(row.id)}
                          >
                            <ChevronRight size={19} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && (
                  <div className="ba-empty">
                    No charges match these filters.{" "}
                    {(search || filter !== "all") && (
                      <button
                        type="button"
                        className="ba-button"
                        onClick={() => {
                          setSearch("");
                          setFilter("all");
                        }}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
              </div>
              <nav
                className="ba-pagination"
                aria-label="Billing records pagination"
              >
                <span>
                  {rows.length
                    ? `Showing ${(currentPage - 1) * PER_PAGE + 1}–${Math.min(currentPage * PER_PAGE, rows.length)} of ${count(rows.length)}`
                    : "Showing 0 of 0"}
                </span>
                <div>
                  <button
                    type="button"
                    className="ba-button"
                    disabled={currentPage === 1}
                    onClick={() => goPage(1)}
                  >
                    First
                  </button>
                  <button
                    type="button"
                    className="ba-button"
                    disabled={currentPage === 1}
                    onClick={() => goPage(currentPage - 1)}
                  >
                    Previous
                  </button>
                  <label>
                    Page{" "}
                    <select
                      aria-label="Jump to page"
                      value={currentPage}
                      onChange={(event) => goPage(Number(event.target.value))}
                    >
                      {Array.from({ length: pages }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>{" "}
                    of {pages}
                  </label>
                  <button
                    type="button"
                    className="ba-button"
                    disabled={currentPage === pages}
                    onClick={() => goPage(currentPage + 1)}
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    className="ba-button"
                    disabled={currentPage === pages}
                    onClick={() => goPage(pages)}
                  >
                    Last
                  </button>
                </div>
              </nav>
            </section>
          )}
        </>
      )}
      {selected && (
        <Overlay
          title={nameFor(selected)}
          drawer
          onClose={closeDrawer}
          footer={
            <>
              <button
                type="button"
                className="ba-button"
                disabled={selectedIndex === 0}
                onClick={() => setSelectedId(rows[selectedIndex - 1].id)}
              >
                Previous
              </button>
              <button
                type="button"
                className="ba-button"
                disabled={selectedIndex === rows.length - 1}
                onClick={() => setSelectedId(rows[selectedIndex + 1].id)}
              >
                Next
              </button>
              <button type="button" className="ba-button" onClick={copyId}>
                <Copy size={15} />
                Copy ID
              </button>
              <Link
                className="ba-button ba-primary"
                to={`/homeowners/${selected.property_id}`}
              >
                Open ledger
              </Link>
            </>
          }
        >
          <p className="ba-detail-address">
            Block {selected.properties?.block ?? "—"} · Lot{" "}
            {selected.properties?.lot_number ?? "—"} · {classFor(selected)}
          </p>
          <Status row={selected} />
          <dl className="ba-detail-grid">
            <div>
              <dt>Dues assessed</dt>
              <dd>{peso.format(Number(selected.amount))}</dd>
            </div>
            <div>
              <dt>Billing month</dt>
              <dd>{monthLabel(month)}</dd>
            </div>
            <div>
              <dt>Credit used</dt>
              <dd>
                <Amount value={selected.creditUsed} />
              </dd>
            </div>
            <div>
              <dt>New unpaid</dt>
              <dd>
                <Amount value={selected.unpaidAdded} />
              </dd>
            </div>
          </dl>
          <div className="ba-explanation">
            {selected.voided_at
              ? "This charge was cancelled and is excluded from assessed totals."
              : !selected.hasEvidence
                ? "No matching saved credit or unpaid activity was found. This does not prove a missed credit, debt, or billing error."
                : "These adjustments are backed by saved billing activity. Later payments may have changed the account balance."}
          </div>
          <div className="ba-explanation">
            <strong>Charge ID</strong>
            <code className="ba-full-id">{selected.id}</code>
            {selected.description && <p>{selected.description}</p>}
          </div>
          <p className="ba-detail-note">
            Dues assessed are not cash received. Open the ledger for current
            balances and payments.
          </p>
        </Overlay>
      )}
      {guide && (
        <Overlay
          title="How to read this audit"
          onClose={closeGuide}
          footer={
            <button
              type="button"
              className="ba-button ba-primary"
              onClick={closeGuide}
            >
              Close guide
            </button>
          }
        >
          <ol className="ba-guide-steps">
            <li>
              Choose the billing month, or use All year to compare recorded
              assessments.
            </li>
            <li>
              “Dues assessed” is the charge created, not proof of payment.
            </li>
            <li>
              “Not recorded” means supporting detail is missing, not zero.
            </li>
            <li>
              Open an account to review its ledger. Never enter a payment just
              to clear an audit status.
            </li>
          </ol>
          <dl className="ba-glossary">
            {[
              [
                "No linked detail",
                "No matching credit or unpaid activity was found. It does not prove a missed credit, debt, or billing error.",
              ],
              [
                "Covered by credit",
                "Saved activity supports that an existing advance balance covered the charge.",
              ],
              [
                "Unpaid portion added",
                "Saved activity supports an unpaid amount added at billing. Later payments may have reduced it.",
              ],
              [
                "Recorded",
                "A linked billing entry exists; review the amounts for its meaning.",
              ],
              [
                "Voided",
                "The charge was cancelled and is excluded from assessed totals.",
              ],
            ].map(([label, text]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </Overlay>
      )}
      {notice && (
        <div className="ba-toast" role="status">
          {notice}
        </div>
      )}
    </main>
  );
}
