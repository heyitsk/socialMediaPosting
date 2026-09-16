# 📜 Project History — smPosting

> **Purpose**: Running log of every decision, file change, and completed task.  
> Update this file at the end of every working session.  
> Reference this first when resuming work — no need to re-read all docs.

---

## Quick State Snapshot

| Item | Value |
|------|-------|
| **Current Phase** | V1 n8n workflows ✅ all tested (`facebook-poster`/`instagram-poster`/`threads-poster`/`youtube-poster`); Pinterest pending Developer App review. V2 SaaS (`websitePlan.md`) Phase 1 backend scaffold is live — Bun/Hono + Prisma + Facebook OAuth connect flow + first real end-to-end dispatch loop (Composer → backend → `facebook-poster` n8n workflow → Graph API → callback → `PUBLISHED`) confirmed working Sep 16. Other platforms (Instagram/Threads/YouTube/Pinterest) not yet wired to the backend — only their standalone n8n workflows are tested. |
| **Active Platforms** | Facebook, Instagram, Reddit, YouTube, Pinterest |
| **Excluded (V1)** | Quora (no API), X/Twitter (deferred to V2) |
| **Credential Scope** | Single user (your own accounts) |
| **n8n Setup (V1 workflows)** | Self-hosted Docker (container: `n8n`, project: InternApplier) — used for building/testing the standalone platform workflows in `workflows/` |
| **n8n Setup (V2 SaaS backend)** | Separate, project-scoped Docker container (`smposting-n8n`, part of `backend/docker-compose.yml`, own Postgres/Redis) — migrated off the shared InternApplier container Sep 16 so the SaaS backend doesn't depend on an unrelated project's n8n instance. Sets its own `CALLBACK_SECRET` and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (see Session 18). |
| **n8n URL (local)** | http://localhost:5678 |
| **n8n Public URL (temp)** | https://breach-payer-sharpie.ngrok-free.dev |
| **OAuth Callback URL** | https://breach-payer-sharpie.ngrok-free.dev/rest/oauth2-credential/callback |
| **Tunnel** | ngrok (free static domain) ✅ Working — free plan only grants one static domain, so the SaaS backend uses it for `PUBLIC_BACKEND_URL`/OAuth callbacks while `N8N_BASE_URL` points at `http://localhost:5678` directly (same machine, no tunnel needed — see Session 18) |
| **Tunnel log** | `ngrok status` / dashboard |
| **Content Source** | Google Sheets (content calendar) |
| **Media Hosting** | Cloudinary (free tier) |

---

## File Index

| File | Purpose | Last Updated |
|------|---------|--------------|
| `planning.md` | Full V1 product plan, API research, workflow architecture, roadmap | 2026-08-11 |
| `setup.md` | Step-by-step account setup guide for all platforms | 2026-08-11 |
| `history.md` | This file — running session log | 2026-08-11 |
| `docker-compose.yml` | n8n Docker configuration with all required env variables | 2026-08-11 |
| `workflows/` | n8n workflow JSON exports (importable into n8n) | 2026-09-07 |
| `websitePlan.md` | V2 SaaS product & technical spec (architecture, OAuth, DB schema, roadmap) | 2026-09-11 |
| `trialBun/` *(external, `/home/kushagra/Desktop/trialBun`)* | BullMQ/ioredis-under-Bun spike test scaffold — not part of this repo | 2026-09-11 |

---

## Session Log

---

### Session 1 — 2026-08-11

**What we did:**
- Researched n8n native node availability for all 7 target platforms
- Confirmed platform support matrix:
  - Facebook ✅ — native `Facebook Graph API` node
  - Instagram ✅ — same Meta node, 2-step publish flow
  - Reddit ✅ — native `Reddit` node (Script app type)
  - YouTube ✅ — native `YouTube` node (Google OAuth2)
  - Pinterest ✅ — `HTTP Request` node → Pinterest API v5 (no native node)
  - Quora ❌ — no public API, excluded from V1
  - X/Twitter ⏳ — native node exists but paid API only; deferred to V2
- Created `planning.md` — full product planning document
- Created `setup.md` — account setup guide for all platforms

**Decisions made:**
1. Quora excluded from V1 — no safe automation path
2. X/Twitter deferred to V2 — fully paid API (~$0.20/tweet with links)
3. V1 = single credential set (your own accounts); multi-client is a V2 website feature
4. Docker video handling resolved — use `filesystem` binary mode + volume mount
5. Google Sheets = content calendar / source of truth
6. Cloudinary = media hosting (free tier, 25GB)

**Files created:**
- `planning.md`
- `setup.md`

---

### Session 2 — 2026-08-11

**What we did:**
- Applied all user decisions to `planning.md`
- Updated platform table with V1 status (✅/❌/⏳)
- Removed X/Twitter from all roadmap phases
- Rewrote Section 7 with full Docker video handling config
- Replaced "Open Questions" with "Decisions Log" (all 8 resolved)
- Started **Phase 1 — Foundation**
- Created `history.md`, `docker-compose.yml`, `workflows/` directory

**Phase 1 checklist:**
- [x] `history.md` created
- [x] Docker configured — 3 env vars added to existing InternApplier n8n container
- [x] n8n container restarted and verified (`filesystem` mode confirmed live)
- [x] Cloudinary account created for media hosting
- [x] Google Sheet content calendar set up with separate date/time columns & ISO formula
- [x] Meta Developer App created & Use Cases configured
- [x] Facebook Graph API credentials configured & Instagram Business ID retrieved
- [x] Facebook Page & Instagram posting workflows built and tested

**Files created this session:**
- `history.md` (this file)
- `workflows/` directory

---

### Session 3 — 2026-08-11

**What we did:**
- Answered Docker question: **no separate n8n instance needed** — use existing one
- Inspected existing container (ID: `0b36cdb21231`, project: InternApplier)
- Found existing n8n compose file at: `/home/kushagra/Desktop/InternApplier/docker-compose.yml`
- Key findings from existing setup:
  - ✅ Volume mount already exists (`n8n_data` named volume — data is persistent)
  - ✅ Timezone already set correctly (`Asia/Kolkata`)
  - ✅ Running with `--tunnel` flag — auto-generates public HTTPS URL for OAuth callbacks (great for Meta/Pinterest/Reddit)
  - ❌ Missing: `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` (critical for YouTube)
  - ❌ Missing: `N8N_PAYLOAD_SIZE_MAX=4000`
  - ❌ Missing: `EXECUTIONS_DATA_PRUNE=true`
- Added all 3 missing vars to `/home/kushagra/Desktop/InternApplier/docker-compose.yml`
- Restarted container with `docker compose up -d --force-recreate n8n`
- Verified all vars are live ✅

**Key note on `--tunnel`:**  
n8n's tunnel gives your local instance a public URL automatically. You can find it in the n8n logs or editor — it looks like `https://[id].hooks.n8n.cloud`. Use this URL as the OAuth callback/redirect URI when setting up Meta, Pinterest, Reddit developer apps in `setup.md`.

**Files modified this session:**
- `/home/kushagra/Desktop/InternApplier/docker-compose.yml` — added 3 env vars
- `history.md` — updated Phase 1 checklist + added this session log

---

### Session 4 — 2026-08-11

