# 📋 Social Media Auto-Poster — V1 Product Planning

> **Product**: n8n-based social media automation for marketing agencies  
> **Version**: V1  
> **Infrastructure**: Self-hosted n8n on Docker  
> **Target Platforms (V1)**: Instagram, Facebook, Reddit, YouTube, Pinterest  
> **Excluded from V1**: Quora (no API), X/Twitter (deferred to V2)  
> **Constraint**: No paid third-party service nodes (no Blotato, PostFast, etc.)  
> **Credential Scope**: Single-user (your own credentials) for V1 testing

---

## Table of Contents

1. [Platform Research: n8n Node Availability](#1-platform-research-n8n-node-availability)
2. [Platform-by-Platform API Strategy](#2-platform-by-platform-api-strategy)
3. [Proposed Workflow Architecture](#3-proposed-workflow-architecture)
4. [Reference Workflows (No Third-Party Services)](#4-reference-workflows-no-third-party-services)
5. [Content Queue Design](#5-content-queue-design)
6. [Rate Limits & API Quotas](#6-rate-limits--api-quotas)
7. [Cost Summary](#7-cost-summary)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Open Questions & Risks](#9-open-questions--risks)

---

## 1. Platform Research: n8n Node Availability

This section documents whether each target platform has a **native built-in n8n node**, or if you need to use the **HTTP Request node** with direct API calls.

| Platform | V1 Status | Native n8n Node? | Node Name / Approach | Auth Method |
|----------|:---------:|:-----------------:|----------------------|-------------|
| **Facebook** | ✅ Included | Yes | `Facebook Graph API` node | Page Access Token |
| **Instagram** | ✅ Included | Yes (via Meta) | `Facebook Graph API` node | Page Token + IG Business Account ID |
| **Reddit** | ✅ Included | Yes | `Reddit` node | OAuth2 (Client ID + Secret) |
| **YouTube** | ✅ Included | Yes | `YouTube` node | Google OAuth2 |
| **Pinterest** | ✅ Included | No — HTTP Request | `HTTP Request` node → Pinterest API v5 | Generic OAuth2 |
| **Quora** | ❌ Excluded | No | No official API exists — monitoring only | N/A |
| **X (Twitter)** | ⏳ Deferred to V2 | Yes | `X (Twitter)` node | OAuth 2.0 (PKCE) — Paid API |

### Key Findings & Decisions

- **Facebook** requires a Page (not a personal profile) and a Page Access Token with `pages_manage_posts` scope.
- **Instagram** requires a Business or Creator account linked to a Facebook Page. Cannot automate personal accounts.
- **Reddit** has a native node. For V1 (single account), use a "Script" type app — simplest auth flow.
- **YouTube** has a native node via Google Cloud. Requires enabling YouTube Data API v3. Videos must be handled as binary data — Docker config is critical (see Section 7).
- **Pinterest** has no native node. Use `HTTP Request` node with Pinterest API v5. Requires Business account and Standard Access approval for public pins.
- **Quora** — **DECISION: Excluded from V1.** No public posting API exists. Any unofficial automation risks permanent account ban.
- **X/Twitter** — **DECISION: Deferred to V2.** API is fully pay-per-use (~$0.015–$0.20/tweet). Not worth the complexity and cost for initial testing.

---

## 2. Platform-by-Platform API Strategy

### 2.1 Facebook (Pages)

- **Method**: Native `Facebook Graph API` node in n8n
- **API**: Meta Graph API v19+
- **Endpoint for posting**: `POST /{PAGE_ID}/feed`
- **Required Permissions (Scopes)**:
  - `pages_manage_posts`
  - `pages_read_engagement`
  - `pages_show_list`
- **Token Type**: **Page Access Token** (long-lived, 60 days renewable — convert to never-expiring using system user token in Meta Business Suite)
- **Supported Content Types**: Text, Link, Photo, Video (via upload)
- **Credential in n8n**: Facebook Graph API credential — paste App ID, App Secret, Access Token

**Important Notes**:
- Personal profiles **cannot** be used; you need a Facebook Page
- For image/video posts, media must be uploaded first, then referenced
- Use a **System User Token** in Meta Business Manager for production (never expires)

---

### 2.2 Instagram (Business)

- **Method**: Native `Facebook Graph API` node (Instagram is part of Meta's API)
- **API**: Instagram Graph API (via Meta)
- **Two-step posting process**:
  1. `POST /{IG_USER_ID}/media` — creates a media container — returns `creation_id`
  2. `POST /{IG_USER_ID}/media_publish` — publishes the container using `creation_id`
- **Required Permissions (Scopes)**:
  - `instagram_basic`
  - `instagram_content_publish`
  - `pages_show_list`
  - `pages_read_engagement`
- **Supported Content Types**: Image, Video (Reels), Carousel (multiple images)
- **Media Hosting**: Images/Videos must be hosted at a **publicly accessible URL** (use Cloudinary, S3, or a self-hosted server)

**Important Notes**:
- Must be a Business or Creator account
- Must be linked to a Facebook Page
- 25 API-published posts per 24h limit
- For Carousel posts, each image gets its own media container first, then all are published together
- Add a `Wait` node (5 seconds) between "create container" and "publish" steps

---

### 2.3 Reddit

- **Method**: Native `Reddit` node in n8n
- **API**: Reddit API v1 (via OAuth2)
- **Node Operations**: Submit Post (text/self post or link post)
- **Required Scopes**: `submit`, `identity`
- **Auth Type**: OAuth2 (Script app type for personal/agency use, or Web App for multi-user)
- **Credential in n8n**: Reddit credential — Client ID + Client Secret

**Important Notes**:
- Reddit requires a `User-Agent` header on all requests (format: `platform:appID:version (by /u/username)`)
- Each subreddit has its own rules — some require account age/karma before posting
- Commercial use may require formal approval from Reddit's developer support
- For a "Script" app type: use Resource Owner Password Credentials grant (simplest for agency use)

---

### 2.4 YouTube

- **Method**: Native `YouTube` node in n8n
- **API**: YouTube Data API v3
- **Node Operations**: Upload video, update video metadata
- **Required Setup**: Google Cloud Console project — Enable YouTube Data API v3 — Create OAuth2 credentials
- **Required Scopes**:
  - `https://www.googleapis.com/auth/youtube.upload`
  - `https://www.googleapis.com/auth/youtube`
- **Credential in n8n**: Google OAuth2 credential (using Client ID + Client Secret from Google Cloud Console)

**Important Notes**:
- YouTube videos must be binary data — store in Google Drive or filesystem, not just a URL
- Set `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` in your Docker env to handle large video files
- For Brand Accounts, add `prompt=consent select_account` to the OAuth URL to force channel picker
- The free quota is **10,000 units/day**; a video upload costs 1,600 units
- Add test Google account as a "Test user" in Google Auth Platform while in testing mode

---

### 2.5 Pinterest

- **Method**: `HTTP Request` node — Pinterest API v5
- **Endpoint**: `POST https://api.pinterest.com/v5/pins`
- **Auth**: Generic OAuth2 in n8n (Pinterest App ID + App Secret)
- **Required Scopes**: `boards:read`, `pins:read`, `pins:write`
- **Request Body Example**:
```json
{
  "board_id": "BOARD_ID_HERE",
  "title": "Pin Title",
  "description": "Pin description",
  "media_source": {
    "source_type": "image_url",
    "url": "https://yourhost.com/image.jpg"
  },
  "link": "https://yourwebsite.com"
}
```

**Important Notes**:
- Must have a **Pinterest Business Account**
- New apps start in "Trial" mode — pins are only visible to you
- You need **Standard Access** approval to go live (requires a screen recording of your OAuth flow + usage demo)
- Fetch board IDs first via `GET https://api.pinterest.com/v5/boards`
- Rate limit: Trial = very low; Standard = 10 requests/sec

---

### 2.6 Quora — EXCLUDED from V1

- **Official API**: Does not exist
- **Unofficial methods**: Selenium, Puppeteer — fragile, ToS violation, ban risk
- **Recommendation**: Quora should be **excluded from automated posting in V1**.
- **Alternative use**: Use n8n to *monitor* Quora via RSS or third-party scraping for content research (identify trending questions — feed into content creation pipeline), then alert your team to manually answer.

> Future consideration: As your agency grows and you need Quora presence, consider manual templated answers. There is no legitimate API path for automation as of 2026.

---

### 2.7 X (Twitter) — DEFERRED TO V2

> **Decision**: X/Twitter is excluded from V1. The API is fully pay-per-use with no free tier since February 2026. Will be added in V2 once the product is validated and a billing model is established for clients.

**Why deferred**:
- ~$0.015/tweet for text posts; ~$0.20/tweet when a link is included
- Requires pre-loaded credits in X Developer Console before any post can be made
- Adds complexity and cost during the testing/validation phase

**V2 Plan (for reference)**:
- Method: Native `X (Twitter)` node in n8n
- Auth: OAuth 2.0 with PKCE
- Budget model: Pass cost through to client or include in agency retainer
- Setup doc is already in `setup.md` Section 7 for when you're ready

---

## 3. Proposed Workflow Architecture

### Overall Design Philosophy

Use **Google Sheets as the Content Calendar** (source of truth). The workflow polls the sheet on a schedule, picks up rows marked as "Ready to Post", formats content per platform, posts, then updates the row status.

```
+------------------------------------------+
|          CONTENT CALENDAR                |
|          (Google Sheets)                 |
|  Columns: Platform | Content | Status    |
|           Date | Media URL | Posted At   |
+---------------+---------------------------+
                |
      Schedule Trigger (every 15 min)
                |
                v
+------------------------------------------+
|      n8n Workflow: Main Orchestrator     |
|                                          |
|  1. Read rows where Status = "Ready"     |
|  2. Filter by scheduled date/time        |
|  3. Route by Platform field              |
+--+------+------+------+------+-----------+
   |      |      |      |      |
   v      v      v      v      v
  [FB]  [IG]  [Reddit] [YT]  [Pinterest] [X]
   |      |      |      |      |           |
   v      v      v      v      v           v
  Post   Post   Post  Upload Create Pin  Tweet
   |      |      |      |      |           |
   +------+------+------+------+-----------+
                         |
                         v
          Update Google Sheet: Status = "Posted"
          Log: timestamp, post URL/ID, error (if any)
```

### Node Breakdown

| Step | Node | Purpose |
|------|------|---------|
| Trigger | `Schedule` | Runs every 15 min |
| Fetch content | `Google Sheets` | Read "Content Calendar" sheet |
| Filter | `Filter` | Only rows where Status = Ready and Scheduled Date <= now |
| Route | `Switch` | Route based on Platform column (5 branches: FB, IG, Reddit, YT, Pinterest) |
| Format | `Set` / `Code` | Adapt content per platform (char limits, hashtags) |
| Post FB | `Facebook Graph API` | POST to /{PAGE_ID}/feed |
| Post IG | `HTTP Request` (×2) + `Wait` | Create media container → Wait 5s → Publish |
| Post Reddit | `Reddit` | Submit post to subreddit |
| Post YT | `YouTube` | Upload video binary from Google Drive |
| Post Pinterest | `HTTP Request` | POST to /v5/pins with OAuth2 |
| Update | `Google Sheets` | Update row: Status = "Posted", add timestamp + post ID |
| Error handler | `Error Trigger` | Catch failures → log to Sheets + send email alert |

### Google Sheets Column Schema (Content Calendar)

| Column | Description | Example |
|--------|-------------|---------|
| `id` | Unique row ID | `POST_001` |
| `platform` | Target platform | `Instagram` |
| `status` | Workflow status | `Ready` / `Posted` / `Error` / `Draft` |
| `scheduled_date` | Date only (User input) | `2026-08-15` |
| `scheduled_time` | Time only (User input) | `10:00:00` |
| `scheduled_datetime` | Combined date + time (Formula: `=D2+E2`) | `2026-08-15 10:00:00` |
| `caption` | Post text/caption | `Check out our new product!` |
| `media_url` | Publicly hosted image/video URL | `https://cdn.yourhost.com/img.jpg` |
| `hashtags` | Platform-specific hashtags | `#marketing #business` |
| `subreddit` | Reddit only | `r/marketing` |
| `board_id` | Pinterest only | `123456789` |
| `yt_title` | YouTube only | `Product Launch Video 2026` |
| `yt_description` | YouTube only | `Full description here...` |
| `posted_at` | Auto-filled timestamp | `2026-08-15T10:02:33` |
| `post_id` | Auto-filled post ID from API | `17841400123456789` |
| `error_message` | Auto-filled on failure | `Media URL not accessible` |

---

## 4. Reference Workflows (No Third-Party Services)

These are workflow patterns from the n8n community and template library that use **only native nodes and HTTP Request nodes**.

### 4.1 Multi-Platform Social Media Poster (Google Sheets to Multiple Platforms)

**Pattern**: Schedule — Google Sheets — Switch — Platform Nodes  
**Reference**: n8n Community Template Library — search "social media scheduler"  
**URL**: https://n8n.io/workflows/?search=social+media+scheduler  
**Nodes used**: Schedule, Google Sheets, Switch, Facebook Graph API, YouTube, Reddit, HTTP Request, Set

This is the closest to what you want to build. Import the template JSON and adapt it to your column schema.

---

### 4.2 Instagram Auto-Poster via Meta Graph API

**Pattern**: Webhook/Schedule — HTTP Request (Create Container) — Wait 5s — HTTP Request (Publish)  
**Reference**: https://n8n.io/workflows/?search=instagram+post  
**Nodes used**: Schedule/Webhook, HTTP Request (x2), Google Sheets  
**Key detail**: The 2-step Instagram API flow (create container then publish) must have a small delay between steps (use `Wait` node, 5 seconds)

---

### 4.3 Reddit Auto-Poster

**Pattern**: Schedule — Google Sheets — Reddit Node (Submit)  
**Reference**: https://n8n.io/workflows/?search=reddit  
**Nodes used**: Schedule, Google Sheets, Reddit, IF (to skip already-posted)  
**Key detail**: Use `kind: self` for text posts, `kind: link` for URL posts

---

### 4.4 YouTube Auto-Upload from Google Drive

**Pattern**: Google Drive Trigger (new file) — YouTube Node (upload) — Sheets (log)  
**Reference**: https://n8n.io/workflows/?search=youtube+upload  
**Nodes used**: Google Drive Trigger, YouTube, Google Sheets  
**Key detail**: Store videos in Google Drive; n8n reads binary from Drive and passes to YouTube node

---

### 4.5 Pinterest Pin Creator (HTTP Request approach)

**Pattern**: Schedule — Sheets — HTTP Request (GET boards) — HTTP Request (POST pin)  
**Nodes used**: Schedule, Google Sheets, HTTP Request (OAuth2), Set  
**Key detail**: Get the Board ID dynamically via API before each pin creation

---

### 4.6 X (Twitter) — Deferred to V2

X/Twitter workflow is excluded from V1. Reference material saved in planning for V2.

---

## 5. Content Queue Design

### Recommended Flow for Agency Use

```
Agency Staff adds row to Google Sheet
         |
         v
  Status = "Draft"  <-- Human reviews / edits
         |
  Status = "Ready"  <-- Approved for posting
         |
  n8n picks up at scheduled time
         |
  Status = "Posting" (set immediately on pickup)
         |
  +------+------------------+
  | Success                 | Failure
  |                         |
  Status = "Posted"    Status = "Error"
  + post_id            + error_message
  + posted_at          + Slack/Email alert
```

### Media Hosting Strategy

Since all platforms except Reddit require publicly accessible media URLs, host your images/videos on one of:

| Option | Cost | Best For |
|--------|------|---------|
| **Cloudinary** (free tier: 25GB) | Free up to 25GB | Images + automatic format conversion |
| **AWS S3** | ~$0.023/GB/month | Scalable, reliable for production |
| **Google Cloud Storage** | ~$0.020/GB/month | Integrates well with n8n Google nodes |
| **Self-hosted Nginx** | Server cost only | Full control, cheapest long-term |

For V1, **Cloudinary's free tier** is recommended — it handles format optimization automatically and generates stable public URLs.

---

## 6. Rate Limits & API Quotas

| Platform | Rate Limit | Notes |
|----------|------------|-------|
| **Facebook** | 200 calls/hour/user | Page posts rarely hit this |
| **Instagram** | 25 posts/24h per account | Enforce in your scheduler |
| **Reddit** | 10 requests/minute (OAuth2) | Monitor with `X-Ratelimit-*` headers |
| **YouTube** | 10,000 units/day | Upload = 1,600 units; stay under 6 uploads/day |
| **Pinterest** | Trial: ~5 req/sec; Standard: 10/sec | Get Standard Access before production |
| **X (Twitter)** | Pay-per-use | Budget carefully; links cost $0.20 each |

### Throttling Strategy
- Add a `Wait` node (3–5 seconds) between API calls in rapid-fire loops
- For batch posts, use the `Split in Batches` node to process one at a time
- Track post counts in Google Sheets to enforce daily limits per platform

---

## 7. Video File Handling in n8n Docker

This is a critical configuration item for YouTube uploads. By default, n8n loads binary files (videos) entirely into RAM, which causes crashes with files larger than a few hundred MB.

### Required Docker Environment Variables

Add all of the following to your `docker-compose.yml`:

```yaml
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n
    environment:
      # Store binary data (videos/images) on disk instead of RAM
      - N8N_DEFAULT_BINARY_DATA_MODE=filesystem

      # Increase max payload size (in MB) — set to your largest expected video
      - N8N_PAYLOAD_SIZE_MAX=4000        # 4 GB max per execution payload
      - N8N_FORMDATA_FILE_SIZE_MAX=3000  # 3 GB max for form data uploads

      # Auto-prune old execution data and their binary files (prevents disk filling up)
      - EXECUTIONS_DATA_PRUNE=true
      - EXECUTIONS_DATA_MAX_AGE=336      # Keep data for 14 days (336 hours)

      # Timezone
      - GENERIC_TIMEZONE=Asia/Kolkata

      # Your n8n public URL (needed for OAuth callbacks)
      - N8N_EDITOR_BASE_URL=http://localhost:5678
      - WEBHOOK_URL=http://localhost:5678/

    volumes:
      # CRITICAL: map a persistent volume so binary files survive container restarts
      - /your/local/n8n/data:/home/node/.n8n
```

> **Replace** `/your/local/n8n/data` with the actual path on your host machine where n8n data should be stored (e.g., `/home/kushagra/n8n-data`).

### Workflow Architecture for YouTube Uploads

Don't pass raw video binary through every node — it's inefficient and error-prone. Use this pattern instead:

```
Google Sheets (get row with video info)
       |
       v
Google Drive (Download video file as binary)
       |
       v
YouTube node (upload binary + metadata)
       |
       v
Google Sheets (update row: status=Posted, video URL)
```

**Best Practices**:
- Store all video files in **Google Drive** — the n8n `Google Drive` node downloads them as binary data natively, so you don't need to manage local file paths
- Keep videos under **2 GB** for V1 — very large files (2 GB+) may need resumable upload handling which requires a custom HTTP Request approach
- Use the `Split in Batches` node (batch size = 1) if uploading multiple videos in one workflow run — prevents memory buildup
- For videos over 2 GB, use the `Execute Command` node to call a Python/shell script using the YouTube Data API resumable upload flow instead of the native node

### YouTube API Quota for Video Uploads

| Action | API Units Used |
|--------|---------------|
| Upload a video | 1,600 units |
| Update video metadata | 50 units |
| Daily free quota | 10,000 units |
| Max uploads/day (free) | ~6 videos/day |

If you need more than 6 uploads/day, request a quota increase via Google Cloud Console → APIs & Services → YouTube Data API v3 → Quotas.

---

## 8. Cost Summary

| Platform | API Cost | V1 Status |
|----------|---------|----------|
| **Facebook** | Free | ✅ Included |
| **Instagram** | Free (same Meta API) | ✅ Included |
| **Reddit** | Free | ✅ Included |
| **YouTube** | Free (quota-based) | ✅ Included |
| **Pinterest** | Free (after Standard Access) | ✅ Included |
| **Quora** | N/A | ❌ Excluded |
| **X (Twitter)** | ~$0.015–$0.20/post | ⏳ V2 |
| **n8n (self-hosted Docker)** | Your server/electricity cost | ✅ Running |
| **Cloudinary (media hosting)** | Free up to 25GB storage | ✅ Recommended |

**V1 Total API Cost: $0/month** (all 5 active platforms are free-tier)

**Only ongoing cost**: your server running Docker + Cloudinary for media hosting (both free at small scale).

---

## 9. Implementation Roadmap

> **V1 Scope**: Single credential set (your own accounts). No multi-client support yet.

### Phase 1 — Foundation (Week 1)
- [ ] Configure n8n Docker with all required env variables (see Section 7)
- [ ] Map persistent volume for n8n data in `docker-compose.yml`
- [ ] Set up Cloudinary account for media hosting
- [ ] Set up Google Sheet content calendar using the column schema from Section 3
- [ ] Follow `setup.md` Sections 1–3 to create FB Page, convert IG to Business, and create Meta Developer App
- [ ] Configure Facebook Graph API credential in n8n
- [ ] Build and test **Facebook Page posting** workflow

### Phase 2 — Instagram Integration (Week 1–2)
- [ ] Verify Facebook Page ↔ Instagram Business account link
- [ ] Build **Instagram 2-step posting** workflow:
  - Step 1: HTTP Request → create media container
  - Wait node (5 seconds)
  - Step 2: HTTP Request → publish container
- [ ] Test with image posts → then video/Reels → then Carousel

### Phase 3 — Reddit (Week 2)
- [ ] Follow `setup.md` Section 4 to create Reddit developer app (Script type)
- [ ] Configure Reddit credential in n8n
- [ ] Build **Reddit post submission** workflow
- [ ] Test in `r/test` and `r/testingground4bots` before real subreddits

### Phase 4 — YouTube (Week 2)
- [ ] Follow `setup.md` Section 5 to create Google Cloud project + enable YouTube Data API v3
- [ ] Configure Google OAuth2 credential in n8n
- [ ] Verify Docker filesystem binary mode is working (test with a small video first)
- [ ] Build **YouTube upload** workflow (Google Drive → YouTube node)
- [ ] Test with an Unlisted video first

### Phase 5 — Pinterest (Week 3)
- [ ] Follow `setup.md` Section 6 to convert Pinterest to Business + create Developer App
- [ ] Configure Pinterest Generic OAuth2 credential in n8n
- [ ] Build **Pinterest pin creation** workflow (HTTP Request)
- [ ] Test in Trial mode (pins visible only to you)
- [ ] Apply for Standard Access when ready for public pins

### Phase 6 — Orchestration & Polish (Week 3–4)
- [ ] Build the **main orchestrator workflow**:
  - Schedule Trigger (every 15 min)
  - Google Sheets → read Ready rows
  - Filter by scheduled date/time
  - Switch node → route to correct platform sub-workflow
  - Write-back: update row Status + posted_at + post_id
- [ ] Add `Error Trigger` node → log error to Google Sheets + send email alert
- [ ] Add `Split in Batches` (size=1) for safe batch processing
- [ ] Add daily post limit checks per platform (use a counter column in Sheets)
- [ ] End-to-end test with real content across all 5 platforms

### Future — V2 Roadmap
- [ ] Add X/Twitter posting (when budget approved)
- [ ] Build web frontend for clients to log in and manage their own content queues
- [ ] Implement per-client credential storage (database + n8n sub-workflows)
- [ ] Add analytics dashboard (post success rates, engagement data)
- [ ] Add AI content generation node (rewrite caption per platform automatically)

---

## 10. Decisions Log

All open questions from initial planning have been resolved:

| # | Question | Decision | Status |
|---|----------|----------|--------|
| 1 | Quora exclusion | **Excluded from V1** — no safe API exists. Use RSS monitoring for research only. | ✅ Resolved |
| 2 | X/Twitter API budget | **Deferred to V2** — fully paid API, not suitable during testing phase | ✅ Resolved |
| 3 | Pinterest Standard Access | Apply early — approval takes 1–2 weeks. Test in Trial mode meanwhile. | ✅ Planned |
| 4 | Reddit commercial use | V1 is personal/testing use — Script app type is sufficient. Formal approval needed before client launch. | ✅ Planned |
| 5 | Token refresh strategy | Use long-lived Page Access Tokens (60-day). Convert to permanent System User Token before going live with clients. | ✅ Planned |
| 6 | Multi-client support | **V1 = single credential set (your own accounts)**. Multi-client via a full website is a V2 feature. | ✅ Resolved |
| 7 | Video file handling | **Resolved** — detailed Docker config documented in Section 7. Use `filesystem` mode + volume mount + Google Drive as video source. | ✅ Resolved |
| 8 | Instagram personal → business | Covered step-by-step in `setup.md` Section 2. | ✅ Resolved |

### Remaining Risks

| Risk | Mitigation |
|------|------------|
| Pinterest Standard Access delay | Apply immediately; test in Trial mode while waiting |
| Reddit karma/age requirements on subreddits | Use `r/test` for testing; research subreddit rules before real posts |
| YouTube quota exhaustion | Monitor units in Google Cloud Console; stay under 6 uploads/day on free tier |
| Meta token expiry | Refresh 60-day token proactively; move to System User Token before production |
| Large video crashes in n8n | Mitigated by Section 7 Docker config; test with small videos first |

---

*Last updated: 2026-08-11 | V1 Planning — All decisions resolved*
