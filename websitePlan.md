# 🚀 Social Media Auto-Poster SaaS — Product & Technical Specification (`websitePlan.md`)

> **Product Vision**: A full-fledged multi-tenant SaaS application allowing users to publish and schedule text, photo, video, and carousel content across multiple social media platforms simultaneously.  
> **Architecture**: Bun + Hono backend API + Vite/React frontend, PostgreSQL via Prisma (Docker-hosted) + **one independently-versioned n8n workflow per platform**, run in **n8n queue mode** (Main + autoscaled Workers behind Redis) for horizontal scale, + S3 Media Storage.  
> **Active V1 Target Platforms**: Facebook Pages, Instagram, Threads, YouTube (Shorts & Videos), Pinterest.  
> **Deferred to V2**: Reddit, X (Twitter), LinkedIn, Tumblr, Blogger.
>
> **Note on Pinterest**: pulled forward from the original V2 deferral list (Sep 2026) — business account access and Developer app registration are in progress. Its Developer App is currently pending Pinterest's manual review (submitted Sep 2026); see §5 for why this blocks the integration the same way YouTube's audit gate does.
>
> **Note on stack (finalized Sep 10, 2026)**: earlier drafts of this doc called the stack "MERN" loosely (Node/Express + React); that's now superseded — see the **Backend Tech Stack** table in §1 for the actual finalized runtime/framework/DB/queue choices and the reasoning behind each. The Section 7 schema remains relational PostgreSQL either way.

---

## 📑 Table of Contents

