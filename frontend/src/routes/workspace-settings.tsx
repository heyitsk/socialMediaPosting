import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { api, apiErrorMessage } from "@/lib/api";
import type { components } from "@/lib/api-schema";
import { ROLE_LABELS, useWorkspace } from "@/lib/session";

type AssignableRole = components["schemas"]["AssignableRole"];
type Workspace = components["schemas"]["WorkspaceSummary"];

const ROLE_DESCRIPTIONS: Record<AssignableRole, string> = {
  ADMIN: "Can connect and disconnect accounts, and post.",
  MEMBER: "Can post with the workspace's connected accounts.",
};

// Everything here is owner-only on the backend (websitePlan.md §9.7), except
// leaving — so non-owners just see their role and a Leave button.
export function WorkspaceSettingsPage() {
  const workspace = useWorkspace();
  // RequireWorkspace only renders this for a workspace in /me.
  if (!workspace) return null;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Workspace settings</h1>
      {workspace.role === "OWNER" ? (
        <>
          <RenameCard workspace={workspace} />
          {workspace.isPersonal ? (
            <Card>
              <CardHeader>
                <CardTitle>Members</CardTitle>
                <CardDescription>
                  Your Personal workspace is just for you. To work with others, create a new
                  workspace and invite them there.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <InviteCard workspaceId={workspace.id} />
              <PendingInvitesCard workspaceId={workspace.id} />
              <MembersCard workspaceId={workspace.id} />
              <DeleteCard workspace={workspace} />
            </>
          )}
        </>
      ) : (
        <LeaveCard workspace={workspace} />
      )}
    </div>
  );
}

// After leaving or deleting, /me no longer lists this workspace and
// RequireWorkspace would bounce us anyway — go to the default one directly.
function useLeaveWorkspacePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    navigate("/", { replace: true });
  };
}

function RenameCard({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(workspace.name);

  const rename = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.PATCH("/api/workspaces/{workspaceId}", {
        params: { path: { workspaceId: workspace.id } },
        body: { name },
      });
      if (!response.ok) throw new Error(apiErrorMessage(error, "Failed to rename workspace."));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Workspace renamed.");
    },
    onError: (error) => toast.error(error.message),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    rename.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Label htmlFor="workspace-name">Name</Label>
          <div className="flex gap-2">
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
            />
            <Button
              type="submit"
              disabled={!name.trim() || name.trim() === workspace.name || rename.isPending}
            >
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RoleSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: AssignableRole;
  onChange: (role: AssignableRole) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(role) => onChange(role as AssignableRole)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-32" aria-label="Role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(["MEMBER", "ADMIN"] as const).map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InviteCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("MEMBER");

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST("/api/workspaces/{workspaceId}/invites", {
        params: { path: { workspaceId } },
        body: { email, role },
      });
      if (!response.ok || !data) throw new Error(apiErrorMessage(error, "Failed to send invite."));
      return data;
    },
    onSuccess: (result) => {
      setEmail("");
      if (result.status === "added") {
        queryClient.invalidateQueries({ queryKey: ["members", workspaceId] });
        toast.success(`${result.invite.email} already had an account and has been added.`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["invites", workspaceId] });
        toast.success(
          `Invited ${result.invite.email}. Send them the app link — they'll join when they sign in with Google.`,
        );
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    invite.mutate();
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.origin);
    toast.success("App link copied.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite people</CardTitle>
        <CardDescription>
          No email is sent. Share the app link — invites are accepted automatically when that person
          signs in with Google using the invited address. Invites expire after 7 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Label htmlFor="invite-email">Email</Label>
          <div className="flex gap-2">
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
            />
            <RoleSelect value={role} onChange={setRole} />
            <Button type="submit" disabled={!email.trim() || invite.isPending}>
              Invite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
        </form>
        <Button variant="outline" size="sm" className="self-start" onClick={copyLink}>
          Copy app link
        </Button>
      </CardContent>
    </Card>
  );
}

function PendingInvitesCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();

  const {
    data: invites,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["invites", workspaceId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/workspaces/{workspaceId}/invites", {
        params: { path: { workspaceId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const revoke = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error, response } = await api.DELETE(
        "/api/workspaces/{workspaceId}/invites/{inviteId}",
        { params: { path: { workspaceId, inviteId } } },
      );
      if (!response.ok) throw new Error(apiErrorMessage(error, "Failed to revoke invite."));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", workspaceId] });
      toast.success("Invite revoked.");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invites</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {isPending && <p className="text-muted-foreground">Loading invites…</p>}
        {isError && <p className="text-destructive">Could not load invites.</p>}
        {invites?.length === 0 && <p className="text-muted-foreground">No pending invites.</p>}
        {invites?.map((invite) => (
          <div key={invite.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{invite.email}</div>
              <div className="text-xs text-muted-foreground">
                {ROLE_LABELS[invite.role]} · expires{" "}
                {new Date(invite.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(invite.id)}
            >
              Revoke
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MembersCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["members", workspaceId] });

  const {
    data: members,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["members", workspaceId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/workspaces/{workspaceId}/members", {
        params: { path: { workspaceId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AssignableRole }) => {
      const { error, response } = await api.PATCH(
        "/api/workspaces/{workspaceId}/members/{userId}",
        { params: { path: { workspaceId, userId } }, body: { role } },
      );
      if (!response.ok) throw new Error(apiErrorMessage(error, "Failed to change role."));
    },
    onSuccess: () => {
      invalidate();
      toast.success("Role updated.");
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error, response } = await api.DELETE(
        "/api/workspaces/{workspaceId}/members/{userId}",
        { params: { path: { workspaceId, userId } } },
      );
      if (!response.ok) throw new Error(apiErrorMessage(error, "Failed to remove member."));
    },
    onSuccess: () => {
      invalidate();
      toast.success("Member removed.");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Removing someone takes effect immediately. Accounts they connected and posts they made
          stay in the workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {isPending && <p className="text-muted-foreground">Loading members…</p>}
        {isError && <p className="text-destructive">Could not load members.</p>}
        {members?.map((member) => (
          <div key={member.userId} className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar name={member.name} avatarUrl={member.avatarUrl} />
              <div className="min-w-0">
                <div className="truncate font-medium">{member.name}</div>
                <div className="truncate text-xs text-muted-foreground">{member.email}</div>
              </div>
            </div>
            {member.role === "OWNER" ? (
              <Badge>Owner</Badge>
            ) : (
              <div className="flex gap-2">
                <RoleSelect
                  value={member.role}
                  disabled={changeRole.isPending}
                  onChange={(role) => changeRole.mutate({ userId: member.userId, role })}
                />
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove ${member.name} from this workspace?`)) {
                      remove.mutate(member.userId);
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DeleteCard({ workspace }: { workspace: Workspace }) {
  const leavePage = useLeaveWorkspacePage();

  const remove = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE("/api/workspaces/{workspaceId}", {
        params: { path: { workspaceId: workspace.id } },
      });
      if (!response.ok) throw new Error(apiErrorMessage(error, "Failed to delete workspace."));
    },
    onSuccess: async () => {
      toast.success(`Deleted "${workspace.name}".`);
      await leavePage();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle>Delete workspace</CardTitle>
        <CardDescription>
          Hides this workspace — its connected accounts, scheduled posts and history — from every
          member, and cancels pending invites.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete "${workspace.name}" for everyone?`)) remove.mutate();
          }}
        >
          Delete workspace
        </Button>
      </CardContent>
    </Card>
  );
}

function LeaveCard({ workspace }: { workspace: Workspace }) {
  const leavePage = useLeaveWorkspacePage();

  const leave = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST("/api/workspaces/{workspaceId}/leave", {
        params: { path: { workspaceId: workspace.id } },
      });
      if (!response.ok) throw new Error(apiErrorMessage(error, "Failed to leave workspace."));
    },
    onSuccess: async () => {
      toast.success(`You left "${workspace.name}".`);
      await leavePage();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{workspace.name}</CardTitle>
        <CardDescription>
          You're {workspace.role === "ADMIN" ? "an" : "a"} {ROLE_LABELS[workspace.role]} here.{" "}
          {workspace.role !== "OWNER" && ROLE_DESCRIPTIONS[workspace.role]} Only the owner can
          manage members and invites.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          disabled={leave.isPending}
          onClick={() => {
            if (window.confirm(`Leave "${workspace.name}"? You'll need a new invite to rejoin.`)) {
              leave.mutate();
            }
          }}
        >
          Leave workspace
        </Button>
      </CardContent>
    </Card>
  );
}
