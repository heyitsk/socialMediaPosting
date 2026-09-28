import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
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
    <div className="flex min-h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">smPosting</h1>
      {error && (
        <p className="text-sm text-destructive">
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.login_failed}
        </p>
      )}
      <Button
        onClick={() => {
          // Full-page navigation, not fetch/popup — the backend redirects to
          // Google and back, and no token ever reaches this page's JS.
          window.location.href = `${API_URL}/api/login/google?next=${encodeURIComponent(next)}`;
        }}
      >
        Sign in with Google
      </Button>
    </div>
  );
}
