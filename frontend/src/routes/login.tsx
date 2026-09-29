import { Send } from "lucide-react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { API_URL } from "@/lib/api";

const ERROR_MESSAGES: Record<string, string> = {
  login_denied: "Sign-in was cancelled.",
  login_invalid_state: "Sign-in expired or was started in another tab. Please try again.",
  login_failed: "Something went wrong signing you in. Please try again.",
};

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");
  const next = searchParams.get("next") ?? "/";

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm shadow-sm">
        <CardContent className="flex flex-col items-center gap-6 py-8 text-center">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Send className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">smPosting</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to publish across your social accounts.
            </p>
          </div>
          {error && (
            <p className="w-full rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.login_failed}
            </p>
          )}
          <Button
            size="lg"
            className="w-full"
            onClick={() => {
              // Full-page navigation, not fetch/popup — the backend redirects to
              // Google and back, and no token ever reaches this page's JS.
              window.location.href = `${API_URL}/api/login/google?next=${encodeURIComponent(next)}`;
            }}
          >
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
