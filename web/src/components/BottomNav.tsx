import { NavLink } from "react-router-dom";

/**
 * Legacy bottom nav kept for RoutingHardening / BrandingUi tests.
 * AppShell owns the primary mobile navigation (Plan / Markets / Journal / More).
 */
const links = [
  { to: "/", label: "Plan", end: true },
  { to: "/intelligence", label: "Markets", end: false },
  { to: "/journal", label: "Journal", end: false },
  { to: "/settings", label: "More", end: false }
];

export function BottomNav() {
  return (
    <nav className="nav" aria-label="Primary">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
