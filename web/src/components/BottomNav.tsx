import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/intelligence", label: "Intel", end: false },
  { to: "/analytics", label: "Analytics", end: false },
  { to: "/replay", label: "Replay", end: false },
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
