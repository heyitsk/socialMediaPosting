import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, API_URL } from "@/lib/api";

export function DashboardPage() {
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
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
              <div className="text-xs text-muted-foreground">{account.platform}</div>
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
          Connect Facebook
        </Button>
      </CardContent>
    </Card>
  );
}
