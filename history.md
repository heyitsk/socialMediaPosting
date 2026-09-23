# 📜 Project History — smPosting

> **Purpose**: Running log of every decision, file change, and completed task.  
> Update this file at the end of every working session.  
> Reference this first when resuming work — no need to re-read all docs.

---

## Quick State Snapshot

| Item | Value |
|------|-------|
| **Current Phase** | V1 n8n workflows ✅ all tested (`facebook-poster`/`instagram-poster`/`threads-poster`/`youtube-poster`/`linkedin-poster`); Pinterest pending Developer App review. V2 SaaS (`websitePlan.md`) Phase 1 backend scaffold is live — Bun/Hono + Prisma + Facebook OAuth connect flow + first real end-to-end dispatch loop (Composer → backend → `facebook-poster` n8n workflow → Graph API → callback → `PUBLISHED`) confirmed working Sep 16. **Instagram is now the second platform wired to the real backend** (Sep 17-21): both connection methods (Facebook Login and standalone Instagram Login) OAuth-connect end-to-end, dispatch through `instagram-poster` n8n workflow using the correct per-connection-method Graph host (`graph.facebook.com` vs `graph.instagram.com`), and "Disconnect" is now a soft-delete so accounts with post history can be disconnected/reconnected for testing. `linkedin-poster.json` (personal profile, `TEXT`/`IMAGE`/`VIDEO`/`CAROUSEL` incl. multi-part video upload and multi-image carousel posts) built and tested standalone Sep 22 — not yet wired to the backend. **Threads unblocked Sep 23**: the Sep 22 Meta redirect-URI save bug cleared, a real account connected end-to-end for the first time, which surfaced (and fixed) a frontend bug — `composer.tsx` had its own hardcoded platform allowlist missing `THREADS` despite the backend/OAuth/n8n side being fully wired since Sep 21. `threads-poster.json` also gained `CAROUSEL` (image-only) the same day. Also documented, not built: a known gap where Instagram Reels'/Threads Video's fixed-`Wait`-then-publish pattern can fail outright on a large file over a slow connection instead of the container actually being `FINISHED` — see `websitePlan.md` §6 "Known Gap: Container-Status Polling Before Publish". **YouTube wired to the real backend Sep 23** (fifth platform after Facebook/Instagram/Threads/LinkedIn): Google OAuth connect with `ON_DEMAND` access-token refresh, dispatch through `youtube-poster` (title/visibility/category/made-for-kids/tags, `VIDEO` + `SHORTS`), and a post-upload processing poller on the shared `video-status-poll` queue with capped exponential backoff — code complete and typechecked, **not yet confirmed with a live end-to-end post** (needs `GOOGLE_CLIENT_ID`/`SECRET` in `backend/.env` and `youtube-poster.json` re-imported into n8n). Pinterest still not wired to the backend. |
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
| `websitePlan.md` | V2 SaaS product & technical spec (architecture, OAuth, DB schema, roadmap) | 2026-09-21 |
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

### Session 20 — 2026-09-17

**What we did:**
- **Built the standalone Instagram Login OAuth flow**, the second of the two ways an Instagram Business/Creator account can be connected (the first being Facebook Login, already built Session 18) — `lib/instagram.ts` (`buildAuthUrl`, `exchangeCodeForToken`, `exchangeForLongLivedToken`, `fetchProfile`) and `routes/auth/instagram.ts` (`/api/auth/instagram/connect` + `/callback`), mirroring the shape of `lib/facebook.ts`/`routes/auth/facebook.ts` but hitting Instagram's own OAuth product (`www.instagram.com/oauth/authorize`, `api.instagram.com/oauth/access_token`, `graph.instagram.com`) — a separate Meta product from the Facebook Login dialog, with no Facebook Page in the loop at all.
- Added Instagram OAuth env vars (`INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`) to `lib/env.ts`/`.env`/`.env.example`, regenerated the frontend's OpenAPI schema for the new endpoints, and added platform-specific "Connect" buttons + connection-method badges to `dashboard.tsx` (duplicate-account detection toast when the same account is connected via both methods).
- Extended the composer for Instagram's media types (`CAROUSEL`/`REELS`/`STORIES` alongside `IMAGE`), with platform-aware media-type options and account selection.
- **Found and fixed a real token-scoping bug during end-to-end testing**: an Instagram photo post dispatched through n8n failed with `OAuthException 190 — Invalid OAuth access token`. Root cause traced through several layers:
  1. `N8N_MEDIA_TYPE` in `service/n8n.ts` was mapping Instagram media types to Facebook's `PHOTO`/`MULTI_PHOTO` strings — Instagram's actual enum values are `IMAGE`/`CAROUSEL`/`REELS`/`STORIES`; fixed the translation layer (migration `20260916195236_add_instagram_login_and_media_types` adds these to the Prisma `MediaType` enum).
  2. The real bug: **Facebook Login and Instagram Login can both resolve to the same physical Instagram account** (same `platformAccountId`), but each issues a token valid on a different host — `graph.facebook.com` for a Facebook-Page-issued IG token, `graph.instagram.com` for an Instagram-Login-issued token. The original `ConnectedAccount` unique constraint (`userId, platform, platformAccountId`) didn't include which flow connected it, so connecting via one flow after the other silently **overwrote** the first token with a token that was only valid on the *other* host — exactly what was happening.
  3. Fixed by adding a `connectionMethod` enum (`FACEBOOK_PAGE` | `INSTAGRAM_LOGIN`) to `ConnectedAccount` and folding it into the unique constraint (`userId, platform, platformAccountId, connectionMethod`), so the two flows now upsert into separate rows instead of clobbering each other. Both `routes/auth/facebook.ts` and `routes/auth/instagram.ts` updated to upsert on the new composite key, each stamping its own `connectionMethod`.
  4. The DB migration for this hit a real snag: the naive `ALTER ... ADD CONSTRAINT` approach failed because existing duplicate rows would've violated the new constraint immediately. Resolved by dropping/recreating as an **index** operation instead of a constraint operation, marking the first stalled migration attempt as rolled back, and reapplying — documented as the pattern to reuse if this happens again (see migration `20260916205952_fix_connected_account_unique_key`).
- Added `service/n8n.ts`'s `GRAPH_HOST` lookup (`Record<ConnectionMethod, string>`) and `buildInstagramPayload()`/`dispatchInstagramToN8n()` — the Instagram counterpart to the existing Facebook dispatch functions, sending `token.graph_host` in the webhook payload so `instagram-poster.json`'s HTTP nodes build URLs against the correct Graph host per-request rather than assuming one. Also added a fail-fast expiry guard (`TOKEN_EXPIRY_BUFFER_MS`, 24h) that throws before dispatch if an `INSTAGRAM_LOGIN`-connected (`SLIDING_WINDOW` refresh strategy) token is expired or about to expire, since there's no proactive refresh worker yet — surfaces a clear "reconnect the account" error instead of letting a doomed request reach n8n. `postToN8n` was factored out as a shared helper since Facebook and Instagram dispatch now share identical POST/error-handling logic, differing only in webhook path and payload shape.
- Updated `workflows/instagram-poster.json`'s callback nodes (success + error) to send the `x-callback-secret` header, matching the pattern already used in `facebook-poster.json` (Session 18) — previously only the Facebook workflow authenticated its callback.
- Verified end-to-end: connected the same Instagram test account via both flows (confirming they now coexist as separate rows with distinct badges/duplicate warning in the dashboard), dispatched a real Instagram photo post, confirmed it now correctly hits `graph.instagram.com` with a valid `INSTAGRAM_LOGIN` token and publishes successfully.

**Decisions made:**
- `ConnectionMethod` (`FACEBOOK_PAGE` | `INSTAGRAM_LOGIN`) is now part of `ConnectedAccount`'s identity, not just metadata — it's in the unique constraint precisely because the two flows can target the same underlying account with mutually-incompatible tokens.
- Token-host selection is resolved once, at dispatch-payload-build time in the backend (`GRAPH_HOST[connectionMethod]`), and passed to n8n as data (`token.graph_host`) rather than n8n trying to infer or hardcode a host — keeps n8n workflows dumb/stateless per the existing `websitePlan.md` §1 principle.
- Fixing a stalled/half-applied migration: prefer dropping/recreating the affected index directly over letting Prisma retry the original failed constraint DDL, then mark the failed migration resolved as rolled-back before reapplying — avoids fighting Prisma's migration-history bookkeeping.

