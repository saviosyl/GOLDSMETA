import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/analytics", label: "Analytics", end: false },
  { to: "/history", label: "History", end: false },
  { to: "/journal", label: "Journal", end: false },
  { to: "/settings", label: "Settings", end: false }
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
