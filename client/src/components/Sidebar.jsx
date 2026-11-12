import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  History,
  CalendarDays,
  ContactRound,
  House,
  ClockAlert,
  FolderOpen,
  BookOpen,
  ClipboardCheck,
  HandCoins,
  ConciergeBell,
  WalletCards,
  BanknoteArrowUp,
  ChartPie,
  ReceiptText,
  MessageSquareWarning,
  Settings,
} from "lucide-react";
import { useOrganization } from "../context/OrganizationContext";
import "./Sidebar.css";

export default function Sidebar({ user, onLogout, open = false, onNavigate }) {
  const { organization } = useOrganization();
  const role = user?.role?.trim().toLowerCase();
  const displayName = user?.full_name?.trim() || user?.email || "User";

  const dashboardPath =
    role === "admin"
      ? "/admin/dashboard"
      : role === "treasurer"
        ? "/treasurer/dashboard"
        : "/secretary/dashboard";

  const overviewItems = [
    {
      name: "Dashboard",
      path: dashboardPath,
      icon: LayoutDashboard,
      roles: ["admin", "treasurer", "secretary"],
    },
    {
      name: "Activity Log",
      path: "/activity-log",
      icon: History,
      roles: ["admin", "secretary", "treasurer"],
    },
    {
      name: "Event Calendar",
      path: "/calendar",
      icon: CalendarDays,
      roles: ["admin", "treasurer", "secretary"],
    },
    {
      name: "Contact Manager",
      path: "/contacts",
      icon: ContactRound,
      roles: ["admin", "secretary", "treasurer"],
    },
    {
      name: "Homeowners",
      path: "/homeowners",
      icon: House,
      roles: ["admin", "secretary", "treasurer"],
    },
    {
      name: "Overdue Accounts",
      path: "/overdue-accounts",
      icon: ClockAlert,
      roles: ["admin", "secretary", "treasurer"],
    },
    {
      name: "Grievances",
      path: "/secretary/grievances",
      icon: MessageSquareWarning,
      roles: ["secretary"],
    },
    {
      name: "Document Library",
      path: "/documents",
      icon: FolderOpen,
      roles: ["admin", "secretary", "treasurer"],
    },
  ].filter((item) => item.roles.includes(role));

  const financeItems = [
    {
      name: "Ledger",
      path: "/ledger",
      icon: BookOpen,
      roles: ["admin", "treasurer", "secretary"],
    },
    {
      name: "Monthly Billing Audit",
      path: "/billing-audit",
      icon: ClipboardCheck,
      roles: ["admin", "secretary", "treasurer"],
    },
    {
      name: "Amenity Revenue",
      path: "/treasurer/service-revenue",
      icon: HandCoins,
      roles: ["treasurer"],
    },
    {
      name: "Services",
      path: "/secretary/services",
      icon: ConciergeBell,
      roles: ["secretary", "treasurer"],
    },
    {
      name: "Payments",
      path: "/payments",
      icon: WalletCards,
      roles: ["admin", "treasurer", "secretary"],
    },
    {
      name: "Expenses",
      path: "/expenses",
      icon: BanknoteArrowUp,
      roles: ["admin", "secretary", "treasurer"],
    },
    {
      name: "Reports",
      path:
        role === "admin"
          ? "/reports"
          : role === "treasurer"
            ? "/treasurer/reports"
            : "/secretary/reports",
      icon: ChartPie,
      roles: ["admin", "treasurer", "secretary"],
    },

    {
      name: "Official Receipts",
      path: "/secretary/receipts",
      icon: ReceiptText,
      roles: ["secretary", "treasurer"],
    },
  ].filter((item) => item.roles.includes(role));

  const systemItems = [
    {
      name: "System Settings",
      path: "/system-settings",
      icon: Settings,
      roles: ["admin"],
    },
  ].filter((item) => item.roles.includes(role));

  const renderNavItems = (items) =>
    items.map((item) => (
      <NavLink
        key={item.path}
        to={item.path}
        end={item.path === "/" || item.path.endsWith("/dashboard")}
        onClick={onNavigate}
        className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
      >
        <span className="nav-icon">
          <item.icon size={20} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="nav-text">{item.name}</span>
      </NavLink>
    ));

  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-badge">
            <House size={18} strokeWidth={1.8} aria-hidden="true" />
          </span>

          <span className="logo-text-group">
            <span className="logo-text">{organization.hoaName}</span>
            <span className="logo-subtext">
              {user?.role
                ? `${user.role.charAt(0).toUpperCase()}${user.role
                    .slice(1)
                    .toLowerCase()} Portal`
                : "Portal"}
            </span>
          </span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <h3 className="nav-section-title">OVERVIEW</h3>
          <div className="nav-items">{renderNavItems(overviewItems)}</div>
        </div>

        {financeItems.length > 0 && (
          <div className="nav-section">
            <h3 className="nav-section-title">FINANCE</h3>
            <div className="nav-items">{renderNavItems(financeItems)}</div>
          </div>
        )}

        {systemItems.length > 0 && (
          <div className="nav-section">
            <h3 className="nav-section-title">SYSTEM</h3>
            <div className="nav-items">{renderNavItems(systemItems)}</div>
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="user-section">
          <div className="user-avatar">
            {(
              user?.full_name?.trim()?.charAt(0) ||
              user?.email?.charAt(0) ||
              "U"
            ).toUpperCase()}
          </div>

          <div className="user-info">
            <div className="user-name">{displayName}</div>
            <div className="user-role">{user?.role || "Admin"}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
