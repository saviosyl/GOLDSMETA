import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/analysis", label: "Analysis" },
  { to: "/history", label: "History" },
  { to: "/journal", label: "Journal" },
  { to: "/settings", label: "Settings" }
];

export function BottomNav() {
  return (
    <nav className="nav" aria-label="Primary">
      {links.map((link) => (
        <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? "active" : undefined)}>
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
