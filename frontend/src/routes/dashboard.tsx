import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Link2,
  Loader2,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { PlatformMark } from "@/components/platform-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL, api } from "@/lib/api";
import { PLATFORM_LABELS } from "@/lib/posting";
import { useWorkspace, useWorkspaceId } from "@/lib/session";

// Removed from the workspace, or a plain member (only owners/admins connect).
const FORBIDDEN_MESSAGE =
  "Only the workspace owner or an admin can connect accounts — or you no longer have access to that workspace.";

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  facebook_connect_denied: "Facebook connection was cancelled.",
  facebook_connect_invalid_state: "Facebook connection expired — please try again.",
  facebook_connect_failed: "Failed to connect Facebook account.",
  facebook_connect_forbidden: FORBIDDEN_MESSAGE,
  instagram_connect_denied: "Instagram connection was cancelled.",
  instagram_connect_invalid_state: "Instagram connection expired — please try again.",
  instagram_connect_failed: "Failed to connect Instagram account.",
  instagram_connect_forbidden: FORBIDDEN_MESSAGE,
  threads_connect_denied: "Threads connection was cancelled.",
  threads_connect_invalid_state: "Threads connection expired — please try again.",
  threads_connect_failed: "Failed to connect Threads account.",
  threads_connect_forbidden: FORBIDDEN_MESSAGE,
  linkedin_connect_denied: "LinkedIn connection was cancelled.",
  linkedin_connect_invalid_state: "LinkedIn connection expired — please try again.",
  linkedin_connect_failed: "Failed to connect LinkedIn account.",
  linkedin_connect_forbidden: FORBIDDEN_MESSAGE,
  youtube_connect_denied: "YouTube connection was cancelled.",
  youtube_connect_invalid_state: "YouTube connection expired — please try again.",
  youtube_connect_failed: "Failed to connect YouTube account.",
  youtube_connect_forbidden: FORBIDDEN_MESSAGE,
  youtube_connect_missing_scope:
    "YouTube connected without upload permission — reconnect and keep the upload checkbox ticked.",
  youtube_connect_no_channel:
    "That Google account has no YouTube channel — create one on YouTube first, then connect again.",
};

function useConnectStatusToast() {
  const [searchParams, setSearchParams] = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    const duplicate = searchParams.get("duplicate") === "1";
    if (!connected && !error) return;

    handled.current = true;

    if (connected === "facebook") {
      toast.success("Facebook account connected.");
    } else if (connected === "instagram") {
      if (duplicate) {
        toast.warning(
          "Instagram connected — this account may already be connected via a Facebook Page.",
        );
      } else {
        toast.success("Instagram account connected.");
      }
    } else if (connected === "threads") {
      toast.success("Threads account connected.");
    } else if (connected === "linkedin") {
      toast.success("LinkedIn account connected.");
    } else if (connected === "youtube") {
      toast.success("YouTube channel connected.");
    } else if (error) {
      toast.error(CONNECT_ERROR_MESSAGES[error] ?? "Failed to connect account.");
    }

    setSearchParams(
      (prev) => {
        prev.delete("connected");
        prev.delete("error");
        prev.delete("duplicate");
        return prev;
      },
      { replace: true },
    );
    // Runs once per mount to consume the one-time OAuth redirect params — deliberately not
    // re-running on every searchParams change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function DashboardPage() {
  useConnectStatusToast();

  const { data, isPending, isError } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/health");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Manage connected social accounts and publishing connections from one place.
        </p>
      </header>

      <section
        className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5"
        aria-label="Backend connection status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
              isError
                ? "bg-destructive/10 text-destructive"
                : data
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : isError ? (
              <CircleAlert className="size-4" aria-hidden="true" />
            ) : (
              <Activity className="size-4" aria-hidden="true" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {isPending && "Checking backend"}
              {isError && "Backend unavailable"}
              {data && "Backend healthy"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isPending && "Verifying API availability..."}
              {isError && "Could not reach the backend API."}
              {data &&
                `Backend is ${data.status} as of ${new Date(data.timestamp).toLocaleTimeString()}`}
            </p>
          </div>
        </div>
        {data && (
          <span className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-emerald-700 dark:text-emerald-300 sm:self-auto">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Connected
          </span>
        )}
      </section>

      <ConnectedAccountsSection />
    </div>
  );
}

// Where "Connect"/"Reconnect" for a given platform starts — reconnecting
// re-runs the same OAuth flow, which upserts onto the same unique key and
// clears disconnectedAt, so it works for both a fresh connect and a
// REQUIRES_RECONNECT/SLIDING_WINDOW token refresh.
// The workspaceId query param tells the backend which workspace the new
// account belongs to — it re-checks membership before redirecting out.
const CONNECT_PATH: Partial<Record<string, string>> = {
  FACEBOOK: "/api/auth/facebook",
  INSTAGRAM: "/api/auth/instagram",
  THREADS: "/api/auth/threads",
  LINKEDIN: "/api/auth/linkedin",
  YOUTUBE: "/api/auth/youtube",
};

