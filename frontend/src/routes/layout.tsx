import { NavLink, Outlet } from "react-router";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard" },
  { to: "/composer", label: "Composer" },
  { to: "/history", label: "History" },
];

export function AppLayout() {
  return (
    <div className="flex min-h-svh">
      <aside className="w-56 shrink-0 border-r border-border p-4">
        <div className="mb-6 px-2 text-lg font-semibold">smPosting</div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent text-accent-foreground",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
