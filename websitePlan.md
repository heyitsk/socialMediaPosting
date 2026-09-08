# 🚀 Social Media Auto-Poster SaaS — Product & Technical Specification (`websitePlan.md`)

> **Product Vision**: A full-fledged multi-tenant SaaS application allowing users to publish and schedule text, photo, video, and carousel content across multiple social media platforms simultaneously.  
> **Architecture**: Node/Express + React Backend/Frontend ("MERN-style" app) + **one independently-versioned n8n workflow per platform**, run in **n8n queue mode** (Main + autoscaled Workers behind Redis) for horizontal scale, + AWS S3 Media Storage.  
> **Active V1 Target Platforms**: Facebook Pages, Instagram, Threads, YouTube (Shorts & Videos).  
> **Deferred to V2**: Pinterest, Reddit, X (Twitter), LinkedIn, Tumblr, Blogger.
>
> **Note on stack naming**: "MERN" is used loosely here for Node/Express + React — the schema in Section 7 is relational (PostgreSQL), not MongoDB. Flag this if a literal Mongo-based stack is actually intended; it would require redesigning Section 7.

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

The application decouples the user-facing web interface and scheduling logic from the platform API execution logic. The Node/Express backend owns **all** orchestration — auth, credential storage, rate limiting, and fan-out. n8n holds **no orchestration logic of its own**: it is a fleet of thin, per-platform, stateless workflows triggered by webhook, running in **queue mode** so it can scale horizontally under Kubernetes.

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

---

## 2. OAuth 2.0 Integration Strategy (User Experience)

Users **never** manually copy/paste Developer App IDs, Secrets, or Access Tokens. The SaaS app uses standard OAuth 2.0 flows to authenticate users.

### User Flow: "Connect Account"
1. In the SaaS Dashboard under **Integrations**, the user clicks `[Connect Facebook / Instagram]`, `[Connect Threads]`, or `[Connect YouTube]`.
2. The web app opens the platform's official OAuth consent screen.
3. The user authorizes the SaaS application to manage their accounts.
4. The platform redirects back to the SaaS backend callback URL (`/api/auth/{platform}/callback`) with an authorization `code`.

### Backend OAuth Exchange & Token Harvesting Flow

```
User Click ──> OAuth Consent ──> Backend Callback (with Code) ──> Exchange Code for Token ──> Fetch IDs ──> Save Encrypted to DB
```

#### Step-by-Step Backend API Operations (Example: Meta / Facebook & Instagram)
1. **Code Exchange**: Backend sends a request to Meta's `/oauth/access_token` endpoint to get a User Access Token.
2. **Long-Lived Token Exchange**: Backend exchanges short-lived token for a 60-day renewable User Access Token.
3. **Account Harvesting (`GET /me/accounts`)**:
   * Queries Meta Graph API: `GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,name}`
   * **Returns**:
     * Facebook Page ID & Permanent Page Access Token
     * Instagram Business Account ID
4. **Encryption & Storage**: The backend encrypts the tokens and saves the IDs to the database under the User's ID.
5. **Dashboard UI**: Popup closes; UI displays `✅ Connected: My Facebook Page & @my_instagram`.

---

## 3. Media Management & S3 Storage Strategy

All images and videos uploaded by users are stored in an **AWS S3 Bucket** (or S3-compatible storage like Cloudflare R2).

### In-App Cropper & Editor
* **Images**: Integrated frontend JS library (`Cropper.js`) allows users to crop/resize images to standard social aspect ratios (1:1 Square, 4:5 Portrait, 9:16 Vertical Story/Reel, 16:9 Landscape) before uploading.
* **Videos**: Frontend previewer checks aspect ratio and duration.

### How S3 Solves the YouTube Binary Requirement vs. Meta Public URLs

| Platform | Required Format | S3 Solution |
|----------|-----------------|-------------|
| **Facebook / Instagram / Threads** | Publicly accessible URL | Backend generates direct public/presigned S3 URL (`https://bucket.s3.amazonaws.com/media/file.mp4`). Meta downloads directly from S3. |
| **YouTube Data API** | Binary File Stream (`data` field) | Inside n8n, the **AWS S3 Node** (or `HTTP Request` node set to *File* format) downloads the S3 video into n8n binary memory/disk, then passes it directly into the `YouTube` upload node. |

> ⚠️ **Known scaling gap — confirmed by real testing (Sep 2026), not yet fixed:** `youtube-poster`'s current `Download Video` → `Merge` → `Upload Video Binary` pattern fully downloads the video into n8n binary storage *before* a single byte is sent to YouTube — total time ≈ download time + upload time, not overlapped. Fine for small test clips, but for large user videos this adds real wall-clock latency and (until `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` is set — patched Sep 8 in the dev env) risked OOM-crashing the worker, since n8n holds binary data in memory by default. **The real fix is a streaming relay**, not a bigger box: replace the two `HTTP Request` nodes with a single **Code node that pipes the S3 GET response stream directly into the YouTube PUT request stream** (Node.js raw `http`/`https`, not the built-in HTTP Request node, which can't start its output until the full response lands) — bytes move S3→YouTube without ever being fully buffered in n8n, cutting transfer time roughly in half and removing the memory ceiling entirely. **Do this before launch supports real (non-test) video sizes** — revisit when building out Phase 3's YouTube workflow for production.

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

