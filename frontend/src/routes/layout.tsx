import { Clock3, LayoutDashboard, Menu, PenSquare, Plus, Settings, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import logo from "@/assets/postuploaders-c-badge-1024.png";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { useMe, useWorkspaceId } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "", label: "Dashboard", icon: LayoutDashboard },
  { path: "/composer", label: "Composer", icon: PenSquare },
  { path: "/history", label: "History", icon: Clock3 },
  { path: "/settings", label: "Settings", icon: Settings },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/40",
    isActive &&
      "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
  );

function AppBrand({ compact = false }: { compact?: boolean }) {
  const { data: me } = useMe();
  const workspaceId = useWorkspaceId();
  const workspaceName = me?.workspaces.find((workspace) => workspace.id === workspaceId)?.name;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <img src={logo} alt="" className="size-9 shrink-0 rounded-lg shadow-sm" />
      {!compact && (
        <div className="min-w-0 leading-none">
          <div className="text-[15px] font-semibold text-sidebar-foreground">postUploaders</div>
          <div className="mt-1 truncate text-[11px] font-medium text-muted-foreground">
            {workspaceName ?? "Workspace"}
          </div>
        </div>
      )}
    </div>
  );
}

// Hidden for the common case of a single (Personal) workspace. Switching keeps
// you on the same page — Composer in one workspace → Composer in the other.
function WorkspaceSwitcher({ workspaceId }: { workspaceId: string }) {
  const { data: me } = useMe();
  const location = useLocation();
  const navigate = useNavigate();

  if (!me || me.workspaces.length < 2) return null;

  const onChange = (nextId: string) => {
    const prefix = `/w/${workspaceId}`;
    const rest = location.pathname.startsWith(prefix) ? location.pathname.slice(prefix.length) : "";
    navigate(`/w/${nextId}${rest}`);
  };

  return (
    <div className="mb-4">
      <Select value={workspaceId} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label="Workspace">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {me.workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspace.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function NavigationLinks({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Primary navigation">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;

        return (
          <NavLink
            key={item.path}
            to={`/w/${workspaceId}${item.path}`}
            end={item.path === ""}
            onClick={onNavigate}
            className={navLinkClass}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
      <NavLink to="/workspaces/new" onClick={onNavigate} className={navLinkClass}>
        <Plus className="size-4 shrink-0" aria-hidden="true" />
        <span>New workspace</span>
      </NavLink>
    </nav>
  );
}

function ProfileLink({ onNavigate }: { onNavigate?: () => void }) {
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <NavLink
      to="/profile"
      onClick={onNavigate}
      className={({ isActive }) => cn(navLinkClass({ isActive }), "px-2")}
    >
      <UserAvatar name={me.name} avatarUrl={me.avatarUrl} />
      <div className="min-w-0">
        <div className="truncate">{me.name}</div>
        <div className="truncate text-xs font-normal opacity-75">{me.email}</div>
      </div>
    </NavLink>
  );
}

export function AppLayout() {
  const workspaceId = useWorkspaceId() ?? "";
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const closeMobileNavigation = useCallback(() => {
    setMobileNavigationOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!mobileNavigationOpen) return;

    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileNavigation();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavigationOpen, closeMobileNavigation]);

  return (
    <div className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-20 items-center border-b border-sidebar-border px-6">
          <AppBrand />
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
          <WorkspaceSwitcher workspaceId={workspaceId} />
          <NavigationLinks workspaceId={workspaceId} />
        </div>
        <div className="border-t border-sidebar-border px-4 py-4">
          <ProfileLink />
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
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <WorkspaceSwitcher workspaceId={workspaceId} />
              <NavigationLinks workspaceId={workspaceId} onNavigate={closeMobileNavigation} />
            </div>
            <div className="border-t border-sidebar-border px-4 py-4">
              <ProfileLink onNavigate={closeMobileNavigation} />
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
