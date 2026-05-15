import { Link } from "@tanstack/react-router";

export function NavBar() {
  const base =
    "rounded-full px-4 py-2 text-sm font-semibold transition border";
  const inactive =
    "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10";
  const active =
    "border-blue-400/60 bg-blue-500/20 text-white shadow-[0_0_20px_rgba(0,120,255,0.35)]";
  return (
    <nav className="mx-auto mb-5 flex w-full max-w-2xl items-center gap-2 px-4 pt-4">
      <Link
        to="/"
        className={base}
        activeProps={{ className: `${base} ${active}` }}
        inactiveProps={{ className: `${base} ${inactive}` }}
        activeOptions={{ exact: true }}
      >
        🚇 Subway
      </Link>
      <Link
        to="/bus"
        className={base}
        activeProps={{ className: `${base} ${active}` }}
        inactiveProps={{ className: `${base} ${inactive}` }}
      >
        🚌 Bus
      </Link>
    </nav>
  );
}