1. [High-Level System Architecture](#1-high-level-system-architecture)
2. [OAuth 2.0 Integration Strategy (User Experience)](#2-oauth-20-integration-strategy-user-experience)
3. [Media Management & S3 Storage Strategy](#3-media-management--s3-storage-strategy)
4. [Post Composer & Pre-Posting Validation Rules](#4-post-composer--pre-posting-validation-rules)
5. [n8n Execution Engine & Webhook Architecture](#5-n8n-execution-engine--webhook-architecture)
6. [Notification & Reporting System](#6-notification--reporting-system)
7. [Database Schema Design](#7-database-schema-design)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [App Authentication, Sessions & Workspaces](#9-app-authentication-sessions--workspaces)
10. [Multi-Posting (Post Groups) & Scheduling](#10-multi-posting-post-groups--scheduling)

---

## 1. High-Level System Architecture

The application decouples the user-facing web interface and scheduling logic from the platform API execution logic. The Bun/Hono backend owns **all** orchestration — auth, credential storage, rate limiting, and fan-out. n8n holds **no orchestration logic of its own**: it is a fleet of thin, per-platform, stateless workflows triggered by webhook, running in **queue mode** so it can scale horizontally under Kubernetes.

> Multi-platform parallelism is achieved by the **backend firing N parallel webhook calls** (one per selected platform, via `Promise.allSettled`) — not by branching inside a single n8n workflow. This keeps each platform's logic, versioning, retries, and rate limits isolated.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 SAAS FRONTEND (REACT)                                  │
│   - User Auth (Google / Email)            - Post Composer & Media Cropper              │
│   - Integration Settings (Connect Buttons)- Post History, Reports & Error Center       │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          SAAS BACKEND (NODE/EXPRESS API)                               │
│   - OAuth 2.0 Handlers (Meta, Google)     - Post Validation & Database (PostgreSQL)    │
│   - Encrypted Credential Vault            - Per-Platform Rate Limiter (token bucket)   │
│   - S3 Media Upload Manager               - Fan-Out Dispatcher (Promise.allSettled)    │
│   - Result Aggregator & Callback Receiver - decrypts token + builds payload PER CALL   │
└──────────────────────┬─────────────────────────────────────────▲───────────────────────┘
                       │ 1. N parallel POST webhook calls          │ 4. N callback POSTs
                       │    (one per platform; payload holds       │    (one per platform;
                       │    only that platform's data + token)     │    SUCCESS/FAILED + id)
                       ▼                                          │
┌───────────────────────────────────────────────────────────────┴────────────────────────┐
│                    n8n — ONE WORKFLOW PER PLATFORM, QUEUE MODE (K8S)                    │
│                                                                                          │
│  n8n-main (1+ replicas)          Redis (job queue)         n8n-worker (autoscaled/KEDA) │
│  - receives webhook              - holds queued jobs        - pulls job + workflow      │
│  - pushes {workflowId, payload}    {workflowId, payload}      definition from Postgres  │
│    to Redis, returns 202                                     - executes it, POSTs        │
│                                                                 result back to backend    │
│                                                                                          │
│  Workflow definitions shared via Postgres:                                              │
│  facebook-poster | instagram-poster | threads-poster | youtube-poster                   │
│  (each independently versioned; FB node/IG 2-step/Threads 2-step/S3→YT upload)          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Why queue mode + K8s**: `n8n-main` and `n8n-worker` are stateless copies of the same n8n app — neither "owns" a workflow. Workflow JSON lives centrally in Postgres. `n8n-main` is the receptionist: it accepts the webhook and pushes `{workflowId, payload}` onto Redis. Any free `n8n-worker` picks the job up, reads the workflow definition, and executes it. KEDA autoscales the number of worker replicas based on Redis queue depth, so throughput scales with load rather than being capped by a single sequential queue. Workers need shared storage (S3) for any binary data touched mid-workflow, since local worker disk isn't shared across replicas.

**The real ceiling is platform API rate limits** (Meta Graph API, YouTube quotas), not n8n/K8s compute — this is why the rate-limiter layer lives in the backend *before* dispatch, not inside n8n.

### Backend Tech Stack (finalized Sep 10, 2026)

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | **Bun** | Native S3 client, native (experimental) Redis client, fast startup; Prisma driver-adapter compatibility confirmed firsthand on a prior project. |
| Web framework | **Hono** over Elysia/Encore | Elysia is Bun-only in spirit (Eden client, perf claims tied to Bun's engine); Hono gives the same modern DX (Zod validation, OpenAPI, native WS/SSE) while staying runtime-portable (Bun/Node/Deno/Workers) — a hedge given the backend also leans on Node-ecosystem packages (BullMQ, AWS-style SDKs) that are more battle-tested under Node than Bun. Encore ruled out outright — it wants to own infra provisioning (its own Postgres/Pub-Sub/cron abstractions), which conflicts with the self-managed Docker Postgres + Redis already chosen here. |
| Database / ORM | **Docker-hosted PostgreSQL + Prisma**, via a driver adapter (`@prisma/adapter-pg`) rather than Prisma's default Rust query-engine binary | Confirmed working under Bun firsthand; the driver-adapter path avoids native-binary/Bun edge cases entirely by talking to Postgres through a pure-JS driver. |
| Frontend | **Vite + React** | Plain SPA, calls the Hono API directly — no SSR/full-stack framework needed since the backend already owns real long-running processes (job queue, SSE server) that don't fit a serverless/edge-first framework's request model anyway. |
| Background job queue | **BullMQ + ioredis** (confirmed primary, Sep 11 2026) | Drives the Threads/Pinterest sliding-window token-refresh scheduler and dispatch retries — a reliability-critical piece, best served by BullMQ's years of production hardening (stall recovery, crash-safe retries) rather than a ~1-year-old, single-maintainer alternative. **Spike test passed** — see "BullMQ/ioredis-under-Bun Spike Test Results" below; the risk flagged on Sep 10 is resolved. |
| Job queue fallback | **`bunqueue`** (SQLite/Postgres-backed, BullMQ-compatible API, no Redis) — evaluated, **not needed**; the primary spike test passed cleanly, so this is kept only as a documented escape hatch (its BullMQ-compatible API keeps migration cost low) rather than an active contingency. |
| Pub/Sub (live updates) | **Bun's native Redis client** | Good fit for the simple publish/subscribe traffic behind the SSE/WebSocket live-status layer (§6). Bun's own docs mark this feature **experimental** — wrap it behind a thin interface so it can be swapped for `ioredis`'s pub/sub (already in the dependency tree via BullMQ) with a one-file change if reliability issues show up, rather than hard-wiring it everywhere. |
| Object storage | **S3**, via Bun's native S3 client (Zig-based, no `@aws-sdk/client-s3` dependency needed) | Covers the backend's own media handling (composer uploads, presigned URLs). **Evaluated and rejected UploadThing** as an alternative — it's a DX wrapper built *on top of* S3, not a replacement (no BYO-bucket, closed-source backend, weaker compliance posture), and it offers no capability the S3→YouTube streaming-relay fix (§3) actually needs — that fix is a plain Node.js streaming Code node running *inside n8n's own process* (not Bun, not our backend), so it only needs a URL it can issue a streaming GET against — which a presigned S3 URL already provides regardless of which client generated it. |

### BullMQ/ioredis-under-Bun Spike Test Results (Sep 11, 2026)

A standalone Bun scaffold (`trialBun/`) exercised the exact reliability properties BullMQ was chosen for (§1 table above), against a local Redis. All scenarios passed:

| Scenario | Result |
|----------|--------|
| Round-trip (add job → worker processes → `job.waitUntilFinished` resolves) | ✅ |
| Crash recovery (`SIGKILL` a worker mid-job; a second worker's stall detection picks it up and completes it) | ✅ |
| Repeatable jobs (`upsertJobScheduler`/`removeJobScheduler` — the mechanism behind the §6 video-status poller) | ✅ |
| Retry + exponential backoff (fail twice, succeed on 3rd, increasing delay between attempts) | ✅ |
| Concurrency (`concurrency: 5`, 20 jobs, no cross-job data contamination) | ✅ |
| Graceful shutdown (`worker.close()` mid-job lets the in-flight job finish rather than dropping it) | ✅ |
| `QueueEvents` (`completed`/`failed`/`progress` delivered correctly) | ✅ |

**Implementation pattern to carry into the real backend**: pass a plain `{ host, port }` options object to each `Queue`/`Worker`/`QueueEvents` instance rather than one shared `ioredis` instance — BullMQ then sets `maxRetriesPerRequest` correctly per client type on its own, and this is also BullMQ's own recommendation (don't share one blocking connection across multiple Worker/QueueEvents instances).

**Conclusion**: `ioredis` under Bun behaves correctly for every property the job-queue layer depends on (§5's video poller, §7's token-refresh scheduler, dispatch retries). No further verification needed before scaffolding the real backend; `bunqueue` fallback is not being activated.

---

## 2. OAuth 2.0 Integration Strategy (User Experience)

Users **never** manually copy/paste Developer App IDs, Secrets, or Access Tokens. The SaaS app uses standard OAuth 2.0 flows to authenticate users, one flow per platform.

### User Flow: "Connect Account"
1. In the SaaS Dashboard under **Integrations**, the user clicks `[Connect Facebook / Instagram]`, `[Connect Threads]`, `[Connect YouTube]`, or `[Connect Pinterest]`.
2. The web app redirects (or opens a popup) to the platform's official OAuth consent screen.
3. The user authorizes the SaaS application to manage their accounts.
4. The platform redirects back to the SaaS backend callback URL (`/api/auth/{platform}/callback`) with an authorization `code`.

### Backend OAuth Exchange & Token Harvesting Flow (general shape, all platforms)

```
User Click ──> OAuth Consent ──> Backend Callback (with Code) ──> Exchange Code for Token ──> Fetch IDs ──> Save Encrypted to DB
```

**What runs where** (same split for every platform below): steps 1-3 above happen entirely on the platform's own servers — we never see the user's password, and there's no code to write for the consent screen itself, just the URL that opens it and a callback route to catch the redirect. Everything from "Exchange Code for Token" onward is our backend calling the platform's API **server-to-server** (no browser involved) — code exchange, long-lived/refresh-token handling, ID harvesting, encryption, and storage are all backend work.

### 2.1 Facebook (Meta Graph API)

- **Authorization URL**: `https://www.facebook.com/v21.0/dialog/oauth`
- **Scopes**: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`, `business_management`
- **Code → short-lived token**: `GET https://graph.facebook.com/v21.0/oauth/access_token?client_id&redirect_uri&client_secret&code`
- **Short-lived → long-lived (60-day) exchange**: `GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token={short_token}`
- **Account harvesting**: `GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,name}` using the long-lived **user** token — returns the Facebook Page ID + Page access token, and the linked Instagram Business Account ID (see §2.2).
- **Refresh shape**: `NONE` — the returned Page access token is effectively non-expiring as long as the user token/session stays valid; no background refresh job needed (§7).
- **Gotcha**: `pages_manage_posts` etc. are restricted permissions — requires Meta **App Review** before working for any account beyond added testers/admins.

### 2.2 Instagram — **two independent connection methods** (confirmed built Sep 17, 2026)

Unlike every other platform in this section, Instagram can be connected **two different ways**, and both are implemented (`lib/facebook.ts`+`routes/auth/facebook.ts` for the first, `lib/instagram.ts`+`routes/auth/instagram.ts` for the second). They can both end up pointing at the *same* physical Instagram Business/Creator account, but each issues a token valid on a **different Graph API host** — this distinction is load-bearing, not cosmetic (see the `ConnectedAccounts.connection_method` note in §7 and the `graph_host` field in §5's Instagram payload).

**Method A — Facebook Login (`connectionMethod: FACEBOOK_PAGE`)**
- Rides entirely on the Facebook OAuth dialog in §2.1 — **no separate consent screen**. Requires the user's Instagram account to be a Business/Creator account linked to a Facebook Page.
- **Additional scopes**: `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments` (optional, for later comment moderation)
- **Harvesting**: same `/me/accounts` call as §2.1, using its `instagram_business_account{id,name}` field — no separate token; the Instagram row is stored with the **same Page access token** as the Facebook Page it's linked to.
- **Token host**: valid only against `graph.facebook.com`.
- **Refresh shape**: `NONE`, same as Facebook — Page token is effectively non-expiring.
- **Gotcha**: `instagram_content_publish` is a restricted permission requiring **App Review + Business Verification** — file this alongside the Pinterest/YouTube review dependencies already tracked in §5.

**Method B — Instagram Login (`connectionMethod: INSTAGRAM_LOGIN`)**
- A genuinely separate Meta OAuth product — no Facebook Page in the loop at all. User authorizes directly against Instagram.
- **Authorization URL**: `https://www.instagram.com/oauth/authorize`
- **Scopes**: `instagram_business_basic`, `instagram_business_content_publish`
- **Code → short-lived token**: `POST https://api.instagram.com/oauth/access_token` (form-urlencoded: `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`)
- **Short-lived → long-lived (60-day) exchange**: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret&access_token={short_token}`
- **Harvesting**: `GET https://graph.instagram.com/me?fields=user_id,username` using the long-lived token.
- **Token host**: valid only against `graph.instagram.com` — **not** interchangeable with a Method A token, even for the same underlying account.
- **Refresh shape**: `SLIDING_WINDOW` — unlike Threads' "renew in place" call shape, no refresh-endpoint call is wired up yet; the dispatch layer (§5) fails fast with a clear error if the token is within 24h of `token_expires_at`, rather than proactively refreshing. A background refresh job is a follow-up, not yet built.
- **Gotcha (bug found + fixed Sep 17, 2026)**: because both methods can resolve to the same `platform_account_id`, the original `ConnectedAccounts` unique key (`user_id, platform, platform_account_id`) let connecting via one method silently overwrite the other method's token — a Method B connection would clobber a Method A row with a token that only works on a different host, producing `OAuthException 190` at dispatch time. Fixed by adding `connection_method` to the unique key (§7) so both can coexist as separate rows; the frontend surfaces a "duplicate account, connected via two methods" toast when this happens rather than hiding it.

### 2.3 Threads (Threads API — separate Meta surface from Graph API) — **implemented Sep 21, 2026, unblocked Sep 23, 2026**

> **Update (Sep 23, 2026):** the Sep 22 redirect-URI save blocker (§2.3 changelog below) cleared — the Meta App Dashboard now accepts the Valid OAuth Redirect URI for the "Access the Threads API" use case, and a real Threads account has connected end-to-end through this flow for the first time. See the changelog entry below for what testing this surfaced (a frontend bug, unrelated to the OAuth code itself) and the new `CAROUSEL` media type built the same day.

Built as `lib/threads.ts`/`routes/auth/threads.ts`, on the same Meta App as §2.1's `META_APP_ID` but with its own `THREADS_APP_ID`/`THREADS_APP_SECRET` credential pair (its own product, own OAuth dialog) — same relationship §2.2 Method B has to §2.1. Threads posting is tied to the authenticated user's own token (`/me/threads`) — unlike Facebook/Instagram there's no Page/Business ID to resolve, so `ConnectedAccounts.connection_method` gets a third value, `THREADS_LOGIN`, purely for consistency with the Instagram naming — Threads only ever has this one connection path.

- **Authorization URL**: `https://threads.net/oauth/authorize`
- **App config**: requires adding the "Threads API" use case to the Meta app — separate from the "Facebook Login for Business" use case used in §2.1/§2.2. The connecting Meta account must be added as a **Threads tester** on the app until it clears review.
- **Scopes actually requested**: `threads_basic`, `threads_content_publish` (the optional insights/replies scopes from the original draft aren't requested — not needed for posting).
- **Code → short-lived token**: `POST https://graph.threads.net/oauth/access_token` (`client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`) — valid ~1 hour.
- **Short-lived → long-lived (60-day) exchange**: `GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret&access_token={short_token}`
- **Refresh before expiry**: `GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token={long_token}` — extends another 60 days; token must be ≥24h old to refresh. `lib/threads.ts` exports `refreshLongLivedToken()` for this, but like Instagram Login (§2.2 Method B) there's no background job calling it yet — the dispatch layer just fails fast if `token_expires_at` is within 24h, same `TOKEN_EXPIRY_BUFFER_MS` pattern as Instagram.
- **Refresh shape**: `SLIDING_WINDOW` — renews the *same* access token in place (no separate `encrypted_refresh_token`); a scheduled backend job must call this proactively before the 60-day window closes (§7).
- **Gotcha**: this is its own token, not reused from §2.1/§2.2 — a distinct `ConnectedAccounts` row/refresh cycle from the Meta Page-token model.

### 2.4 YouTube (Google OAuth 2.0 / YouTube Data API v3)

- **Authorization URL**: `https://accounts.google.com/o/oauth2/v2/auth`
- **Scopes**: `https://www.googleapis.com/auth/youtube.upload` (minimum for posting)
- **Required consent-request params**: `access_type=offline` (or no refresh token is issued at all) + `prompt=consent` (forces Google to re-issue a refresh token even on repeat consent — otherwise only granted on the very first authorization, which silently breaks reconnect flows).
- **Code → tokens**: `POST https://oauth2.googleapis.com/token` (`code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`) → `access_token` (~1hr) + `refresh_token` (long-lived, no fixed expiry).
- **Refresh**: `POST /token` with `grant_type=refresh_token&refresh_token={token}` — no re-consent needed, called right before use.
- **Refresh shape**: `ON_DEMAND` — no background job; backend exchanges `encrypted_refresh_token` for a fresh access token immediately before each upload call (§7).
- **Gotcha**: OAuth itself works fine in dev/testing regardless of the separate **upload-audit gate** already documented in §5 case 3 — that gate caps upload *volume*, not the OAuth connect flow.
- **Implemented Sep 23, 2026** (`lib/youtube.ts`, `routes/auth/youtube.ts`, `service/youtube-token.ts`): own `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` ("Web application" OAuth client in a Google Cloud project with YouTube Data API v3 enabled), redirect URI `<PUBLIC_BACKEND_URL>/api/auth/youtube/callback`, new `ConnectionMethod.YOUTUBE_LOGIN`. Deviations from the plan above:
  - **Scopes are `youtube.upload` + `youtube.readonly`**, not upload alone — upload-only can't read anything back, and the backend needs `channels.list?mine=true` at connect time (resolves channel id/title → `platform_account_id`/`account_name`) and `videos.list?part=status` for the post-upload poller (§6).
  - **Callback rejects two silent-failure cases** with their own frontend error toasts: Google's granular consent letting the user untick the upload scope (`youtube_connect_missing_scope` — would otherwise "connect" and then 403 on every post), and a Google account with no YouTube channel (`youtube_connect_no_channel`).
  - **`ON_DEMAND` refresh** lives in one function, `getFreshYouTubeAccessToken()`: reuses the stored access token while it has >5 min left (no network call), otherwise exchanges the refresh token and persists the new access token + `token_expires_at`. Called from both the dispatch path and the video-status poller. The refresh token itself is never rotated.
  - **Revocation handling**: an `invalid_grant` from Google (user revoked access, password change, or the 7-day refresh-token expiry Google applies while the consent screen is in **Testing** mode) nulls `encrypted_refresh_token`; `GET /api/integrations` reports `needsReconnect: true` for an `ON_DEMAND` row with no refresh token, which drives the dashboard's existing Reconnect button.
  - **Testing-mode gotchas**: every Google account used to connect must be added under Google Auth Platform → Audience → Test users (else `Error 403: access_denied`), and connections expire weekly until the app is published/verified. Unaudited projects also can only upload **private** videos, whatever `privacyStatus` is sent — another reason to file the §5 case 3 audit early.

### 2.5 Pinterest (API v5)

- **Authorization URL**: `https://www.pinterest.com/oauth/`
- **Scopes**: `boards:read`, `boards:write`, `pins:read`, `pins:write`, `user_accounts:read`
- **Code → tokens**: `POST https://api.pinterest.com/v5/oauth/token`, HTTP Basic Auth (`app_id:app_secret`, base64), form body `grant_type=authorization_code&code&redirect_uri` → `access_token` (30-day expiry) + `refresh_token` (~365-day validity — verify at implementation time, Pinterest has changed this window before).
- **Refresh**: same endpoint, `grant_type=refresh_token&refresh_token={token}`.
- **Board resolution**: no auto-harvest step like Meta's `/me/accounts` — after connect, call `GET /v5/boards` and have the user pick a destination board (or default to their main board); Pinterest has no single "primary account" concept the way a Facebook Page does.
- **Refresh shape**: `SLIDING_WINDOW` — but unlike Threads, this one *consumes* `encrypted_refresh_token` to mint a brand-new access token (closer to Google's model) rather than renewing in place; same proactive scheduled job as Threads, different call shape inside it (§7).
- **Gotcha**: gated by the Developer App review + Trial-vs-Standard access split already documented in §5 case 4 — Trial access has materially lower rate limits even once OAuth is fully wired up.

---

## 3. Media Management & S3 Storage Strategy

All images and videos uploaded by users are stored in an **S3 Bucket**, accessed from the backend via **Bun's native S3 client** (see the Backend Tech Stack table in §1 — no `@aws-sdk/client-s3` dependency needed).

### Per-Platform Media Fitting (Crop / Pad / Preview) — planned Sep 23, 2026, not built

**Problem (seen in real testing across platforms):** the same photo/video posted to different platforms/surfaces renders differently, because each surface expects a different aspect ratio. A mismatch leads to one of three things: the platform **crops** it (subject cut off), **pads** it (black/white bars), or **rejects** it outright (Instagram errors on out-of-range ratios). Goal: every post fits its target surface cleanly, with the user in control.

**Reference targets** (re-verify against each platform's current docs at build time, since these change):

| Surface | Aspect ratio | Recommended size |
|---|---|---|
| IG feed / carousel | 4:5 – 1.91:1 (4:5 best) | 1080×1350 |
| IG / FB Story, IG Reels, YT Shorts | 9:16 | 1080×1920 |
| FB feed | 4:5 – 1.91:1 | 1080×1350 |
| LinkedIn | 1.91:1 – 4:5 | 1200×627 / 1080×1350 |
| Threads | flexible; 4:5 displays best | 1080×1350 |
| YouTube video | 16:9 | 1920×1080 |

Gotcha: Instagram crops **every carousel item to the first item's aspect ratio**, so the cropper must enforce one ratio across a carousel.

**Decisions:**
* **Not an LLM.** Resizing/cropping is deterministic work, and an LLM is slow, expensive and unreliable for it. Use `sharp` (images) and `ffmpeg` (video). "AI" is used only where it adds real value (smart crop placement, optional outpainting — see below).
* **Keep one master file and store per-platform crop settings, not copies.** The original upload stays untouched in S3. Each target (e.g. `INSTAGRAM/STORY`, `THREADS/POST`) stores only `{ x, y, w, h, mode: "crop" | "blur_pad" }` in relative 0–1 coordinates. It's non-destructive, so users can re-edit anytime, and the actual files are rendered on demand.
* **Smart default crop.** Images: `sharp`'s attention/entropy strategy (`position: sharp.strategy.attention`), `smartcrop.js`, or face detection. Video: center crop to start; subject-tracking reframing (MediaPipe AutoFlip-style) as a later upgrade for 16:9 → 9:16.
* **Per-platform preview grid + user adjust.** The composer shows how the media will look on each selected platform. Each tile opens a ratio-locked cropper (`react-easy-crop` or `Cropper.js`) so the user can drag/zoom. Stories/Reels/Shorts previews overlay a **safe zone** (the top and bottom ~14% are covered by platform UI).
* **Blurred-background padding instead of black bars.** When the user doesn't want to crop (e.g. a wide group photo into a 9:16 story), the media sits on a blurred, zoomed copy of itself. Easy in both `sharp` and `ffmpeg`.
* **Render in a worker at publish time.** A BullMQ job reads the master + crop settings, runs `sharp`/`ffmpeg`, writes each version to S3, and sends that version's URL to the platform's n8n workflow. Video rendering goes in its **own queue** (ffmpeg is CPU-heavy) and can later scale on queue depth via KEDA (§5), separately from the API.
* **Optional, later — generative outpainting** to extend backgrounds instead of cropping/padding. The results look great, but it costs real money and can invent strange details, so it's offered as a premium feature, not the default.

**Build order:**
1. **Now (pre-S3, works with today's public-URL input):** probe media dimensions before dispatch (`probe-image-size` for images, `ffprobe` on the URL for video), compare against each selected platform's allowed range, and warn in the composer (e.g. "This is 16:9 — Instagram Story will crop it"). Rough previews via CSS `object-fit: cover` on the hosted URL (no pixel reads, so no CORS issues).
2. **After S3 upload lands:** cropper UI + stored per-platform crop settings (new column/table keyed by post + platform + surface).
3. `sharp`/`ffmpeg` render worker + its own BullMQ queue; dispatch sends the rendered-version URLs.
4. Smart crop defaults, AutoFlip-style video reframing, optional outpainting.

### How S3 Solves the YouTube Binary Requirement vs. Meta Public URLs

| Platform | Required Format | S3 Solution |
|----------|-----------------|-------------|
| **Facebook / Instagram / Threads** | Publicly accessible URL | Backend generates direct public/presigned S3 URL (`https://bucket.s3.amazonaws.com/media/file.mp4`). Meta downloads directly from S3. |
| **YouTube Data API** | Binary File Stream (`data` field) | Inside n8n, the **AWS S3 Node** (or `HTTP Request` node set to *File* format) downloads the S3 video into n8n binary memory/disk, then passes it directly into the `YouTube` upload node. |

> ⚠️ **Known scaling gap — confirmed by real testing (Sep 2026), not yet fixed:** `youtube-poster`'s current `Download Video` → `Merge` → `Upload Video Binary` pattern fully downloads the video into n8n binary storage *before* a single byte is sent to YouTube — total time ≈ download time + upload time, not overlapped. Fine for small test clips, but for large user videos this adds real wall-clock latency and (until `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` is set — patched Sep 8 in the dev env) risked OOM-crashing the worker, since n8n holds binary data in memory by default. **The real fix is a streaming relay**, not a bigger box: replace the two `HTTP Request` nodes with a single **Code node that pipes the S3 GET response stream directly into the YouTube PUT request stream** (Node.js raw `http`/`https`, not the built-in HTTP Request node, which can't start its output until the full response lands) — bytes move S3→YouTube without ever being fully buffered in n8n, cutting transfer time roughly in half and removing the memory ceiling entirely. **Do this before launch supports real (non-test) video sizes** — revisit when building out Phase 3's YouTube workflow for production.
>
> **Note (Sep 10, 2026):** this fix is entirely independent of which storage client the *backend* uses (Bun's native S3 client, raw AWS SDK, or otherwise) — it's a Code node running *inside n8n's own Node.js process*, which only needs a URL it can issue a streaming GET against. A presigned S3 URL already satisfies that. UploadThing was evaluated as a possible object-storage alternative and rejected for this reason among others: it's a DX layer built on top of S3 (not a replacement), offers no capability this fix needs, and adds real downsides (no BYO-bucket, closed-source backend, weaker compliance posture) for zero gain here.

### Streaming-Relay Decision — planned for LinkedIn video, blocked on S3 (Sep 22, 2026; revised same day after the multi-part upload fix landed)

**Status: planned, not built.** `linkedin-poster.json` currently uses a `Download` → `Merge` → `Split Video Into Parts` → `Upload Binary` pattern (see §5's `linkedin-poster` notes / `history.md` Session 24) for its video branch, and the plain `Download` → `Merge` → `Upload Binary` pattern (no splitting needed) for images. Once an S3 bucket exists (Phase 2 roadmap item, currently blocking — no AWS account provisioned yet), the streaming-relay fix will be applied **video only**, one platform at a time, LinkedIn then YouTube (or vice versa — whichever's S3 wiring lands first). Decisions locked in:

* **Video only, not image.** Images are small enough that the download-then-upload pattern's extra latency/memory pass is negligible; the complexity and error-handling cost of a hand-rolled streaming Code node isn't worth it there. Video is where large files make the double I/O pass actually expensive, so that's the only branch getting rebuilt. Image branches (`LI Download Image` → `Merge Image Upload` → `LI Upload Image Binary`, and YouTube's equivalent) stay on the plain `HTTP Request` pattern.
* **Revised shape of the change (Sep 22 update):** the real, tested `linkedin-poster.json` now confirms LinkedIn caps every upload part at exactly 4,194,304 bytes (4 MiB) — `initializeUpload` always returns one `uploadInstructions` entry per part, each with its own `firstByte`/`lastByte` range, even for a single-part upload. That reshapes the relay from "one whole-file stream" into **one stream per part**, matched 1:1 to those ranges, which is a better fit for S3 anyway:
  * `Init Upload` (unchanged) returns `uploadInstructions[]`.
  * Replace `Split Video Into Parts` (which currently buffers the *entire* file via `getBinaryDataBuffer` before slicing) with a **Code node that loops over `uploadInstructions[]` and, per part, issues an S3 **ranged GET** (`Range: bytes=<firstByte>-<lastByte>`) and pipes that response directly into that part's PUT** (`sourceRes.pipe(putReq)`, raw Node `http`/`https`) — so at most one part's worth of bytes (≤4 MiB) is ever in memory at once, regardless of total video size. This removes the "buffer the whole file first" step entirely, not just the final PUT.
  * Each part's relay must still capture the PUT response's `ETag` header itself (a raw `http.request` doesn't get n8n's Full-Response-mode header capture for free) and emit it in order, so the existing `Collect Video Part ETags` node (or an equivalent step folded into the relay) can still build the `uploadedPartIds` array `finalizeUpload` needs — this part of the already-built multi-part logic carries over unchanged, only the *source* of each part's bytes changes from "slice of an in-memory buffer" to "ranged S3 stream."
  * S3 range requests are a native, well-supported feature (`Range` request header, `206 Partial Content` response) — no extra S3-side work needed beyond generating one presigned URL for the object and reusing it with a different `Range` header per part.
* **Follow redirects.** Raw `http`/`https` don't auto-follow redirects the way n8n's `HTTP Request` node (axios/got-based) does, and presigned S3 URLs/CDN fronts can redirect. Decided to build redirect-following into the relay Code node from the start rather than ship it broken and find out later — the added complexity is small (a loop re-issuing the GET against `location` on 3xx) compared to debugging a silent failure in production. Redirects must be re-issued with the same `Range` header each time.
* **Requires `NODE_FUNCTION_ALLOW_BUILTIN: "http,https,url"`** on the n8n container — Code node sandbox blocks `require()` of Node builtins by default. This is container-wide, so it loosens the sandbox for every workflow's Code nodes, not just the relay ones — acceptable since this is a self-hosted single-tenant n8n instance. (This is the one piece of the existing multi-part fix that streaming would newly require — the current buffered version deliberately avoids this via `this.helpers.getBinaryDataBuffer`/`prepareBinaryData`, which don't need it.)
* **Known remaining risks to handle in the implementation, not just the plan:** (1) manual error handling — no built-in retry/continue-on-fail UI like `HTTP Request` gets, so the Code node needs explicit `sourceRes`/`putReq` error listeners and non-2xx detection, per part; (2) no mid-execution binary preview in the n8n UI for debugging; (3) each part's `Content-Length` on the PUT side is always known upfront (`lastByte - firstByte + 1`), unlike the whole-file case — so the earlier chunked-transfer-encoding fallback concern mostly goes away for LinkedIn specifically, though it would still apply if this pattern is reused for YouTube's single-stream resumable upload.
* **Build order:** both `linkedin-poster.json` and `youtube-poster.json` get this fix eventually — LinkedIn's version is inherently part-based (per above), YouTube's resumable upload is a single stream with no server-imposed part size, so YouTube keeps the original whole-file relay design from the initial Sep 2026 decision. Deliberately not building either until a real S3 bucket + presigned URLs exist to test against, rather than relaying from arbitrary test URLs.

---

## 4. Post Composer & Pre-Posting Validation Rules

Before sending data to n8n, the Web App enforces platform-specific validation rules directly in the post composer to prevent API failures.

### Rule Validation Matrix

| Platform | Text Limit | Photo Constraints | Video Constraints | Carousel |
|----------|------------|-------------------|-------------------|----------|
| **Facebook** | 63,206 chars | JPG/PNG/WEBP | MP4/MOV, up to 4GB | Supported |
| **Instagram** | 2,200 chars, 30 hashtags | Aspect ratio: 1:1, 4:5, 9:16 | Reels: 9:16, max 90s (recommended) | Up to 10 items |
| **Threads** | 500 chars | JPG/PNG/WEBP | MP4/MOV, max 5 minutes | Up to 10 items |
| **YouTube** | Title: 100, Desc: 5,000 | N/A (Thumbnail only) | **Shorts**: 9:16, ≤60s + `#Shorts`<br>**Standard**: 16:9 landscape | Not Supported |

If a user selects an invalid combination (e.g. attempting to upload a 3-minute video to Instagram Reels or a text-only post to YouTube), the frontend composer disables the platform selector and displays a helpful guidance tooltip.

---

## 5. n8n Execution Engine, Queue Mode & Scaling

n8n holds **one workflow per platform** (`facebook-poster`, `instagram-poster`, `threads-poster`, `youtube-poster`), each independently versioned and each triggered by its own webhook. A post targeting multiple platforms results in **multiple parallel webhook calls from the backend**, not one call with a `platforms` array — this is a deliberate change from the earlier single-workflow design, made to keep per-platform logic, retries, and rate limits isolated.

### Backend Dispatch Logic (Bun/Hono)

```js
const results = await Promise.allSettled(
  post.platforms.map(platform =>
    dispatchToN8n(platform, buildPayloadFor(platform, post)) // decrypts + injects that platform's token only
  )
);
// results are then written to PostLogs and aggregated into the Post's overall status (see Section 6)
```

Rate limiting happens **here**, before dispatch — a token-bucket limiter per `(user, platform)` pair, sized to each platform's documented API quota (Graph API, YouTube Data API v3 units, etc.). A call that would exceed quota is queued/delayed by the backend rather than sent to n8n.

**Two distinct failure modes, confirmed by real testing (Sep 2026) — must be handled differently:**

1. **Measured quota throttling** — Graph API returns an `X-App-Usage` / `X-Page-Usage` header on *every* response with `call_count` / `total_time` / `total_cputime` percentages. Each n8n callback (Section 6) should pass these through so the backend's token bucket can throttle proactively as a Page approaches ~80-90% usage, instead of only reacting after a 400. This is what the token-bucket limiter above was designed for.
2. **Abuse/spam block (Meta error code `368`, e.g. subcode `1390008`)** — not a quota counter at all; it's Meta's trust-score heuristic reacting to a suspicious pattern (rapid repeat posts, identical content, unverified/dev-mode app). Retrying — even with backoff — does not reliably help and may prolong the block, which can last minutes to ~24h. The backend must treat this as a **circuit breaker**, not a queue-and-retry case: on `code: 368` / `type: OAuthException`, immediately pause further dispatch for that `(user, platform)` for a cooldown window and surface it in the Error Center as an actionable alert, rather than silently re-attempting.
3. **YouTube's upload-audit gate (pre-launch blocker, not a runtime case)** — confirmed by real testing (Sep 2026) that a `quotaExceeded` 429 on YouTube's resumable-upload init call can fire even while Cloud Console's own `Video Uploads per day` metric shows 0% usage. Google enforces a **separate, undocumented ceiling on the video-upload feature** for any project that hasn't completed their **Audit and Quota Extension** review — it doesn't appear anywhere in the standard quota dashboard, isn't adjustable by requesting a higher number there, and is **project-wide** (shared across every user of the SaaS), not per-user like everything else in this section. Unlike cases 1-2, there's no backend logic that works around this — it's a hard external dependency that must be resolved (audit request filed and approved, realistic lead time days-to-weeks) **before** the YouTube integration can support more than a handful of test uploads total, regardless of how many users the product has.
4. **Pinterest's Developer App review (pre-launch blocker, same shape as case 3)** — submitting the app (Sep 2026) required a live company/app URL and privacy policy link before Pinterest would even accept the form, then places the app in manual review ("your request is still being reviewed") with no in-dashboard status/ETA — confirmation only arrives by email. New apps default to **Trial access** (limited scopes/rate limits) regardless of outcome; reaching **Standard Access** for production traffic needs a separate review after that. Same implication as the YouTube gate: this is an external dependency with unknown lead time, not something the backend can work around, and it blocks `pinterest-poster` beyond a handful of test posts until it clears.

> **Note (Sep 16, 2026):** the schema below is the aspirational full design. The first real implementation (`backend/src/service/n8n.ts` dispatching to `facebook-poster.json`, confirmed working end-to-end) is deliberately simpler — no `youtube_metadata` block (Facebook-only so far) and `token` is shaped `{ page_id, access_token }` rather than the IG example below. A `callback_url` field (pointing at `${PUBLIC_BACKEND_URL}/api/webhooks/n8n-callback`) is also sent per-call rather than assumed, since it's what each workflow's callback node actually reads. This will converge back toward the full schema as more platforms get wired up.
>
> **Note (Sep 17, 2026):** Instagram is now the second platform actually wired to the backend (`buildInstagramPayload`/`dispatchInstagramToN8n` in `service/n8n.ts` → `instagram-poster.json`). Its real `token` shape is `{ ig_business_id, access_token, graph_host }` — `graph_host` is the one addition beyond what §2.2 alone would suggest: since an Instagram token's validity depends on *which OAuth product connected it* (`graph.facebook.com` for Facebook Login, `graph.instagram.com` for standalone Instagram Login — see §2.2), the backend resolves that once via `GRAPH_HOST[connectedAccount.connectionMethod]` and ships the result as plain data in the payload. `instagram-poster.json`'s HTTP nodes build every URL as `graph_host + '/v23.0/' + ig_user_id + '/...'` — n8n never decides the host itself, it only ever echoes back what the backend told it. `media_type` for Instagram is sent as the raw Prisma enum value (`IMAGE`/`CAROUSEL`/`REELS`/`STORIES`) — no `PHOTO`/`MULTI_PHOTO` renaming like Facebook's, since `instagram-poster.json`'s Switch node was built to match those values verbatim.
>
> **Note (Sep 21, 2026):** Threads is now the third platform wired to the backend (`buildThreadsPayload`/`dispatchThreadsToN8n` in `service/n8n.ts` → `threads-poster.json`). Its `token` shape is the simplest of the three — just `{ access_token }`, no id/host field at all, since every Threads call target is the caller's own `/me/threads` (§2.3). `media_type` is sent as the raw Prisma enum value (`TEXT`/`IMAGE`/`VIDEO`), matching `threads-poster.json`'s Switch node verbatim, same convention as Instagram's. Only `TEXT`/`IMAGE`/`VIDEO` are accepted for Threads — `CAROUSEL`/`REELS`/`STORIES` are rejected by `posts.ts`'s `SUPPORTED_MEDIA_TYPES` before ever reaching n8n.

### Webhook Payload Schema (Sent from Backend to n8n) — one call per platform

```json
{
  "post_id": "pst_883920",
  "user_id": "usr_4492",
  "platform": "instagram",
  "content": "Check out our latest product launch! 🚀",
  "media_type": "VIDEO",
  "media_urls": ["https://s3.amazonaws.com/my-bucket/videos/vid_001.mp4"],
  "youtube_metadata": {
    "title": "Product Launch 2026 #Shorts",
    "description": "Full details on our site!",
    "privacy": "public"
  },
  "token": {
    "ig_business_id": "17841400987654321",
    "access_token": "EAAX..."
  }
}
```

> Only the `token` block relevant to `platform` is ever included — credentials are passed per-call and never stored inside n8n itself.

### Per-Platform n8n Workflow (same shape as before, just no longer branched together)
* **`facebook-poster`**: `HTTP Request` node (`/feed`, `/photos`, `/videos`, or the split-upload+`/feed` flow for `MULTI_PHOTO`) — not the typed `Facebook Graph API` node, since its `Credential` field can't take a per-call dynamic token; access token is passed as a query param from the webhook payload instead. Testing status (Sep 2026): `TEXT`, `PHOTO`, `VIDEO`, and `MULTI_PHOTO` (carousel) all confirmed working end-to-end after token rotation — carousel's multi-upload-then-attach flow was re-verified once the earlier rate limit cleared and posts correctly.
* **`instagram-poster`**: 2-Step Flow — `POST {graph_host}/{ig_business_id}/media` (create container) ➔ **Wait Node** (5-10s) ➔ `POST {graph_host}/{ig_business_id}/media_publish`. Every URL is built from `graph_host` in the webhook payload (see §5 Sep 17 note above), not a hardcoded host — the same workflow serves both Facebook-Login-connected and Instagram-Login-connected accounts. Callback nodes send the `x-callback-secret` header (added Sep 17, matching `facebook-poster`'s pattern from Session 18).
* **`threads-poster`**: 2-Step Flow — `POST https://graph.threads.net/v1.0/me/threads` (create container) ➔ **Wait Node** (5s text / 10s image / 10s carousel / 60s video) ➔ `POST .../me/threads_publish`. Wired to the backend Sep 21, 2026 (§2.3); callback nodes gained the `x-callback-secret` header the same day, matching `facebook-poster`/`instagram-poster`. **`CAROUSEL` added Sep 23, 2026**: same split-item-containers → aggregate → parent-container pattern as `instagram-poster`'s carousel (child containers created with `is_carousel_item=true`, combined via `media_type=CAROUSEL&children=id1,id2,...`) — image-only for now, matching the Facebook/Instagram carousel scope in this codebase, even though Threads' own API also accepts video children. Known limitation carried over from the workflow's own sticky note, and **confirmed still unfixed as of Sep 23**: publish uses a blind time-based Wait rather than polling the container's `status` field until `FINISHED` — see the new "Known Gap" callout in §6 for why this is a real (not just theoretical) failure mode and the planned fix.
* **`youtube-poster`**: `Download Video` (plain HTTP GET on `media_urls[0]`, S3 in production) ∥ `Initiate Resumable Upload` ➔ `Merge` ➔ `Upload Video Binary` (PUT to the session `Location`) ➔ callback. **Wired to the backend Sep 23, 2026** (§2.4): payload is `{ media_type, media_urls, youtube_metadata: { title, description, privacy, made_for_kids, tags, category_id }, token: { access_token } }` — the backend always hands n8n an already-fresh access token, refresh token/client secret never leave the backend. Callback nodes gained the `x-callback-secret` header, matching the other workflows. `media_type` is `VIDEO` or `SHORTS`; YouTube has no API flag for Shorts (it classifies vertical/square ≤3 min videos itself), so `SHORTS` only makes the backend append `#Shorts` to the description if absent. The callback's `SUCCESS` means *upload accepted*, not published — see §6's poller. Still carries the §3 download-then-upload bottleneck.
* **`pinterest-poster`** *(planned, blocked on Developer App review — see §5 case 4)*: `HTTP Request` node(s) against Pinterest API v5 — `GET /v5/boards` to resolve `board_id`, then `POST /v5/pins` with `media_source` + `board_id`, same per-call dynamic-token pattern as the other HTTP-Request-based workflows.

Each workflow ends with a single **Callback HTTP Request node** POSTing its own result back to `/api/webhooks/n8n-callback` — it does not know about, or wait for, the other platforms' workflows.

### Queue Mode & Kubernetes Scaling

- n8n runs in **queue mode**: `n8n-main` (webhook receiver, pushes `{workflowId, payload}` to Redis) + `n8n-worker` replicas (pull jobs from Redis, read the workflow definition from the shared Postgres store, execute it). Main and worker are stateless copies of the same n8n app — neither "owns" a workflow.
- Deploy both roles on **Kubernetes**; use **KEDA** to autoscale `n8n-worker` replica count based on Redis queue depth, so throughput grows with load instead of being capped by a single sequential worker.
- Workers share **S3** for any binary data a workflow touches (e.g. the YouTube video download) since local worker disk isn't shared across replicas.
- Scaling n8n/K8s raises *throughput headroom*, not the actual ceiling — platform API rate limits are the real constraint, which is why limiting happens in the backend before a job ever reaches Redis.

---

## 6. Notification & Reporting System

### Return Webhook Response Schema (Sent from each per-platform n8n workflow to Backend)

Since each platform now runs as its own workflow triggered by its own webhook call, each one calls back independently with **its own result only** — there is no bundled `results` array from n8n anymore.

> **Note (Sep 16, 2026):** the real `POST /api/webhooks/n8n-callback` route (and what `facebook-poster.json`'s callback nodes actually send) implements a simpler subset of this — `{ post_id, platform, status, platform_post_id, error }` only, no `error_type`/`usage` fields yet, and auth is a plain `x-callback-secret` shared-secret header rather than anything richer. `error_type`/`usage`-driven handling (circuit breaker for `ABUSE_BLOCK`, proactive throttling from `usage`) is still aspirational — confirmed working today is just the `SUCCESS`/`FAILED` → `Post.status` update.

```json
{
  "post_id": "pst_883920",
  "platform": "instagram",
  "status": "SUCCESS", // SUCCESS | FAILED
  "platform_post_id": "179001122334455",
  "error": null,
  "error_type": null, // null | RATE_LIMIT | ABUSE_BLOCK | AUTH_ERROR | OTHER — drives which failure-mode handling in §5 applies
  "usage": { "call_count": 12, "total_time": 4, "total_cputime": 3 } // parsed from Graph API's X-App-Usage/X-Page-Usage header, if present; null for platforms without an equivalent header
}
```

`error_type: ABUSE_BLOCK` (Meta code `368`) triggers the circuit breaker described in §5, not the retry/backoff path — the Error Center (below) should present it as "Meta temporarily blocked this account for suspicious activity" rather than a generic failure.

### Async Media Processing Poller (Video)

Confirmed by testing (Sep 2026): a `SUCCESS` callback for `media_type: VIDEO` on Facebook only means `POST /{page_id}/videos` **accepted** the upload — Graph API hands back a video `id` immediately, but the video is transcoded asynchronously and does not appear on the Page (Feed or Video Library) until processing finishes, sometimes several minutes later. The n8n callback's `platform_post_id` cannot be treated as "now live" for video the way it can for TEXT/PHOTO.

- On a `VIDEO` `SUCCESS` callback, the backend enqueues a **status poller** job (BullMQ repeatable job — not another n8n workflow) keyed on `platform_post_id` + the account's token.
- Poller calls `GET /{video_id}?fields=status` every **30 seconds**.
- `status.video_status`:
  - `"processing"` → reschedule for another 30s.
  - `"ready"` → mark the `PostLogs` row finalized/confirmed, fire the completion notification (Web Push + in-app pop-up — see Dual Notification Engine below).
  - `"error"` → mark `FAILED` with `error_type: PROCESSING_FAILED`, surface in the Error Center like any other failure.
- Hard timeout after ~15 minutes (30 polls): if still unresolved, mark `UNKNOWN` rather than polling forever, and flag for manual check.
- Only confirmed necessary for Facebook video so far; worth verifying whether Threads/Instagram video containers need the same treatment once those are load-tested with larger files.
- **Implementation (as built):** one shared BullMQ queue/worker (`queue/video-status-queue.ts` / `video-status-worker.ts`) for every platform that needs it — Facebook, LinkedIn (Sep 22), **YouTube (Sep 23)**. Enqueued only from `routes/webhooks.ts` on a `SUCCESS` callback; the job carries `{ postId, platform, platformPostId, mediaId }` through Redis (`mediaId` = what's polled, `platformPostId` = what's logged — differ only for LinkedIn). The worker's per-platform `PLATFORMS` table maps each platform to its status check, and `POLL_POLICY` (a `Record<VideoPollPlatform, …>`, so a new platform can't compile without an entry) gives each its own attempt count and delay function, applied through a custom BullMQ `backoffStrategy`. Facebook/LinkedIn keep the fixed 30s × 30 (~15 min) above; **YouTube uses capped exponential backoff** — 15s, 30s, 1m, 2m, 4m, then 5m × 5 (11 checks, ~33 min) — since most videos finish in the first minutes and each check costs a YouTube quota unit. YouTube is polled for *every* post (all its posts are video) via `videos.list?part=status`: `uploadStatus` `processed` → `PUBLISHED`; `failed`/`rejected`/`deleted` → `FAILED` with YouTube's `failureReason`/`rejectionReason` (duplicate, copyright, etc.). Failure logs now also record `platformPostId` so the video can be found manually.
- **Why one queue, not per-platform (decided Sep 23):** each job is a single fast status call that throws to reschedule rather than blocking, so with concurrency 5 one platform's burst can't starve another's. Split per platform only once one needs its own rate limiter (BullMQ's limiter is per-queue) or independent scaling.
- **Known gap:** if the status check itself keeps *throwing* (network error, revoked token) rather than returning `processing`, the job exhausts its attempts and is removed with no `PostLog` written — the post stays `PROCESSING`. Needs a final-attempt failure hook (worker `failed` event) that logs `FAILED`; not yet built.

### Known Gap: Container-Status Polling Before Publish (Instagram Reels / Threads Video) — documented Sep 23, 2026, not yet built

This is a **different** gap from the Async Media Processing Poller above — that poller runs *after* a Facebook/LinkedIn video publish succeeds, confirming the already-live post finished transcoding. This gap is about *before* publish: `instagram-poster.json` (Reels) and `threads-poster.json` (Video) both create a media container, then blind-`Wait` a fixed duration (60s for both), then call `media_publish`/`threads_publish` regardless of whether Meta's server-side processing actually finished.

**Why this is a real failure mode, not just a theoretical one:**
- Threads video allows up to **1 GB / 5 minutes** (§4 Rule Validation Matrix); Instagram Reels has a comparable ceiling. A file near that size, or a slow/throttled source URL fetch on Meta's end, can easily leave the container still `IN_PROGRESS` after 60 seconds.
- Unlike the post-publish poller's failure mode (which just delays the "confirmed live" notification), this one **fails the publish call outright** — `threads_publish`/`media_publish` returns an error (Meta's own docs describe a "media not ready"-type response) if called before the container reaches `FINISHED`. There's no retry-and-recover; the post fails and the user has to resubmit.
- The 60s figure was chosen empirically during standalone workflow testing (`history.md` Session 8/13) for typical small test clips — it was never derived from Meta's worst-case processing time, and Meta's own API docs recommend polling instead of a fixed wait specifically because processing time isn't guaranteed to fit any fixed window.

**Planned fix (not implemented yet):** replace the fixed `Wait` node in both `instagram-poster.json` and `threads-poster.json` with an actual poll loop between container creation and publish:
1. `GET /{container_id}?fields=status,error_message` (Threads: `graph.threads.net`; Instagram: `{graph_host}/{ig_business_id}` container).
2. If `status` is `IN_PROGRESS`, `Wait` a short interval (e.g. 5-10s) and retry — same n8n `Wait` → `HTTP Request` → `IF` loop shape as a `SplitInBatches`-based retry, built inside the workflow itself since that's where the container/publish calls live.
3. If `FINISHED`, proceed to publish. If `ERROR` or a timeout ceiling is hit (analogous to the 15-minute/30-attempt cap the backend's Facebook/LinkedIn poller already uses), fail cleanly with a real error message instead of guessing.

This only affects the two platforms whose publish flow uses a container + blind wait (Instagram Reels, Threads Video) — Facebook and LinkedIn video already have real post-publish status polling (the Async Media Processing Poller above / `video-status-queue.ts`), so they're not in scope for this fix.

### Backend-Side Aggregation

The backend, not n8n, owns turning N independent per-platform callbacks (or `Promise.allSettled` results if it dispatched them together) into the overall post status:

- Write one `PostLogs` row per callback received.
- Once all dispatched platforms for a `post_id` have reported back (or timed out), compute `Posts.status`:
  - all `SUCCESS` → `PUBLISHED`
  - all `FAILED` → `FAILED`
  - mixed → `PARTIAL_FAILURE`
- This replaces the old n8n-side "Aggregate Results" code node from the single-workflow design — aggregation now lives entirely in the backend since the platforms never share an n8n execution to aggregate within.

### Dual Notification Engine
* **In-App Realtime Updates**: Web App receives WebSocket / Server-Sent Events (SSE) from backend to update status pills (`Published` 🟢, `Partial Failure` 🟡, `Failed` 🔴) instantly without page refresh.
  > **Note (Sep 16, 2026):** deliberately deferred — `history.tsx` currently polls `GET /api/posts` every 5s, which is real but minor waste (no-op requests when nothing changed). Discussed replacing it with `socket.io`/SSE push now vs. later; decided to hold off until all V1 platforms are integrated and dispatching (end of Phase 3), so the live-update layer is built once against the final multi-platform `Post`/`PostLog` shape rather than being reworked per platform as each one comes online. This is unrelated to and does not replace the Facebook video-status poller (§6 below) — that poller exists because Facebook itself has no push/webhook for VOD transcoding completion (only a `live_videos` webhook for going *live*), so backend→Facebook must stay pull-based regardless; only the backend→frontend leg is the deferred-but-planned WebSocket candidate.
* **Push Notifications / Pop-up**: For completions that resolve later than the initial callback — currently just the Video Processing Poller above — the backend fires a Web Push notification (and an in-app pop-up if the tab is open) once polling confirms `"ready"` or `"error"`, since the user may have navigated away during the multi-minute transcode wait.
* **Email Alerts (Resend / SendGrid)**: On completion (or if errors occurred), the backend dispatches an HTML email report summarizing the published posts and highlighting any failed platforms with direct resolution links.

### Error Center & Retry Mechanism
* Users can view exact, human-readable diagnostics in the **Error Center** (e.g. *"Threads token expired"*, *"Video aspect ratio invalid"*).
* A single-click **"Retry Failed Platforms"** button re-enqueues only the failed platforms without re-posting to successfully published networks.

---

## 7. Database Schema Design

### Core Tables (PostgreSQL, via Prisma)

> **Planned Sep 24, 2026 (§9):** `ConnectedAccounts` and `Posts` move from `user_id` to `workspace_id` ownership, `Users` gains `google_sub`/`avatar_url`/`last_login_at`, and new `Workspaces`/`Memberships`/`WorkspaceInvites` tables are added. The tables below still describe the current single-user schema until that migration lands.

#### `Users` Table
* `id` (UUID, Primary Key)
* `email` (String, Unique)
* `name` (String)
* `created_at` (Timestamp)

#### `ConnectedAccounts` Table
* `id` (UUID, Primary Key)
* `user_id` (Foreign Key -> Users.id)
* `platform` (Enum: `FACEBOOK`, `INSTAGRAM`, `THREADS`, `YOUTUBE`, `PINTEREST`)
* `account_name` (String)
* `platform_account_id` (String — Page ID, IG Business ID, Channel ID, Pinterest Board ID)
* `connection_method` (Enum: `FACEBOOK_PAGE`, `INSTAGRAM_LOGIN`, `THREADS_LOGIN` — `THREADS_LOGIN` added Sep 21, 2026. Only Instagram meaningfully has *two* connection methods (§2.2); Threads' single OAuth path still gets its own enum value, `THREADS_LOGIN`, rather than defaulting to `FACEBOOK_PAGE`, purely so the column's meaning stays "which OAuth product connected this row" for every platform rather than being Instagram-specific. `LINKEDIN_LOGIN` (Sep 22) and `YOUTUBE_LOGIN` (Sep 23) followed the same convention; Pinterest still defaults to `FACEBOOK_PAGE` as a placeholder until it's implemented. **Part of the table's unique key** — `(user_id, platform, platform_account_id, connection_method)` — because Instagram's two connection methods can resolve to the same `platform_account_id` while issuing tokens valid on different Graph API hosts; without this column in the key, connecting via one method silently overwrote the other's token (real bug, fixed Sep 17 — see §2.2).
* `encrypted_access_token` (Text — AES-256-GCM encrypted; see **Token Encryption Scheme** below for the exact byte format)
* `encrypted_refresh_token` (Text, Nullable — AES-256-GCM encrypted; `NULL` for platforms with no separate refresh token, e.g. Facebook/Instagram)
* `key_version` (Integer — which encryption key encrypted this row's tokens; see **Token Encryption Scheme** below for why this exists)
* `token_expires_at` (Timestamp, Nullable — `NULL` where meaningless for that platform's refresh_strategy)
* `refresh_strategy` (Enum: `NONE`, `SLIDING_WINDOW`, `ON_DEMAND`, `REQUIRES_RECONNECT` — last one added Sep 22 for LinkedIn. `ON_DEMAND` is live for YouTube as of Sep 23; for it, `token_expires_at` is the short-lived access token's expiry and a `NULL` `encrypted_refresh_token` means "Google revoked it, reconnect needed")
* `last_refreshed_at` (Timestamp, Nullable — for debugging/auditing refresh jobs)
* `disconnected_at` (Timestamp, Nullable — added Sep 21, 2026. `NULL` means actively connected. Clicking **Disconnect** sets this instead of deleting the row, because `Posts.connected_account_id` is a `RESTRICT` foreign key — a hard delete fails outright once the account has post history. Every read path that lists/resolves an account for use (`GET /api/integrations`, post-creation account lookup, the Instagram duplicate-account check) filters `disconnected_at IS NULL`. Reconnecting via OAuth `upsert`s on the same composite unique key above and clears this field, reviving the row — and its `Posts`/`PostLogs` history — rather than creating a duplicate or erroring on the unique constraint.)

> **Refresh shapes by platform** (drives the `refresh_strategy` switch, not per-platform `if` branches scattered through the codebase):
> * **`NONE`** — Facebook / Instagram. Page token has no fixed expiry in practice; no background job acts on it, user just re-connects if it ever stops working.
> * **`SLIDING_WINDOW`** — Threads (60-day) and Pinterest (30-day access / ~1yr refresh). A scheduled job scans for rows nearing `token_expires_at` and proactively refreshes. Not one uniform call shape though: Threads renews the *same* access token in place (no `encrypted_refresh_token` involved), while Pinterest consumes `encrypted_refresh_token` to mint a brand-new access token — same schedule, different per-platform refresh-call logic inside that one job.
> * **`ON_DEMAND`** — YouTube. `encrypted_refresh_token` never expires on its own; no background job needed — backend just exchanges it for a fresh access token right before each upload call.

### Token Encryption Scheme (finalized Sep 11, 2026)

Tokens must be **reversibly encrypted, not hashed** — unlike a password, the backend needs the literal plaintext value back at dispatch time to inject into the n8n webhook payload (§5). A leak of this column is equivalent to handing an attacker write access to a user's social accounts with no password/2FA needed, so encryption at rest here is a hard requirement, not a nice-to-have.

- **Cipher/mode**: **AES-256-GCM**, via Bun's built-in `node:crypto` — no extra dependency. GCM is used specifically because it bakes in an authentication tag (tamper detection), unlike CBC which needs a separately bolted-on HMAC to get the same guarantee.
- **Nonce/IV**: GCM requires a fresh, random 12-byte nonce for every encryption call — reusing one with the same key is a critical failure (can allow tag forgery or key recovery), not just "weaker" encryption. The nonce isn't secret, so it doesn't need its own column: `encrypt()` packs `nonce || ciphertext || authTag` into one buffer, base64-encodes it, and that's the entire value stored in `encrypted_access_token` / `encrypted_refresh_token`. `decrypt()` slices the three pieces back apart by fixed byte length before calling the AES-GCM primitive.
- **Key storage (now, proportionate to current scale)**: a single master key as an environment variable (`TOKEN_ENCRYPTION_KEY_V1`, 32 random bytes, base64), injected via the hosting platform's/Docker's secrets mechanism — never committed, never logged, and never stored alongside the Postgres credentials (the whole point is that a DB-only leak — backup theft, SQL injection — doesn't also hand over the key). Not standing up Vault/KMS infrastructure before there's a paying user to justify it.
- **`key_version` column and rotation**: each row records which key encrypted it. Rotating to a new key (`KEY_V2`) doesn't require downtime or a blocking migration: add `KEY_V2` to the app's key lookup alongside `KEY_V1` (both held at once, indexed by version), flip new writes to stamp `key_version = 2`, and existing rows keep decrypting correctly via `KEY_V1` since `decrypt()` looks up `keys[row.key_version]` instead of assuming one global key. A low-priority background job then walks rows still on `key_version = 1`, decrypts with `KEY_V1`, re-encrypts with `KEY_V2`, and updates them — spread over hours/days with zero outage. Once no rows reference `key_version = 1` anymore, that key is safe to delete from the secrets store.
- **Implementation shape**: one backend utility module — `encrypt(plaintext, keyVersion) → { ciphertext, keyVersion }` and the matching `decrypt(ciphertext, keyVersion)`. Called only from two places: the OAuth callback routes (encrypt, on connect/refresh) and the dispatch layer (decrypt, immediately before injecting the token into the n8n webhook payload). Never touches the frontend, never touches n8n — consistent with §5/§7's existing rule that n8n never stores or reads credentials itself.

#### `Posts` Table
* `id` (UUID, Primary Key)
* `user_id` (Foreign Key -> Users.id)
* `caption` (Text)
* `media_type` (Enum: `TEXT`, `IMAGE`, `VIDEO`, `CAROUSEL`, `REELS`, `STORIES`, `SHORTS` — `SHORTS` added Sep 23, YouTube-only)
* `media_urls` (JSON Array of S3 URLs)
* `status` (Enum: `DRAFT`, `SCHEDULED`, `PROCESSING`, `PUBLISHED`, `PARTIAL_FAILURE`, `FAILED`)
* `scheduled_for` (Timestamp, Nullable)
* `platform_options` (JSON, Nullable — added Sep 23, 2026. Platform-specific fields the shared caption/media columns can't hold; currently only YouTube's `{ title, privacyStatus, madeForKids, categoryId, tags }`. Validated per platform by zod in `routes/posts.ts`, not by the DB. For YouTube, `caption` holds the video description.)
* `created_at` (Timestamp)

#### `PostLogs` Table
* `id` (UUID, Primary Key)
* `post_id` (Foreign Key -> Posts.id)
* `platform` (Enum)
* `status` (Enum: `SUCCESS`, `FAILED`)
* `platform_post_id` (String, Nullable)
* `error_message` (Text, Nullable)
* `executed_at` (Timestamp)

> **Note**: under the per-platform-workflow design (Section 5), one `PostLogs` row is inserted per n8n callback received — not written in a single batch from one bundled n8n response. `ConnectedAccounts.encrypted_access_token` is decrypted by the backend only at dispatch time and injected into that call's payload; n8n itself never reads from or stores into this table/vault.

---

## 8. Implementation Roadmap

### Phase 1 — SaaS Core & OAuth Infrastructure
- [x] Spike-test `ioredis`/BullMQ under Bun (see §1 "BullMQ/ioredis-under-Bun Spike Test Results" — all 7 scenarios passed, Sep 11 2026). `@prisma/adapter-pg` and Bun's native S3/Redis clients already confirmed working (Sep 10).
- [x] Set up Web App Framework: Bun + Hono backend API, Vite + React frontend.
- [x] Configure database schema (PostgreSQL, Docker-hosted) via Prisma (driver adapter) with AES-256-GCM token encryption (versioned keys, per §7 Token Encryption Scheme).
- [x] Implement OAuth 2.0 handler for Meta Facebook (Sep 16), both Instagram connection methods (Sep 17), and Threads Login (Sep 21) — Google/Pinterest callback routes still pending, per §2.
- [x] Build Integration Dashboard with "Connect / Disconnect" buttons (Facebook, both Instagram methods, Threads; duplicate-connect guard + disconnect toasts added Sep 16-17). "Disconnect" is a soft-delete (Sep 21) so accounts with post history can be disconnected/reconnected without hitting the `Posts` FK constraint.
- [ ] App authentication & workspaces (§9, planned Sep 24): (A) workspace schema + data migration, (B) Google sign-in via OIDC + PKCE with Redis sessions, (C) `requireAuth` + workspace-membership middleware replacing `getOrCreateDefaultUser()`, platform connect flows bound to session + workspace, (D) frontend login/route guard/workspace switcher, (E) invites, (F) single-origin dev setup + docs.

### Phase 2 — Media Engine & Post Composer
- [x] Set up AWS S3 bucket and presigned URL upload handler (§11, Sep 29 2026 — code done; bucket deploy + live test pending).
- [ ] Pre-dispatch media dimension probe + per-platform aspect-ratio warnings and read-only preview grid in the composer (§3 "Per-Platform Media Fitting", step 1; implementation plan §12.7 step 1).
- [ ] Ratio-locked cropper with safe-zone overlays; store per-target crop settings against a single master upload (§3, step 2; §12.7 step 2, ships with image rendering).
- [ ] `sharp`/`ffmpeg` render worker on its own BullMQ queue (crop or blurred-background pad), dispatching rendered-version S3 URLs to n8n (§3, step 3; §12.7 steps 2-3).
- [ ] Smart-crop defaults, video auto-reframing, optional generative outpainting (§3, step 4 — later; §12.7 step 4).
- [ ] Build Post Composer UI with real-time platform validation rules.

### Phase 3 — n8n Webhook & Execution Workflow
- [x] Build one independent n8n workflow per platform (`facebook-poster`, `instagram-poster`, `threads-poster`, `youtube-poster`) — no shared "master" workflow with internal platform branching. (`pinterest-poster` still pending Developer App review.)
- [x] Configure platform nodes with dynamic expressions for tokens and IDs, sourced from the per-call webhook payload only — confirmed for `facebook-poster`, `instagram-poster` (Sep 17, including per-call `graph_host` selection, per §2.2/§5), and `threads-poster` (Sep 21, simplest `token` shape of the three — just `access_token`, per §5).
- [ ] Implement S3 binary download for YouTube node — `youtube-poster.json` currently uses a plain HTTP GET stand-in (Session 13/14); real S3 wiring and the streaming-relay fix (§3) not yet built. (Backend wiring itself done Sep 23 — see next item.)
- [x] Wire YouTube to the backend (Sep 23) — Google OAuth connect (§2.4), `ON_DEMAND` token refresh, `buildYouTubePayload`/`dispatchYouTubeToN8n`, `youtube-poster.json` callback secret + new metadata fields, YouTube added to the shared video-status poller with exponential backoff (§6), composer title/visibility/category/made-for-kids/tags fields. Not yet confirmed with a live end-to-end post.
- [ ] Log a `FAILED` `PostLog` when a video-status poll job exhausts its attempts by *throwing* (network error/revoked token) — currently leaves the post stuck in `PROCESSING` (§6).
- [ ] Apply the streaming-relay fix (§3, video-only) to `linkedin-poster.json` and `youtube-poster.json` — planned Sep 22, blocked on the Phase 2 S3 bucket item; `linkedin-poster.json` itself (text/image/video, standalone-tested Sep 22) is otherwise a V2-deferred platform (see header) not yet wired to the backend dispatcher.
- [ ] Stand up n8n in **queue mode**: Postgres for shared workflow storage, Redis for the job queue, `n8n-main` + `n8n-worker` roles. (Current dev setup, Sep 16, is a single non-queue-mode n8n container in `backend/docker-compose.yml` — fine for one platform/low volume, not yet the queue-mode architecture this section describes.)
- [ ] Deploy n8n main/worker on Kubernetes; configure **KEDA** autoscaling of worker replicas on Redis queue depth.
- [ ] Build the backend **fan-out dispatcher** (`Promise.allSettled` over selected platforms) and **per-`(user, platform)` rate limiter** (token bucket sized to each platform's quota) — current dispatch (Sep 16) is a single synchronous call to one platform (Facebook), not the multi-platform fan-out this describes. **Planned in detail in §10 (Sep 29)** — fan-out is now per-target BullMQ `publish` jobs rather than an in-request `Promise.allSettled`, so scheduling shares the same path.
- [x] Build Return Webhook Callback handler on backend (Sep 16) — implements per-callback `PostLogs` insert + direct `Posts.status` update for the single-platform case; cross-callback aggregation across multiple platforms (Section 6) still pending, since nothing dispatches to more than one platform yet.
- [x] Add `CAROUSEL` support to `threads-poster.json` (Sep 23) — same split/aggregate pattern as `instagram-poster`'s carousel, image-only.
- [ ] Replace the fixed-`Wait`-then-publish pattern in `instagram-poster.json` (Reels) and `threads-poster.json` (Video) with real container-status polling before calling `media_publish`/`threads_publish` — documented as a known gap in §6 ("Known Gap: Container-Status Polling Before Publish", added Sep 23); not yet built.

### Phase 4 — History, Error Center & Notifications
- [ ] Build History Dashboard & Error Center UI.
- [ ] Implement WebSockets/SSE for live dashboard updates — deliberately deferred (see §6 note, Sep 16) until all V1 platforms are integrated; `history.tsx`'s 5s `GET /api/posts` poll is the interim placeholder.
- [ ] Set up Email Notification service (Resend / SendGrid).
- [ ] Implement "One-Click Retry" for failed post attempts.

---

## 9. App Authentication, Sessions & Workspaces

> **Status (Sep 24, 2026):** Phase A (workspace schema, migration `20260924060000_add_workspaces_and_login`) applied. Phase B (Google sign-in, Redis sessions, `/api/me`, `/api/logout[-all]`, Vite `/api` proxy) live-tested. Phase C done: data routes moved under `/api/workspaces/:workspaceId/*` behind `requireAuth` + `requireWorkspace` (non-members get 404); connect flows take `?workspaceId=`, check session + membership at start, and at the callback the state must belong to the same signed-in user (`lib/connect-state.ts`); PKCE added to YouTube connect (Meta/LinkedIn unchanged); `csrf()` on `/api/*`; per-IP rate limit on `/api/login/*`; `/docs` + `/openapi.json` dev-only; single-user mode (`DEFAULT_USER_*`, `getDefaultWorkspaceContext`) removed. Phase D (workspace URLs, switcher, avatar/logout) built Sep 24. Phase E (roles, members, invites, soft delete — backend and frontend) built Sep 29, see §9.7; Phase F not started. Rules follow the [OWASP OAuth 2.0 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html).

This is **app login** ("who is using smPosting"), which is a different thing from the §2 **platform connect** flows ("which Facebook Page may smPosting post to"). They share nothing except the OAuth mechanics.

### 9.1 Decisions (Sep 24, 2026)

| Decision | Choice | Why |
|---|---|---|
| Login methods | **Sign in with Google only** (OpenID Connect) | No password storage, reset flows or MFA to build. Other methods may come later. |
| Who can sign up | **Anyone** | Open SaaS. |
| Google project | **Separate Google Cloud project** from the YouTube one | Login only needs `openid email profile` (non-sensitive), so this project can be published to Production without Google verification. The YouTube project stays in Testing (100 test users, 7-day refresh tokens) without blocking signups. |
| Session type | **Opaque session token in a cookie, session stored in Redis** — not stateless JWTs | Logout, "log out everywhere", account deletion and removing someone from a workspace must take effect immediately. JWTs can't be revoked without a denylist, which is a per-request lookup anyway. A Redis `GET` is sub-millisecond, and every route already queries Postgres, so the lookup is negligible. JWTs pay off when many services verify tokens without a shared store; we have one backend. |
| Session lifetime | **7 days sliding** (reset on activity), **30-day absolute cap** | |
| Tenancy | **Workspaces** — connected accounts and posts belong to a workspace, users access it through membership | Agencies: one employee manages several clients. Individuals get an auto-created "Personal" workspace and never see the concept (switcher hidden when there's only one). Doing this before real users exist is one migration; retrofitting later touches every query and unique key under live data. |
| Authorization | Tenant isolation on every request ("is this user a member of this workspace?") plus **three roles: OWNER, ADMIN, MEMBER** (revised Sep 29 — originally "no roles in V1"). Full matrix in §9.7. | An agency needs its founder to control who's in a client workspace, and a junior shouldn't be able to disconnect the client's Page. |
| Invites | **In V1, owner only.** The owner enters an email + role → if that email already has an account they're added at once, otherwise a pending invite (7 days) is accepted automatically when they sign in with Google using that (verified) email. No invite email — the owner shares the app link. | |
| Seeded user | `DEFAULT_USER_EMAIL` is the owner's own Google account → linked on first login, keeping all existing connected accounts and history. | |

### 9.2 Single-origin dev setup (solves the one-ngrok-domain limit)

Login cookies are set for one origin. Today the frontend is `localhost:5173`, the API is `localhost:4000`, and OAuth callbacks arrive on the ngrok domain (`PUBLIC_BACKEND_URL`). A cookie set on `localhost` never reaches the callback, so a connect callback couldn't know which user or workspace started it. Putting the user id in `state` is not safe (OWASP: `state` must be bound to the user agent, otherwise an attacker can attach their Page to a victim's account, or the reverse). `SameSite=None` cookies across origins weaken CSRF protection.

Fix: the same single free ngrok domain, pointed at Vite instead of the backend.

```
Before:  https://<ngrok-domain> ──► :4000 backend
After:   https://<ngrok-domain> ──► :5173 Vite ──(proxy /api/*)──► :4000 backend
```

- Callback URLs stay `https://<ngrok-domain>/api/auth/{platform}/callback`, so **no redirect URI changes** in the Meta/LinkedIn/Google dashboards. Only the new login redirect URI `https://<ngrok-domain>/api/login/google/callback` is registered, in the new Google project.
- `FRONTEND_URL` becomes the ngrok domain too. The app is opened at the ngrok URL in dev (HTTPS, which the `Secure` cookie needs).
- Vite needs `server.proxy['/api']` (with `xfwd` so the backend sees the client IP) and `server.allowedHosts` including the ngrok host.
- n8n keeps calling `localhost:4000` directly for callbacks (no browser, no cookies).
- Production: a reverse proxy / ingress does the same job as Vite (one origin, `/api` → backend).

### 9.3 Schema (Phase A)

```
User ──< Membership >── Workspace ──< ConnectedAccount
  │                        │     └──< Post (workspace_id + created_by_user_id)
  └── invited_by ──< WorkspaceInvite >──┘
```

- **`users`**: add `google_sub` (unique, nullable until first login — only the seeded user is ever null), `avatar_url`, `last_login_at`. Users are matched by Google `sub`, not email (emails can change or be reassigned).
- **`workspaces`**: `id`, `name`, `owner_user_id`, `created_at`.
- **`memberships`**: `user_id`, `workspace_id`, `created_at`, unique `(user_id, workspace_id)`.
- **`workspace_invites`**: `id`, `workspace_id`, `email` (lowercased), `invited_by_user_id`, `created_at`, `expires_at` (7 days), `accepted_at`. Unique `(workspace_id, email)` — re-inviting refreshes the same row.
- **`connected_accounts`**: `user_id` → `workspace_id`. Unique key becomes `(workspace_id, platform, platform_account_id, connection_method)`.
- **`posts`**: `user_id` → `workspace_id`, plus `created_by_user_id` (which member posted). The n8n payload's `user_id` stays and carries `created_by_user_id`; the workflows only pass it through, so they need no changes.
- **Data migration**: create a "Personal" workspace for the seeded user, add them as owner/member, move every existing row into it.
- **Sessions are not a table** — Redis keys `session:<sha256(token)>` → `{userId, createdAt}` with a 7-day TTL refreshed on use, plus a per-user set `user-sessions:<userId>` for "log out everywhere". Only the hash is stored, so a Redis dump doesn't leak usable sessions.

### 9.4 Google sign-in flow (Phase B)

Authorization Code flow + **PKCE (S256)** + **`nonce`**, confidential client (client secret sent at token exchange). Never the implicit grant, never Google One Tap / a JS SDK, so no token ever passes through browser JavaScript.

**`GET /api/login/google?next=/composer`**
1. Generate `state`, `nonce` and a PKCE `code_verifier` (32 random bytes each). Store `{codeVerifier, nonce, next}` in Redis at `oauth:state:login:<state>`, 5-minute TTL.
2. Set a short-lived `HttpOnly; Secure; SameSite=Lax` cookie containing `state` — binds the flow to this browser (OWASP §Essential Basics #2).
3. Redirect to Google with `response_type=code`, `scope=openid email profile`, `code_challenge`, `code_challenge_method=S256`, `nonce`, `state`, `prompt=select_account`.

**`GET /api/login/google/callback`**
1. Require the query `state` to equal the cookie's `state`; read the Redis entry and delete it immediately (single use).
2. Exchange the code at `https://oauth2.googleapis.com/token`, sending `code_verifier` and the client secret.
3. Verify the `id_token` with `jose` against Google's JWKS: signature, `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud == LOGIN_GOOGLE_CLIENT_ID`, `exp`, `nonce` match, `email_verified === true`.
4. Find the user by `sub`. If none, and a user with that email exists with `google_sub = NULL` (the seeded user only), link it. Otherwise create the user + a "Personal" workspace + owner membership.
5. Accept any unexpired pending invites for that email (create memberships, stamp `accepted_at`).
6. Rotate the session (delete the old one if a cookie came in — prevents session fixation), create a new one, set `__Host-sid=<token>; HttpOnly; Secure; SameSite=Lax; Path=/`. `Lax` (not `Strict`) so the cookie still comes along when Meta/Google/LinkedIn redirect the browser back to the connect callbacks.
7. Discard Google's access/refresh tokens — login doesn't need them.
8. Redirect to `next` only if it's a relative path starting with `/` and not `//` or `/\` — no open redirect (OWASP #1). Otherwise `/`.

**Other endpoints**: `POST /api/logout` (delete session + clear cookie), `POST /api/logout-all`, `GET /api/me` (user + their workspaces). Any failure redirects to `/login?error=<code>` and never echoes provider error text.

### 9.5 Authorization (Phase C)

- **`requireAuth`** middleware: hash the cookie, look up the session in Redis, refresh its TTL (respecting the 30-day cap), `c.set("user", …)`. Applied to all `/api/*` except `/api/login/*`, `/api/webhooks/*` (already guarded by `N8N_CALLBACK_SECRET`) and `/health`. `/docs` + `/openapi.json` disabled in production.
- **`requireWorkspace`** middleware: data routes move under `/api/workspaces/:workspaceId/…` (`integrations`, `posts`); checks a `Membership` exists, else **404** (not 403 — doesn't reveal the workspace exists). Every query filters by the verified `workspaceId`, same as today's `userId` filters.
- **Platform connect flows** (`/api/auth/{platform}?workspaceId=…`): require a session and membership at the start; store `{userId, workspaceId, codeVerifier?}` alongside `state`; at the callback require the session's user equals the stored user before writing the `ConnectedAccount`. Add PKCE to the Google/YouTube connect flow (and to Meta/LinkedIn where they support it).
- **CSRF**: `SameSite=Lax` + Hono's `csrf()` (Origin check) on every state-changing method + CORS locked to `FRONTEND_URL`.
- **Rate limiting**: per-IP Redis counter on `/api/login/*`.
- **Logging**: never log `code`, `state`, `id_token`, or cookies.
- **Cleanup**: remove `getOrCreateDefaultUser()` and `DEFAULT_USER_EMAIL`/`DEFAULT_USER_NAME`.
- **Tests**: user B gets 404 on user A's workspace, integrations, `connectedAccountId` in a post, disconnect and history; a connect callback with a mismatched session is rejected.

### 9.6 Frontend (Phase D)

- `useMe()` (`useQuery(["me"])`) and a `<RequireAuth>` wrapper around `AppLayout` → `/login?next=…` on 401.
- Login button = full-page navigation to `/api/login/google` (no popup, no SDK).
- `openapi-fetch` middleware: any 401 → `/login`.
- Routes move under `/w/:workspaceId/…`; the workspace switcher sits in the sidebar, hidden with one workspace; avatar + logout at the bottom.
- `API_URL` becomes relative (same origin via the Vite proxy).
- **Remember**: `composer.tsx` keeps its own platform allowlist — the workspace refactor must not drop anything from it.

### 9.7 Roles, members & invites (Phase E)

> **Status (Sep 29, 2026):** backend built (migration `20260929060000_add_workspace_roles_and_soft_delete`), OpenAPI doc + `api-schema.d.ts` regenerated, 15 end-to-end permission tests passing. Frontend built the same day (typecheck + production build clean; not yet click-tested with two real Google accounts).

**Decisions (Sep 29, 2026):**
- Exactly **one owner** per workspace (`workspaces.owner_user_id`, the creator). Ownership can't be transferred and the owner can't leave.
- **Roles** are `ADMIN | MEMBER` on `memberships.role`. OWNER is *not* a role value — it's derived from `owner_user_id`, so ownership has one source of truth.
- Every user's auto-created **Personal** workspace (`workspaces.is_personal`, at most one per user via a partial unique index) is **single-user**: no invites, can't be deleted (rename is fine). To collaborate, create another workspace.
- Deleting a workspace is a **soft delete** (`workspaces.deleted_at`). The membership check (`getRole()` in `db/workspaces.ts`) treats a deleted workspace as "not a member", so its posts (scheduled ones too), connected accounts and history are hidden everywhere at once; pending invites are revoked. Rows and encrypted tokens are kept — see §9.8 for the purge job. No scheduler exists yet; when one is built it must skip deleted workspaces.
- Removing a member (or a member leaving) takes effect on their next request — membership is checked on every request, so there's no session to revoke. Accounts they connected and posts they made stay with the workspace.

**Permission matrix:**

| Action | OWNER | ADMIN | MEMBER |
|---|:-:|:-:|:-:|
| View integrations, compose/post, view history | ✅ | ✅ | ✅ |
| Connect / disconnect platform accounts | ✅ | ✅ | ❌ |
| Invite, revoke invites, list members & invites, remove members, change roles | ✅ | ❌ | ❌ |
| Rename / delete workspace | ✅ | ❌ | ❌ |
| Leave workspace | ❌ | ✅ | ✅ |

**Endpoints** (non-members get 404 on everything under a workspace; members lacking the role get 403):

| Endpoint | Who |
|---|---|
| `POST /api/workspaces {name}` — create; caller becomes owner | any signed-in user |
| `PATCH /api/workspaces/:id {name}` — rename | owner |
| `DELETE /api/workspaces/:id` — soft delete; 409 for Personal | owner |
| `POST /api/workspaces/:id/leave` — 409 for the owner | admin, member |
| `GET /api/workspaces/:id/members` | owner |
| `PATCH /api/workspaces/:id/members/:userId {role}` — 409 on the owner | owner |
| `DELETE /api/workspaces/:id/members/:userId` — 409 on the owner | owner |
| `GET /api/workspaces/:id/invites` — pending, unexpired | owner |
| `POST /api/workspaces/:id/invites {email, role}` — returns `added` (existing account, membership created now) or `invited` (pending 7 days). Re-inviting refreshes expiry + role. 409 for Personal or an existing member. **Rate-limited 20/hour per user** (`rateLimitByUser`) | owner |
| `DELETE /api/workspaces/:id/invites/:inviteId` — revoke | owner |
| `DELETE /api/workspaces/:id/integrations/:accountId` and `/api/auth/{platform}?workspaceId=` (start + callback) | owner, admin |

- `/api/me` returns `role` (`OWNER`/`ADMIN`/`MEMBER`) and `isPersonal` per workspace instead of `isOwner`, and omits deleted workspaces.
- V1 sends no invite email — the owner shares the app link. Email delivery rides on the Phase 4 Resend/SendGrid item.

**Frontend:**
- `/w/:workspaceId/settings` (`routes/workspace-settings.tsx`, "Settings" in the sidebar). Owner: rename, invite form (email + role, "Copy app link"), pending invites + revoke, members with role dropdown + remove, delete. Personal workspace: rename only, plus a note to create a new workspace to collaborate. Admin/member: their role and a Leave button.
- `/workspaces/new` (`routes/new-workspace.tsx`), linked from "+ New workspace" in the sidebar and the profile page; lands on the new workspace's settings.
- Dashboard hides Connect/Reconnect/Disconnect for MEMBERs; the `*_connect_forbidden` toast now covers "not an owner/admin" as well as "removed".
- `useWorkspace()` (active workspace's `role`/`isPersonal` from `/api/me`) and `apiErrorMessage()` (shows the backend's `{ error }` message) are the shared helpers. Every change refetches `/api/me`; leave/delete navigate to `/`.
- Confirmations use `window.confirm` — there's no dialog component yet.

### 9.8 Later / not V1

- **Member cap per workspace, set by pricing tier (V2).** e.g. Free = just you, Pro = 5, Agency = 25. Enforce in `POST …/invites` (count memberships + pending invites) and return a clear "upgrade" error.
- **More roles** (documented Sep 29, not planned yet), with when each would earn its place:
  - **CONTRIBUTOR** — drafts only, can't publish. A freelance copywriter whose posts need sign-off.
  - **APPROVER** — approves/rejects drafts before they go out. An agency lead reviewing the week's queue.
  - **CLIENT / GUEST** — sees and approves posts in their own workspace only. The brand's marketing manager signing off on content.
  - **VIEWER / ANALYST** — read-only history and analytics. A stakeholder who only wants reports.
  - **BILLING** — plan and invoices only. The agency's accountant, once pricing tiers exist.
  - Contributor/approver/client imply a draft → approval → publish workflow on posts, which doesn't exist yet.
- Ownership transfer (deliberately not in V1).
- Purge job for soft-deleted workspaces: revoke platform tokens and hard-delete rows after a grace period.
- Audit log.
- Account deletion (`DELETE /api/me`: revoke platform tokens, delete data) — needed before Meta App Review, which requires a data-deletion callback URL and a privacy policy.
- Other login methods (would move `google_sub` into an `auth_identities` table).

---

## 10. Multi-Posting (Post Groups) & Scheduling

> **Status (Sep 29, 2026):** planned, not built. Replaces the single-account composer and the single-platform `POST /api/workspaces/:id/posts`. This is the §1 "Fan-Out Dispatcher" and the §6 "Backend-Side Aggregation" made concrete, with dispatch moved onto BullMQ so scheduling uses the same path.

### 10.1 Decisions (Sep 29, 2026)

1. The media-type-first multi-post flow **replaces** `composer.tsx`. A single-account post is a group with one target.
2. **Per-platform caption overrides**: one shared caption plus an optional override per target (mainly for Threads' 500-char limit).
3. Pre-submit validation is **all-or-nothing**: if any target is invalid the whole submit is rejected, and the UI offers a one-click "deselect invalid targets".
4. **Manual, per-target retry only.** No automatic re-publishing, because a retry after a lost callback can duplicate a live post.
5. Video to Instagram is always a **Reel**. YouTube Shorts are **double-verified**: the user picks Video or Short, and a Short must also pass a real dimension/duration probe (§10.5).
6. **Several accounts on the same platform** may be selected (for example two Facebook Pages). If one Instagram account is connected twice (Facebook Page login and Instagram Login share `platformAccountId`, see §2.2), it is **silently posted to once**.
7. **Stories stay Instagram-only**: choosing "Story" only offers Instagram accounts.
8. Dispatch goes through **BullMQ**, and **scheduling ships with this feature**.
9. **No live-post permalinks** yet.

### 10.2 Data model

A new parent `PostGroup` holds what the user wrote once. The existing `Post` stays the per-target row, so the n8n payloads, the `post_id` in callbacks, and the video-status poller keep keying on `Post.id` unchanged.

```
PostGroup (new)                      Post (existing — one per target account)
- id, workspaceId, createdByUserId   + groupId -> PostGroup
- contentKind: TEXT|IMAGE|CAROUSEL|    connectedAccountId
  VIDEO|STORY                          mediaType   (platform-specific, e.g. IG REELS)
- caption (shared)                     caption     (effective: override ?? shared)
- mediaUrls                            platformOptions (YouTube title/privacy/format…)
- status (aggregated, §10.4)           status
- scheduledFor (null = now)
- idempotencyKey (unique per workspace)
- cancelledAt
```

- `PostStatus` gains `CANCELLED`. `PostGroup.status` uses the same enum.
- Migration: hand-written SQL plus `prisma migrate deploy` (never `migrate dev`, which asks for a DB reset here). Every existing `Post` is backfilled into a one-target group, so History reads a single shape.
- `mediaUrls` stay on `PostGroup` only. `Post` keeps its copy for now so the n8n payload builders don't change, and it is dropped later.

### 10.3 Content kind → per-platform media type

| Kind | Facebook | Instagram | Threads | LinkedIn | YouTube |
|---|---|---|---|---|---|
| Text | TEXT | ✗ | TEXT | TEXT | ✗ |
| Image | IMAGE | IMAGE | IMAGE | IMAGE | ✗ |
| Carousel | CAROUSEL | CAROUSEL | CAROUSEL | CAROUSEL | ✗ |
| Video | VIDEO | REELS | VIDEO | VIDEO | VIDEO or SHORTS (user picks, §10.5) |
| Story | ✗ | STORIES | ✗ | ✗ | ✗ |

This table replaces `SUPPORTED_MEDIA_TYPES` in `routes/posts.ts` and `MEDIA_TYPES_BY_PLATFORM` in `composer.tsx`. It lives in one backend module and is served by `GET /api/capabilities` (kinds, platforms, caption limits, carousel min/max). The frontend renders from that response, so its allowlist can't drift again.

### 10.4 API & dispatch flow

```
GET    /api/capabilities
POST   /api/workspaces/:ws/post-groups                            create (now or scheduled)
GET    /api/workspaces/:ws/post-groups                            History
GET    /api/workspaces/:ws/post-groups/:id                        live results panel poll
POST   /api/workspaces/:ws/post-groups/:id/cancel                 scheduled only
POST   /api/workspaces/:ws/post-groups/:id/targets/:postId/retry  FAILED targets only
```

**Create** (`{ idempotencyKey, contentKind, caption, mediaUrls, scheduledFor?, targets: [{ connectedAccountId, captionOverride?, youtubeOptions? }] }`):

1. **Idempotency**: a repeated `(workspaceId, idempotencyKey)` returns the existing group (double-click or network retry never publishes twice).
2. **Validate every target** and collect all errors, not only the first. Checks: account belongs to the workspace and isn't disconnected; token isn't past `tokenExpiresAt` (and for scheduled posts, won't expire before `scheduledFor`); kind supported; effective caption within that platform's limit (Instagram 2,200 chars and 30 hashtags, Threads 500, LinkedIn 3,000, YouTube description 5,000 plus title 100); carousel count within the strictest selected platform's range; YouTube options present; Shorts probe (§10.5); media URL reachable with a matching content type (one HEAD request, not N platform failures). Any error → `400 { targets: [{ connectedAccountId, errors[] }] }`, and nothing is written.
3. **Dedupe Instagram** targets on `platformAccountId`, silently keeping the first.
4. **One transaction** creates the group and N `Post` rows (`SCHEDULED` if `scheduledFor` is set, else `PROCESSING`).
5. **Enqueue one BullMQ `publish` job per target** (`jobId = publish:<postId>:<attempt>`, `delay = scheduledFor - now` or 0, `attempts: 1` per decision 4). The route returns 201 immediately; the frontend polls for results.

**`publish` worker** (per target; concurrency around 10, so one group's targets run in parallel):

- Skip if the group is cancelled or its workspace is soft-deleted (§9.7). The target becomes `CANCELLED`.
- Re-check the account at send time (it may have been disconnected or its token may have expired since scheduling). A failure here fails that target only.
- Build the payload and call n8n with `AbortSignal.timeout(15s)`. A throw means a `FAILED` log for this target only.
- On a successful hand-off, enqueue a **callback-deadline job** (`deadline:<postId>:<attempt>`, around 20 minutes for text/image, longer for video) that marks the target `FAILED — no response from platform workflow` if it is still `PROCESSING`.

**Aggregation**: a single `recomputeGroupStatus(tx, groupId)` runs after every target change (dispatch failure, webhook, video poller, deadline job, cancel). It runs inside the same transaction and first takes `SELECT … FOR UPDATE` on the group row, because two callbacks arriving together would otherwise both read a stale sibling status. Rules:

- any target `SCHEDULED` → `SCHEDULED`
- any target `PROCESSING` → `PROCESSING`
- all `CANCELLED` → `CANCELLED`
- all `PUBLISHED` → `PUBLISHED`
- all `FAILED` → `FAILED`
- otherwise → `PARTIAL_FAILURE`

**Webhook hardening** (`routes/webhooks.ts`):

- An unknown `post_id` returns 404, not 500 from `findUniqueOrThrow`.
- A duplicate callback (the target already has a final log with the same outcome) is a no-op.
- A **late `SUCCESS` after the deadline job already failed the target overrides it to `PUBLISHED`**, because the post really went out.

**Retry**: only for `FAILED` targets. The old `PostLog` rows are kept as attempt history, then a new `publish` job is enqueued. If the failure was the callback-deadline timeout, the UI warns first: "this may already be live — check the platform before retrying".

### 10.5 YouTube Shorts double verification

- **Frontend (instant feedback)**: load the URL into a hidden `<video preload="metadata">` and read `videoWidth`, `videoHeight` and `duration` on `loadedmetadata`. Reading metadata needs no CORS (only canvas pixel reads do). If the video isn't vertical/square or runs over 3 minutes, the "Short" choice shows an error.
- **Backend (authoritative)**: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height:stream_side_data=rotation:format=duration -of json <url>`, with a timeout. Swap width and height when rotation is ±90 (phone videos are often stored landscape with a rotation flag). Accept only `height >= width` and `duration <= 180s`. An unreachable URL or a probe failure is a validation error, not a silent pass.
- ffprobe becomes a runtime dependency of the backend image.
- The same probe later feeds §3 "Per-Platform Media Fitting" step 1 (aspect-ratio warnings for Instagram and others).
- If the user picks "Video" but the file is vertical and at most 3 minutes, show an info note: YouTube will likely classify it as a Short anyway.

### 10.6 Scheduling

- **Timezone**: stored in UTC; picked and displayed in the browser's local timezone.
- **Allowed range (default)**: at least 2 minutes and at most 90 days ahead.
- **Durability**: Postgres is the source of truth and BullMQ delayed jobs are only the trigger. Redis should run with AOF persistence. A reconciler on startup and every 5 minutes finds `SCHEDULED` targets whose `scheduledFor` has passed and that have no pending job, then enqueues them, so a Redis flush or an overlong downtime can't silently drop posts.
- **Late firing (default, to confirm)**: a job running more than 1 hour past `scheduledFor` (for example the backend was down) fails that target with "missed its scheduled time" instead of posting stale content.
- **Cancel**: allowed while the group is `SCHEDULED`. It removes the pending jobs and marks the targets `CANCELLED`. A target already sent can't be cancelled.
- **Edit (default, to confirm)**: V1 edits a scheduled post as cancel-and-recreate, with the form pre-filled.
- **Re-checked at send time**: account connection, token expiry and media URL reachability (a hosted file may have been deleted after scheduling).

### 10.7 Frontend

1. **Kind**: cards for Text, Image, Carousel, Video and Story.
2. **Accounts**: checkboxes grouped by platform. Unsupported, expired or disconnected accounts are shown disabled with the reason.
3. **Content**: shared caption and media URL(s), then one tab per selected account for its caption override, YouTube fields (title, Video/Short, privacy, category, made-for-kids, tags) and per-platform limit counters.
4. **When**: "Post now" or a date-time picker.
5. **Submit**: a 400 lists the errors per target and offers "Deselect invalid targets". On success, a live results panel on the same page shows one row per target (spinner, then ✅, or ❌ with the error and Retry), polling `GET /post-groups/:id` every 3s until nothing is `PROCESSING`.
6. **History**: one card per group with an aggregated pill (Scheduled, Processing, Published, Partial, Failed, Cancelled) that expands to per-target rows. The 5s refetch runs only while some group is `SCHEDULED` or `PROCESSING` and is due soon.

### 10.8 Build order

1. Schema, migration and backfill.
2. Capabilities module and `GET /api/capabilities`.
3. `publish` queue and worker, callback-deadline jobs, and `recomputeGroupStatus`; the webhook and video poller switched over, plus webhook hardening.
4. `POST /post-groups` (validation, Instagram dedupe, idempotency, ffprobe) plus list, get, cancel and retry.
5. Scheduling reconciler.
6. Frontend: new composer flow and results panel, then grouped History with retry and cancel.
7. Remove the old `POST /posts` and old composer code; update history.md.

### 10.9 Failure messages and retry limit (Sep 30, 2026)

- **Readable errors.** `PostLog.errorMessage` keeps n8n's raw failure text (status, response body, node name, sometimes the JS stack). `backend/src/lib/platform-error.ts` turns it into one short sentence when a post group is serialized. Its `ERROR_RULES` table (first match wins) matches on platform, failing n8n node, HTTP status and/or text. Examples: expired tokens → "reconnect it", rate limits, a YouTube quota, LinkedIn's video size range, unreadable media (a `Download`/`Probe` node failing). Otherwise it falls back to the platform's own `message` from the response body, then to a sentence per status code. New known failures go in that table.
- **Retry cap.** Each target gets at most **5 sends** (`MAX_ATTEMPTS` in `service/post-groups.ts`): the first send plus 4 manual retries. The API exposes `canRetry` per target. Past the cap, the retry endpoint returns 409 and History shows "Retry limit reached — create the post again" instead of the Retry button.

## 11. Media Uploads to S3 (Sep 29, 2026)

The composer's "public URL" fields are gone: users pick files, the browser uploads them straight to a private S3 bucket, and the backend hands n8n presigned GET URLs in the same `media_urls` field as before — **no n8n workflow changes**. Cropping/per-platform fitting (§3 steps 2-4) and the YouTube/LinkedIn streaming relay (§3) are deliberately later phases.

### 11.1 Decisions (Kushagra, Sep 29)

| Question | Decision |
|---|---|
| URL input | Replaced completely — uploads only (old posts keep their `media_urls`) |
| Limits | Images 8 MB, videos 1 GB |
| Types | JPEG / PNG / WebP, MP4 / MOV. HEIC rejected with an "export as JPEG" hint |
| Library | None — uploads are scoped to the post being composed |
| Retention | 15 days after the post is sent |
| Resilience | Multipart with per-part retries; no resume across page reloads |
| Part size | `max(16 MiB, ceil(size / 10,000))` — always 16 MiB (≤ 64 parts) at the 1 GB cap |

### 11.2 Storage client

AWS SDK v3 (`@aws-sdk/client-s3`, `s3-request-presigner`, `s3-presigned-post`) rather than Bun's native S3 client (§1): Bun's client can presign a plain PUT but not a POST policy (needed to enforce `content-length-range`) nor multipart `UploadPart` URLs. The client sets `requestChecksumCalculation: "WHEN_REQUIRED"` so the SDK's default CRC32 isn't baked into presigned URLs the browser can't satisfy. Credentials come from the default chain — `AWS_PROFILE` in dev, the instance/task role in production; no keys in `.env`.

### 11.3 Bucket (`infra/media-bucket.yaml`, CloudFormation)

Private (public access blocked, `BucketOwnerEnforced`, SSE-S3, TLS-only policy). CORS allows the frontend origin(s) GET/HEAD/PUT/POST and **exposes `ETag`** (the browser needs each part's ETag to complete a multipart upload). Lifecycle: abort incomplete multipart uploads after 1 day; a 120-day backstop expiration (must stay above 90-day scheduling + 15-day retention). A managed policy (`s3:PutObject/GetObject/DeleteObject/AbortMultipartUpload` on objects, `s3:ListBucket` so HEAD on a missing key is 404 not 403) is output for the backend's runtime role.

### 11.4 Upload flow (two-phase)

1. `POST /api/workspaces/:id/media` `{filename, contentType, sizeBytes}` → creates a `media_assets` row (`PENDING`) with a server-generated key `<workspaceId>/<assetId>.<ext>` (the filename is only a column). Returns either
   - images: a presigned **POST** whose policy pins the exact size and content type, or
   - videos: a multipart upload with one presigned PUT URL per part (URLs valid 2 h).
2. The browser uploads (XHR for progress; 4 parts in parallel; retries 1 s / 3 s / 8 s on network errors, 429 and 5xx).
3. `POST /media/:assetId/complete` (with part ETags for videos) → completes the multipart upload, HEADs the object (size must match), sniffs the first 16 bytes (magic bytes must match the declared type — catches a renamed HEIC), marks the row `READY`. Any mismatch deletes the object.
4. `DELETE /media/:assetId` removes an unattached upload (the composer's remove button).

Rate limit: 120 upload starts per user per 10 min.

### 11.5 Posting, dispatch and retention

- `POST /post-groups` takes `mediaAssetIds` (ordered) instead of `mediaUrls`. Validation requires READY, unattached assets of this workspace, the right kind (video vs image), and adds a per-target error for **Instagram + non-JPEG** (its publishing API is JPEG-only). The Shorts ffprobe runs against a 15-minute presigned URL.
- The group create and the asset attach (`group_id`, `position`, `expires_at`) run in one transaction; the attach is a conditional update so two posts can't claim the same file.
- The publish worker signs fresh GET URLs (6 h) **at dispatch time**, so scheduled posts and retries never carry stale URLs. A post whose files were already deleted fails with a readable error.
- Retention: `expires_at = (scheduledFor ?? now) + 15 days`, counted from send time — an S3 lifecycle rule counted from upload time would delete media of posts scheduled more than 15 days out.
- Hourly cleaner (`service/media.ts`): PENDING rows older than 24 h (aborting their multipart upload), READY-but-never-attached rows older than 24 h, and expired rows whose group has nothing SCHEDULED or PROCESSING. Postgres, not an S3 listing, is the index of what exists.

### 11.6 Known limits / follow-ups

- WebP on Facebook, LinkedIn and Threads is untested.
- In dev, presigned URLs signed with temporary `aws login` credentials stop working when that session expires (scheduled posts need long-lived credentials — a role in production).
- Next: per-platform media fitting (§3 steps 2-4, planned in §12) and the streaming relay for YouTube/LinkedIn video (§3).

## 12. Per-Platform Media Fitting — Implementation Plan (Sep 30, 2026, planning only)

Turns §3 "Per-Platform Media Fitting" into buildable steps on top of §10 (post groups) and §11 (S3 uploads). Goal: before posting, the user sees how each file will look on every selected platform, and can crop it or blur-pad it per platform. The upload in S3 is never changed. Each target stores its fit settings, and the fitted files are rendered by a worker before dispatch.

### 12.1 What already exists

- `components/media-picker.tsx` keeps each picked `File` plus a blob `previewUrl`, so previews and the cropper work on the local file: no S3 download and no CORS.
- `composer.tsx`'s `useVideoShape` already reads a video's width, height and duration in the browser (Shorts check, §10.5).
- `lib/media-probe.ts` `probeVideo` (ffprobe, rotation-aware) runs at group create for the Shorts check only.
- `lib/capabilities.ts` + `GET /api/capabilities` is the single source of platform rules. Fit rules go here too, so the composer can't drift from the backend.
- Dispatch signs one URL list per **group** (`service/media.ts` `mediaUrlsForDispatch`), which has to become per **target**.
- Instagram + non-JPEG image is a hard validation error today (§11.5).

### 12.2 Surfaces and fit rules (`capabilities.ts`)

A **surface** is a (platform, media type) pair, e.g. `INSTAGRAM/STORIES`. Each one gets a fit rule, served in `/api/capabilities`:

```ts
interface SurfaceFit {
  minRatio: number;          // width / height the platform accepts
  maxRatio: number;
  enforced: boolean;         // true: the API rejects out-of-range media; false: the platform crops or letterboxes it on display
  presets: { label: string; ratio: number | null }[]; // cropper choices, first is the default; null = keep original
  outputWidth: number;       // render width; height follows the chosen ratio
  safeZone?: { top: number; bottom: number };         // fraction of the frame covered by platform UI
  sameRatioAcrossCarousel?: boolean;                  // Instagram crops every item to the first one's ratio
}
```

Starting values (re-check each against the platform's current docs when building):

| Surface | Accepts | Enforced | Presets | Notes |
|---|---|---|---|---|
| IG IMAGE / CAROUSEL | 4:5 – 1.91:1 | yes | 4:5, 1:1, 1.91:1 | carousel: one ratio for all items |
| IG REELS | wide range, shown 9:16 | no | 9:16, original | safe zone top ~14%, bottom ~20% (caption) |
| IG STORIES | wide range, shown 9:16 | no | 9:16, original | safe zone top/bottom ~14% |
| FB IMAGE / CAROUSEL / VIDEO | any | no | original, 4:5, 1:1, 1.91:1 (video: 16:9, 9:16) | feed crops tall media to 4:5 |
| THREADS IMAGE / CAROUSEL / VIDEO | any | no | original, 4:5, 1:1 | |
| LINKEDIN IMAGE / CAROUSEL / VIDEO | any | no | original, 1.91:1, 1:1, 4:5 | |
| YT VIDEO | any | no | original, 16:9 | |
| YT SHORTS | ≤ 1:1 (vertical/square) | yes (§10.5) | 9:16, 1:1 | a landscape video + 9:16 crop becomes Short-eligible |

### 12.3 Data model

**`media_assets` gains probed dimensions:** `width`, `height` (display orientation, with EXIF orientation / rotation flag applied) and `duration_seconds` (video). They're filled at `POST /media/:id/complete`. Images are ≤ 8 MB, so the backend downloads them and reads `sharp().metadata()`. Videos use the existing `probeVideo`. The Shorts check and fit validation then read stored values instead of probing on every create. Old rows stay null and are treated as "unknown, no fit check".

**New `media_fits`** (one row per target × asset, only when the file isn't sent as-is):

```
MediaFit
- id
- postId        -> Post (the target)
- mediaAssetId  -> MediaAsset
- mode          CROP | PAD
- ratio         output width / height
- x, y, w, h    Float, 0-1, relative to the display-oriented master (CROP: region kept; PAD: whole frame)
- renditionId?  -> MediaRendition
- unique(postId, mediaAssetId)
```

No row means the original is sent, which is today's behaviour. Relative coordinates keep settings independent of output size, and they're what `react-easy-crop` returns.

**New `media_renditions`** (rendered files):

```
MediaRendition
- id, mediaAssetId, specHash (unique with mediaAssetId)
- key          `<workspaceId>/<assetId>/r/<specHash>.<jpg|mp4>`
- status       PENDING | READY | FAILED | DELETED
- width, height, sizeBytes, error?
```

`specHash` = hash of (mode, rounded rect, ratio, output size, format). Two targets with the same fit, e.g. two Instagram accounts, share one render. The hourly cleaner (§11.5) deletes renditions together with their master.

### 12.4 API and validation

- `GET /api/capabilities` gains `surfaces`.
- `POST /post-groups`: each target gains `mediaFits?: [{ mediaAssetId, mode, ratio, rect }]`.
- Per-target checks (collected like §10.4, all-or-nothing):
  - The rect is inside 0–1 and matches `ratio` × the master's dimensions (±1%).
  - On an enforced surface, the effective ratio (the fit's ratio, else the master's) is within range.
  - Instagram carousels use one ratio for every item.
  - The Shorts check uses the effective ratio.
- **Instagram images are always rendered to JPEG**, even without a crop (a plain "convert" rendition). This removes today's "Instagram only accepts JPEG" error.
- Editing a scheduled post (cancel-and-recreate, §10.6) pre-fills the fits.

### 12.5 Rendering

- **Queue:** a new `render` BullMQ queue + worker (`queue/render-queue.ts`, `queue/render-worker.ts`), concurrency 1–2 and separate from `publish`, because ffmpeg saturates CPU. It can later become its own deployment scaled on queue depth by KEDA (§5).
- **Render eagerly at create:** right after the group transaction, enqueue one job per distinct rendition (`jobId = render:<renditionId>`, so it dedupes). Scheduled posts are ready long before send time, and render failures show up early. The §10.6 reconciler also re-enqueues `PENDING` renditions.
- **Publish worker:**
  - A rendition still `PENDING`: `moveToDelayed(now + 15 s)` until a render deadline (~5 min image, ~30 min video).
  - `FAILED` or past the deadline: the target fails with a readable message (new `ERROR_RULES` entries, §10.9).
  - Otherwise `mediaUrlsForDispatch` signs the rendition's key when the target has one, else the master's.
  - n8n payloads don't change.
- **Images (`sharp`):**
  - `.rotate()` first (EXIF auto-orient, so the coordinates match what the browser showed).
  - CROP: `extract` → `resize(outW, outH)`.
  - PAD: a blurred, darkened `cover` copy as background with a `contain` copy composited in the centre.
  - Output JPEG (mozjpeg, q≈90) in sRGB with metadata stripped.
- **Video (`ffmpeg`, reads the presigned URL, writes a temp file, multipart-uploads to S3):**
  - CROP: `crop=w:h:x:y,scale=W:H,setsar=1`.
  - PAD: `split[a][b];[a]scale=W:H:force_original_aspect_ratio=increase,crop=W:H,boxblur=20:5[bg];[b]scale=W:H:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`.
  - Encoding: `-c:v libx264 -preset veryfast -crf 20 -c:a aac -movflags +faststart`. ffmpeg auto-rotates by default, matching the display-oriented coordinates.
  - The timeout scales with duration, and the worker needs temp disk of about 2× the input size.
- No new `PostStatus`. The results panel shows "Preparing media…" while a target's renditions are `PENDING`.

### 12.6 Frontend

1. **Preview grid** (`components/media-fit/`): shown once media and at least one account are picked.
   - One tile per distinct surface among the selected targets.
   - Each tile is a frame at the fit ratio showing the local blob, CSS only (no canvas):
     - CROP: `object-fit: cover` positioned from the rect.
     - PAD: a CSS-blurred copy behind `object-fit: contain`.
     - Original: the platform's own display behaviour.
   - Carousels page through items.
   - 9:16 surfaces overlay striped safe-zone bands.
   - Badges: "Fits", "Platform will crop this", "Instagram will reject this — crop or pad".
2. **Cropper dialog** per tile, using `react-easy-crop` (it handles `<video>` too and returns relative crop areas): preset ratio chips from `surfaces`, a Crop / Blur-pad toggle, zoom, and a safe-zone overlay. Carousels choose one ratio, then position each item.
3. **Defaults:** on an enforced surface with out-of-range media, pre-apply a centre crop at the first preset, so the post is valid without extra clicks, and flag the tile "Auto-cropped — check it". Otherwise send the original.
4. Submit sends `mediaFits` per target. The preview and the render use the same relative rect, so what the user sees is what gets rendered.

### 12.7 Build order

1. **Probe + warnings** (usable on its own): dimension columns + migration (hand-written SQL + `migrate deploy`), probing at upload complete, `surfaces` in capabilities, a read-only preview grid with badges and safe zones, enforced-range validation, and the Shorts check switched to stored dimensions.
2. **Cropper + image rendering** (ship together, since a saved crop is useless without a render): `media_fits` + `media_renditions`, API field + validation, cropper dialog, `sharp`, render queue/worker, per-target dispatch URLs, Instagram JPEG conversion, cleaner support.
3. **Video rendering:** ffmpeg crop/pad, temp-disk handling, render deadline, "Preparing media…" state.
4. **Smart defaults and extras:**
   - `sharp`'s attention strategy (or `smartcrop.js` in the browser) positions the default crop.
   - AutoFlip-style video reframing later.
   - Generative outpainting as a paid extra, never the default.

### 12.8 Risks

- `sharp` under Bun: check that its prebuilt libvips loads in the backend runtime before building on it.
- Portrait phone photos (EXIF orientation) and rotated phone videos are the classic mismatch between browser preview and server output. Test both first.
- Video re-encoding is slow and CPU-heavy (a 1 GB 4K file can take minutes) and loses a little quality. It only runs when the user actually crops or pads a video.
- Renditions add storage, with the same 15-day retention as their master.

### 12.9 Open questions (defaults assumed above)

1. Render on the server from the master (assumed), or crop images in the browser (canvas) and upload a separate file per platform? The browser route is simpler for images but doesn't work for video, and it multiplies uploads.
2. Should fit settings be per surface (all Instagram feed accounts share one crop, assumed) or editable per account?
3. For out-of-range media on a strict platform, default to a centre crop (assumed), a blur-pad, or just block the post until the user chooses?
4. Build video cropping in the same release as images, or ship images first (assumed)?
5. Should previews be plain ratio frames with safe zones (assumed), or mock each platform's UI (avatar, caption, buttons)?
6. Should Story/Reels images default to blur-pad rather than crop? Wide photos in a 9:16 frame lose a lot to cropping.

---
*Created: 2026-08-14 | Master Specification for Social Media Auto-Poster SaaS*  
*Updated: 2026-09-06 | Revised architecture: per-platform n8n workflows (not one monolithic workflow), n8n queue mode + Kubernetes/KEDA scaling, backend-owned fan-out/rate-limiting/aggregation. Source: separate planning discussion, recapped by Kushagra.*  
*Updated: 2026-09-10 | Facebook `MULTI_PHOTO` (carousel) confirmed tested/working (§5). Full §2 OAuth detail added for all 5 platforms. `ConnectedAccounts` schema (§7) revised for the three token refresh shapes (`NONE`/`SLIDING_WINDOW`/`ON_DEMAND`). Backend tech stack finalized (§1): Bun + Hono, Docker Postgres + Prisma (driver adapter), Vite + React, BullMQ + ioredis (bunqueue as fallback), Bun native Redis client for pub/sub, Bun native S3 client for object storage. UploadThing evaluated and rejected.*  
*Updated: 2026-09-11 | Token encryption scheme finalized (§7): AES-256-GCM via Bun's `node:crypto`, nonce packed into the ciphertext blob (no separate column), single env-var master key for now, and a `key_version` column added to `ConnectedAccounts` enabling zero-downtime key rotation (old rows decrypt on their original key while a background job re-encrypts them onto the new one).*  
*Updated: 2026-09-11 | BullMQ/ioredis-under-Bun spike test passed (§1) — all 7 reliability scenarios (round-trip, crash recovery, repeatable jobs, retry/backoff, concurrency, graceful shutdown, QueueEvents) confirmed working. Stack risk resolved: BullMQ + ioredis is confirmed primary, `bunqueue` fallback not activated. Phase 1 roadmap item checked off.*  
*Updated: 2026-09-16 | First real end-to-end dispatch loop confirmed working: Facebook OAuth connect (§2.1) → encrypted token storage (§7) → Composer submit → backend `POST /api/posts` → `facebook-poster` n8n workflow → Graph API → callback → `Post.status = PUBLISHED`. §5/§6 flagged with notes on where the actual (simpler, Facebook-only) payload/callback schema currently diverges from this doc's full aspirational design. Phase 1/3 roadmap items checked off for what's genuinely built (Bun+Hono, Prisma schema, Facebook OAuth handler, Integration Dashboard, per-platform n8n workflows, backend callback handler); fan-out dispatcher, rate limiter, queue mode, K8s/KEDA, and non-Facebook OAuth handlers remain open. n8n's dev deployment for the SaaS backend moved to its own project-scoped Docker service (`backend/docker-compose.yml`), separate from the shared container used to build/test the standalone V1 workflows.*  
*Updated: 2026-09-17 | Instagram becomes the second platform wired to the real backend, with a wrinkle the earlier draft didn't anticipate: it has **two independent OAuth connection methods** (§2.2 rewritten) — Facebook Login (rides the existing §2.1 dialog) and standalone Instagram Login (new `lib/instagram.ts`/`routes/auth/instagram.ts`) — which can both connect the same physical account but issue tokens valid on different Graph API hosts. Fixed a real bug where the two methods clobbered each other's tokens by adding `connection_method` to `ConnectedAccounts`' unique key (§7). `service/n8n.ts` gained `buildInstagramPayload`/`dispatchInstagramToN8n` and a `GRAPH_HOST` lookup so the correct host is resolved backend-side and passed to n8n as data (§5) rather than n8n guessing; also a 24h token-expiry fail-fast guard since Instagram Login tokens expire and there's no refresh worker yet. `instagram-poster.json` callback nodes gained the `x-callback-secret` header, matching `facebook-poster`. Phase 1/3 roadmap items updated.*  
*Updated: 2026-09-21 | Fixed a Postgres FK-violation (`23001`) on disconnecting an account with post history — `Posts.connected_account_id` is `RESTRICT`, so the hard `DELETE` used by `DELETE /api/integrations/:id` failed outright. Replaced with a soft-delete: `ConnectedAccounts.disconnected_at` (§7, new column) is stamped instead of deleting the row; every read path that lists/resolves an account now filters it out, and reconnecting via OAuth (same composite key from the Sep 17 fix) clears it automatically, reviving the row and its post history.*
*Updated: 2026-09-21 | Threads becomes the third platform wired to the real backend (§2.3 rewritten, §5/§7 updated): `lib/threads.ts`/`routes/auth/threads.ts` implement the Threads Login OAuth flow (own `THREADS_APP_ID`/`SECRET` on the same Meta App as Facebook), `ConnectedAccounts.connection_method` gained a `THREADS_LOGIN` value (migration `20260921043412_add_threads_login`), and `service/n8n.ts` gained `buildThreadsPayload`/`dispatchThreadsToN8n` dispatching to `threads-poster.json`. Threads' payload is the simplest of the three platforms — just `{ access_token }`, no page/business id — since Threads posts always target the caller's own `/me/threads`. `threads-poster.json`'s callback nodes gained the `x-callback-secret` header, matching `facebook-poster`/`instagram-poster`. Same deferred-refresh posture as Instagram Login: a 24h expiry fail-fast guard exists, but no background sliding-window refresh worker yet.*
*Updated: 2026-09-22 | Threads OAuth testing **blocked, not abandoned**: the code from Sep 21 is complete and untouched, but the Meta App Dashboard won't save a Valid OAuth Redirect URI for the "Access the Threads API" use case — its save action 404s on Meta's own internal endpoint regardless of browser, cache state, or account permissions, with Basic Settings fully complete. Full diagnostic trail and prioritized next steps (strip `business_id` context → VPN region test → second-account test → last-resort app recreation) logged in `history.md` Session 23. Deliberately set aside in favor of scoping the LinkedIn workflow (deferred-to-V2 platform, see header) rather than continuing to troubleshoot a platform-side bug outside our control.*
*Updated: 2026-09-22 | `linkedin-poster.json` built and standalone-tested (personal-profile text/image/video posts via the LinkedIn Posts API, `LinkedIn-Version: 202609`) — not yet wired to the backend dispatcher, since LinkedIn is a V2-deferred platform (see header). Its image/video branches were initially built on the same `Download` → `Merge` → `Upload Binary` pattern as `youtube-poster.json`. Planning-only session (no code changes retained): discussed applying the §3 streaming-relay fix to LinkedIn's video branch, locked in the decision (video-only; redirect-following built in from the start; both LinkedIn and YouTube eventually get it) documented in §3's new "Streaming-Relay Decision" subsection, and Phase 3 roadmap updated — implementation deliberately deferred until a real S3 bucket exists (Phase 2, currently blocked on AWS account setup) to test the relay against real presigned URLs.*
*Updated: 2026-09-22 | Real end-to-end testing of `linkedin-poster.json` surfaced (and fixed) a genuine correctness bug beyond the planning-only streaming discussion above: LinkedIn's `initializeUpload` returns one `uploadInstructions` byte-range entry per part, capped at exactly 4,194,304 bytes (4 MiB) — a video over that size needs a real multi-part PUT, not just a single-shot upload. Implemented via two new Code nodes (`Split Video Into Parts`, `Collect Video Part ETags`) using n8n's documented `this.helpers.getBinaryDataBuffer`/`prepareBinaryData` API, letting the existing single-part PUT node run once per item unchanged; confirmed working end-to-end on a 27 MB test video. This landed the now-confirmed 4 MiB-per-part limit, which **revised §3's "Streaming-Relay Decision"**: rather than one whole-file streaming relay, LinkedIn's version is now planned as one ranged-S3-GET-to-PUT stream *per part* (`Range: bytes=firstByte-lastByte`), so at most one part (≤4 MiB) is ever buffered at once regardless of total video size — a strict improvement over both the original whole-file-relay plan and the currently-shipped whole-file-buffer-then-slice implementation. Still not built — still blocked on an S3 bucket existing (§3, Phase 2). See `history.md` Session 24 for the full debugging trail.*
*Updated: 2026-09-23 | Threads' Sep 22 OAuth redirect-URI blocker (§2.3) cleared — a real Threads account connected end-to-end for the first time, which surfaced a genuine frontend bug rather than an OAuth problem: `frontend/src/routes/composer.tsx` maintains its own hardcoded platform allowlist (`PostablePlatform` union, `MEDIA_TYPES_BY_PLATFORM`, `PLATFORM_LABELS`, the `postableAccounts` filter) completely separate from the backend's `SUPPORTED_MEDIA_TYPES` — Threads' OAuth/dispatch/n8n-workflow support was already complete, but the connected account never appeared in the "Post as" dropdown because composer.tsx simply never listed `THREADS`. Fixed by adding Threads to all four spots. **Added `CAROUSEL` support to Threads** the same day (§4/§5): `threads-poster.json` gained a carousel branch (split media URLs → per-image child containers with `is_carousel_item=true` → aggregate IDs → parent container with `media_type=CAROUSEL&children=...` → publish), `backend/src/routes/posts.ts`'s `SUPPORTED_MEDIA_TYPES.THREADS` and the composer's Threads media-type list both updated to match — image-only, mirroring the existing Facebook/Instagram carousel scope. **Documented, not built**: confirmed via Meta's own API guidance that the Instagram Reels/Threads Video fixed-`Wait`-then-publish pattern (in place since the original standalone workflows, `history.md` Session 8/13) is a real failure mode, not just a theoretical one — a near-size-limit video (Threads: 1GB/5min) on a slow connection can still be mid-processing when the fixed wait expires, and the publish call fails outright rather than degrading gracefully. Full gap writeup and planned poll-loop fix added to §6 ("Known Gap: Container-Status Polling Before Publish"); Phase 3 roadmap updated. No code changes for this part — deliberately deferred per Kushagra's instruction to document only.*
*Updated: 2026-09-23 | Planning only: added §3 "Per-Platform Media Fitting" to replace the old one-line cropper note — keep one master upload and store per-platform crop settings, `sharp`/`ffmpeg` rendering (explicitly not an LLM), a per-platform preview grid with a ratio-locked cropper and safe zones, blurred-background padding instead of black bars, a render worker on its own BullMQ queue, and optional outpainting later. Phase 2 roadmap split into four matching items; step 1 (dimension probe + warnings) can be built before S3.*
*Updated: 2026-09-23 | **YouTube becomes the fifth platform wired to the real backend** (§2.4, §5, §6, §7). Google OAuth connect flow (`lib/youtube.ts`, `routes/auth/youtube.ts`) with `access_type=offline&prompt=consent`, `youtube.upload` + `youtube.readonly` scopes, and callback guards for an unticked upload scope or a channel-less Google account. First real `ON_DEMAND` refresh implementation (`service/youtube-token.ts`): stored access token reused while >5 min from expiry, otherwise refreshed and persisted; an `invalid_grant` nulls the refresh token and surfaces `needsReconnect`. Schema: `ConnectionMethod.YOUTUBE_LOGIN`, `MediaType.SHORTS`, new nullable `Posts.platform_options` JSON column (migration `20260923040000_add_youtube`, hand-written and applied via `migrate deploy` to avoid the pre-existing `_prisma_migrations` drift forcing a reset). `youtube-poster.json` gained the `x-callback-secret` header plus `made_for_kids`/`tags`/`category_id` payload fields (category no longer hardcoded to 22). YouTube joins Facebook/LinkedIn on the **single shared video-status queue** — kept shared rather than split per platform (§6) — refactored to a per-platform status-check table and a `POLL_POLICY` record with a custom BullMQ backoff; YouTube polls on capped exponential backoff (~11 checks / ~33 min vs. 60 fixed). Frontend: Connect YouTube button + error toasts, composer YouTube fields (title, visibility, category, made-for-kids, tags; caption relabelled "Description"), and the history page shows the video title. Not yet confirmed with a live end-to-end post; unaudited-project uploads are forced private (§2.4).*
*Updated: 2026-09-24 | Planning only: new §9 "App Authentication, Sessions & Workspaces". Google-only sign-in (OIDC, auth code + PKCE + nonce, separate Google Cloud project), opaque session cookies backed by Redis rather than stateless JWTs (immediate revocation), 7-day sliding sessions. Workspace tenancy for agencies (individuals get an auto-created Personal workspace), email invites auto-accepted on Google sign-in, no roles in V1 beyond workspace owner. Single-origin dev setup — the one free ngrok domain repointed at Vite, which proxies `/api` to the backend, so no platform redirect URIs change. §7 flagged as pending the workspace migration; Phase 1 roadmap item added.*
*Updated: 2026-09-29 | §9.7 Phase E backend built: OWNER/ADMIN/MEMBER roles (owner derived from `owner_user_id`, `memberships.role` = ADMIN|MEMBER), owner-only member/invite management, ADMIN manages connected accounts, one non-transferable owner who cannot leave, single-user undeletable Personal workspace (`is_personal`), soft delete (`deleted_at`) hiding a workspace everywhere via the membership check, invites to existing accounts applied immediately, 20/hour per-user invite rate limit. §9.1 rows revised (no longer "no roles in V1"); §9.8 gains a V2 per-tier member cap and a list of possible future roles.*
*Updated: 2026-09-29 | Planning only: new §10 "Multi-Posting (Post Groups) & Scheduling" — `PostGroup` parent over per-target `Post` rows, media-kind-first composer replacing the old one, per-platform caption overrides, all-or-nothing validation with one-click deselect, per-target BullMQ publish jobs (also used for scheduling), locked `recomputeGroupStatus` aggregation, callback-deadline jobs, webhook idempotency, manual per-target retry, ffprobe-verified YouTube Shorts, silent Instagram double-connection dedupe.*
*Updated: 2026-09-29 | New §11 "Media Uploads to S3": composer URL fields replaced by direct browser-to-S3 uploads (presigned POST for images, presigned multipart for videos), `media_assets` table, magic-byte verification, presigned GETs signed at dispatch time, 15-day retention counted from send time with an hourly cleaner, CloudFormation template for the bucket. Storage client switched from Bun's native S3 client to AWS SDK v3 (§11.2). Phase 2 S3 item ticked.*  
*Updated: 2026-09-30 | New §10.9: n8n failure text is mapped to short user-facing messages by a rules table (`lib/platform-error.ts`), raw text kept in `PostLog`; manual retry capped at 5 sends per target (`canRetry` in the API). LinkedIn video size probe switched from HEAD to a ranged GET (HEAD is refused on GET-presigned S3 URLs).*
*Updated: 2026-09-30 | Planning only: new §12 "Per-Platform Media Fitting — Implementation Plan" turning §3 into four build steps: dimensions probed at upload complete, `surfaces` fit rules in `/api/capabilities`, CSS-only preview grid with safe zones, `react-easy-crop` cropper, `media_fits` (per target × asset, relative rect, CROP/PAD) and shared `media_renditions`, eager `render` BullMQ queue (`sharp` images, `ffmpeg` video), per-target dispatch URLs, Instagram images always rendered to JPEG. Six open questions listed in §12.9. Phase 2 roadmap items point at §12.*
