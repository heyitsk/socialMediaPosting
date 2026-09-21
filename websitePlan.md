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

### 2.3 Threads (Threads API — separate Meta surface from Graph API)

- **Authorization URL**: `https://threads.net/oauth/authorize`
- **App config**: requires adding the "Threads API" use case to the Meta app — separate from the "Facebook Login for Business" use case used in §2.1/§2.2.
- **Scopes**: `threads_basic`, `threads_content_publish`, `threads_manage_insights` (optional), `threads_manage_replies` (optional), `threads_read_replies` (optional)
- **Code → short-lived token**: `POST https://graph.threads.net/oauth/access_token` (`client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`) — valid ~1 hour.
- **Short-lived → long-lived (60-day) exchange**: `GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret&access_token={short_token}`
- **Refresh before expiry**: `GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token={long_token}` — extends another 60 days; token must be ≥24h old to refresh.
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

### In-App Cropper & Editor
* **Images**: Integrated frontend JS library (`Cropper.js`) allows users to crop/resize images to standard social aspect ratios (1:1 Square, 4:5 Portrait, 9:16 Vertical Story/Reel, 16:9 Landscape) before uploading.
* **Videos**: Frontend previewer checks aspect ratio and duration.

### How S3 Solves the YouTube Binary Requirement vs. Meta Public URLs

| Platform | Required Format | S3 Solution |
|----------|-----------------|-------------|
| **Facebook / Instagram / Threads** | Publicly accessible URL | Backend generates direct public/presigned S3 URL (`https://bucket.s3.amazonaws.com/media/file.mp4`). Meta downloads directly from S3. |
| **YouTube Data API** | Binary File Stream (`data` field) | Inside n8n, the **AWS S3 Node** (or `HTTP Request` node set to *File* format) downloads the S3 video into n8n binary memory/disk, then passes it directly into the `YouTube` upload node. |