const CONNECT_OPTIONS = [
  { platform: "FACEBOOK", path: "/api/auth/facebook", label: "Connect / Add Facebook Pages" },
  { platform: "INSTAGRAM", path: "/api/auth/instagram", label: "Connect Instagram" },
  { platform: "THREADS", path: "/api/auth/threads", label: "Connect Threads" },
  { platform: "LINKEDIN", path: "/api/auth/linkedin", label: "Connect LinkedIn" },
  { platform: "YOUTUBE", path: "/api/auth/youtube", label: "Connect YouTube" },
];

function ConnectedAccountsSection() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId() ?? "";
  // Members post with the accounts but can't change them (websitePlan.md §9.7).
  const canManage = useWorkspace()?.role !== "MEMBER";
  const connect = (path: string) => {
    window.location.href = `${API_URL}${path}?workspaceId=${encodeURIComponent(workspaceId)}`;
  };

  const {
    data: accounts,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["integrations", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/workspaces/{workspaceId}/integrations", {
        params: { path: { workspaceId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/workspaces/{workspaceId}/integrations/{id}", {
        params: { path: { workspaceId, id } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", workspaceId] });
      toast.success("Account disconnected.");
    },
    onError: () => toast.error("Failed to disconnect account."),
  });

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <div className="min-w-0">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-foreground">Connected accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review account connections and resolve any publishing access issues.
          </p>
        </div>

        {isPending && (
          <div
            className="grid gap-4 md:grid-cols-2"
            role="status"
            aria-label="Loading connected accounts"
          >
            {[0, 1, 2, 3].map((index) => (
              <Card key={index} className="min-h-52 animate-pulse">
                <CardContent className="flex h-full flex-col justify-between pt-4">
                  <div className="flex items-start gap-3">
                    <div className="size-10 rounded-lg bg-muted" />
                    <div className="space-y-2">
                      <div className="h-3 w-20 rounded bg-muted" />
                      <div className="h-4 w-32 rounded bg-muted" />
                    </div>
                  </div>
                  <div className="h-7 w-24 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
            <span className="sr-only">Loading accounts...</span>
          </div>
        )}

        {isError && (
          <div
            className="flex min-h-40 flex-col justify-center rounded-lg border border-destructive/20 bg-destructive/5 p-6"
            role="alert"
          >
            <CircleAlert className="mb-3 size-5 text-destructive" aria-hidden="true" />
            <p className="font-medium text-foreground">Could not load connected accounts.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check the backend connection and try again.
            </p>
          </div>
        )}

        {accounts?.length === 0 && (
          <div className="flex min-h-52 flex-col justify-center rounded-lg border border-dashed border-border bg-card px-6 py-8">
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Link2 className="size-5" aria-hidden="true" />
            </div>
            <p className="font-medium text-foreground">No accounts connected yet.</p>
            <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              {canManage
                ? "Connect a social account to start publishing from this workspace."
                : "Ask the workspace owner or an admin to connect a social account."}
            </p>
          </div>
        )}

        {accounts && accounts.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {accounts.map((account) => (
              <Card key={account.id} className="min-h-52 shadow-sm">
                <CardContent className="flex h-full flex-col pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <PlatformMark platform={account.platform} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          {PLATFORM_LABELS[account.platform] ?? account.platform}
                        </p>
                        <p className="mt-1 truncate font-medium text-foreground">
                          {account.accountName}
                        </p>
                      </div>
                    </div>
                    {account.needsReconnect ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                        <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                        Attention
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        <CircleCheck className="size-3.5" aria-hidden="true" />
                        Connected
                      </span>
                    )}
                  </div>

                  <div className="mt-5 min-h-12 text-xs leading-5 text-muted-foreground">
                    {account.platform === "INSTAGRAM" &&
                      (account.connectionMethod === "INSTAGRAM_LOGIN"
                        ? "Direct login"
                        : "Connected through a Facebook Page")}
                    {account.needsReconnect && (
                      <p className="font-medium text-amber-800 dark:text-amber-200">
                        {canManage
                          ? "Token expired. Reconnect to restore publishing access."
                          : "Token expired. Ask the owner or an admin to reconnect."}
                      </p>
                    )}
                  </div>

                  {canManage && (
                    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
                      {account.needsReconnect && CONNECT_PATH[account.platform] && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => connect(CONNECT_PATH[account.platform]!)}
                        >
                          <RefreshCw className="size-3.5" aria-hidden="true" />
                          Reconnect
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={disconnect.isPending}
                        onClick={() => disconnect.mutate(account.id)}
                      >
                        <Unplug className="size-3.5" aria-hidden="true" />
                        Disconnect
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card className="shadow-sm xl:sticky xl:top-10">
        <CardHeader>
          <CardTitle className="text-base">Connect a platform</CardTitle>
          <CardDescription>
            {canManage
              ? "Choose a provider to add a publishing connection."
              : "Only the workspace owner or an admin can connect or disconnect accounts."}
          </CardDescription>
        </CardHeader>
        {canManage && (
          <CardContent className="grid gap-2">
            {CONNECT_OPTIONS.map((option) => (
              <Button
                key={option.platform}
                variant="outline"
                size="sm"
                className="h-auto justify-start px-3 py-2.5 text-left"
                onClick={() => connect(option.path)}
              >
                <PlatformMark platform={option.platform} />
                <span>{option.label}</span>
              </Button>
            ))}
          </CardContent>
        )}
      </Card>
    </section>
  );
}
