import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
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
  { path: "", label: "Dashboard" },
  { path: "/composer", label: "Composer" },
  { path: "/history", label: "History" },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
    isActive && "bg-accent text-accent-foreground",
  );

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

export function AppLayout() {
  const { data: me } = useMe();
  const workspaceId = useWorkspaceId() ?? "";

  return (
    <div className="flex min-h-svh">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border p-4">
        <div className="mb-6 px-2 text-lg font-semibold">smPosting</div>
        <WorkspaceSwitcher workspaceId={workspaceId} />
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={`/w/${workspaceId}${item.path}`}
              end={item.path === ""}
              className={navLinkClass}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {me && (
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              cn(navLinkClass({ isActive }), "mt-auto flex items-center gap-3 px-2")
            }
          >
            <UserAvatar name={me.name} avatarUrl={me.avatarUrl} />
            <div className="min-w-0">
              <div className="truncate">{me.name}</div>
              <div className="truncate text-xs font-normal text-muted-foreground">{me.email}</div>
            </div>
          </NavLink>
        )}
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