**Files modified this session:**
- `backend/src/lib/instagram.ts` (new), `backend/src/routes/auth/instagram.ts` (new)
- `backend/src/lib/env.ts`, `backend/.env`, `backend/.env.example` — `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`
- `backend/prisma/schema.prisma`, migrations `20260916195236_add_instagram_login_and_media_types` and `20260916205952_fix_connected_account_unique_key` — `MediaType` enum additions (`REELS`/`STORIES`), `ConnectionMethod` enum, composite unique constraint
- `backend/src/service/n8n.ts` — `GRAPH_HOST`, `buildInstagramPayload`, `dispatchInstagramToN8n`, shared `postToN8n` helper, token-expiry guard
- `backend/src/routes/auth/facebook.ts` — upserts updated to the new composite unique key
- `workflows/instagram-poster.json` — `x-callback-secret` header added to callback nodes
- `frontend/src/routes/dashboard.tsx` — platform-specific connect buttons, connection-method badges, duplicate-account toast
- `frontend/src/routes/composer.tsx` — Instagram media types (`CAROUSEL`/`REELS`/`STORIES`), platform-aware account/media-type selection
- `frontend/src/lib/api-schema.d.ts` — regenerated for Instagram endpoints
- `history.md` — this entry

---

### Session 21 — 2026-09-21

