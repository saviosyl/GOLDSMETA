import { NavLink } from "react-router-dom";

/** Legacy bottom nav — AppShell owns the primary mobile nav. Kept for tests/compat. */
const links = [
  { to: "/", label: "Plan", end: true },
  { to: "/v4", label: "Research", end: false },
  { to: "/history", label: "History", end: false },
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
