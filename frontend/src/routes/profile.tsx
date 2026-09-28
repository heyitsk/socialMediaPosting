import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import { useLogout, useMe } from "@/lib/session";

export function ProfilePage() {
  const { data: me } = useMe();
  const logout = useLogout();

  // RequireAuth only renders this once /me has resolved to a user.
  if (!me) return null;

  const signOut = (everywhere: boolean) =>
    logout.mutate(
      { everywhere },
      { onError: () => toast.error("Failed to log out — please try again.") },
    );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Profile</h1>

      <Card>
        <CardContent className="flex items-center gap-5">
          <UserAvatar name={me.name} avatarUrl={me.avatarUrl} className="size-20 text-2xl" />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{me.name}</div>
            <div className="truncate text-sm text-muted-foreground">{me.email}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Signed in with Google · Member since{" "}
              {new Date(me.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspaces</CardTitle>
          <CardDescription>
            Each workspace has its own connected accounts and post history.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {me.workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              to={`/w/${workspace.id}`}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              <span className="font-medium">{workspace.name}</span>
              <Badge variant={workspace.role === "OWNER" ? "default" : "secondary"}>
                {{ OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" }[workspace.role]}
              </Badge>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>
            You're signed out after 7 days of inactivity. Logging out of all devices also signs out
            every other browser you've used.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant="destructive" disabled={logout.isPending} onClick={() => signOut(false)}>
            Log out
          </Button>
          <Button variant="outline" disabled={logout.isPending} onClick={() => signOut(true)}>
            Log out of all devices
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
