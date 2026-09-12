import { Button } from "@/components/ui/button";

export function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">smPosting</h1>
      <p className="text-sm text-muted-foreground">Placeholder — real auth (§2) lands here.</p>
      <Button disabled>Sign in with Google</Button>
    </div>
  );
}