> ⚠️ **Known scaling gap — confirmed by real testing (Sep 2026), not yet fixed:** `youtube-poster`'s current `Download Video` → `Merge` → `Upload Video Binary` pattern fully downloads the video into n8n binary storage *before* a single byte is sent to YouTube — total time ≈ download time + upload time, not overlapped. Fine for small test clips, but for large user videos this adds real wall-clock latency and (until `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` is set — patched Sep 8 in the dev env) risked OOM-crashing the worker, since n8n holds binary data in memory by default. **The real fix is a streaming relay**, not a bigger box: replace the two `HTTP Request` nodes with a single **Code node that pipes the S3 GET response stream directly into the YouTube PUT request stream** (Node.js raw `http`/`https`, not the built-in HTTP Request node, which can't start its output until the full response lands) — bytes move S3→YouTube without ever being fully buffered in n8n, cutting transfer time roughly in half and removing the memory ceiling entirely. **Do this before launch supports real (non-test) video sizes** — revisit when building out Phase 3's YouTube workflow for production.
>
> **Note (Sep 10, 2026):** this fix is entirely independent of which storage client the *backend* uses (Bun's native S3 client, raw AWS SDK, or otherwise) — it's a Code node running *inside n8n's own Node.js process*, which only needs a URL it can issue a streaming GET against. A presigned S3 URL already satisfies that. UploadThing was evaluated as a possible object-storage alternative and rejected for this reason among others: it's a DX layer built on top of S3 (not a replacement), offers no capability this fix needs, and adds real downsides (no BYO-bucket, closed-source backend, weaker compliance posture) for zero gain here.

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
* **`threads-poster`**: 2-Step Flow — `POST /me/threads` (create container) ➔ **Wait Node** (30-60s for video transcoding) ➔ `POST /me/threads_publish`.
* **`youtube-poster`**: `AWS S3` Download Node (fetches binary stream into `data` field) ➔ `YouTube` Upload Node.
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
* `connection_method` (Enum: `FACEBOOK_PAGE`, `INSTAGRAM_LOGIN` — added Sep 17, 2026. Only meaningfully distinguishes Instagram's two OAuth products today (§2.2); other platforms default to `FACEBOOK_PAGE` as a placeholder value since they don't (yet) have more than one connection path. **Part of the table's unique key** — `(user_id, platform, platform_account_id, connection_method)` — because Instagram's two connection methods can resolve to the same `platform_account_id` while issuing tokens valid on different Graph API hosts; without this column in the key, connecting via one method silently overwrote the other's token (real bug, fixed Sep 17 — see §2.2).
* `encrypted_access_token` (Text — AES-256-GCM encrypted; see **Token Encryption Scheme** below for the exact byte format)
* `encrypted_refresh_token` (Text, Nullable — AES-256-GCM encrypted; `NULL` for platforms with no separate refresh token, e.g. Facebook/Instagram)
* `key_version` (Integer — which encryption key encrypted this row's tokens; see **Token Encryption Scheme** below for why this exists)
* `token_expires_at` (Timestamp, Nullable — `NULL` where meaningless for that platform's refresh_strategy)
* `refresh_strategy` (Enum: `NONE`, `SLIDING_WINDOW`, `ON_DEMAND`)
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
* `media_type` (Enum: `TEXT`, `IMAGE`, `VIDEO`, `CAROUSEL`)
* `media_urls` (JSON Array of S3 URLs)
* `status` (Enum: `DRAFT`, `SCHEDULED`, `PROCESSING`, `PUBLISHED`, `PARTIAL_FAILURE`, `FAILED`)
* `scheduled_for` (Timestamp, Nullable)
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
- [x] Implement OAuth 2.0 handler for Meta Facebook (Sep 16) and both Instagram connection methods, Facebook Login + standalone Instagram Login (Sep 17) — Threads/Google/Pinterest callback routes still pending, per §2.
- [x] Build Integration Dashboard with "Connect / Disconnect" buttons (Facebook + both Instagram methods; duplicate-connect guard + disconnect toasts added Sep 16-17). "Disconnect" is a soft-delete (Sep 21) so accounts with post history can be disconnected/reconnected without hitting the `Posts` FK constraint.

### Phase 2 — Media Engine & Post Composer
- [ ] Set up AWS S3 bucket and presigned URL upload handler.
- [ ] Integrate frontend image cropper (`Cropper.js`) and video previewer.
- [ ] Build Post Composer UI with real-time platform validation rules.

### Phase 3 — n8n Webhook & Execution Workflow
- [x] Build one independent n8n workflow per platform (`facebook-poster`, `instagram-poster`, `threads-poster`, `youtube-poster`) — no shared "master" workflow with internal platform branching. (`pinterest-poster` still pending Developer App review.)
- [x] Configure platform nodes with dynamic expressions for tokens and IDs, sourced from the per-call webhook payload only — confirmed for `facebook-poster` and, as of Sep 17, `instagram-poster` (including per-call `graph_host` selection between `graph.facebook.com`/`graph.instagram.com`, per §2.2/§5).
- [ ] Implement S3 binary download for YouTube node — `youtube-poster.json` currently uses a plain HTTP GET stand-in (Session 13/14); real S3 wiring and the streaming-relay fix (§3) not yet built, and YouTube isn't wired to the backend at all yet.
- [ ] Stand up n8n in **queue mode**: Postgres for shared workflow storage, Redis for the job queue, `n8n-main` + `n8n-worker` roles. (Current dev setup, Sep 16, is a single non-queue-mode n8n container in `backend/docker-compose.yml` — fine for one platform/low volume, not yet the queue-mode architecture this section describes.)
- [ ] Deploy n8n main/worker on Kubernetes; configure **KEDA** autoscaling of worker replicas on Redis queue depth.
- [ ] Build the backend **fan-out dispatcher** (`Promise.allSettled` over selected platforms) and **per-`(user, platform)` rate limiter** (token bucket sized to each platform's quota) — current dispatch (Sep 16) is a single synchronous call to one platform (Facebook), not the multi-platform fan-out this describes.
- [x] Build Return Webhook Callback handler on backend (Sep 16) — implements per-callback `PostLogs` insert + direct `Posts.status` update for the single-platform case; cross-callback aggregation across multiple platforms (Section 6) still pending, since nothing dispatches to more than one platform yet.

### Phase 4 — History, Error Center & Notifications
- [ ] Build History Dashboard & Error Center UI.
- [ ] Implement WebSockets/SSE for live dashboard updates — deliberately deferred (see §6 note, Sep 16) until all V1 platforms are integrated; `history.tsx`'s 5s `GET /api/posts` poll is the interim placeholder.
- [ ] Set up Email Notification service (Resend / SendGrid).
- [ ] Implement "One-Click Retry" for failed post attempts.

---
*Created: 2026-08-14 | Master Specification for Social Media Auto-Poster SaaS*  
*Updated: 2026-09-06 | Revised architecture: per-platform n8n workflows (not one monolithic workflow), n8n queue mode + Kubernetes/KEDA scaling, backend-owned fan-out/rate-limiting/aggregation. Source: separate planning discussion, recapped by Kushagra.*  
*Updated: 2026-09-10 | Facebook `MULTI_PHOTO` (carousel) confirmed tested/working (§5). Full §2 OAuth detail added for all 5 platforms. `ConnectedAccounts` schema (§7) revised for the three token refresh shapes (`NONE`/`SLIDING_WINDOW`/`ON_DEMAND`). Backend tech stack finalized (§1): Bun + Hono, Docker Postgres + Prisma (driver adapter), Vite + React, BullMQ + ioredis (bunqueue as fallback), Bun native Redis client for pub/sub, Bun native S3 client for object storage. UploadThing evaluated and rejected.*  
*Updated: 2026-09-11 | Token encryption scheme finalized (§7): AES-256-GCM via Bun's `node:crypto`, nonce packed into the ciphertext blob (no separate column), single env-var master key for now, and a `key_version` column added to `ConnectedAccounts` enabling zero-downtime key rotation (old rows decrypt on their original key while a background job re-encrypts them onto the new one).*  
*Updated: 2026-09-11 | BullMQ/ioredis-under-Bun spike test passed (§1) — all 7 reliability scenarios (round-trip, crash recovery, repeatable jobs, retry/backoff, concurrency, graceful shutdown, QueueEvents) confirmed working. Stack risk resolved: BullMQ + ioredis is confirmed primary, `bunqueue` fallback not activated. Phase 1 roadmap item checked off.*  
*Updated: 2026-09-16 | First real end-to-end dispatch loop confirmed working: Facebook OAuth connect (§2.1) → encrypted token storage (§7) → Composer submit → backend `POST /api/posts` → `facebook-poster` n8n workflow → Graph API → callback → `Post.status = PUBLISHED`. §5/§6 flagged with notes on where the actual (simpler, Facebook-only) payload/callback schema currently diverges from this doc's full aspirational design. Phase 1/3 roadmap items checked off for what's genuinely built (Bun+Hono, Prisma schema, Facebook OAuth handler, Integration Dashboard, per-platform n8n workflows, backend callback handler); fan-out dispatcher, rate limiter, queue mode, K8s/KEDA, and non-Facebook OAuth handlers remain open. n8n's dev deployment for the SaaS backend moved to its own project-scoped Docker service (`backend/docker-compose.yml`), separate from the shared container used to build/test the standalone V1 workflows.*  
*Updated: 2026-09-17 | Instagram becomes the second platform wired to the real backend, with a wrinkle the earlier draft didn't anticipate: it has **two independent OAuth connection methods** (§2.2 rewritten) — Facebook Login (rides the existing §2.1 dialog) and standalone Instagram Login (new `lib/instagram.ts`/`routes/auth/instagram.ts`) — which can both connect the same physical account but issue tokens valid on different Graph API hosts. Fixed a real bug where the two methods clobbered each other's tokens by adding `connection_method` to `ConnectedAccounts`' unique key (§7). `service/n8n.ts` gained `buildInstagramPayload`/`dispatchInstagramToN8n` and a `GRAPH_HOST` lookup so the correct host is resolved backend-side and passed to n8n as data (§5) rather than n8n guessing; also a 24h token-expiry fail-fast guard since Instagram Login tokens expire and there's no refresh worker yet. `instagram-poster.json` callback nodes gained the `x-callback-secret` header, matching `facebook-poster`. Phase 1/3 roadmap items updated.*  
*Updated: 2026-09-21 | Fixed a Postgres FK-violation (`23001`) on disconnecting an account with post history — `Posts.connected_account_id` is `RESTRICT`, so the hard `DELETE` used by `DELETE /api/integrations/:id` failed outright. Replaced with a soft-delete: `ConnectedAccounts.disconnected_at` (§7, new column) is stamped instead of deleting the row; every read path that lists/resolves an account now filters it out, and reconnecting via OAuth (same composite key from the Sep 17 fix) clears it automatically, reviving the row and its post history.*
