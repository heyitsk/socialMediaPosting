import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

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

      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Integrations dashboard placeholder — Connect/Disconnect buttons per §2 land here.
        </CardContent>
      </Card>
    </div>
  );
}
