# 📜 Project History — smPosting

> **Purpose**: Running log of every decision, file change, and completed task.  
> Update this file at the end of every working session.  
> Reference this first when resuming work — no need to re-read all docs.

---

## Quick State Snapshot

| Item | Value |
|------|-------|
| **Current Phase** | Phase 1 — Foundation (in progress) — YouTube ✅ done |
| **Active Platforms** | Facebook, Instagram, Reddit, YouTube, Pinterest |
| **Excluded (V1)** | Quora (no API), X/Twitter (deferred to V2) |
| **Credential Scope** | Single user (your own accounts) |
| **n8n Setup** | Self-hosted Docker (container: `n8n`, project: InternApplier) |
| **n8n URL (local)** | http://localhost:5678 |
| **n8n Public URL (temp)** | https://breach-payer-sharpie.ngrok-free.dev |
| **OAuth Callback URL** | https://breach-payer-sharpie.ngrok-free.dev/rest/oauth2-credential/callback |
| **Tunnel** | ngrok (free static domain) ✅ Working |
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
| `workflows/` | n8n workflow JSON exports (importable into n8n) | — |
| `websitePlan.md` | V2 SaaS product & technical spec (architecture, OAuth, DB schema, roadmap) | 2026-09-06 |

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

## Platform Credential Reference

> Fill this in as you complete setup.md steps. Keep actual secrets in a password manager — only record IDs here.

| Platform | App/Project Name | App ID / Client ID | Notes |
|----------|-----------------|-------------------|-------|
| Facebook + Instagram | SMPosting App | *Configured* | Instagram Business Account ID retrieved |
| Threads | SMPosting App | *Configured* | Long-lived token generated via curl; HTTP Request node setup |
| Reddit | — | — | *Deferred* (Pending API Access Request) |
| YouTube | SMPosting V1 | *Configured* | OAuth2 credentials generated |
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

---

*Update this file at the end of each session.*
