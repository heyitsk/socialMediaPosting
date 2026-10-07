import { ArrowUpRight } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import logo from "@/assets/postuploaders-c-badge-1024.png";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
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
    <main className="relative min-h-svh overflow-hidden bg-muted/30">
      <div
        className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-primary/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-32 size-[28rem] rounded-full bg-primary/5 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative mx-auto flex min-h-svh w-full max-w-6xl items-center px-5 py-8 sm:px-8 lg:px-10">
        <div className="grid w-full overflow-hidden rounded-3xl border bg-background shadow-xl lg:grid-cols-2">
          {/* Product introduction */}
          <section className="relative hidden min-h-[560px] overflow-hidden bg-foreground p-10 text-background lg:flex lg:flex-col lg:justify-between xl:p-14">
            <div
              className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-background/10 blur-3xl"
              aria-hidden="true"
            />

            <div className="relative flex items-center gap-3">
              <img src={logo} alt="" className="size-10 rounded-xl shadow-sm" />
              <span className="text-lg font-semibold tracking-tight">postUploaders</span>
            </div>

            <div className="relative max-w-lg">
              <p className="text-sm font-medium uppercase tracking-[0.16em] text-background/55">
                Social publishing workspace
              </p>

              <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
                Publish your social content from one workspace.
              </h1>

              <p className="mt-5 max-w-md text-base leading-7 text-background/65">
                Connect your social accounts, create posts, and keep your publishing activity
                organized in one place.
              </p>
            </div>

            <p className="relative text-xs text-background/40">Simple publishing. One workspace.</p>
          </section>

          {/* Sign in */}
          <section className="flex min-h-[560px] items-center justify-center p-6 sm:p-10 lg:p-12">
            <div className="w-full max-w-sm">
              <CardContent className="p-0">
                <div className="mb-8 text-center">
                  <img src={logo} alt="" className="mx-auto mb-5 size-12 rounded-2xl shadow-md" />

                  <p className="text-sm font-medium text-muted-foreground">Welcome to</p>

                  <h2 className="mt-1 text-3xl font-semibold tracking-tight">postUploaders</h2>

                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Sign in to access your social publishing workspace.
                  </p>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 p-3.5 text-sm leading-5 text-destructive"
                  >
                    {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.login_failed}
                  </div>
                )}

                <Button
                  size="lg"
                  className="h-12 w-full rounded-xl text-sm font-medium shadow-sm"
                  onClick={() => {
                    // Full-page navigation, not fetch/popup — the backend redirects to
                    // Google and back, and no token ever reaches this page's JS.
                    window.location.href = `${API_URL}/api/login/google?next=${encodeURIComponent(next)}`;
                  }}
                >
                  <span className="flex size-6 items-center justify-center rounded-md bg-background text-sm font-semibold text-foreground">
                    G
                  </span>
                  Continue with Google
                  <ArrowUpRight className="ml-auto size-4" aria-hidden="true" />
                </Button>

                <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
                  By continuing you agree to our{" "}
                  <Link to="/terms" className="underline hover:text-foreground">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link to="/privacy" className="underline hover:text-foreground">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </CardContent>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