**What we did:**
- Investigated n8n tunnel URL — confirmed `--tunnel` flag did NOT produce a public URL
- n8n v2.13.4 startup logs only showed `http://localhost:5678` (tunnel service didn't connect)
- Determined that a **public HTTPS URL is required** for OAuth callbacks from Meta, Pinterest, Reddit
- `cloudflared` was already installed on the system
- Tested quick `trycloudflare.com` tunnel briefly, then stopped it
- **Decision: purchase a domain and set up a Cloudflare named tunnel** (permanent URL, best for production)
- Stopped temporary tunnel (`pkill cloudflared`)

**BLOCKED ON:**  
Cloudflare named tunnel setup. Domain being purchased.

**When you resume:**  
Once your domain is in Cloudflare DNS, come back and say "domain is ready" — I'll walk you through:
1. `cloudflared login` → authenticate with Cloudflare
2. `cloudflared tunnel create smposting` → create named tunnel
3. Set up a DNS CNAME record (`n8n.yourdomain.com` → tunnel)
4. Create tunnel config file pointing to `http://localhost:5678`
5. Run tunnel as a systemd service (auto-starts with the machine)
6. Update `WEBHOOK_URL` in `docker-compose.yml` to the new public URL
7. Restart n8n container

**Your OAuth callback URL will then be:**
```
https://n8n.yourdomain.com/rest/oauth2-credential/callback
```
This goes into Meta Developer App, Pinterest Developer App, Reddit App, Google Cloud Console.

**Files modified this session:**
- `history.md` — added Session 4 log + blocked state

---

### Session 5 — 2026-08-12

**What we did:**
- Resolved Meta Graph API Explorer issues due to deprecated permissions (e.g., `manage_pages`).
- Configured permissions under the Meta App "Use Cases" Dashboard (instead of the deprecated "Products" UI).
- Successfully queried `me/accounts` to retrieve the Instagram User ID (Instagram Business Account ID).
- Opted for the **permanent Page Access Token** authentication method to avoid domain verification and callback URL requirements for local testing.
- Skipped Reddit Developer App setup for now due to Reddit's new manual approval/pre-approval blocker policy for API access.
- Created Google Cloud Project `SMPosting V1`, enabled **YouTube Data API v3**, configured Google Auth Platform OAuth consent screen (External, added test users, added scopes), and successfully generated OAuth 2.0 Web Application credentials.
- Configured **Pinterest developer app** and successfully bypassed the trial-access block by generating a direct **Sandbox Developer Access Token** (enabling write access to pins and boards for testing).
- Designed and set up the **Google Sheets Content Calendar** with separate `scheduled_date` and `scheduled_time` columns, and a custom ISO-combining formula (`scheduled_datetime`).

**Decisions made:**
- Use the permanent Page Access Token method instead of OAuth2 for Facebook/Instagram integration.
- Postpone Reddit integration until manual developer application approval is granted.
- Use Pinterest Sandbox tokens with the `HTTP Request` node to bypass manual trial approval delays during testing.
- Separate date and time fields in Google Sheets to optimize user input flow.

**Files modified this session:**
- `history.md` — updated status logs and Phase 1 checklist

---

### Session 6 — 2026-08-14

**What we did:**
- Successfully tested Facebook Page posting using the Facebook Graph API node in n8n (POST to `feed` for text/links, POST to `photos` with `url` parameter, POST to `videos` with `file_url` parameter).
- Resolved Facebook video post behavior (asynchronous processing): monitored status via `GET /{video-id}?fields=status`.
- Successfully tested Instagram posting via Facebook Graph API node using a 2-step flow (POST to `media` to create a container ID, then POST to `media_publish` with `creation_id`).
- Resolved Meta OAuth exception error code 190 by regenerating a **User Access Token** with all necessary linked-page permissions (`instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`).

**Decisions made:**
- Use the 2-step flow for Instagram posts directly in the Graph API node.
- Ensure the Instagram integration uses a User Access Token with both Instagram permissions and linked Facebook Page read permissions.

**Files modified this session:**
- `history.md` — updated with Session 6 progress

---

### Session 7 — 2026-08-14

**What we did:**
- Researched why YouTube node requires binary data instead of a URL (unlike Meta which accepts `file_url` directly — YouTube Data API v3 does not support URL-based uploads).
- Identified all free methods to get video as binary before the YouTube node, ordered by complexity:
  1. HTTP Request node (GET → Response Format: File) — simplest
  2. Read/Write Files from Disk node — local file on server
  3. Google Drive node (Download operation) — recommended for current phase
  4. Dropbox / OneDrive / Box nodes — alternative cloud storage
  5. S3-compatible storage (Cloudflare R2 / Backblaze B2) — planned for production
  6. Code node (Node.js fetch → Buffer) — advanced custom logic
  7. Execute Command node (wget/curl) — self-hosted only
  8. yt-dlp via Execute Command — for social platform source URLs
- **Decision: use Google Drive node now → migrate to S3 node in production phase.**
- Set up **Google Drive node** (Resource: File, Operation: Download, Output Field: `data`).
- Enabled both **Google Drive API** and **YouTube Data API v3** on the same Google Cloud project (`SMPosting V1`) so a single OAuth client covers both nodes.
- Resolved `invalid_client` / `The provided client secret is invalid` OAuth error:
  - Root cause: copy-paste issue with client secret (special characters truncated)
  - Fix: used the copy icon (📋) in Cloud Console instead of manual text selection
  - Also verified OAuth consent screen test users were configured correctly
  - Also confirmed redirect URI exactly matched: `https://breach-payer-sharpie.ngrok-free.dev/rest/oauth2-credential/callback`
- Successfully authenticated both Google Drive and YouTube nodes with OAuth2.
- Tested end-to-end: Google Drive download → YouTube upload → video published ✅
- Researched **YouTube Shorts** upload flow:
  - No separate API endpoint or node action exists for Shorts
  - YouTube auto-classifies a video as a Short if: duration ≤ 60s + aspect ratio is 9:16 (vertical) + `#Shorts` in title or description
  - **No workflow changes needed** — same YouTube node works; just add `#Shorts` hashtag and ensure source video is vertical
  - For vertical Pexels videos, use `orientation=portrait` query param in the Pexels API
- Tested YouTube Shorts upload — video correctly appeared as a Short in YouTube Studio ✅

**Decisions made:**
- Use Google Drive node as the video binary source for now; switch to S3 node in production.
- Single Google Cloud OAuth client covers both Google Drive and YouTube APIs (no separate credential needed).
- YouTube Shorts = same upload flow as regular videos; no special node or HTTP Request needed.
- Source videos for Shorts must already be in 9:16 format before entering n8n — n8n does not do video transcoding.
- Always test uploads with `Privacy: private` first, then check YouTube Studio for the Short label before making public.

**Files modified this session:**
- `history.md` — updated with Session 7 progress

---

### Session 8 — 2026-08-14

**What we did:**
- Exchanged Threads short-lived access token for a 60-day long-lived access token using `curl` against the `https://graph.threads.net/access_token` endpoint.
- Configured Threads API publishing in n8n. Because there is no native Threads node, we set up a 2-step publishing flow using two **HTTP Request** nodes targeting `graph.threads.net` (POST to `/me/threads` to create a container, and POST to `/me/threads_publish` to publish it).
- Resolved a 400 Bad Request error (media not found) during video publishing by adding a **Wait** node (30-60s) between container creation and publishing to allow Threads' asynchronous video processing to complete.

**Decisions made:**
- Use n8n **HTTP Request** nodes for all Threads API actions due to the lack of a native n8n Threads node.
- Account for asynchronous media/video transcoding delays on Threads by introducing a delay or polling status before invoking the publish endpoint.

**Files modified this session:**
- `history.md` — updated with Session 8 progress

### Session 9 — 2026-08-24

**What we did:**
- **Multi-Post Type Matrix Expansion**:
  - Updated the upfront `Code in JavaScript` node to split comma-separated strings for both `platform` (e.g., `Instagram, Facebook`) and `post_type` / `media_type` (e.g., `photo, video, carousel, story`).
  - Emits individual workflow stream items for each combination containing `target_platform` and `target_post_type`.
- **Instagram Sub-Routing by Post Type**:
  - Added a downstream `Route IG Post Type` Switch node after `Route Platform` (Instagram output) to route items to 4 distinct branches: `photo`, `video`, `carousel`, and `story`.
- **Instagram Direct Photo Publishing**:
  - Successfully tested native Instagram photo posting with direct media URL and caption passing.
  - Removed redundant wait containers for single photo posts since the node returns the publish ID directly upon completion.
- **`Record Success` & `Record Error` Architecture Refactoring**:
  - Replaced legacy loop code (which referenced non-existent `$node['Initialize Row']` and `$node['Get Next Platform']`).
  - Configured `Record Success` and `Record Error` to run in **"Run Once for Each Item"** mode to leverage n8n's native paired-item mapping (`$('Code in JavaScript').item.json`).
  - Preserved original Google Sheet row identifiers (e.g., `post_id: POST_001`) while recording the live API response (`result_id` / `instagram_published_id`).
- **Validation & Execution Fixes**:
  - Diagnosed pre-execution workflow validation blocker (*"The workflow has issues and cannot be executed..."*): resolved by disabling unconfigured placeholder nodes (Facebook, YouTube, Drive, etc.) on the canvas.
  - Clarified item aggregation vs. item execution modes across `Record Success` (Each Item) and `Aggregate Results` (All Items).

**Decisions made:**
- Split `platform` and `post_type` upfront in the primary Code node rather than using separate splitters per platform branch.
- Set `Record Success` / `Record Error` nodes to **"Run Once for Each Item"** mode to ensure correct paired item matching across rows and prevent `.first()` data overwriting.
- Aggregate all branch outputs in `Aggregate Results` running in **"Run Once for All Items"** mode prior to Google Sheets row update.

**Files modified this session:**
- `history.md` — updated with Session 9 progress and decisions

### Session 10 — 2026-08-24

**What we did:**
- Built and refined the **Aggregate Results (Code)** node in n8n for consolidating multi-branch social media posts into a single summary row for Google Sheets.
- Resolved an issue where running multiple branch uploads (e.g. Instagram Photo vs Story vs YouTube) resulted in split executions / duplicate output records instead of a unified record.
- Identified limitation of n8n **Merge node**:
  - In *Combine / Append* mode, the Merge node stalls when only one branch runs (e.g., Photo only, while Story is skipped) because it waits indefinitely for input on all ports.
- **Architectural Solution (Merge Node Elimination / Direct Node Lookup)**:
  - Eliminated the Merge node completely.
  - Connected upload/record branch outputs directly into the **Aggregate Result (Code)** node (configured with mode: *Run Once for All Items*).
  - Used n8n's direct node access `$('Node Name').all()` inside `try...catch` blocks to dynamically fetch outputs from only the branches that actually executed.
- Cleaned up parent JSON payload:
  - Removed temporary per-branch fields (`target_platform`, `target_post_type`, `result_status`, `result_id`, `result_error`, etc.) from the root row object.
  - Aggregated platform post IDs into `final_post_id` / `post_id` (e.g. `instagram (photo): 18107... | instagram (story img): 17955...`).
  - Output clean error messages to `final_error` / `error_message` (empty string when no errors occur, rather than `"None | None"`).
  - Updated Google Sheets `status` column directly to match dropdown options (`"Posted"`, `"Partial Success"`, or `"Error"`).
  - Added ISO timestamp to `posted_at` upon successful publication.

**Decisions made:**
- Do not use Merge nodes for multi-branch conditional workflows where certain branches may be skipped; use direct node queries (`$('Node Name').all()`) in a Code node instead.
- The Code node must run in "Run Once for All Items" mode to aggregate array items across all rows and branches.
- Google Sheets `status` dropdown column is overwritten directly with the calculated status (`Posted`, `Partial Success`, `Error`).

**Files modified this session:**
- `history.md` — updated with Session 10 progress and decisions

---

### Session 11 — 2026-08-24

**What we did:**
- Addressed n8n Merge node stalling issues and duplicate output bugs caused by item-level matrix splitting.
- Designed a **Hybrid Architecture** for multi-post uploads (e.g., Instagram Photo + Story):
  - **Platform-Level Splitting:** Modified the primary JS Code node to only split target platforms (creating 1 item per platform) and pass `post_type` as a combined raw string.
  - **Sequential Post-Type Routing:** Replaced the Instagram Post Type router with a linear chain of IF nodes (Photo → Story → Video → Reel). This guarantees a single item flows through without creating parallel branches that stall the Merge node.
  - **Consolidated Aggregation:** Merged the `Record Success` and `Aggregate Results` logic into a single final Code node at the end of the Instagram branch. The node dynamically fetches results from the preceding upload nodes via `$('Node Name').item.json` in `try...catch` blocks.

**Decisions made:**
- Abandoned the n8n Merge node for optional branch aggregation due to its strict wait-for-all-inputs behavior.
- Adopted sequential IF-node chaining for sub-post types (like Instagram variants) to maintain single-item execution integrity and prevent double-triggering of downstream nodes.

**Files modified this session:**
- `history.md` — updated with Session 11 progress and architectural changes

---

### Session 12 — 2026-09-06

**What we did:**
- Kushagra had a separate research conversation on claude.ai exploring V2 SaaS tech-stack options (evaluated copying GitHub Python/Selenium bot projects, rejected them as ToS-risky and not SaaS-grade) and worked through how a web app should sit in front of n8n.
- Recapped that conversation here, then revised `websitePlan.md` to match the resulting direction — a real architecture change from the doc's original single-workflow design:
  - **Per-platform n8n workflows** (`facebook-poster`, `instagram-poster`, `threads-poster`, `youtube-poster`) instead of one workflow with an internal Switch node routing all platforms — isolates versioning, logs, and retry/rate-limit logic per platform.
  - **Multi-platform parallelism now lives in the backend**, not n8n: the Node/Express backend fires parallel webhook calls (`Promise.allSettled`), one per selected platform, each with only that platform's payload + decrypted token.
  - **n8n runs in queue mode** for scale: `n8n-main` (webhook receiver, pushes jobs to Redis) + `n8n-worker` replicas (pull jobs, read the shared workflow definition from Postgres, execute). Main/worker are stateless copies of the same app — neither "owns" a workflow.
  - **Kubernetes + KEDA** autoscale `n8n-worker` replica count based on Redis queue depth.
  - **Real bottleneck flagged as platform API rate limits** (Graph API, YouTube quotas), not compute — added a per-`(user, platform)` token-bucket rate limiter in the backend, ahead of dispatch to n8n.
  - Updated the webhook payload/callback schemas (Sections 5–6 of `websitePlan.md`) from one bundled multi-platform call to one call + one callback per platform, with the backend now owning result aggregation into `Posts.status` (previously an n8n "Aggregate Results" code node in the old single-workflow design).
  - Flagged an unresolved naming conflict: the recap called the stack "MERN," but `websitePlan.md`'s DB schema (Section 7) is relational PostgreSQL, not MongoDB — left as an open question in the doc rather than resolved unilaterally.

**Decisions made:**
- `websitePlan.md` is the source of truth for V2 architecture going forward; its Section 1/5/6 diagrams and schemas now reflect per-platform workflows + queue mode + K8s/KEDA + backend-owned rate limiting and aggregation.
- Credentials are passed to n8n per-call (decrypted by the backend at dispatch time) and are never stored in or read from n8n itself.
- Confirm with Kushagra whether "MERN" should be taken literally (→ Mongo, requiring a Section 7 schema redesign) or was shorthand for a Node/Express/React stack sitting on the existing Postgres schema.

**Files modified this session:**
- `websitePlan.md` — Sections 1, 5, 6, 7, 8 revised for the per-platform-workflow / queue-mode / K8s architecture; header and footer updated
- `history.md` — added Session 12 log + `websitePlan.md` row in File Index

---

### Session 13 — 2026-09-07

**What we did:**
- Corrected `websitePlan.md` §5: `facebook-poster` is documented as an `HTTP Request` node, not the typed `Facebook Graph API` node — its `Credential` field is bound to an n8n-stored credential at design time and has no expression/`fx` option, so it can't take a per-call dynamic token. Same limitation confirmed for the community Instagram node and the built-in Google Drive node. Standing pattern going forward: every platform-calling node in these workflows is a plain `HTTP Request` with `authentication: none`, token injected via expression from the webhook payload — never an n8n-stored credential.
- Built and **tested successfully** `workflows/instagram-poster.json`: webhook → routes on `media_type` (`IMAGE`/`CAROUSEL`/`REELS`/`STORIES`) → per-type container→wait→publish `HTTP Request` chains → `Build Success/Error Result` → `Send Callback`, plus an `Error Trigger` island that recovers `post_id`/`callback_url` from the failed run's `Parse Request` output via `$json.execution.data.executionData.resultData.runData`. Confirmed working for photo, story, and reel.
- Built `workflows/facebook-poster.json` (same shape, routes on `TEXT`/`PHOTO`/`MULTI_PHOTO`/`VIDEO`). `MULTI_PHOTO` mirrors Instagram's carousel pattern: upload each photo unpublished → aggregate returned IDs → one `/feed` call with `attached_media`. Facebook Reels deferred — needs the structurally different chunked `video_reels` resumable-upload API, not a quick addition. **Not yet tested.**
- Built and **tested successfully** `workflows/threads-poster.json` (routes on `TEXT`/`IMAGE`/`VIDEO`). Confirmed `graph.threads.net` is a fully separate host/app/token/quota pool from Facebook/Instagram's `graph.facebook.com` before building — relevant since we'd just hit a Facebook-side block and needed to know it wouldn't carry over. No Page/Business ID needed; posts via `/me/threads`, tied directly to the user's own token.
- Built `workflows/youtube-poster.json` — structurally different from the other three since YouTube Data API v3 needs actual uploaded bytes, not a URL Graph API can fetch server-side. `Download Video` and `Initiate Resumable Upload` run in parallel (they don't depend on each other) and recombine via a `Merge` node, since an `HTTP Request` node's output replaces the item it received — a sequential chain would drop the downloaded binary before the final `Upload Video Binary` PUT to the session URL from the init call's `Location` header. Replaces the old Google Drive node (same per-call-credential problem as Facebook/Instagram's typed nodes) with a generic HTTP GET on `media_urls[0]` — any public URL works; used a Drive "anyone with the link" direct-download URL as a stand-in for S3 during testing. **Not yet tested** — blocked by the quota issue below before the `Merge`/binary-body wiring could be confirmed live.
- Hit two real platform errors during testing, both written into `websitePlan.md` §5/§6:
  - **Meta error `368` / subcode `1390008`** ("spam prevention") on Instagram's `Publish Photo Post` — an abuse heuristic, not a countable rate limit; doesn't respond to retry/backoff, can block for minutes to ~24h.
  - **YouTube `quotaExceeded` (429)** on `Initiate Resumable Upload` — checked Cloud Console's Quotas dashboard directly: `Video Uploads per day` shows limit 100, usage 0%, confirming **the number shown in Console is not what's actually enforced.** YouTube gates the upload feature behind a separate, undocumented restriction for any project that hasn't completed Google's **Audit and Quota Extension** process — project-wide (shared across every future SaaS user), not per-user, and not something a rate limiter can route around.

**Key findings (carry into next session):**
- Facebook Page is likely still cooling down from the code-368 block — `facebook-poster.json` is built but untested; check whether the block has lifted, then test `TEXT` first.
- YouTube uploads are hard-blocked project-wide until the Audit and Quota Extension request is filed and approved (realistic lead time: days to weeks). This is a **pre-launch dependency for the whole SaaS**, not just today's problem — worth filing soon given the lead time, even before the backend exists. Also check OAuth consent screen "Publishing status" (Testing vs. In Production) while in Cloud Console — a related but separate gate.
- General pattern now proven across three platforms: n8n's typed, credential-bound nodes (Facebook Graph API, Instagram community node, Google Drive) cannot take a per-call dynamic token under any configuration — plain `HTTP Request` + payload-injected token is the only way to make per-user credentials work in a multi-tenant n8n workflow.

**Decisions made:**
- `websitePlan.md` §5 corrected: `facebook-poster` uses `HTTP Request`, not the typed node — matches what was actually built.
- `websitePlan.md` §5/§6 updated with the rate-limit-vs-abuse-block distinction (measured quota throttling via `X-App-Usage`/`X-Page-Usage` headers vs. a circuit breaker for Meta code 368) and new callback schema fields (`error_type`, `usage`).
- Next session picks up: (1) confirm Facebook Page cooldown has lifted, test `facebook-poster.json`; (2) file the YouTube Audit and Quota Extension request; (3) retest `youtube-poster.json` once approved (or find another way to sanity-check the `Merge`/binary-body wiring in the meantime, since the quota gate blocked confirmation this session).

**Files modified this session:**
- `workflows/instagram-poster.json` — new, tested (photo/story/reel)
- `workflows/facebook-poster.json` — new, untested
- `workflows/threads-poster.json` — new, tested
- `workflows/youtube-poster.json` — new, untested (blocked by YouTube's upload-audit gate)
- `websitePlan.md` — §5 `facebook-poster` node type corrected; §5/§6 rate-limit vs. abuse-block distinction and callback schema fields (`error_type`, `usage`) added
- `history.md` — this entry, File Index, Platform Credential Reference, and Key Technical Decisions updated

---

### Session 14 — 2026-09-08

**What we did:**
- Confirmed the Facebook code-368 block from Session 13 was **still active a full day later** — retried `facebook-poster.json`'s `Publish Photo Post` and got the identical `code: 368` / `error_subcode: 1390008` response. Checked Meta Business Suite's Account Quality page as a possible status source; it showed nothing actionable, confirming there's no reliable way to check remaining cooldown time for this error — it's silent until it lifts.
- Flagged that the pasted n8n execution log contained a live Facebook access token in plaintext (`qs.access_token`) — same class of exposure as the `cred.txt` issue from Session 1; token should be rotated before further use since it's now sitting in conversation history.
- Verified via Cloud Console's Quotas & System Limits page that `Queries per day`/`Queries per minute`/`Search Queries` all show 0% usage — reconfirmed this dashboard is disconnected from the actual upload-audit gate and can't be used to check block status either.
- Got a fresh OAuth token via OAuth Playground (had to add `https://developers.google.com/oauthplayground` as an authorized redirect URI on the `SMPosting V1` OAuth client first) and isolate-tested the **`Initiate Resumable Upload`** node alone (pinned mock data on `Parse Request`, bypassing the Webhook trigger's listen-mode hang that "Execute previous nodes" caused). Got back a clean `200 OK` with a valid resumable-upload `Location` URL — **the YouTube upload-audit gate has lifted.**
- Ran the full `youtube-poster.json` workflow end-to-end and found the `Validate Payload` → `Initiate Resumable Upload` connection was actually missing on canvas (the `true` output was only wired to `Download Video`) — items silently never reached the second parallel branch. Reconnected it manually; full flow (`Download Video` ∥ `Initiate Resumable Upload` → `Merge` → `Upload Video Binary`) then ran successfully end-to-end for the first time.
- Sourced a verified public 9:16, 10s, CC0 test clip (`https://cdn.truefilesize.com/mp4/sample-portrait.mp4`) to test Shorts via Google Drive, since the original test video had issues. Confirmed regular video upload and Shorts upload (via `#Shorts` in title/description, no workflow changes needed — same as the old native-node behavior) both work through the new HTTP-based flow.
- Discussed what S3 actually changes vs. the Drive stand-in: **nothing in the workflow** — `Download Video` already does a generic `GET` on `media_urls[0]`, so Drive vs. S3 is transparent to n8n. The only real design implication is that S3 objects aren't public by default, so the backend must either use a public-read bucket or generate presigned GET URLs with a TTL that survives Redis queue delays + download time.
- Identified a scaling gap in `youtube-poster.json`: `Download Video` fully buffers the video into n8n binary storage before `Upload Video Binary` sends anything to YouTube — total time is download + upload, not overlapped. Initially thought this also risked an OOM crash and "patched" it by adding `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` to `~/.zshrc` — **turned out to be a misdiagnosis**: that env var was already set on the actual n8n instance (the Docker container `n8n`, part of the `internapplier` docker-compose project, which is what's really behind the ngrok tunnel), confirmed via `docker inspect n8n`. The host-level `node /usr/local/bin/n8n start` process I'd checked instead is an unrelated stray/orphaned instance, not what's actually serving `localhost:5678`/the tunnel. Reverted the unnecessary `~/.zshrc` edit.

**Key findings (carry into next session):**
- Meta code-368 blocks have no queryable status/countdown anywhere (not Business Suite, not the API) — the only mitigation is not retrying repeatedly (may prolong it) and building the backend circuit breaker from `websitePlan.md` §5 rather than relying on manual checking.
- YouTube's upload-audit gate (Session 13) has lifted for this project — resumable-upload init calls now succeed. Unclear whether this was the actual audit resolving or something else; worth noting if it's still fine in future sessions.
- `youtube-poster.json` is now **fully tested and working** for standard video, Shorts, and the previously-unverified `Merge`/binary-body wiring — the missing `Validate Payload → Initiate Resumable Upload` connection was the only real bug, not the merge logic itself.
- The true fix for the YouTube download→upload bottleneck is a streaming relay (Code node piping the S3 GET stream directly into the YouTube PUT stream), not just the memory-mode patch — documented in `websitePlan.md` §3 as a pre-production to-do, not yet built.

**Decisions made:**
- No action needed on binary mode — already correctly configured on the real n8n Docker container. `~/.zshrc` edit reverted since it targeted the wrong (unused) n8n instance.
- `websitePlan.md` §3 updated with a callout on the download-then-upload bottleneck and the streaming-relay fix, flagged as a pre-launch to-do for when the real (non-test) YouTube workflow is built — this part still stands regardless of the binary-mode mixup, since streaming vs. buffering is a speed/architecture issue, not a memory-config one.
- Rotate the Facebook access token pasted in this session's chat before reusing it — treat it as compromised.
- Confirmed n8n setup is Docker-based (`docker-compose` project `internapplier`, container `n8n`, volume `n8n_data` → `/home/node/.n8n`) — matches `history.md`'s existing Quick State Snapshot. The stray host-level `n8n start` process (PID 3498) was confirmed unrelated/orphaned and **killed** — no impact on the real (Dockerized) instance or the ngrok tunnel, since it wasn't the thing actually serving `localhost:5678`.

**Files modified this session:**
- `websitePlan.md` — §3 streaming-relay/download-bottleneck callout added
- `history.md` — this entry, Quick State Snapshot, Platform Credential Reference, and Key Technical Decisions updated
- Killed orphaned host process `node /usr/local/bin/n8n start` (PID 3498) — no file changed, config cleanup only

---

### Session 15 — 2026-09-10

**What we did:**
- Confirmed `facebook-poster.json`'s `MULTI_PHOTO` (carousel) flow tested successfully end-to-end once the earlier Graph API rate limit cleared — closes out the last "untested" post type from Session 13. Pinterest remains pending (Developer App still in manual review, per §5 case 4).
- Compiled full OAuth 2.0 implementation details for all 5 V1 platforms (Facebook, Instagram, Threads, YouTube, Pinterest) — authorization URLs, scopes, code/token-exchange endpoints, long-lived/refresh-token handling — and wrote them into `websitePlan.md` §2 as five per-platform subsections, plus a "what runs where" split (platform's servers own the consent screen; our backend owns everything from code-exchange onward, server-to-server).
- Identified that the three refresh-token shapes across those 5 platforms aren't uniform: Facebook/Instagram tokens are effectively non-expiring (`NONE`), Threads/Pinterest need a proactive scheduled refresh before a sliding expiry window closes (`SLIDING_WINDOW` — though Threads renews in place while Pinterest consumes a separate refresh token to mint a new one, different call shapes under the same schedule), and YouTube's refresh token never expires and is just exchanged on-demand right before each upload (`ON_DEMAND`). Revised `websitePlan.md` §7 `ConnectedAccounts` schema accordingly: added `PINTEREST` to the platform enum, added `encrypted_refresh_token` and `refresh_strategy` columns, made `token_expires_at` nullable.
- Locked in the backend tech stack after evaluating alternatives:
  - **Runtime/framework**: Bun + Hono (not Elysia — too Bun-coupled for a backend that also leans on Node-ecosystem packages like BullMQ; not Encore — its infra-provisioning opinions conflict with the already-chosen self-managed Postgres/Redis).
  - **DB/ORM**: Docker-hosted PostgreSQL + Prisma via driver adapter (`@prisma/adapter-pg`), confirmed compatible with Bun firsthand on a prior project — avoids Prisma's native Rust-binary engine and its rougher edges under Bun.
  - **Frontend**: Vite + React (plain SPA), calling the Hono API directly.
  - **Job queue**: BullMQ + `ioredis` for the reliability-critical refresh scheduler and dispatch retries — evaluated `bunqueue` (SQLite/Postgres-backed, BullMQ-compatible API, no Redis) as an alternative but kept it as a named fallback only, given it's a ~1-year-old, single-maintainer project versus BullMQ's years of production hardening. Flagged that `ioredis` under Bun is the one genuinely unverified compatibility risk in the stack — needs a spike test (queue + worker, kill mid-job, confirm recovery) before scaffolding.
  - **Pub/Sub**: Bun's native Redis client for the SSE/live-update layer — noted it's explicitly labeled experimental in Bun's own docs, so it should sit behind a thin swappable interface rather than be hard-wired everywhere.
  - **Object storage**: confirmed S3 (via Bun's native Zig-based S3 client, no `@aws-sdk/client-s3` needed) for the backend's own media handling. Evaluated **UploadThing** as a possible alternative and rejected it — it's a DX wrapper built on top of S3, not a replacement (no BYO-bucket, closed-source backend, weaker compliance posture), and it offers no capability the YouTube streaming-relay fix (§3) actually needs, since that fix is a Code node running inside n8n's own Node.js process (not our Bun backend) that just needs a URL to issue a streaming GET against — a presigned S3 URL already does that regardless of which client generated it.
- Wrote all of the above into `websitePlan.md`: header architecture line, new "Backend Tech Stack" table in §1, full §2 OAuth rewrite, §3 S3-client + UploadThing-rejection notes, §7 `ConnectedAccounts` schema, Phase 1 roadmap line, and footer changelog. Also swept and fixed stale "Node/Express"/"TypeORM"/"Next.js" references left over from the pre-Bun draft.

**Decisions made:**
- Facebook `MULTI_PHOTO` (carousel) is confirmed working — no longer a testing gap.
- `websitePlan.md` §2 is now the source of truth for per-platform OAuth implementation (endpoints/scopes/refresh handling), not just the general flow.
- `ConnectedAccounts.refresh_strategy` (`NONE` / `SLIDING_WINDOW` / `ON_DEMAND`) is the mechanism that drives refresh-job logic per platform, replacing scattered per-platform `if` branches.
- Backend stack finalized: Bun + Hono, Docker Postgres + Prisma (driver adapter), Vite + React, BullMQ + ioredis (bunqueue as fallback only), Bun native Redis client for pub/sub (behind a swappable interface), Bun native S3 client for object storage. UploadThing rejected.
- Next session must run the `ioredis`/BullMQ-under-Bun spike test before scaffolding the real backend — this is the one unverified assumption in the finalized stack.

**Files modified this session:**
- `websitePlan.md` — header/architecture line, new §1 "Backend Tech Stack" table, §2 fully rewritten with per-platform OAuth detail, §3 S3-client + UploadThing notes, §5 Facebook carousel status + heading fix, §7 `ConnectedAccounts` schema revised, §8 Phase 1 roadmap line, footer changelog; stale Node/Express/TypeORM references fixed
- `history.md` — this entry

---

### Session 16 — 2026-09-11

**What we did:**
- Worked through the token-encryption approach flagged as an open gap at the end of Session 15 (`websitePlan.md` §7 only said "AES-256," no mode/key-storage/rotation plan) — walked through why this is a hard requirement (tokens must be *reversibly* encrypted, not hashed like a password, since the backend needs the plaintext back to inject into the n8n webhook payload; a leak is equivalent to handing an attacker write-access to a user's social accounts with no password/2FA needed).
- Explained AES-GCM's nonce requirement in detail: a fresh random 12-byte nonce per encryption call is mandatory (reuse under the same key is a critical failure, not just weaker security), but the nonce itself isn't secret — resolved the "does this need its own column" question by packing `nonce || ciphertext || authTag` into one base64 blob stored in the existing `encrypted_access_token`/`encrypted_refresh_token` columns, no schema change needed for that part.
- Explained the key-rotation mechanics behind the `key_version` column proposed in Session 15: keeping both old and new keys in the app's lookup simultaneously decouples "start using the new key" (instant) from "finish re-encrypting old rows" (gradual, via a background job) — avoiding the downtime/one-time-migration problem a single global key would force.
- Locked in and wrote the full token encryption scheme into `websitePlan.md` §7 as a new **Token Encryption Scheme** subsection: AES-256-GCM via Bun's built-in `node:crypto`; nonce packed into the stored ciphertext blob; a single master key for now via env var (`TOKEN_ENCRYPTION_KEY_V1`), stored separately from Postgres, no Vault/KMS infra until there's a paying user to justify it; `key_version` column added to `ConnectedAccounts`; rotation procedure documented (add new key to lookup → flip new writes to new version → background job re-encrypts old rows → delete old key once unused); `encrypt()`/`decrypt()` utility called only from OAuth callback routes and the dispatch layer, never from the frontend or n8n.

**Decisions made:**
- Token encryption: AES-256-GCM (not just "AES-256"), nonce packed into the ciphertext blob (no new column), `key_version` column added to `ConnectedAccounts` for zero-downtime key rotation, master key starts as a single env var and graduates to cloud KMS envelope encryption only once scale/compliance actually demands it.
- `encrypt()`/`decrypt()` is backend-only, called from exactly two places (OAuth callback on connect/refresh; dispatch layer right before injecting into the n8n payload) — never touches the frontend or n8n, consistent with the existing rule that n8n never stores or reads credentials.

**Files modified this session:**
- `websitePlan.md` — §7 `ConnectedAccounts` schema: added `key_version` column, updated `encrypted_access_token`/`encrypted_refresh_token` descriptions; new "Token Encryption Scheme" subsection; §8 Phase 1 roadmap line updated; footer changelog
- `history.md` — this entry, Key Technical Decisions updated

---

### Session 17 — 2026-09-11

**What we did:**
- Ran the `ioredis`/BullMQ-under-Bun spike test flagged as the one unverified risk at the end of Session 15 — built a standalone Bun scaffold (`trialBun/`) with 7 test files against a local Redis, covering every reliability property BullMQ was chosen for: round-trip processing, crash recovery (`SIGKILL` a worker mid-job, confirm a second worker's stall detection completes it), repeatable jobs (`upsertJobScheduler`/`removeJobScheduler` — the mechanism behind the §6 video-status poller), retry/exponential backoff, concurrency (no cross-job data contamination), graceful shutdown (in-flight job finishes rather than being dropped), and `QueueEvents` delivery. All 7 passed.
- Along the way, clarified two conceptual points worth keeping straight for anyone else touching this layer later: (1) Bun's native `RedisClient` pub/sub (already tested separately) and BullMQ are not competing options — pub/sub is fire-and-forget messaging with no persistence/retry/state, while BullMQ is a full job-queue state machine built on Redis primitives (sorted sets, blocking list ops, Lua scripts) that pub/sub doesn't provide; the plan already scopes native `RedisClient` for the SSE broadcast layer and `ioredis`+BullMQ for the queue layer, and both coexist in the same app. (2) `ioredis` is just the Redis wire-protocol client; BullMQ is a framework built on top of it (declared as a dependency) that implements queue semantics — so the spike really tested two layered risks at once (does `ioredis` behave under Bun; does BullMQ's logic, which assumes `ioredis`'s exact API, hold up on top of it).
- Key implementation detail confirmed during testing: pass a plain `{ host, port }` object to each `Queue`/`Worker`/`QueueEvents` instance instead of a shared `ioredis` instance — avoids `maxRetriesPerRequest` config bugs and matches BullMQ's own recommendation against sharing one blocking connection across multiple Worker/QueueEvents instances.
- Wrote the full results into `websitePlan.md` §1 as a new "BullMQ/ioredis-under-Bun Spike Test Results" subsection, updated the Backend Tech Stack table rows (job queue risk → confirmed primary, `bunqueue` fallback → not needed), checked off the Phase 1 roadmap spike-test item, and added a footer changelog entry.

**Decisions made:**
- BullMQ + `ioredis` is now the **confirmed** primary job queue under Bun — the last unverified assumption in the finalized backend stack is resolved. `bunqueue` stays documented as an escape hatch only, not an active contingency.
- Connection pattern for the real backend: separate plain `{ host, port }` configs per `Queue`/`Worker`/`QueueEvents` instance, not one shared `ioredis` connection.
- Testing/scaffolding phase for the job-queue layer is done; nothing blocks starting the real Phase 1 backend scaffold (Bun + Hono, Postgres/Prisma, OAuth handlers) on this front anymore.

**Files modified this session:**
- `websitePlan.md` — §1 Backend Tech Stack table rows updated, new "BullMQ/ioredis-under-Bun Spike Test Results" subsection added, §8 Phase 1 roadmap item checked off, footer changelog entry added
- `history.md` — this entry, Key Technical Decisions updated
- `trialBun/` (outside this repo, at `/home/kushagra/Desktop/trialBun`) — spike-test scaffold, not part of `smPosting`'s tracked files

---

### Session 18 — 2026-09-16

**What we did:**
- **Facebook OAuth "Connect Account" flow wired up in the real backend** (`backend/src/routes/auth/facebook.ts`, `db/users.ts`, `lib/crypto.ts`), closing the gap between `websitePlan.md` §2.1 and actual code — token exchange confirmed completing successfully and `ConnectedAccounts` rows persisting with AES-256-GCM-encrypted tokens per the §7 scheme.
- **Global error handler added** (`backend/src/middleware/error-handler.ts`): a single `onError` hook on the Hono app — `HTTPException`s serialize to `{ error: message }` with their status code, anything else logs server-side and returns a generic `500`, so routes just `throw new HTTPException(...)` instead of each hand-rolling error responses.
- **Dashboard UX fixes** (`frontend/src/routes/dashboard.tsx`):
  - Fixed a duplicate-toast bug where the "Facebook account connected" success toast fired twice on the post-OAuth redirect — the `useEffect` consuming the `?connected=facebook` query param was re-running on every `searchParams` change; fixed with a `useRef` guard + empty dependency array so it runs exactly once per mount.
  - Added `sonner` success/error toasts on the **Disconnect** button (previously only the connect flow had toasts).
  - Added a guard disabling the "Connect Facebook" button (and relabeling it "Facebook Connected") once an account of that platform already exists, preventing duplicate-connection attempts.
- **Facebook → n8n dispatch loop built end-to-end** (per the `tidy-yawning-karp.md` plan — Facebook-only, one-`ConnectedAccount`-to-one-`Post`, immediate dispatch on create):
  - `prisma/schema.prisma`: added `Post.connectedAccountId` FK to `ConnectedAccount` (migration `20260915201030_add_post_connected_account`).
  - `lib/env.ts`: added `N8N_BASE_URL` and `N8N_CALLBACK_SECRET` (also added to `.env`/`.env.example`).
  - `service/n8n.ts` (new): `buildFacebookPayload()` decrypts the account's token and shapes the exact payload `facebook-poster.json`'s "Parse Request" node expects (`token: { page_id, access_token }`, `callback_url` pointed at `PUBLIC_BACKEND_URL`); `dispatchToN8n()` does a plain `fetch` POST to `{N8N_BASE_URL}/webhook/facebook-poster` — no queue for this single-platform pass, since fan-out/rate-limiting (§1/§5) only earns its keep once multiple platforms dispatch in parallel.
  - `routes/posts.ts` (new): `POST /api/posts` creates the `Post` as `PROCESSING` and dispatches immediately (no draft step); if the dispatch `fetch` itself throws (n8n unreachable), the post is immediately flipped to `FAILED` with a `PostLog` row instead of hanging in `PROCESSING` forever with no callback ever coming. `GET /api/posts` lists posts with their `PostLog`s for the History page.
  - `routes/webhooks.ts` (new): `POST /api/webhooks/n8n-callback` checks an `x-callback-secret` header against `N8N_CALLBACK_SECRET` (`401` on mismatch/missing), then writes a `PostLog` row and sets `Post.status` to `PUBLISHED`/`FAILED` directly (no multi-platform aggregation yet — that's still §6's deferred concern).
  - `workflows/facebook-poster.json`: added an `x-callback-secret: {{ $env.CALLBACK_SECRET }}` header to both the "Send Callback" and "Send Error Callback" `HTTP Request` nodes, referencing an n8n-side env var rather than hardcoding the secret in the exported workflow JSON.
- **Debugged two real deployment issues while wiring the above, both resolved:**
  1. **`ngrok` showing the same URL for both tunnels** — root cause: the free plan only grants one static domain. Resolved by keeping `PUBLIC_BACKEND_URL` on the ngrok domain (needed for Meta's OAuth callback, which rejects localhost) while pointing `N8N_BASE_URL` straight at `http://localhost:5678` — no tunnel needed since the backend and n8n run on the same machine.
  2. **n8n's callback nodes threw "access to env vars denied"** when reading `$env.CALLBACK_SECRET` — root cause: n8n's `N8N_BLOCK_ENV_ACCESS_IN_NODE` security hardening defaults to blocking `{{ $env.* }}` in node expressions. Fixed by explicitly setting `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` on the n8n container (see next item) and re-testing — resolved.
  - In the course of this, **migrated the SaaS backend's n8n off the shared InternApplier container onto its own project-scoped container**: added an `n8n` service to `backend/docker-compose.yml` (alongside the already-present Postgres/Redis), with its own `CALLBACK_SECRET` (matching `N8N_CALLBACK_SECRET`) and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` — keeps the SaaS backend's infra self-contained rather than depending on an unrelated project's n8n instance.
- **Confirmed the full loop works end-to-end**: submitted a real post via the new Composer UI → `Post` created `PROCESSING` → `facebook-poster` workflow ran → Graph API accepted it → callback returned `204` → `Post.status` flipped to `PUBLISHED` with a matching `PostLog` row.
- **Frontend Composer and History pages built out for real** (both were placeholders before):
  - `routes/composer.tsx`: queries `/api/integrations`, filters to `FACEBOOK` accounts, lets the user pick a Page, enter a caption, choose media type (`TEXT`/`IMAGE`/`VIDEO`), and (for non-text) a media URL (Cloudinary — no upload widget yet); submits via `POST /api/posts` with `sonner` success/error toasts.
  - `routes/history.tsx`: lists posts from `GET /api/posts` (polled every 5s), with a status badge and the failed log's error message if present.
  - Added the shadcn/ui components these needed: `badge`, `input`, `label`, `select`, `sonner`, `textarea`. Mounted `<Toaster />` in `main.tsx`.
- Also had a design-time-only n8n UI question resolved (not a code change): the expression editor's `[ERROR: not accessible via UI, please run node]` message under `{{ $env.CALLBACK_SECRET }}` is expected — n8n's browser-side expression preview can't resolve `$env` (only the execution engine can, at runtime); the successful `204`/`PUBLISHED` result above already proves it resolves correctly when the workflow actually runs.

**Decisions made:**
- Facebook-only, single-`ConnectedAccount`-to-one-`Post` dispatch for this pass — no multi-platform fan-out, no BullMQ queueing yet; both are deferred until a second platform is wired up and parallel dispatch is actually needed (per the `tidy-yawning-karp.md` plan).
- The backend's own n8n instance is now a project-scoped Docker service in `backend/docker-compose.yml`, separate from the shared InternApplier container used for the original V1 workflow-building/testing — avoids coupling the SaaS backend's infra to an unrelated project.
- `N8N_BASE_URL` points at `localhost:5678` directly rather than through ngrok, since n8n and the backend run on the same machine and ngrok's free plan only grants one static domain (already used for `PUBLIC_BACKEND_URL`/OAuth).
- `n8n-callback` route auth is a simple shared-secret header (`x-callback-secret`) check, not HMAC-signed payloads — matches the "shared secret" convention already used for `TOKEN_ENCRYPTION_KEY_V1`/`N8N_CALLBACK_SECRET` elsewhere in the stack; revisit only if a real security need arises.
- The actually-built webhook payload/callback schema is deliberately simpler than `websitePlan.md` §5/§6's aspirational one (no `error_type`/`usage`/`youtube_metadata` fields yet — just what `facebook-poster.json` actually sends/expects). `websitePlan.md` updated to flag this gap explicitly rather than silently diverge from what's documented.

**Files modified this session:**
- `backend/prisma/schema.prisma`, new migration `20260915201030_add_post_connected_account` — `Post.connectedAccountId` FK
- `backend/src/lib/env.ts`, `backend/.env`, `backend/.env.example` — `N8N_BASE_URL`, `N8N_CALLBACK_SECRET`
- `backend/src/service/n8n.ts` (new) — `buildFacebookPayload`, `dispatchToN8n`
- `backend/src/routes/posts.ts` (new) — `POST`/`GET /api/posts`
- `backend/src/routes/webhooks.ts` (new) — `POST /api/webhooks/n8n-callback`
- `backend/src/middleware/error-handler.ts` (new) — global `onError` handler
- `backend/src/index.ts` — registered `postsRoute`/`webhooksRoute`, wired `errorHandler`
- `backend/docker-compose.yml` — added project-scoped `n8n` service (`CALLBACK_SECRET`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`)
- `workflows/facebook-poster.json` — `x-callback-secret` header added to both callback `HTTP Request` nodes
- `frontend/src/routes/composer.tsx`, `frontend/src/routes/history.tsx` — real implementations (previously placeholders)
- `frontend/src/routes/dashboard.tsx` — duplicate-toast fix, disconnect toasts, connect-button guard
- `frontend/src/main.tsx` — mounted `<Toaster />`
- `frontend/src/components/ui/{badge,input,label,select,sonner,textarea}.tsx` (new shadcn components)
- `frontend/src/lib/api-schema.d.ts` — regenerated for `/api/posts`, `/api/webhooks/n8n-callback`
- `websitePlan.md` — §5/§6 actual-vs-planned schema gap flagged; Phase 1/3 roadmap items checked off; footer changelog
- `history.md` — this entry, Quick State Snapshot, Platform Credential Reference, Key Technical Decisions updated

---

### Session 19 — 2026-09-16

**What we did:**
- Diagnosed a real correctness gap surfaced by the user while testing video posts: `facebook-poster.json`'s video branch calls `POST /{page_id}/videos`, which accepts the upload and returns a video `id` immediately, but the video is still transcoding on Facebook's side — the workflow's "Build Success Result" node fires the callback right away regardless, so `routes/webhooks.ts` was writing `Post.status = PUBLISHED` well before the video was actually live. This is exactly the gap `websitePlan.md` §6 ("Async Media Processing Poller") had already designed for but never built.
- Weighed two fixes: (A) add a poll-before-callback wait loop inside the n8n video branch itself, vs. (B) poll from the backend after the existing callback lands, matching §6's original design. **Chose (B)** — n8n workflows are meant to stay fast/stateless/single-shot per `websitePlan.md` §1 ("n8n holds no orchestration logic of its own"), and a multi-minute poll loop inside the workflow would tie up an n8n execution slot per video post, working against the queue-mode/KEDA-autoscaled direction the architecture is headed. Facebook's existing callback already carries everything needed (`platform_post_id` = the video id), so **no `facebook-poster.json` changes were required at all** — this was resolved entirely backend-side.
- Implemented the poller as the backend's first real BullMQ usage (previously only spike-tested in `trialBun/`, never instantiated in the actual backend):
  - `lib/facebook.ts` — added `getVideoStatus(pageToken, videoId)`, reusing the existing `graphGet<T>` helper to call `GET /{video_id}?fields=status`.
  - `queue/video-status-queue.ts` (new) — a `video-status-poll` `Queue` + `enqueueVideoStatusPoll(postId, platformPostId)`, using the existing `redisConnection()` from `queue/connection.ts`. Uses BullMQ's native `attempts: 30` + `backoff: { type: "fixed", delay: 30_000 }` (instead of hand-rolled re-enqueueing) — directly reuses the retry/backoff mechanism already validated in the Sep 11 spike test, giving the same "30s interval, ~15min hard timeout" §6 already documented.
  - `queue/video-status-worker.ts` (new) — the `Worker`: looks up the `Post` + `connectedAccount` fresh from the DB on every attempt (not from job data) and decrypts the token right before use, consistent with §7's Token Encryption Scheme rule of decrypting only immediately before use. Resolves `PUBLISHED` on `video_status: "ready"`, `FAILED` (with a specific error message) on `"error"`, retries (via `throw`) while `"processing"`, and writes a timeout `FAILED` `PostLog` on the last of the 30 attempts instead of polling forever.
  - `routes/webhooks.ts` — the only behavioral change to the existing callback route: a `FACEBOOK` + `SUCCESS` callback for a `VIDEO` post now looks up the post's `mediaType`, and if it's `VIDEO`, enqueues the poller and returns `204` **without** writing the immediate `PostLog`/`Post.status = PUBLISHED` — leaves the post at `PROCESSING` until the poller confirms it. All other cases (`TEXT`/`IMAGE`/`CAROUSEL`, or an outright `FAILED` from n8n itself) keep the exact prior immediate-write behavior.
  - `index.ts` — starts the `Worker` in the same process as the API via `startVideoStatusWorker()`, since there's no separate worker deployment yet (still queue-mode/K8s future work per Phase 3).
- No frontend changes needed — `history.tsx` already polls every 5s and already renders `PROCESSING` as a badge; a `VIDEO` post now simply stays on that badge for longer (up to ~15 min) before flipping to `PUBLISHED`/`FAILED`, which is the actual fix.
- Verified: `tsc --noEmit` clean on both backend and frontend; confirmed via `bun --watch`'s auto-reload that the backend didn't crash on the new code; confirmed the `Worker` registered correctly by checking for `bull:video-status-poll:*` keys in Redis (`docker exec smposting-redis redis-cli keys ...`). Real end-to-end confirmation (submit an actual video post, watch it stay `PROCESSING` past the n8n callback and flip to `PUBLISHED` only once Facebook's `video_status` reports `"ready"`) is still pending live testing by the user.
- Followed up in the same session by closing that gap: added `CAROUSEL` support to `composer.tsx`. Confirmed first that no backend changes were needed — `routes/posts.ts`'s `mediaUrlsSchema` already accepts an arbitrary-length `string[]`, `service/n8n.ts`'s `N8N_MEDIA_TYPE` map already translates Prisma's `CAROUSEL` to the workflow's `MULTI_PHOTO` string, and `facebook-poster.json`'s switch already has a `MULTI_PHOTO` branch — this was purely a missing UI affordance.
  - Added `"CAROUSEL"` to the `MediaType` union and to the media-type `Select`.
  - Replaced the single `mediaUrl` input with a `carouselUrls: string[]` array (seeded with 2 empty slots) that only renders when `mediaType === "CAROUSEL"`; the existing single-URL `Input` still handles `IMAGE`/`VIDEO` unchanged. Each row has a remove button (disabled once down to the `MIN_CAROUSEL_PHOTOS = 2` floor, since a 1-photo "carousel" isn't a real carousel on Facebook's side) and there's an "Add photo" button to append more.
  - `canSubmit` and the submit payload both branch on `mediaType === "CAROUSEL"`: submission is blocked until at least 2 non-blank URLs are entered, and empty/whitespace rows are filtered out (via `trimmedCarouselUrls`) before being sent as `mediaUrls`.
  - Verified with `bunx tsc --noEmit` and a full `bun run build` — both clean.

**Decisions made:**
- Video-processing-completion detection lives entirely in the backend (BullMQ poller calling Graph API directly), not inside the n8n workflow — keeps n8n workflows fast/stateless and centralizes the pattern so it can be reused if Instagram/Threads video containers turn out to need the same treatment later (an open question §6 already flagged).
- The BullMQ `Worker` runs in the same process as the Hono API for now (no separate worker process/deployment) — acceptable until real queue-mode/K8s scaling work happens (Phase 3, still open).
- Poller job data carries only `{ postId, platformPostId }`, never a decrypted token — the worker re-fetches the `ConnectedAccount` and decrypts on every attempt, matching the existing "decrypt only right before use" rule rather than persisting a plaintext token into a Redis job payload.

**Files modified this session:**
- `backend/src/lib/facebook.ts` — added `getVideoStatus`
- `backend/src/queue/video-status-queue.ts` (new)
- `backend/src/queue/video-status-worker.ts` (new)
- `backend/src/routes/webhooks.ts` — video-aware callback handling
- `backend/src/index.ts` — starts the video-status worker
- `frontend/src/routes/composer.tsx` — added `CAROUSEL` media type + repeatable photo-URL input
- `history.md` — this entry

---

## Platform Credential Reference

> Fill this in as you complete setup.md steps. Keep actual secrets in a password manager — only record IDs here.

| Platform | App/Project Name | App ID / Client ID | Notes |
|----------|-----------------|-------------------|-------|
| Facebook | SMPosting App | *Configured* | `facebook-poster.json` fully tested — `TEXT`, `PHOTO`, `VIDEO`, and `MULTI_PHOTO` (carousel) all confirmed working end-to-end (Sep 10) once the code-368 block cleared. **Access token pasted in chat Sep 8 — treat as compromised, rotate before reuse.** V2 SaaS backend's real dispatch loop (OAuth connect → encrypted token storage → Composer submit → n8n → Graph API → callback → `PUBLISHED`) confirmed working end-to-end Sep 16 — first platform wired to the actual backend, not just the standalone n8n workflow. |
| Instagram | SMPosting App | *Configured* | Instagram Business Account ID retrieved; `instagram-poster.json` tested successfully for photo/story/reel (Sep 7) |
| Threads | SMPosting App | *Configured* | Long-lived token generated via curl; `threads-poster.json` tested successfully for TEXT (Sep 7) |
| Reddit | — | — | *Deferred* (Pending API Access Request) |
| YouTube | SMPosting V1 | *Configured* | Upload-audit gate has **lifted** — `youtube-poster.json` tested successfully end-to-end for standard video and Shorts (Sep 8), after fixing a missing `Validate Payload → Initiate Resumable Upload` canvas connection |
| Pinterest | SMPosting V1 | *Configured* | Sandbox Developer Access Token generated |

---

## Key Technical Decisions (Quick Reference)

| Decision | Details |
|----------|---------|
| n8n binary mode | `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` |
| Max payload size | `N8N_PAYLOAD_SIZE_MAX=4000` (4GB) |
| Data pruning | `EXECUTIONS_DATA_PRUNE=true`, 336h TTL |
| Volume mount | `/home/kushagra/n8n-data:/home/node/.n8n` |
| YouTube video source | Google Drive (Download) → n8n binary (`data` field) → YouTube node |
| YouTube Shorts | Same YouTube node — add `#Shorts` in title/description, source must be 9:16, ≤ 60s |
| Google Drive → YouTube auth | Single OAuth2 client in `SMPosting V1` project covers both APIs |
| Instagram posting | Direct photo publish; sequential IF-node chain for `photo`, `story`, `video`, `reel` |
| Multi-post type splitting | Platform split only in primary JS node; `post_type` passed as combined string |
| Record Success / Aggregate | Consolidated into single final Code Node at the end of platform sequence |
| Threads posting | 2-step: create container via HTTP Request → Wait 30-60s → publish |
| Multi-Branch Aggregation | Single-item flow using `$('Node Name').item.json` in `try/catch` (No Merge Node) |
| Status Updating | Directly maps summary status (`Posted`/`Partial Success`/`Error`) to Google Sheets dropdown |
| Content queue | Google Sheets, polled every 15 min by Schedule trigger |
| Error handling | `Error Trigger` node → log to Sheets + email alert |
| Pinterest access | Trial mode for testing; apply for Standard Access for live |
| Per-call credentials (V2) | Every typed/credential-bound n8n node (Facebook Graph API, Instagram community node, Google Drive) replaced with plain `HTTP Request` + `authentication: none`; token injected via expression from the webhook payload |
| YouTube upload source (V2) | Plain HTTP GET on `media_urls[0]` (any public URL — S3 in production) instead of the Google Drive node, for the same per-call-credential reason above |
| YouTube upload mechanism (V2) | `Download Video` + `Initiate Resumable Upload` run in parallel → `Merge` node recombines binary + session `Location` header → `Upload Video Binary` PUTs bytes |
| Meta error 368 (abuse block) | Spam heuristic, not a quota — retry/backoff doesn't help; can block minutes–24h; needs circuit-breaker handling in backend, not a retry queue |
| YouTube upload quota gate | Cloud Console's `Video Uploads per day` figure is not what's enforced — separate undocumented ceiling for unaudited projects; fixed only via Google's Audit and Quota Extension request. **Gate lifted Sep 8** — resumable-upload init now succeeds. |
| YouTube download→upload bottleneck | `Download Video` fully buffers video in n8n binary storage before `Upload Video Binary` sends anything — real fix is a streaming Code-node relay (S3 GET stream piped directly into YouTube PUT stream), not yet built; see `websitePlan.md` §3 |
| Meta code-368 status checking | No queryable status/countdown exists anywhere (not Business Suite, not the API) — confirmed by testing the same block twice, a day apart |
| Facebook carousel (V2) | `MULTI_PHOTO` confirmed tested/working end-to-end (Sep 10) — upload each photo unpublished, aggregate IDs, one `/feed` call with `attached_media` |
| Backend runtime/framework (V2) | Bun + Hono — Hono chosen over Elysia (too Bun-coupled) and Encore (infra-provisioning opinions conflict with self-managed Postgres/Redis) |
| Database/ORM (V2) | Docker-hosted PostgreSQL + Prisma via driver adapter (`@prisma/adapter-pg`) — avoids Prisma's native Rust-binary engine; confirmed compatible with Bun firsthand |
| Frontend (V2) | Vite + React SPA, calling the Hono API directly — no Next.js/SSR, since the backend already needs real long-running processes (job queue, SSE server) |
| Job queue (V2) | BullMQ + `ioredis` — **confirmed primary** (spike test passed Sep 11: round-trip, crash recovery, repeatable jobs, retry/backoff, concurrency, graceful shutdown, QueueEvents all ✅). Connect via plain `{ host, port }` per `Queue`/`Worker`/`QueueEvents` instance, not a shared `ioredis` instance. `bunqueue` remains a documented fallback only, not active. |
| Pub/Sub for live updates (V2) | Bun's native Redis client — explicitly experimental per Bun's own docs, so wrapped behind a thin swappable interface rather than hard-wired |
| Object storage (V2) | S3 via Bun's native Zig-based S3 client (no `@aws-sdk/client-s3` needed) — UploadThing evaluated and rejected (DX wrapper on top of S3, not a replacement; offers nothing the YouTube streaming-relay fix needs, since that fix runs inside n8n's own Node process, not the Bun backend) |
| `ConnectedAccounts` refresh shapes (V2) | Three shapes drive a `refresh_strategy` column instead of per-platform `if` branches: `NONE` (Facebook/Instagram, non-expiring Page token), `SLIDING_WINDOW` (Threads renews in place, Pinterest consumes a refresh token — same schedule, different call shape), `ON_DEMAND` (YouTube, refresh token never expires, exchanged right before each use) |
| Token encryption cipher (V2) | AES-256-GCM via Bun's built-in `node:crypto` — reversible (not hashed), since the backend must recover the plaintext token to inject into the n8n webhook payload; a leak is equivalent to handing over write-access to a user's connected accounts |
| Token nonce/IV handling (V2) | No new column — GCM's mandatory fresh 12-byte nonce per encryption is packed as `nonce \|\| ciphertext \|\| authTag` into one base64 blob, stored in the existing `encrypted_access_token`/`encrypted_refresh_token` columns |
| Token encryption key storage (V2) | Single master key via env var (`TOKEN_ENCRYPTION_KEY_V1`), stored separately from Postgres — no Vault/KMS until scale/compliance justifies it |
| `key_version` column & rotation (V2) | Added to `ConnectedAccounts`; rotation is zero-downtime — add new key to the app's lookup, flip new writes to the new version, background job re-encrypts old rows onto it, delete the old key once unused |
| Encrypt/decrypt utility scope (V2) | One backend module (`encrypt(plaintext, keyVersion)` / `decrypt(ciphertext, keyVersion)`) called only from OAuth callback routes (encrypt, on connect/refresh) and the dispatch layer (decrypt, right before injecting into the n8n payload) — never touches the frontend or n8n |
| Global error handling (V2) | Single Hono `onError` hook (`middleware/error-handler.ts`): `HTTPException` → `{ error: message }` + its status; anything else → logged server-side, generic `500` to the client. Routes just `throw new HTTPException(...)`, no per-route error boilerplate. |
| Post dispatch scope (V2, current) | Facebook-only, one `ConnectedAccount` ↔ one `Post` (no multi-platform join table yet); `POST /api/posts` creates the post as `PROCESSING` and dispatches immediately — no draft step, no BullMQ queue yet (single synchronous `fetch` to n8n is enough until a second platform needs parallel fan-out) |
| n8n dispatch failure handling (V2) | If the `fetch` to n8n itself throws (tunnel/container down) before n8n can even attempt the post, the backend immediately flips `Post.status = FAILED` and writes a `PostLog` row — prevents a post from being stuck in `PROCESSING` forever with no callback ever coming |
| n8n callback auth (V2) | Shared-secret header (`x-callback-secret`, checked against `N8N_CALLBACK_SECRET`) on `POST /api/webhooks/n8n-callback` — not HMAC-signed payloads; matches the shared-secret convention already used elsewhere in the stack |
| n8n container topology (V2) | SaaS backend's n8n runs as its own Docker service (`smposting-n8n`) in `backend/docker-compose.yml`, separate from the shared InternApplier container used to build/test the standalone V1 workflows — avoids coupling backend infra to an unrelated project. Needs its own `CALLBACK_SECRET` + `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` set to match the backend's `N8N_CALLBACK_SECRET` and allow callback nodes to read it via `{{ $env.CALLBACK_SECRET }}` |
| `N8N_BASE_URL` vs. tunnel (V2) | Points directly at `http://localhost:5678`, not through ngrok — backend and n8n run on the same machine, and ngrok's free plan only grants one static domain (already used for `PUBLIC_BACKEND_URL`/Meta OAuth, which does require a public HTTPS URL since Meta rejects localhost redirects) |

---

*Update this file at the end of each session.*
