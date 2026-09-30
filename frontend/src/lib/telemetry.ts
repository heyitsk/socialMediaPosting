import type { Faro } from "@grafana/faro-web-sdk";

// Grafana Faro (websitePlan.md §14.7): JS errors, Web Vitals, sessions, and a
// trace per API call that the backend continues — the API is same-origin, so
// fetch calls get a traceparent header by default. Off unless VITE_FARO_URL
// (the Grafana Cloud collector URL, public by design) is set at build time;
// the SDK is then never downloaded and every helper below is a no-op.
const FARO_URL = import.meta.env.VITE_FARO_URL as string | undefined;

let faro: Faro | undefined;
// View and user set before the SDK finished loading, applied once it has.
let pendingView: string | undefined;
let pendingUserId: string | null | undefined;

export async function initTelemetry() {
  if (!FARO_URL) return;
  const [{ getWebInstrumentations, initializeFaro }, { TracingInstrumentation }] =
    await Promise.all([import("@grafana/faro-web-sdk"), import("@grafana/faro-web-tracing")]);
  faro = initializeFaro({
    url: FARO_URL,
    app: {
      name: "smposting-frontend",
      version: import.meta.env.VITE_APP_VERSION ?? "dev",
      environment: import.meta.env.MODE,
    },
    instrumentations: [...getWebInstrumentations(), new TracingInstrumentation()],
  });
  if (pendingView) trackView(pendingView);
  if (pendingUserId !== undefined) setTelemetryUser(pendingUserId);
}

// Ids in the path become ":id", so views group in Grafana.
const ID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

export function trackView(pathname: string) {
  if (!faro) {
    pendingView = pathname;
    return;
  }
  faro.api.setView({ name: pathname.replace(ID_SEGMENT, "/:id") });
}

// Id only — no email or name in telemetry.
export function setTelemetryUser(userId: string | null) {
  if (!faro) {
    pendingUserId = userId;
    return;
  }
  if (userId) faro.api.setUser({ id: userId });
  else faro.api.resetUser();
}

// What the user did just before something failed. Values must be strings.
export function trackEvent(name: string, attributes?: Record<string, string>) {
  faro?.api.pushEvent(name, attributes);
}
