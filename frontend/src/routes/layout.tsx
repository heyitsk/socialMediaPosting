import { useEffect, useRef, useState } from "react";
import { Clock3, LayoutDashboard, Menu, PenSquare, Send, X } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/composer", label: "Composer", icon: PenSquare },
  { to: "/history", label: "History", icon: Clock3 },
];

function AppBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Send className="size-4" aria-hidden="true" />
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="text-[15px] font-semibold text-sidebar-foreground">smPosting</div>
          <div className="mt-1 text-[11px] font-medium text-muted-foreground">Workspace</div>
        </div>
      )}
    </div>
  );
}

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Primary navigation">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;

        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/40",
                isActive &&
                  "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function AppLayout() {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function closeMobileNavigation() {
    setMobileNavigationOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  useEffect(() => {
    if (!mobileNavigationOpen) return;

    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileNavigation();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavigationOpen]);

  return (
    <div className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-20 items-center border-b border-sidebar-border px-6">
          <AppBrand />
        </div>
        <div className="flex flex-1 flex-col px-4 py-6">
          <NavigationLinks />
        </div>
        <div className="border-t border-sidebar-border px-6 py-5">
          <div className="h-px w-10 bg-primary/20" />
        </div>
      </aside>

      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
        <Button
          ref={menuButtonRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          aria-expanded={mobileNavigationOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMobileNavigationOpen(true)}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
        <AppBrand compact />
        <div className="size-8" aria-hidden="true" />
      </header>

      {mobileNavigationOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-foreground/20 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={closeMobileNavigation}
          />
          <aside
            id="mobile-navigation"
            className="relative flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex h-20 items-center justify-between border-b border-sidebar-border px-5">
              <AppBrand />
              <Button
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                onClick={closeMobileNavigation}
              >
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>
            <div className="flex-1 px-4 py-6">
              <NavigationLinks onNavigate={closeMobileNavigation} />
            </div>
          </aside>
        </div>
      )}

      <main className="min-h-[calc(100svh-4rem)] lg:min-h-svh lg:pl-64">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
