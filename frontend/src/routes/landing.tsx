import { useEffect } from "react";
import { Link } from "react-router";
import logo from "@/assets/postuploaders-c-badge-1024.png";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { LEGAL_LINKS } from "@/components/legal-layout";
import { PlatformMark } from "@/components/platform-mark";
import { CONTACT_EMAIL } from "@/lib/legal";

const PLATFORMS = [
  {
    platform: "YOUTUBE",
    name: "YouTube",
    description: "Upload the videos you choose to your channel and follow their processing status.",
  },
  {
    platform: "INSTAGRAM",
    name: "Instagram",
    description: "Publish posts to the Instagram account you connect.",
  },
  {
    platform: "FACEBOOK",
    name: "Facebook",
    description: "Publish posts to the Facebook Pages you manage.",
  },
  {
    platform: "THREADS",
    name: "Threads",
    description: "Publish posts to your Threads profile.",
  },
  {
    platform: "LINKEDIN",
    name: "LinkedIn",
    description: "Share posts to your LinkedIn account.",
  },
];

const STEPS = [
  {
    title: "Connect your accounts",
    description: "Sign in with Google, then connect the social accounts you want to publish to.",
  },
  {
    title: "Create a post once",
    description: "Write your caption, add images or video, and pick the platforms to send it to.",
  },
  {
    title: "Publish now or schedule it",
    description:
      "postUploaders sends it to each platform at the time you choose and shows the status.",
  },
];

// Public home for signed-out visitors. Google and Meta app reviewers open
// this URL, so it has to say what the app does and link the legal pages.
export function LandingPage() {
  useEffect(() => {
    document.title =
      "postUploaders · Publish to YouTube, Instagram, Facebook, Threads and LinkedIn";
  }, []);

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logo} alt="" className="size-8 rounded-lg" />
            <span className="font-semibold tracking-tight">postUploaders</span>
          </Link>
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Social publishing workspace
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Publish to YouTube, Instagram, Facebook, Threads and LinkedIn from one place.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            postUploaders is a publishing tool for creators, teams and agencies. Connect your
            accounts, write a post once, and send it to every platform you choose, now or on a
            schedule.
          </p>
          <div className="mt-8 max-w-xs">
            <GoogleSignInButton />
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
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
          </div>
        </section>

        <section className="border-y bg-background">
          <div className="mx-auto max-w-5xl px-5 py-14 sm:px-8">
            <h2 className="text-2xl font-semibold tracking-tight">Where it publishes</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              postUploaders posts through each platform's official API, using only the access you
              grant. You can disconnect an account, or revoke access on the platform, at any time.
            </p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORMS.map((item) => (
                <li key={item.platform} className="flex gap-4 rounded-2xl border p-5">
                  <PlatformMark platform={item.platform} />
                  <div>
                    <h3 className="font-medium">{item.name}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-14 sm:px-8">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-sm font-medium text-background">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-medium">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-5xl px-5 pb-14 sm:px-8">
          <div className="rounded-2xl border bg-background p-6 sm:p-8">
            <h2 className="text-lg font-semibold tracking-tight">How we use your Google account</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
              You sign in to postUploaders with Google. If you connect YouTube, we use that
              permission only to upload the videos you choose and to read your channel's name and ID
              and the processing status of videos we uploaded. postUploaders's use of information
              received from Google APIs adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. See our{" "}
              <a href="/privacy#google" className="text-foreground underline">
                Privacy Policy
              </a>{" "}
              for details.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="hover:text-foreground">
                {link.label}
              </Link>
            ))}
          </nav>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground">
            {CONTACT_EMAIL}
          </a>
        </div>
      </footer>
    </div>
  );
}
