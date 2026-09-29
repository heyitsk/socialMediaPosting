import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, apiErrorMessage } from "@/lib/api";

// A fresh workspace — typically one per client — with you as its owner. Your
// Personal workspace stays just yours; this is where you invite people.
export function NewWorkspacePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST("/api/workspaces", {
        body: { name },
      });
      if (!response.ok || !data)
        throw new Error(apiErrorMessage(error, "Failed to create workspace."));
      return data;
    },
    onSuccess: async (workspace) => {
      // RequireWorkspace only lets you in once /me lists the new workspace.
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success(`Created "${workspace.name}".`);
      navigate(`/w/${workspace.id}/settings`);
    },
    onError: (error) => toast.error(error.message),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div className="flex max-w-lg flex-col gap-8">
      <div>
        <p className="text-sm font-medium text-primary">Workspace</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">New workspace</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          A separate space with its own accounts, posts, and members.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Create a workspace</CardTitle>
          <CardDescription>
            A workspace has its own connected accounts, posts and members — e.g. one per client.
            You'll be its owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Coffee"
              maxLength={100}
              required
              autoFocus
            />
            <Button
              type="submit"
              className="self-start"
              disabled={!name.trim() || create.isPending}
            >
              Create workspace
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