**What we did:**
- Diagnosed a Postgres foreign-key violation (`23001`) when clicking **Disconnect** on a connected account that already had posts against it: `Post.connectedAccountId → ConnectedAccount.id` has no `onDelete` behavior specified in `schema.prisma`, which Prisma/Postgres defaults to `RESTRICT` — so `DELETE /api/integrations/:id`'s `prisma.connectedAccount.deleteMany(...)` failed outright once the account had post history, blocking the user from disconnecting and re-testing the Instagram OAuth flow from scratch.
- **Chose soft-delete over cascading the delete or catching-and-messaging the FK error** — cascading would silently destroy the user's post/`PostLog` history the moment they disconnect an account (worse than an inactive row sitting around); a soft-delete flag both fixes the immediate bug and is the right long-term behavior regardless.
- Added a `disconnectedAt` (nullable timestamp) column to `ConnectedAccount` (migration `20260921031208_add_connected_account_soft_delete`). `DELETE /api/integrations/:id` now does `updateMany({ disconnectedAt: new Date() })` instead of `deleteMany`; `GET /api/integrations` and the post-creation account lookup in `routes/posts.ts` both filter `disconnectedAt: null` so a disconnected account stops appearing/stops being postable, without touching its post history.
- Made reconnecting transparent: since both OAuth callbacks (`routes/auth/facebook.ts`, `routes/auth/instagram.ts`) already `upsert` on the `(userId, platform, platformAccountId, connectionMethod)` composite key from Session 20, their `update` blocks now also clear `disconnectedAt: null` — running the OAuth flow again on a previously-disconnected account revives the same row (and its post history) instead of erroring on the unique constraint or creating an orphaned duplicate.
- Verified: the previously-stuck test account (`06ae519c-...`, an `INSTAGRAM_LOGIN`-connected row) was inspected directly in the DB and confirmed unaffected by the earlier failed delete (Postgres rolled the whole failed transaction back — no data lost); `bunx tsc --noEmit` clean; migration applied via `prisma migrate deploy` (not `migrate dev`, since the dev DB had unrelated drift from Session 20's manually-patched migration that `migrate dev` wanted to resolve via a full reset).

**Decisions made:**
- "Disconnect" is a soft-delete (`ConnectedAccount.disconnectedAt`), not a hard delete — consistent with the DB actively protecting `Post`/`PostLog` referential integrity via `RESTRICT`, rather than working around that constraint destructively.
- Every read path that lists or resolves a `ConnectedAccount` for use (integrations list, post-creation lookup, the Instagram duplicate-detection query) must filter `disconnectedAt: null` — there's no single shared query helper for this yet; each call site was updated individually.

**Files modified this session:**
- `backend/prisma/schema.prisma`, new migration `20260921031208_add_connected_account_soft_delete` — `ConnectedAccount.disconnectedAt`
- `backend/src/routes/integrations.ts` — list filters `disconnectedAt: null`; disconnect does a soft-delete `updateMany` instead of `deleteMany`
- `backend/src/routes/auth/facebook.ts`, `backend/src/routes/auth/instagram.ts` — `update` blocks clear `disconnectedAt: null` on reconnect; Instagram's duplicate-check query also filters `disconnectedAt: null`
- `backend/src/routes/posts.ts` — post-creation account lookup filters `disconnectedAt: null`
- `websitePlan.md` — §7 `ConnectedAccounts` schema updated with `disconnected_at`; §2.2 Instagram OAuth section expanded for the dual connection-method reality; §5 Instagram payload/host notes added; roadmap/footer updated
- `history.md` — this entry
- `history.md` — this entry

---

### Session 22 — 2026-09-21

**What we did:**
- **Built the Threads Login OAuth flow**, the third distinct Meta OAuth product wired to the backend (after Facebook Login and Instagram Login) — `lib/threads.ts` (`buildAuthUrl`, `exchangeCodeForToken`, `exchangeForLongLivedToken`, `refreshLongLivedToken`, `fetchProfile`) and `routes/auth/threads.ts` (`/api/auth/threads` + `/callback`), mirroring `lib/instagram.ts`/`routes/auth/instagram.ts`'s shape but hitting Threads' own endpoints (`threads.net/oauth/authorize`, `graph.threads.net/oauth/access_token`, `graph.threads.net/v1.0/me`) on the same Meta App as Facebook (own `THREADS_APP_ID`/`THREADS_APP_SECRET` credential pair, own "Threads API" product, own consent screen). Unlike Facebook/Instagram, a Threads token has no separate Page/Business ID to resolve — it's tied directly to the caller's own `/me/threads`.
- Added `THREADS_LOGIN` to the `ConnectionMethod` enum (migration `20260921043412_add_threads_login`) so Threads gets its own connection-method identity in `ConnectedAccount`, consistent with Instagram's naming, even though Threads only has one OAuth path today.
- Added Threads env vars (`THREADS_APP_ID`/`THREADS_APP_SECRET`) to `lib/env.ts`/`.env`/`.env.example`, mounted the route in `index.ts`, and added a "Connect Threads" button + connect/error toasts to `dashboard.tsx`.
- Extended `service/n8n.ts` with `buildThreadsPayload`/`dispatchThreadsToN8n` → `threads-poster.json`. Threads' payload is the simplest of the three platforms: `token: { access_token }` only, no id/host field, since every call targets the caller's own account. `media_type` is sent as the raw Prisma enum value (`TEXT`/`IMAGE`/`VIDEO`), matching `threads-poster.json`'s Switch node verbatim — no translation table needed, same convention as Instagram. Reused the same `TOKEN_EXPIRY_BUFFER_MS` fail-fast guard pattern as Instagram Login (24h-before-expiry check on `SLIDING_WINDOW` tokens), since there's no proactive refresh worker for either yet.
- Updated `posts.ts`'s `SUPPORTED_MEDIA_TYPES` to add `THREADS: ["TEXT", "IMAGE", "VIDEO"]` and extended the platform dispatch branch (was a two-way `if`/`else` for Facebook/Instagram, now a three-way branch including Threads) and `integrations.ts`'s `connectionMethod` response enum to include `THREADS_LOGIN`.
- Updated `workflows/threads-poster.json`'s callback nodes (`Send Callback`, `Send Error Callback`) to send the `x-callback-secret` header, matching the pattern already used in `facebook-poster.json`/`instagram-poster.json` — previously Threads' workflow was the only one of the three left unauthenticated on its callback.
- Ran `prisma migrate deploy` + `prisma generate` for the new enum value; `bunx tsc --noEmit` clean on both backend and frontend. Left the actual `THREADS_APP_ID`/`THREADS_APP_SECRET` values blank in `.env` for the user to fill in with their own Meta App credentials (already added as a Threads tester on that app) — did not restart any running dev server, per instruction, since testing was left to the user.

**Decisions made:**
- `THREADS_LOGIN` gets its own `ConnectionMethod` enum value rather than defaulting to `FACEBOOK_PAGE` — keeps the column's meaning "which OAuth product connected this row" consistent across every platform, not just Instagram-specific, even though Threads has no second method to disambiguate from today.
- `GRAPH_HOST`'s type was narrowed from `Record<ConnectionMethod, string>` to `Record<Extract<ConnectionMethod, "FACEBOOK_PAGE" | "INSTAGRAM_LOGIN">, string>` rather than adding a meaningless `THREADS_LOGIN` entry to it — that lookup is Instagram-specific (host selection), and Threads' payload never needs a host at all since `threads-poster.json` hardcodes `graph.threads.net`.
- Deferred a proactive Threads token-refresh worker again (same call as Instagram Login, Session 20) — `refreshLongLivedToken()` is exported and ready, but wiring a BullMQ scheduled job for it is left for when a second `SLIDING_WINDOW` platform (Pinterest) makes a shared worker worth building once instead of twice.

**Files modified this session:**
- `backend/src/lib/threads.ts` (new), `backend/src/routes/auth/threads.ts` (new)
- `backend/src/lib/env.ts`, `backend/.env`, `backend/.env.example` — `THREADS_APP_ID`/`THREADS_APP_SECRET`
- `backend/prisma/schema.prisma`, migration `20260921043412_add_threads_login` — `ConnectionMethod.THREADS_LOGIN`
- `backend/src/index.ts` — mounts `/api/auth/threads`
- `backend/src/service/n8n.ts` — `buildThreadsPayload`, `dispatchThreadsToN8n`, narrowed `GRAPH_HOST`'s type
- `backend/src/routes/posts.ts` — `THREADS` added to `SUPPORTED_MEDIA_TYPES`, three-way platform dispatch branch
- `backend/src/routes/integrations.ts` — `connectionMethod` response enum includes `THREADS_LOGIN`
- `workflows/threads-poster.json` — `x-callback-secret` header added to both callback nodes
- `frontend/src/routes/dashboard.tsx` — "Connect Threads" button, connect/error toasts
- `websitePlan.md` — §2.3 rewritten for the real implementation; §5 Threads payload note added; §7 `connection_method` enum updated; roadmap/footer updated
- `history.md` — this entry

### Session 23 — 2026-09-22

**What we did:**
- No code changes this session — entirely spent diagnosing why the Meta App Dashboard refuses to save a **Valid OAuth Redirect URI** on the "Access the Threads API" use case (`https://developers.facebook.com/apps/1575982267231848/...`), which is blocking `THREADS_APP_ID`/`THREADS_APP_SECRET` from ever being usable in `.env` — Session 22's backend/OAuth code has been ready and untested against a real Threads account this whole time because of this.
- Ruled out, in order: `ERR_NGROK_8012` (backend was down; fixed — tunnel now returns a real `302` via `curl`), stale/cached form state (hard refresh, then a full incognito window — same failure), incomplete **Basic Settings** (App Domains, Privacy Policy URL, Terms of Service URL, App Icon, Category, Threads App ID/Secret — all confirmed filled in), a duplicate/legacy "Threads Login" product conflicting with the new "Access the Threads API" use case (dashboard shows only one Threads use case), a missing "App Type" setting (field no longer exists in the current dashboard UI), insufficient permissions (account confirmed **Administrator** in App Roles), an app-wide restriction (**Alert Inbox** empty, **Required Actions** clear), a Firefox/Gecko-specific bug (reproduced identically in genuine desktop Chrome, after first ruling out a false-positive mobile-emulation test), and a dead legacy product route (`/apps/.../threads-login/settings/` redirects straight back to the dashboard — that page doesn't exist for this app).
- **Found the actual mechanism via the browser Network tab**: clicking Save POSTs to `https://developers.facebook.com/apps/1575982267231848/async/threads-login/setting/save/`, which returns a flat **HTTP 404 "Page Not Found - Meta for Developers"** — i.e. the generic "Form can't be saved, please verify all information" toast is masking a 404 from Meta's own internal save handler, not a real field-validation error. The request is well-formed (valid CSRF/DTSG token, correct cookies, correct payload) and reaches Meta's edge fine (response headers show legitimate multi-hop internal proxy routing, `x-fb-debug` trace IDs, etc.) — it just 404s once it gets there, consistently, regardless of browser/session/cache state.
- The mismatch between the page's own self-identification (loaded via the newer "Use Cases" architecture — `product_route=threads-api` in the referrer) and the save request it fires (still hitting the legacy **`threads-login`** product's async endpoint) points to this specific app instance being stuck in a broken/half-migrated internal state on Meta's side, not anything fixable from settings the user controls.
- Tried stripping the `?business_id=...` query param (viewing the use case outside Business Manager context) as a next diagnostic step — not yet completed/confirmed by end of session.

**Where we're stuck:**
- The Threads redirect URI **cannot currently be saved** through the Meta App Dashboard for this app (`test-n8n`, App ID `1575982267231848`), so `/api/auth/threads` cannot be tested end-to-end yet — `THREADS_APP_ID`/`THREADS_APP_SECRET` in `.env` remain placeholders.
- **Not yet tried** (next session should start here, in this order — cheapest/most diagnostic first):
  1. Retry with the `business_id` query param stripped from the URL (isolate whether Business Manager-scoped context is what's breaking the save).
  2. VPN to a different region (US/EU) and retry — the proxy-hop pattern in the response headers is consistent with a regional rollout gap for this specific save action.
  3. Add a second Facebook account as Admin under App Roles and retry the save logged in as that account — isolates an account/session-specific gatekeeper flag from a true per-app bug.
  4. If none of the above work: delete and recreate the Meta App from scratch. **Caveat**: this same app (`META_APP_ID=1575982267231848`) is also the one used for the already-working Facebook and Instagram integrations, so recreating it means redoing Facebook Login for Business + Instagram API setup too, not just Threads — deferred for exactly this reason.
- Decision made this session: **defer Threads dashboard troubleshooting** and move on to scoping the LinkedIn workflow instead, rather than burning further time on a Meta-side platform bug outside our control.

**Files modified this session:**
- None (diagnostic-only session).
- `history.md` — this entry
- `websitePlan.md` — Threads entry in Platform Credential Reference and changelog updated to reflect the dashboard blocker

---

### Session 24 — 2026-09-22

**What we did:**
- **Built `workflows/linkedin-poster.json`** from scratch — a webhook-triggered posting workflow for a LinkedIn *personal profile*, using the current LinkedIn Posts API (`/rest/posts`, not the deprecated UGC Posts API), following the same shape as the other per-platform workflows (`Parse Request` → `Route by Media Type` switch → per-type publish chain → `Build Success/Error Result` → `Send Callback`, plus an `Error Trigger` island). `TEXT` publishes directly; `IMAGE`/`VIDEO` need LinkedIn's own binary upload flow (`initializeUpload` → PUT bytes → publish, `finalizeUpload` too for video), with the upload-session init and the binary download running in parallel and a `Merge` node recombining them, same pattern as `youtube-poster.json`. Also fixed a deprecated `LinkedIn-Version: 202405` header (LinkedIn versions are supported ~1 year) to `202609` before any live testing.
- **Corrected course mid-session**: initially over-implemented a streaming-relay optimization for the image/video binary upload (raw Node.js `http`/`https` streams inside a Code node, piping the download GET directly into the LinkedIn PUT instead of buffering the whole file) — user clarified they wanted this *discussed and documented only*, not built yet, since there's no S3 bucket to relay from yet. Reverted `workflows/linkedin-poster.json` and `backend/docker-compose.yml` to their pre-relay state and instead wrote the decision into `websitePlan.md` §3 (new subsection: video-only scope, approach left to judgement, build once an S3 bucket exists) — this stays a documented-but-deferred optimization, tracked separately from the correctness issue below.
- **Real end-to-end testing surfaced a genuine multi-part upload bug**, root-caused through several ruled-out theories: a generic LinkedIn error with an empty n8n output tab → traced via docker logs to a circular-JSON/socket-level failure (a raw connection failure, not a clean parsed HTTP error) → suspected a `Content-Length`/`fileSizeBytes` mismatch from the `LI Probe Video Size` HEAD-request pattern, checked the actual header value and disproved that theory (sizes matched) → true cause found in `LI Init Video Upload`'s actual response: LinkedIn's `initializeUpload` returns **multiple `uploadInstructions` entries** (each a `{uploadUrl, firstByte, lastByte}` byte-range) once a video exceeds LinkedIn's exact 4,194,304-byte (4 MiB) single-part limit, but the workflow only ever PUT the whole file to `uploadInstructions[0]`'s URL — a byte-range mismatch that reset the connection for anything bigger than 4 MiB.
- **Implemented proper multi-part video upload support** in `linkedin-poster.json`: a new `Split Video Into Parts` Code node (between `Merge Video Upload` and the existing PUT node) reads the full downloaded video via `this.helpers.getBinaryDataBuffer(0, 'data')`, slices out each `uploadInstructions[i]`'s exact `[firstByte, lastByte]` byte range with `buffer.subarray(...)`, and wraps each slice with `this.helpers.prepareBinaryData(...)` — emitting one item per part. The existing `LI Upload Video Binary` PUT node needed no logic change beyond its URL expression (`$json.value.uploadInstructions[0].uploadUrl` → `$json.uploadUrl`), since n8n runs an HTTP Request node once per input item automatically. A new `Collect Video Part ETags` Code node gathers each part's `ETag` response header, in order, into a single `uploadedPartIds` array that `LI Finalize Video Upload`'s body now references (previously a hardcoded single-element array). Confirmed both `this.helpers.getBinaryDataBuffer` and `this.helpers.prepareBinaryData` against n8n's own docs (`build/code-in-n8n/cookbook/code-node/get-the-binary-data-buffer.md`) before writing this — deliberately avoided `this.helpers.httpRequest`/raw Node streams inside a Code node so no `NODE_FUNCTION_ALLOW_BUILTIN` change was needed on the n8n container, and so the already-proven `HTTP Request` node config (binary PUT, `fullResponse: true` for the ETag header) could just be reused per-item instead of reimplemented. Handles both the 1-part and N-part cases uniformly — no separate single-part code path anymore.
- Diagnosed several bad test-media-URL issues along the way, each needing a different fix: an Unsplash page link and a Cloudinary **embed-player** URL (`player.cloudinary.com/embed/?...`) are both HTML widgets, not raw file bytes — converted the latter to Cloudinary's direct-delivery format (`res.cloudinary.com/<cloud_name>/video/upload/<public_id>.<format>`); a Google Drive `uc?export=download` link triggered Drive's virus-scan interstitial page (no `Content-Length` header), which the `LI Probe Video Size` HEAD-request pattern silently turned into `fileSizeBytes: 0`, cleanly rejected by LinkedIn as `FILE_SIZE_OUT_OF_RANGE` — concluded Drive links aren't reliable for this workflow and should be avoided in favor of genuinely direct-serving hosts.
- Hit and diagnosed a `PROCESSING_FAILED`/`CORRUPTED_ENTITY` status on an early test video (likely malformed `.webm` container metadata from a screen-recording tool) — diagnosis only; the fix (ffmpeg re-encode to standard MP4, H.264+AAC, `+faststart`) was explicitly deferred by the user until after the multi-part fix landed.
- **Confirmed the multi-part fix works end-to-end**: re-tested with a 27 MB Cloudinary sample video (`samples/sea-turtle.mp4`, over the 4 MiB single-part threshold, so a genuine multi-part case) — video uploaded, processed, and published successfully (`urn:li:video:D4D10AQEeeY8TspO1oQ`), confirmed via `GET /rest/videos/{id}` returning `status: AVAILABLE`.
- Discussed refining the (still-deferred) streaming-relay plan now that the real `initializeUpload` responses confirm LinkedIn caps every part at exactly 4,194,304 bytes: revised `websitePlan.md` §3 so the eventual relay is **one ranged S3 GET → PUT stream per part** (`Range: bytes=firstByte-lastByte`, matched to `uploadInstructions[]`) instead of one whole-file relay — bounds memory to ≤4 MiB at a time regardless of total video size, and reuses the already-built `Collect Video Part ETags` logic unchanged (only the byte *source* per part changes). Still not built — still blocked on an S3 bucket.
- **Researched and confirmed LinkedIn's carousel/multi-image support** directly against LinkedIn's own Posts API docs (Microsoft Learn): the Posts API's `content.carousel` type is **sponsored/ads-only** ("Organic: No, Sponsored: Yes"), but a separate `content.multiImage` type is the organic equivalent — 2 to 20 images, referenced by `urn:li:image:...` IDs, via `{ images: [{ id, altText }] }`. Confirmed schema via the live `multiimage-post-api` doc page before implementing (not guessed).
- **Added `CAROUSEL` support to `linkedin-poster.json`**: `Route by Media Type` gained a `CAROUSEL` rule; a new `Split Carousel URLs` Code node fans `media_urls[]` out into one item per photo (reusing the same "n8n runs a node once per input item" fan-out pattern as the video multi-part fix); `LI Init Image Upload (Carousel)` ∥ `LI Download Image (Carousel)` → `Merge Carousel Image Upload` → `LI Upload Image Binary (Carousel)` mirror the existing single-`IMAGE` flow exactly, just running once per photo automatically; `Collect Carousel Image URNs` pulls each photo's resulting image URN back out of the init node's per-item outputs (via `$('LI Init Image Upload (Carousel)').all()`), in `media_urls[]` order, into one array; `LI Publish Carousel` posts with `content.multiImage.images`. No `finalizeUpload` step needed for images, same as the existing single-image branch. Sticky note updated with the `multiImage`-vs-`carousel` distinction and the new `media_type` value.

**Decisions made:**
- `linkedin-poster.json` follows the existing per-platform-workflow conventions exactly (plain `HTTP Request` nodes with `authentication: none` + payload-injected token, `Merge` for parallel binary-download/session-init branches, `fullResponse` mode wherever a response header carries the real result) — no new architectural pattern introduced.
- Streaming-relay for LinkedIn video upload stays **documented, not built** (`websitePlan.md` §3) until an S3 bucket exists — separate and orthogonal from the multi-part correctness fix, which was needed regardless of whether uploads are streamed or buffered. Revised same session to a per-part (not whole-file) relay design once the 4 MiB part cap was confirmed by real testing.
- Multi-part video upload handling uses n8n's native "one output item per part → node runs once per item" behavior rather than a hand-rolled loop with `this.helpers.httpRequest` — keeps the already-tested single-part PUT node's config untouched and reusable, and avoids re-enabling `NODE_FUNCTION_ALLOW_BUILTIN`. The same fan-out pattern was reused verbatim for carousel/multi-image uploads — one recurring idiom for "do this LinkedIn upload step N times," not a one-off for video.
- LinkedIn carousel posts use `content.multiImage`, never `content.carousel` — the latter is unusable for this workflow's organic, personal-profile use case regardless of implementation effort, since the Posts API restricts it to sponsored posts at the platform level.
- Video re-encoding for the `CORRUPTED_ENTITY`/malformed-webm issue remains explicitly deferred — next LinkedIn-related work, per the user's own ordering.

**Files modified this session:**
- `workflows/linkedin-poster.json` (new) — full workflow; later updated for the `202609` API version fix, the multi-part video upload fix (`Split Video Into Parts`, `Collect Video Part ETags` nodes added; `LI Upload Video Binary` URL expression and `LI Finalize Video Upload` body updated), and `CAROUSEL`/multi-image support (`Split Carousel URLs`, `LI Init Image Upload (Carousel)`, `LI Download Image (Carousel)`, `Merge Carousel Image Upload`, `LI Upload Image Binary (Carousel)`, `Collect Carousel Image URNs`, `LI Publish Carousel` nodes added; `Route by Media Type` switch rule added); stale "not implemented" notes/sticky-note text corrected throughout
- `websitePlan.md` — new §3 subsection documenting the deferred LinkedIn video streaming-relay decision, later revised same session to a per-part ranged-GET design; Phase 3 roadmap item; two changelog entries
- `backend/docker-compose.yml` — briefly touched then reverted (streaming-relay over-implementation walked back)
- `history.md` — this entry, Platform Credential Reference, Key Technical Decisions

---

## Platform Credential Reference

> Fill this in as you complete setup.md steps. Keep actual secrets in a password manager — only record IDs here.

| Platform | App/Project Name | App ID / Client ID | Notes |
|----------|-----------------|-------------------|-------|
| Facebook | SMPosting App | *Configured* | `facebook-poster.json` fully tested — `TEXT`, `PHOTO`, `VIDEO`, and `MULTI_PHOTO` (carousel) all confirmed working end-to-end (Sep 10) once the code-368 block cleared. **Access token pasted in chat Sep 8 — treat as compromised, rotate before reuse.** V2 SaaS backend's real dispatch loop (OAuth connect → encrypted token storage → Composer submit → n8n → Graph API → callback → `PUBLISHED`) confirmed working end-to-end Sep 16 — first platform wired to the actual backend, not just the standalone n8n workflow. |
| Instagram | SMPosting App | *Configured* | Instagram Business Account ID retrieved; `instagram-poster.json` tested successfully for photo/story/reel (Sep 7). V2 SaaS backend now supports **both** connection methods end-to-end (Sep 17-21): Facebook Login (rides on the Facebook OAuth dialog, IG token scoped to `graph.facebook.com`) and standalone Instagram Login (`routes/auth/instagram.ts`, own OAuth product, IG token scoped to `graph.instagram.com`) — tracked as separate `ConnectedAccount` rows via the `connectionMethod` column so the two token scopes never clobber each other. |
| Threads | SMPosting App | *Configured* | Long-lived token generated via curl; `threads-poster.json` tested successfully for TEXT (Sep 7). V2 SaaS backend's Threads Login OAuth flow (`routes/auth/threads.ts`) implemented Sep 21 — own `THREADS_APP_ID`/`SECRET` on the same Meta App as Facebook, connecting account added as a Threads tester. **Unblocked Sep 23**: the Sep 22 redirect-URI save blocker cleared on Meta's side; a real Threads account connected end-to-end through the OAuth flow for the first time. Testing that surfaced a frontend bug (Threads missing from `composer.tsx`'s hardcoded platform allowlist, despite full backend readiness) — fixed same day. `CAROUSEL` media type (image-only) added to `threads-poster.json` + backend + composer the same session. `TEXT`/`IMAGE`/`VIDEO` remain end-to-end tested from Sep 7; `CAROUSEL` and the unblocked OAuth path are not yet live-tested end to end. |
| Reddit | — | — | *Deferred* (Pending API Access Request) |
| YouTube | SMPosting V1 | *Configured* | Upload-audit gate has **lifted** — `youtube-poster.json` tested successfully end-to-end for standard video and Shorts (Sep 8), after fixing a missing `Validate Payload → Initiate Resumable Upload` canvas connection. **V2 (Sep 23):** same `SMPosting V1` project now also backs the SaaS connect flow — needs a "Web application" OAuth client with redirect URI `<PUBLIC_BACKEND_URL>/api/auth/youtube/callback`, credentials in `backend/.env` as `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Consent screen still in **Testing**: every connecting Google account must be a test user (else `Error 403: access_denied`), refresh tokens expire after 7 days, and unaudited uploads are forced private |
| Pinterest | SMPosting V1 | *Configured* | Sandbox Developer Access Token generated |
| LinkedIn | *(personal profile app)* | *Configured* | `linkedin-poster.json` built and tested standalone (not yet backend-integrated) — `TEXT`/`IMAGE`/`VIDEO`/`CAROUSEL` all built, including multi-part video upload for files over LinkedIn's 4 MiB single-part limit (Sep 22, tested end-to-end) and multi-image carousel posts via `content.multiImage` (Sep 22, not yet live-tested). `LinkedIn-Version` hardcoded to `202609`, bump periodically per LinkedIn's versioning docs. Video re-encoding for malformed-container (`CORRUPTED_ENTITY`) cases still deferred. |

---

## Key Technical Decisions (Quick Reference)

| Decision | Details |
|----------|---------|
| n8n binary mode | `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` |
| Max payload size | `N8N_PAYLOAD_SIZE_MAX=4000` (4GB) |
| Data pruning | `EXECUTIONS_DATA_PRUNE=true`, 336h TTL |
| Volume mount | `/home/kushagra/n8n-data:/home/node/.n8n` |
| YouTube video source | Google Drive (Download) → n8n binary (`data` field) → YouTube node |
| YouTube Shorts | Same YouTube node — add `#Shorts` in title/description, source must be 9:16, ≤ 60s (V1 note; superseded by the "YouTube `SHORTS` (V2)" row below — YouTube's limit is now ≤3 min, vertical or square) |
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
| Instagram dual connection methods (V2) | Facebook Login and standalone Instagram Login can both connect the *same* physical Instagram account but issue tokens valid on different hosts (`graph.facebook.com` vs `graph.instagram.com`). Modeled as `ConnectedAccount.connectionMethod` (`FACEBOOK_PAGE` \| `INSTAGRAM_LOGIN`), folded into the unique constraint (`userId, platform, platformAccountId, connectionMethod`) so connecting via one flow never overwrites the other's token. |
| Instagram Graph host selection (V2) | Resolved once, backend-side, at payload-build time — `GRAPH_HOST[connectedAccount.connectionMethod]` in `service/n8n.ts` — and shipped to n8n as `token.graph_host` data. n8n's HTTP nodes just string-concatenate whatever host they're given; no host-selection logic lives in the workflow itself. |
| Instagram token expiry guard (V2) | `buildInstagramPayload` throws before dispatch if a `SLIDING_WINDOW` (Instagram-Login) token is within 24h of `tokenExpiresAt` or already past it — fails fast with "reconnect the account" instead of sending a doomed request to n8n, since there's no proactive refresh worker for this token type yet. |
| `ConnectedAccount` disconnect semantics (V2) | Soft-delete via `disconnectedAt` (nullable timestamp), not a hard `DELETE` — `Post.connectedAccountId` is `RESTRICT`, so a hard delete fails once the account has post history. Every read path that lists/resolves an account for use filters `disconnectedAt: null`; OAuth callbacks clear it on reconnect (same upsert key as the dual-connection-method fix above), reviving the row and its history instead of erroring or duplicating. |
| Threads OAuth (V2) | Own `THREADS_APP_ID`/`THREADS_APP_SECRET` on the same Meta App as Facebook (own "Threads API" product, own `threads.net` consent screen) — same relationship Instagram Login has to Facebook. `ConnectionMethod` gained `THREADS_LOGIN` purely for naming consistency, even though Threads has only one connection path. Dispatch payload is `{ access_token }` only — no page/business id, since Threads always posts to the caller's own `/me/threads`. |
| LinkedIn video upload — single-part limit | LinkedIn's `initializeUpload` returns one `uploadInstructions` entry per byte-range part; files over exactly 4,194,304 bytes (4 MiB) get split into multiple parts by LinkedIn itself. PUTting the whole file to `uploadInstructions[0]` only (ignoring the rest) causes a raw connection reset for anything bigger than 4 MiB — not a clean LinkedIn error response. |
| LinkedIn multi-part upload implementation | Handled via n8n's native "node runs once per input item" behavior rather than a hand-rolled HTTP loop: a Code node (`Split Video Into Parts`) fans the single downloaded video out into one item per part (sliced via `this.helpers.getBinaryDataBuffer` + `Buffer.subarray` + `this.helpers.prepareBinaryData`), so the existing single-part PUT node's config is reused unchanged, just fed multiple items. A second Code node (`Collect Video Part ETags`) collapses the resulting per-part `ETag` headers back into one ordered `uploadedPartIds` array for `finalizeUpload`. Deliberately avoids `this.helpers.httpRequest`/raw Node streams in a Code node, so no `NODE_FUNCTION_ALLOW_BUILTIN` change is needed. |
| LinkedIn streaming-relay (video) | Documented in `websitePlan.md` §3 as a deferred optimization (video-only, approach left to judgement) — blocked on having an S3 bucket to relay from; explicitly orthogonal to the multi-part correctness fix above, which was needed regardless of buffered vs. streamed upload. Revised Sep 22 to a per-part (ranged S3 GET matched to each `uploadInstructions[i]` byte range) design instead of one whole-file relay, once real testing confirmed the 4 MiB part cap. |
| LinkedIn carousel/multi-image posts | LinkedIn's Posts API has two visually-similar-sounding but functionally distinct content types: `content.carousel` is **sponsored/ads-only** (confirmed via LinkedIn's own docs — "Organic: No"), while `content.multiImage` (2-20 images, `{ id, altText }` per image) is the organic equivalent and the one this workflow actually uses. `linkedin-poster.json`'s `CAROUSEL` media type reuses the video multi-part fix's fan-out pattern (`Split Carousel URLs` → parallel init/download per photo → merge → upload → `Collect Carousel Image URNs`) rather than inventing a new one — same idiom, different LinkedIn endpoint. No `finalizeUpload` step needed, same as single-image posts. |
| LinkedIn OAuth (V2) | Standalone LinkedIn App (`developer.linkedin.com`), not a Meta App — own `LINKEDIN_CLIENT_ID`/`SECRET`. "Sign In with LinkedIn using OpenID Connect" (`openid profile` scopes) resolves the member's own `sub` via `GET /v2/userinfo`, used to build `urn:li:person:{sub}` automatically instead of pasting it in manually; "Share on LinkedIn" (`w_member_social`) authorizes posting. No page/business resolution step, unlike Facebook/Instagram. |
| LinkedIn token refresh strategy (V2) | New `RefreshStrategy.REQUIRES_RECONNECT` enum value — LinkedIn issues a 60-day access token with **no refresh token at all** (unlike Threads' `SLIDING_WINDOW`, which actually has something to refresh). `buildLinkedInPayload` throws a clear "reconnect the account" error at dispatch time once within `TOKEN_EXPIRY_BUFFER_MS` (24h) of `tokenExpiresAt`; `routes/integrations.ts` surfaces the same check as a `needsReconnect` boolean so the dashboard can show a "Reconnect" button before the user even tries to post, rather than only failing at dispatch. |
| Frontend platform allowlist is separate from backend (V2, gotcha) | `frontend/src/routes/composer.tsx` maintains its own `PostablePlatform` union, `MEDIA_TYPES_BY_PLATFORM`, `PLATFORM_LABELS`, and `postableAccounts` filter — none derived from the backend's `Platform` enum or `SUPPORTED_MEDIA_TYPES`. A platform can be fully wired backend-side (OAuth, dispatch, n8n workflow) and still not appear in the composer dropdown if this file isn't updated too, since TypeScript can't catch the omission (`account.platform` is typed as the full OpenAPI enum; the `.filter()` just silently drops anything not explicitly listed). Bit Threads on Sep 23 — fixed, and worth checking first whenever a new platform "isn't showing up" despite the backend looking complete. |
| Threads `CAROUSEL` (V2) | `threads-poster.json` reuses `instagram-poster.json`'s carousel shape almost exactly: per-image child containers (`is_carousel_item=true`) → aggregate returned `id`s → one parent container (`media_type=CAROUSEL&children=id1,id2,...`) → publish. Image-only, same scope decision as the existing Facebook/Instagram carousels in this codebase, even though Threads' API itself also accepts video children. |
| Instagram Reels / Threads Video fixed-wait gap (V2, documented not fixed) | Both `instagram-poster.json` (Reels) and `threads-poster.json` (Video) create a container then blind-`Wait` a fixed duration (60s) before calling publish, instead of polling the container's `status` field until `FINISHED` like Meta's docs recommend. Confirmed (Sep 23) as a real failure mode, not just theoretical: a video near Threads' 1GB/5min ceiling on a slow connection can still be `IN_PROGRESS` when the wait expires, and the publish call fails outright rather than degrading gracefully — no retry-and-recover. This is a *different* gap from the existing Facebook/LinkedIn post-publish `video-status-queue.ts` poller (that one confirms an already-published video finished transcoding; this one is pre-publish and its failure blocks the post from going live at all). Planned fix: replace the fixed `Wait` node in both workflows with a real poll loop (`GET .../{container_id}?fields=status` → `Wait` short interval → retry until `FINISHED`/`ERROR`/timeout) built inside n8n itself. Documented in `websitePlan.md` §6/Phase 3 roadmap; deliberately not implemented yet per explicit instruction to document only. |
| LinkedIn video status polling (V2) | Reused the existing Facebook `video-status-poll` BullMQ queue/worker instead of standing up a second one — each poll job is one fast HTTP status check that either finishes or throws to let BullMQ's fixed 30s backoff reschedule it, so it never blocks the worker for the actual multi-minute processing duration; a burst on one platform can't meaningfully starve the other. `VideoStatusJobData` gained a `platform` discriminator and a `mediaId` field separate from `platformPostId`, since LinkedIn's video urn (what you poll, `GET /rest/videos/{urn}`) and its post/share urn (what you log as the history-page id) are two different things — Facebook's case has them be the same id, so its call site needed no change (`mediaId` defaults to `platformPostId`). Worker `concurrency` bumped from the implicit default of 1 to 5 so simultaneous polls across platforms run in parallel rather than strictly one-at-a-time. `linkedin-poster.json`'s `Build Success Result`/`Send Callback` nodes now also send back `media_urn` (the video's own urn, only set on the `VIDEO` branch) alongside the existing `platform_post_id` (the created post's urn), since the backend needs both. |
| YouTube OAuth + token refresh (V2) | Own Google OAuth flow (`lib/youtube.ts`, `routes/auth/youtube.ts`), `ConnectionMethod.YOUTUBE_LOGIN`. `access_type=offline&prompt=consent` so Google always returns a refresh token (callback throws if it doesn't). Scopes `youtube.upload` + `youtube.readonly` — readonly needed for `channels.list?mine=true` (channel id/title at connect) and `videos.list` (poller). Callback rejects an unticked upload scope (granular consent) and channel-less Google accounts with their own error toasts. First real `RefreshStrategy.ON_DEMAND`: `service/youtube-token.ts` `getFreshYouTubeAccessToken()` reuses the stored ~1h access token while >5 min from expiry (no network call, no DB write) and only then refreshes + persists it; refresh token never rotates. `invalid_grant` nulls `encryptedRefreshToken`, which `GET /api/integrations` reports as `needsReconnect`. n8n only ever receives an already-fresh access token. |
| `Posts.platform_options` (V2) | New nullable JSON column for per-platform fields the shared `caption`/`media_urls` columns can't hold — currently YouTube's `{ title, privacyStatus, madeForKids, categoryId, tags }`, validated by zod in `routes/posts.ts` (title 1–100 chars, no `<`/`>`; tags ≤500 chars combined; category from a hardcoded list of 15 assignable ids, default `"22"`; privacy defaults to `private`). JSON over dedicated columns so future platform-specific options (Pinterest board, etc.) don't each need a migration. YouTube's `caption` is the video description; `GET /api/posts` exposes `youtubeTitle` for the history page. |
| YouTube `SHORTS` (V2) | New `MediaType.SHORTS`, YouTube-only. The API has no Shorts flag — YouTube classifies vertical/square videos ≤3 min itself — so `buildYouTubePayload` just appends `#Shorts` to the description when it's in neither title nor description. `workflows/youtube-poster.json` treats `VIDEO` and `SHORTS` identically. |
| YouTube video status polling (V2) | YouTube joins Facebook/LinkedIn on the single `video-status-poll` queue — the n8n callback's `SUCCESS` only means the upload was accepted. Every YouTube post is polled via `videos.list?part=status` (`processed` → `PUBLISHED`; `failed`/`rejected`/`deleted` → `FAILED` with YouTube's reason). Worker refactored to a per-platform `PLATFORMS` check table; `POLL_POLICY` is a `Record<VideoPollPlatform, …>` so a new platform can't compile without an entry. YouTube uses **capped exponential backoff** (15s → 5 min cap, 11 checks, ~33 min) via a custom BullMQ `backoffStrategy` (built-in `exponential` has no cap); Facebook/LinkedIn keep fixed 30s × 30. |
| Shared vs per-platform poll queue (V2) | Kept **one** queue/worker for all video polling (concurrency 5): each job is one fast status call that throws to reschedule, so no platform can starve another. Split per platform only once one needs its own BullMQ rate limiter (per-queue) or independent scaling. Known gap across all platforms: if the status check itself *throws* on every attempt (network error, revoked token), the job exhausts attempts without writing a `PostLog` and the post stays `PROCESSING`. |
| Prisma migrations with `_prisma_migrations` drift | `prisma migrate dev` demands a full reset because of a stale rolled-back row for `20260916205952_fix_connected_account_unique_key` (the applied row matches the file). Never accept the reset — generate SQL with `prisma migrate diff`, hand-write the migration folder (omit the unrelated `RenameIndex` drift), then `migrate deploy` + `generate`. Used for `20260923040000_add_youtube`. |

---

### Session 25 — 2026-09-22

**What we did:**
- **Integrated `linkedin-poster.json` with the real backend and frontend**, following the exact same shape as Facebook/Instagram/Threads (OAuth connect flow → encrypted token storage → Composer submit → `service/n8n.ts` dispatch → n8n webhook → callback → `PUBLISHED`), plus a new piece none of the other platforms needed: a true async video-readiness poller.
- **Schema**: added `Platform.LINKEDIN`, `ConnectionMethod.LINKEDIN_LOGIN`, and a new `RefreshStrategy.REQUIRES_RECONNECT` value (LinkedIn's 60-day token has no refresh token at all, unlike Threads' `SLIDING_WINDOW`). Hand-wrote the migration SQL (`ALTER TYPE ... ADD VALUE` x3) and applied it directly via `psql` + `prisma migrate resolve --applied` instead of `prisma migrate dev`, after discovering **pre-existing drift** on an unrelated older migration (`20260916205952_fix_connected_account_unique_key` has two rows in `_prisma_migrations` with different checksums — an artifact from a retried migration in an earlier session) that made `migrate dev` demand a full destructive `migrate reset`. Left that pre-existing drift alone rather than fixing it by wiping test data — flagged here for whoever eventually resolves it properly.
- **`lib/linkedin.ts`** (new): `buildAuthUrl`/`exchangeCodeForToken` (standard OAuth 2.0 code exchange, no long-lived-token step like Facebook/Threads need), `fetchProfile` (OIDC `GET /v2/userinfo`, resolves `sub`/`name` so the person urn is derived automatically instead of pasted in), and `getVideoStatus` (`GET /rest/videos/{urn}`, normalizes LinkedIn's `AVAILABLE`/`PROCESSING_FAILED`/still-processing onto the same `"ready"|"error"|"processing"` union `lib/facebook.ts`'s version returns).
- **`routes/auth/linkedin.ts`** (new): mirrors `routes/auth/threads.ts` — Redis-backed CSRF state, upserts `ConnectedAccount` on `(userId, platform, platformAccountId, connectionMethod)`, `refreshStrategy: REQUIRES_RECONNECT`.
- **`service/n8n.ts`**: added `buildLinkedInPayload`/`dispatchLinkedInToN8n` — `media_type` passed through verbatim (no renaming, like Instagram/Threads), `token: { access_token, author_urn }` built from the stored `platformAccountId`. Reuses Instagram's/Threads' `TOKEN_EXPIRY_BUFFER_MS` expiry guard (now exported) for the `REQUIRES_RECONNECT` case.
- **`routes/posts.ts` / `routes/integrations.ts` / `routes/webhooks.ts`**: added `LINKEDIN` to every hardcoded platform enum list, `SUPPORTED_MEDIA_TYPES.LINKEDIN = [TEXT, IMAGE, VIDEO, CAROUSEL]`, a dispatch branch, and a `media_urn` field on the n8n callback schema (LinkedIn-only, video branch only).
- **Extended the video-status BullMQ queue/worker to cover LinkedIn** (see the new "LinkedIn video status polling" row in Key Technical Decisions above for the full reasoning) rather than building a second one — `enqueueVideoStatusPoll` gained `platform`/`mediaId` params, the worker branches its status-check call and log messages on `platform`, concurrency bumped to 5.
- **Frontend**: `dashboard.tsx` gained a "Connect LinkedIn" button, LinkedIn's three OAuth error toasts, a `connected=linkedin` success toast, and a per-account "Reconnect" button + "Token expired — reconnect below" notice driven by the new `needsReconnect` field (shown whenever a `REQUIRES_RECONNECT`/`SLIDING_WINDOW` account is within 24h of `tokenExpiresAt`). `composer.tsx` gained `LINKEDIN` in `MEDIA_TYPES_BY_PLATFORM` (`TEXT`/`IMAGE`/`VIDEO`/`CAROUSEL`, same options as Facebook) and in the postable-accounts filter.
- Regenerated `frontend/src/lib/api-schema.d.ts` from the live OpenAPI doc (booted the backend briefly with a placeholder `LINKEDIN_CLIENT_ID`/`SECRET` just to pass env validation for this, then restored the blank `.env` placeholders — no real LinkedIn call happens on that code path). Backend (`tsc --noEmit`) and frontend (`tsc -b`) both typecheck clean.
- Updated `workflows/linkedin-poster.json`'s shared `Build Success Result`/`Send Callback` nodes to also emit `media_urn` (video branch only, guarded by `req.media_type === 'VIDEO'` so it doesn't try to reference a node that never ran on other branches) — **not yet re-imported into the running n8n instance**, since there's no `N8N_API_KEY` configured for programmatic import; needs a manual re-import via n8n's UI before the video-polling path can be tested live.

**Decisions made (see Key Technical Decisions table above for the technical detail on each):**
- New `RefreshStrategy.REQUIRES_RECONNECT` enum value, with a `needsReconnect` field surfaced on `GET /api/integrations` so the dashboard can prompt before dispatch fails, not just after.
- LinkedIn's person urn is resolved automatically via OIDC `/v2/userinfo` (`openid profile` scopes) rather than requiring it to be pasted in, closing the gap from the very first LinkedIn session where it was supplied manually.
- Reused the existing Facebook video-status BullMQ queue/worker for LinkedIn instead of a second queue — the "does polling block the other platform" concern raised this session doesn't actually apply, since each poll job is a fast single HTTP call gated by BullMQ's backoff, not a blocking wait; concurrency bumped from 1 to 5 as cheap headroom. Splitting into per-platform queues is a small, isolated follow-up if real contention ever shows up, not a redesign.
- Pre-existing `_prisma_migrations` drift (unrelated to this session's change) was worked around, not fixed — applying the LinkedIn migration by hand rather than running `prisma migrate reset` and destroying already-connected test accounts.

**Files modified this session:**
- `backend/prisma/schema.prisma` — `Platform.LINKEDIN`, `ConnectionMethod.LINKEDIN_LOGIN`, `RefreshStrategy.REQUIRES_RECONNECT`
- `backend/prisma/migrations/20260922062752_add_linkedin/migration.sql` (new, hand-written, applied manually + `migrate resolve --applied`)
- `backend/src/lib/linkedin.ts` (new)
- `backend/src/routes/auth/linkedin.ts` (new)
- `backend/src/lib/env.ts` — `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET`
- `backend/.env` / `backend/.env.example` — LinkedIn credential placeholders + setup comment
- `backend/src/service/n8n.ts` — `buildLinkedInPayload`, `dispatchLinkedInToN8n`, exported `TOKEN_EXPIRY_BUFFER_MS`
- `backend/src/routes/posts.ts`, `backend/src/routes/integrations.ts` (also added `needsReconnect`), `backend/src/routes/webhooks.ts` (also added `media_urn`)
- `backend/src/queue/video-status-queue.ts` / `backend/src/queue/video-status-worker.ts` — platform-aware polling, `mediaId` vs `platformPostId`, concurrency 5
- `backend/src/index.ts` — mounted `/api/auth/linkedin`
- `workflows/linkedin-poster.json` — `Build Success Result`/`Send Callback` now emit `media_urn`
- `frontend/src/routes/dashboard.tsx`, `frontend/src/routes/composer.tsx`
- `frontend/src/lib/api-schema.d.ts` (regenerated)
- `history.md` — this entry, Platform Credential Reference, Key Technical Decisions

---

### Session 26 — 2026-09-23

**What we did:**
- Kushagra fixed the Meta App Dashboard's redirect-URI save blocker from Session 23/Sep 22 and successfully connected a real Threads account through the app's OAuth flow for the first time — but the connected account didn't appear in the Composer's "Post as" dropdown.
- Investigated and found this was a **frontend bug, not an OAuth/backend problem**: `frontend/src/routes/composer.tsx` keeps its own hardcoded platform allowlist (`PostablePlatform` union, `MEDIA_TYPES_BY_PLATFORM`, `PLATFORM_LABELS`, the `postableAccounts` filter, the empty-state message) entirely separate from the backend — it only ever listed `FACEBOOK | INSTAGRAM | LINKEDIN`. Threads' OAuth (`routes/auth/threads.ts`), dispatch (`buildThreadsPayload`/`dispatchThreadsToN8n`), and n8n workflow (`threads-poster.json`) had all been complete since Sep 21; the account was simply filtered out of the UI. Fixed by adding `THREADS` to all four spots.
- Confirmed the rest of the Threads integration's actual state while investigating: OAuth, dispatch, and the n8n workflow (`TEXT`/`IMAGE`/`VIDEO`) were all genuinely done; only `CAROUSEL` was missing and the frontend gap above.
- Answered a question about whether Threads video needs a BullMQ status-poll worker like Facebook/LinkedIn: no — Threads (like Instagram Reels) uses a container-create → fixed-wait → publish flow entirely inside the n8n workflow, not a post-publish backend poll. That's a different mechanism from the Facebook/LinkedIn case, which needs `video-status-queue.ts` because those platforms return success *before* transcoding finishes.
- Researched (web search) Threads' actual video specs to answer directly: MP4/MOV, H264/HEVC, 23-60 FPS, max 1920px width, **max 5 min duration, max 1 GB file size**, AAC audio. Also confirmed Threads supports carousels via the same container-model API Instagram uses (`is_carousel_item=true` children → parent `CAROUSEL` container with `children=id1,id2,...` → publish), up to a documented 20 items (sources vary 2-20).
- **Implemented Threads `CAROUSEL`** end-to-end, image-only (matching the existing Facebook/Instagram carousel scope in this codebase):
  - `workflows/threads-poster.json`: added a `CAROUSEL` output to the `Route by Media Type` switch, wired to a new `Split Media URLs` → `Create Child Container` (`is_carousel_item=true`, `media_type=IMAGE`) → `Aggregate Child IDs` → `Create Carousel Container` (`media_type=CAROUSEL&children=...`) → `Wait 10s (Carousel)` → `Publish Carousel` chain, feeding into the existing `Build Success Result` → `Send Callback` path. Updated the workflow's sticky note to document the new media type and its image-only scope.
  - `backend/src/routes/posts.ts`: `SUPPORTED_MEDIA_TYPES.THREADS` now includes `"CAROUSEL"`.
  - `frontend/src/routes/composer.tsx`: Threads dropdown now offers "Carousel (multiple photos)".
- Verified both backend (`bunx tsc --noEmit`) and frontend (`tsc -b --noEmit`) typecheck clean after all changes.
- Kushagra asked whether the 60s fixed-wait-before-publish pattern (Threads Video, and by the same logic Instagram Reels) only covers the best case, and pointed out a max-size video on a slow connection could still be processing when the wait ends. Confirmed this is correct and a real (not theoretical) failure mode — `threads-poster.json`'s own sticky note already flagged the same limitation before this session touched it. Per explicit instruction, **documented this gap and its planned fix without implementing it**: added a "Known Gap: Container-Status Polling Before Publish" subsection to `websitePlan.md` §6, a Phase 3 roadmap line, and a Key Technical Decisions row here, all describing the real fix (poll `GET .../{container_id}?fields=status` in a loop until `FINISHED`/`ERROR`/timeout, replacing the blind `Wait` node, inside both `instagram-poster.json` and `threads-poster.json`) for a future session to build.

**Decisions made:**
- Threads `CAROUSEL` stays image-only for now, matching this codebase's existing Facebook/Instagram carousel scope, even though Threads' API also technically accepts video children in a carousel — no user-facing need for mixed carousels yet.
- The container-status-polling fix for Instagram Reels/Threads Video is deliberately deferred (documentation only, no code) — explicit instruction this session, tracked in `websitePlan.md` §6/Phase 3 and the Key Technical Decisions table above for whoever picks it up next.
- No change made to the existing Facebook/LinkedIn `video-status-queue.ts` poller — confirmed it's a genuinely different mechanism (post-publish transcode confirmation) from the pre-publish container-readiness gap Threads/Instagram have, so it isn't a candidate for reuse here.

**Files modified this session:**
- `frontend/src/routes/composer.tsx` — added `THREADS` to `PostablePlatform`, `MEDIA_TYPES_BY_PLATFORM` (`TEXT`/`IMAGE`/`VIDEO`/`CAROUSEL`), `PLATFORM_LABELS`, the `postableAccounts` filter, and the empty-state message
- `backend/src/routes/posts.ts` — `SUPPORTED_MEDIA_TYPES.THREADS` gained `"CAROUSEL"`
- `workflows/threads-poster.json` — new `CAROUSEL` branch (`Split Media URLs`, `Create Child Container`, `Aggregate Child IDs`, `Create Carousel Container`, `Wait 10s (Carousel)`, `Publish Carousel` nodes + `Route by Media Type` switch rule + connections); sticky note updated
- `websitePlan.md` — §2.3 unblocked note, §5 `threads-poster` bullet updated for `CAROUSEL`, new §6 "Known Gap: Container-Status Polling Before Publish" subsection, Phase 3 roadmap items, new changelog entry
- `history.md` — this entry, Quick State Snapshot, Platform Credential Reference (Threads row), Key Technical Decisions (3 new rows)

### Session 27 — 2026-09-23

**What we did:**
- **Wired YouTube to the real backend and frontend**, same shape as the other four platforms (OAuth connect → encrypted token storage → Composer submit → `service/n8n.ts` dispatch → `youtube-poster` n8n webhook → callback), plus a post-upload processing poller.
- **Schema** (migration `20260923040000_add_youtube`, hand-written + `migrate deploy` — see Key Technical Decisions): `ConnectionMethod.YOUTUBE_LOGIN`, `MediaType.SHORTS`, nullable `posts.platform_options` JSONB.
- **OAuth**: `lib/youtube.ts` (auth URL, code exchange, refresh, `channels.list`, `videos.list` status), `routes/auth/youtube.ts` (Redis-state CSRF check, scope + channel guards, upsert keyed on channel id, `disconnectedAt: null` on reconnect), `service/youtube-token.ts` (`ON_DEMAND` refresh helper). `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` added to `env.ts`/`.env.example`. `integrations.ts` reports `needsReconnect` for an `ON_DEMAND` row with a null refresh token.
- **Dispatch**: `buildYouTubePayload` (async — it may refresh the token first, hence `await dispatchYouTubeToN8n(await buildYouTubePayload(...))` while the other platforms' builders are sync) and `dispatchYouTubeToN8n`. `posts.ts` accepts `youtubeOptions` (required for YouTube, 400 otherwise), stores it as `platformOptions`, `SUPPORTED_MEDIA_TYPES.YOUTUBE = VIDEO/SHORTS`.
- **Workflow** `youtube-poster.json`: `x-callback-secret` header on both callback nodes; `Parse Request` reads `media_type`, `made_for_kids`, `tags`, `category_id`; `Validate Payload` also requires the access token; `Initiate Resumable Upload` sends tags, `categoryId`, `selfDeclaredMadeForKids` (category no longer hardcoded to 22). Sticky note rewritten.
- **Poller**: `webhooks.ts` enqueues a status poll for every YouTube `SUCCESS` callback (mediaId = platformPostId). Queue/worker refactored into per-platform `POLL_POLICY` + `PLATFORMS` tables; YouTube switched from fixed 30s to capped exponential backoff via a custom `backoffStrategy` registered in the worker's `settings`.
- **Frontend**: dashboard "Connect YouTube" button, 5 `youtube_connect_*` error toasts, `connected=youtube` toast; composer YouTube fields (title with 100-char counter, visibility, category picker, made-for-kids, comma-separated tags; caption relabelled "Description"; `Short` media option); history page shows the video title above the description. `api-schema.d.ts` regenerated from the backend's OpenAPI doc.
- Helped Kushagra past Google's `Error 403: access_denied` (add the account under Google Auth Platform → Audience → Test users) and explained that a Google Drive test file must be shared "Anyone with the link" for its `drive.usercontent.google.com/download?id=…&export=download&confirm=t` URL to return the video instead of a sign-in page.
- Both `bunx tsc --noEmit` (backend) and `tsc -b --noEmit` (frontend) typecheck clean; OAuth URL building and payload builder smoke-tested. **No live end-to-end YouTube post through the backend yet.**

**Decisions made:**
- One shared video-status queue, not per-platform (see Key Technical Decisions).
- `ON_DEMAND` refresh checks expiry before refreshing, so a ~33 min YouTube poll refreshes at most once or twice instead of on every check.
- YouTube-specific fields go in a generic `platform_options` JSON column rather than new columns.
- `SHORTS` is a backend/UI concept only — handled by appending `#Shorts`, the workflow treats it like `VIDEO`.
- The download-whole-video-then-upload bottleneck (YouTube, Facebook video, LinkedIn video) stays deferred (`websitePlan.md` §3).

**Still to do:**
- Add `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to `backend/.env`, re-import `youtube-poster.json` into n8n, restart the backend, then run a live private-video and Short post end to end.
- Fix the poller gap where a check that keeps throwing leaves the post in `PROCESSING` (all platforms).

**Files modified this session:**
- `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260923040000_add_youtube/migration.sql` (new)
- `backend/src/lib/env.ts`, `backend/.env.example`, `backend/src/lib/youtube.ts` (new), `backend/src/service/youtube-token.ts` (new), `backend/src/routes/auth/youtube.ts` (new), `backend/src/index.ts`
- `backend/src/service/n8n.ts`, `backend/src/routes/posts.ts`, `backend/src/routes/integrations.ts`, `backend/src/routes/webhooks.ts`
- `backend/src/queue/video-status-queue.ts`, `backend/src/queue/video-status-worker.ts`
- `workflows/youtube-poster.json`
- `frontend/src/lib/api-schema.d.ts`, `frontend/src/routes/dashboard.tsx`, `frontend/src/routes/composer.tsx`, `frontend/src/routes/history.tsx`
- `websitePlan.md` — §2.4 implementation notes, §5 `youtube-poster` bullet, §6 poller implementation + shared-queue decision + known gap, §7 `connection_method`/`refresh_strategy`/`media_type`/`platform_options`, Phase 3 roadmap, changelog
- `history.md` — this entry, Quick State Snapshot, Platform Credential Reference (YouTube row), Key Technical Decisions (6 new rows, Shorts row annotated)

---

*Update this file at the end of each session.*