### Backend Dispatch Logic (Node/Express)

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
* **`facebook-poster`**: `HTTP Request` node (`/feed`, `/photos`, `/videos`, or the split-upload+`/feed` flow for `MULTI_PHOTO`) — not the typed `Facebook Graph API` node, since its `Credential` field can't take a per-call dynamic token; access token is passed as a query param from the webhook payload instead. Testing status (Sep 2026): `TEXT`, `PHOTO`, `VIDEO` all confirmed working end-to-end after token rotation; `MULTI_PHOTO` (carousel) is still **untested** — hit the Graph API rate limit before a run could complete, so its multi-upload-then-attach flow needs re-verification once the limit clears.
* **`instagram-poster`**: 2-Step Flow — `POST /media` (create container) ➔ **Wait Node** (5-10s) ➔ `POST /media_publish`.
* **`threads-poster`**: 2-Step Flow — `POST /me/threads` (create container) ➔ **Wait Node** (30-60s for video transcoding) ➔ `POST /me/threads_publish`.
* **`youtube-poster`**: `AWS S3` Download Node (fetches binary stream into `data` field) ➔ `YouTube` Upload Node.

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
* **Push Notifications / Pop-up**: For completions that resolve later than the initial callback — currently just the Video Processing Poller above — the backend fires a Web Push notification (and an in-app pop-up if the tab is open) once polling confirms `"ready"` or `"error"`, since the user may have navigated away during the multi-minute transcode wait.
* **Email Alerts (Resend / SendGrid)**: On completion (or if errors occurred), the backend dispatches an HTML email report summarizing the published posts and highlighting any failed platforms with direct resolution links.

### Error Center & Retry Mechanism
* Users can view exact, human-readable diagnostics in the **Error Center** (e.g. *"Threads token expired"*, *"Video aspect ratio invalid"*).
* A single-click **"Retry Failed Platforms"** button re-enqueues only the failed platforms without re-posting to successfully published networks.

---

## 7. Database Schema Design

### Core Tables (PostgreSQL / Prisma / TypeORM)

#### `Users` Table
* `id` (UUID, Primary Key)
* `email` (String, Unique)
* `name` (String)
* `created_at` (Timestamp)

#### `ConnectedAccounts` Table
* `id` (UUID, Primary Key)
* `user_id` (Foreign Key -> Users.id)
* `platform` (Enum: `FACEBOOK`, `INSTAGRAM`, `THREADS`, `YOUTUBE`)
* `account_name` (String)
* `platform_account_id` (String — Page ID, IG Business ID, Channel ID)
* `encrypted_access_token` (Text — AES-256 encrypted)
* `token_expires_at` (Timestamp)

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
- [ ] Set up Web App Framework (Next.js / Node.js API).
- [ ] Configure database schema (PostgreSQL) with AES-256 token encryption.
- [ ] Implement OAuth 2.0 handlers for Meta (FB & IG), Threads, and Google (YouTube).
- [ ] Build Integration Dashboard with "Connect / Disconnect" buttons.

### Phase 2 — Media Engine & Post Composer
- [ ] Set up AWS S3 bucket and presigned URL upload handler.
- [ ] Integrate frontend image cropper (`Cropper.js`) and video previewer.
- [ ] Build Post Composer UI with real-time platform validation rules.

### Phase 3 — n8n Webhook & Execution Workflow
- [ ] Build one independent n8n workflow per platform (`facebook-poster`, `instagram-poster`, `threads-poster`, `youtube-poster`) — no shared "master" workflow with internal platform branching.
- [ ] Configure platform nodes with dynamic expressions for tokens and IDs, sourced from the per-call webhook payload only.
- [ ] Implement S3 binary download for YouTube node.
- [ ] Stand up n8n in **queue mode**: Postgres for shared workflow storage, Redis for the job queue, `n8n-main` + `n8n-worker` roles.
- [ ] Deploy n8n main/worker on Kubernetes; configure **KEDA** autoscaling of worker replicas on Redis queue depth.
- [ ] Build the backend **fan-out dispatcher** (`Promise.allSettled` over selected platforms) and **per-`(user, platform)` rate limiter** (token bucket sized to each platform's quota).
- [ ] Build Return Webhook Callback handler on backend; implement per-callback `PostLogs` insert + cross-callback aggregation into `Posts.status` (Section 6).

### Phase 4 — History, Error Center & Notifications
- [ ] Build History Dashboard & Error Center UI.
- [ ] Implement WebSockets/SSE for live dashboard updates.
- [ ] Set up Email Notification service (Resend / SendGrid).
- [ ] Implement "One-Click Retry" for failed post attempts.

---
*Created: 2026-08-14 | Master Specification for Social Media Auto-Poster SaaS*  
*Updated: 2026-09-06 | Revised architecture: per-platform n8n workflows (not one monolithic workflow), n8n queue mode + Kubernetes/KEDA scaling, backend-owned fan-out/rate-limiting/aggregation. Source: separate planning discussion, recapped by Kushagra.*
