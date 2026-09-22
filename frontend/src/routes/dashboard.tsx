import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, API_URL } from "@/lib/api";

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  facebook_connect_denied: "Facebook connection was cancelled.",
  facebook_connect_invalid_state: "Facebook connection expired — please try again.",
  facebook_connect_failed: "Failed to connect Facebook account.",
  instagram_connect_denied: "Instagram connection was cancelled.",
  instagram_connect_invalid_state: "Instagram connection expired — please try again.",
  instagram_connect_failed: "Failed to connect Instagram account.",
  threads_connect_denied: "Threads connection was cancelled.",
  threads_connect_invalid_state: "Threads connection expired — please try again.",
  threads_connect_failed: "Failed to connect Threads account.",
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
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Backend connection</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {isPending && "Checking backend…"}
          {isError && "Could not reach the backend API."}
          {data && `Backend is ${data.status} as of ${new Date(data.timestamp).toLocaleTimeString()}`}
        </CardContent>
      </Card>

      <ConnectedAccountsCard />
    </div>
  );
}

function ConnectedAccountsCard() {
  const queryClient = useQueryClient();

  const { data: accounts, isPending, isError } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/integrations");
      if (error) throw error;
      return data;
    },
  });

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/integrations/{id}", { params: { path: { id } } });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Account disconnected.");
    },
    onError: () => toast.error("Failed to disconnect account."),
  });

  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Connected Accounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {isPending && <p className="text-muted-foreground">Loading accounts…</p>}
        {isError && <p className="text-destructive">Could not load connected accounts.</p>}
        {accounts?.length === 0 && (
          <p className="text-muted-foreground">No accounts connected yet.</p>
        )}
        {accounts?.map((account) => (
          <div key={account.id} className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">{account.accountName}</div>
              <div className="text-xs text-muted-foreground">
                {account.platform}
                {account.platform === "INSTAGRAM" &&
                  (account.connectionMethod === "INSTAGRAM_LOGIN"
                    ? " · Direct login"
                    : " · via Facebook Page")}
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate(account.id)}
            >
              Disconnect
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.location.href = `${API_URL}/api/auth/facebook`;
          }}
        >
          Connect / Add Facebook Pages
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.location.href = `${API_URL}/api/auth/instagram`;
          }}
        >
          Connect Instagram
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.location.href = `${API_URL}/api/auth/threads`;
          }}
        >
          Connect Threads
        </Button>
      </CardContent>
    </Card>
  );
}
