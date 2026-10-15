# postUploaders V2 — Implementation Plan (Google Business Profile)

Status: planning (Oct 15, 2026). Companion to `v2Plan.md` (research + feasibility). Nothing here is built.
Convention: feature branches off `v2`, merged back into `v2`, then `v2` → `main` → `production` via PR (see branch-strategy memory). DB changes are hand-written SQL migrations, never `migrate dev` reset.

## 1. Decisions locked (Kushagra, Oct 15)

| # | Decision |
|---|---|
| 1 | Pilot client has a verified GBP, 60+ days, with a website; it is the profile used for the API access application. |
| 2 | Customers connect through **OAuth themselves**. The Manager invite is only needed so our Google login can file the access request. |
| 3 | **Managed service first**, built as one workspace per business so self-serve can follow. |
| 4 | **Geotag every image we publish**, real photos and AI-generated posters alike, with the **exact latitude and longitude of the business** (original GPS is recorded, then replaced). **Alt text is for the image itself**, not the owner's website: built from the keyword(s) staff assigned and embedded in the image file (§4.4). See §5 for the safeguards this plan adds. |
| 5 | **Video skipped** for V2. |
| 6 | Human approval before posting by default; auto-publish is opt-in later. |
| 7 | Keyword research done by **staff** (a member of our company), entered through a staff dashboard reached by **Google sign-in + email allowlist**, not a seeded password login (§3). |
| 8 | **Exact business coordinates on every image** confirmed (no "near" threshold); **alt text default is the keyword-led sentence**. |
| 9 | **Languages: Hindi and English**, set per location (§4.2). |

Note for the record: the client's `V2 Blueprint.docx` lists falsifying EXIF GPS as something not to build, and independent tests found no ranking effect from geotags. Reports also say Google strips image metadata on upload, and the GBP API has no alt-text field, so embedded alt text and GPS may never be seen by Google. Decision 4 overrides that on Kushagra's call. We do not promise ranking gains from either in customer-facing copy, and both ship behind per-workspace switches (§5).

## 2. Phase 0 — Google side (no code, start immediately)

Everything else waits on this one. Steps are in the "GCP setup" section of this file (§8).

Exit: project approved (quota 300 per minute in Cloud Console), OAuth consent screen verified for `business.manage`, test location reachable through the API.

While waiting, all GBP code is built against a **mock** (`GbpClient` interface, §4.1), so nothing blocks on Google.

## 3. Phase 1 (V2.0) — Foundation, connect, audit, staff dashboard

### 3.1 Staff access via Google sign-in

How V1 login works today: `routes/login.ts` runs Google OIDC, `verifyIdToken` already requires `email_verified === true`, `upsertUserFromGoogle` creates or links a `User`, and `requireAuth` reads the session. There are no passwords, so "seeding a staff login" never meant a password; the only real question is **where the list of staff emails lives**.

| | A. Env allowlist | B. `User.isStaff` column |
|---|---|---|
| Change | `STAFF_EMAILS=a@gmail.com,b@gmail.com` in env | One SQL update or script |
| Needs migration | No | Yes (hand-written SQL) |
| Needs a redeploy to add or remove staff | Yes (restart) | No |
| Audit trail | Weak | Better (can log who flipped it) |
| Effort | About 30 lines | About 60 lines |

**Decision: start with A (most feasible), move to B when staff list changes more often than deploys.** Both use the same Google sign-in, so the switch is invisible to staff.

Cost of checking on every request: negligible. V1 sessions are opaque tokens with the record in Redis (`lib/session.ts`), not JWTs, so there is no token refresh; each request already reads the session once. The allowlist is parsed into an in-memory `Set` at process start, and the check is only `Set.has(email)`. It runs only on `/api/staff/*` and `GET /api/session` (to tell the frontend whether to show the staff menu), not on every API route, and needs one primary-key lookup of the user's email. Checking per request, not once at login, is deliberate: removing someone from the list takes effect on their very next request instead of lingering for the 7-day session.

Initial list (sample for now, more added later, comma-separated): `STAFF_EMAILS=click72crm@gmail.com`. Compared case-insensitively against Google's verified email.

Rules, either way:
- Check the **verified email from Google's id token** against the list, on the **backend**, per request. The frontend only hides or shows the menu.
- One allowlisted email per person, not one shared Gmail: a shared account has no accountability, and with Google-only login its security is just that Google account's. Require 2-Step Verification on every staff Google account (ideally a Workspace-managed domain).
- Staff get a separate route group `/api/staff/*` behind `requireStaff`. They do **not** get fake workspace membership, so `requireWorkspace` tenant isolation stays intact for everyone else.
- Staff can read workspace facts and audit results and write keyword plans. They cannot decrypt tokens or post as the owner. Every staff write creates an `AuditEvent`.
- `GET /api/session` returns `isStaff`; the frontend shows `/staff` only when true.
- Tests: non-staff gets 403 on `/api/staff/*`; unverified-email token rejected (already covered by login); a staff user cannot read a workspace's tokens.

### 3.2 Schema (new tables; `workspaceId` is our `tenant_id`)

- `Platform` gets `GOOGLE_BUSINESS`; `ConnectionMethod` gets `GOOGLE_BUSINESS_LOGIN`; `RefreshStrategy.ON_DEMAND` reused.
- `GbpLocation`: workspaceId, connectedAccountId, `accountName`/`locationName` (Google resource names), title, address, primary and secondary categories, phone, website, hours, latitude, longitude, verification and listing status, role, timezone, lastSyncedAt.
- `BusinessFact`: gbpLocationId, field, value, source (`API_IMPORT` | `OWNER` | `STAFF`), approvedBy, approvedAt, expiresAt.
- `KeywordPlan` (versioned) and `Keyword` (5 per plan): phrase, intent, mapped service, language, enteredByStaffId, source/date, lastUsedAt.
- `AuditEvent`: actor (user or staff), action, object, before and after, timestamp, correlationId.
- `MediaAsset` additions: `label`, `exifSummary` (json), `originalGps` (what the upload had, if anything), `geotagLat`/`geotagLng` (what we wrote), `altText`, `altKeywords`, `keywordId` (which of the 5 keywords this image serves), `licenceNote`.
- `GbpLocation` also stores the business's exact `latitude`/`longitude` (§5).
- Workspace settings: `geotagEnabled` and `embedAltTextEnabled` (both default on).
- Written as hand-written SQL migrations (`migrate diff` + `migrate deploy`).

### 3.3 Backend

1. `lib/google-business.ts` with the `GbpClient` interface: `listAccounts`, `listLocations`, `getLocation`, `patchLocation`, `createPost`, `uploadMedia`, `listReviews`, `getPerformance`. Two implementations: `MockGbpClient` and `RealGbpClient`. Selected by env flag, so we can switch on the day approval lands.
2. `routes/auth/google-business.ts`: OAuth with `business.manage`, offline access, state + PKCE, same pattern as `routes/auth/youtube.ts`; reject if the scope isn't granted; separate OAuth client from login and YouTube.
3. `service/gbp-token.ts` cloned from `youtube-token.ts`.
4. Location picker endpoint with role, status and "missing location" guidance (the Sharma Dental table from the walkthrough).
5. Audit service: reads fields, diffs against facts, stores a result. Read-only.
6. Facts questionnaire endpoints (owner) and keyword plan endpoints (staff).
7. Disconnect and revoke flow (reuse `connected-accounts.ts` soft delete).

### 3.4 Frontend

- Connect Google Business button and location picker.
- Audit screen with proposed changes and separate consent for profile edits and posting.
- Facts questionnaire.
- `/staff` dashboard: workspace list, per-workspace audit, keyword plan editor (5 keywords per location, versioned).

### 3.5 Exit criteria
Mock end to end: connect → pick location → audit → facts → staff enters 5 keywords. Staff tenancy tests pass. Real API: connect and read audit on the pilot profile.

## 4. Phase 2 (V2.1) — Content, photos, publishing

### 4.1 Content planner
Rotation of the 5 keywords × services × angles (tip, FAQ, offer, seasonal, event, behind-the-scenes), with a cooldown per keyword and angle. Output: `ContentPlanItem` rows (date, keyword, service, angle, post type, CTA, photo needed). Start as a rotation function and a simple list; calendar UI only after the pilot confirms it's wanted.

### 4.2 AI drafting
- Claude API with structured output. Input: approved facts, one keyword, angle, tone, CTA destination, prohibited claims. No facts means no draft.
- Fact-check pass rejects invented prices, services, credentials, offers and keyword stuffing. Business name never gets keywords.
- Store prompt version, facts used, model, draft, human edits and final copy.
- Cost cap per workspace per month and a `UsageLedger` row for each generation.
- **Language:** each location has a post language (`en` or `hi`; mixed Hinglish allowed if staff ask). Drafts are written directly in that language, not translated afterwards, and sent to GBP with the matching `languageCode`. The fact-check pass runs on the output language. Keywords are never translated.
- **Hindi text in poster images:** image generators often garble Devanagari, so posters with text are **rendered from templates with a real Devanagari font** (sharp/SVG), with the AI producing at most the background or illustration. This is a rendering choice to confirm in the first pilot.

### 4.3 Photo pipeline
Reuse V1: `MediaAsset`, presigned S3 upload, `media-probe.ts`, `render.ts`.
1. Validate MIME and magic bytes, size, dimensions.
2. Store the **original untouched** (EXIF intact) in private S3.
3. Read EXIF GPS from the original and record it in `originalGps` (diagnostics only).
4. Make the publish copy as **JPEG** (`render.ts` uses sharp, which drops EXIF; JPEG is the format where EXIF GPS and IPTC/XMP are reliable, PNG is not).
5. Descriptive filename and label from the keyword and service.
6. As the **last** step, write the business's exact GPS and the alt text/keyword metadata onto the publish copy (§4.4, §5). This applies to uploaded photos and AI-generated posters alike.
7. Publish to GBP through `media.create` with a presigned `sourceUrl`.

### 4.4 Alt text on the image itself
Scope change (Oct 15): alt text is for **the image we generate or the owner uploads**, driven by the keyword(s) staff assigned, not a website deliverable.

- **Which keyword:** each image belongs to a content plan item, which already carries one of the 5 keywords (`keywordId`). Staff can override per image.
- **What text:** `altText` = the keyword plus a short truthful description and the business area, e.g. "Teeth whitening in Salt Lake City at Sharma Dental Clinic". `altKeywords` = the exact assigned keyword(s). A pure keyword list as alt text is easy to enable (`altTextMode: KEYWORD_ONLY | KEYWORD_SENTENCE`, default sentence), but it is the "keyword stuffing" form that Google's alt-text guidance discourages and is useless to screen-reader users. Kushagra chose the keyword-led sentence as the default (Oct 15); keyword-only stays available as a setting.
- **How the sentence is built:** two levels, both deterministic about the keyword.
  1. **Template (V2.1 default, free, no hallucination):** fill `{keyword} at {business name}, {area}` from the approved keyword, the location's name, and its city/area, e.g. "Teeth whitening in Salt Lake City at Sharma Dental Clinic". Optionally add a fixed per-photo-category suffix taken from the GBP media category the image is filed under (exterior, interior, team at work, product), e.g. "... clinic exterior". Max about 125 characters; the keyword appears exactly once and is never altered.
  2. **Vision-assisted (later, optional):** a vision model describes what is actually in the image ("dentist whitening a patient's teeth"), and an LLM writes the sentence around the keyword **only if the image matches the keyword**; otherwise it falls back to the template and flags the image for staff, so a keyword is never attached to an image that doesn't show it. Costs one vision call per image, so it's gated by the usage cap.
  Staff can edit any generated alt text per image.
- **Hindi and English:** the keyword is used verbatim in whatever script staff entered it (Devanagari, Latin or Hinglish); the sentence follows the post's language. EXIF `ImageDescription` is ASCII-only by spec, so Hindi text is written to **XMP and IPTC (UTF-8)** only, and EXIF carries just the English or transliterated form.
- **Where it goes (GBP has no alt-text field):** written into the publish JPEG's metadata with exiftool, in the places image tools actually read: XMP `dc:description` and `dc:subject` (keywords), IPTC `AltTextAccessibility`, `ExtDescrAccessibility` and `Keywords`, and EXIF `ImageDescription` (also a candidate for `XPKeywords`). Same file also gets a descriptive filename.
- **Spike (needs the approved API):** (a) does `MediaItem.description` accept text for location photos and show anywhere? If yes, put the alt text there too; (b) upload a test image with all of the above and inspect the copy Google serves. If Google strips it, the metadata is harmless but invisible there; it still helps wherever the owner reuses the file (their website, other platforms).
- The alt text is also shown in the app with a copy button. That costs nothing and lets owners reuse it on their website if they want. No website integration is planned.

### 4.5 Publishing
- `google-business-poster.json` n8n workflow and `buildGoogleBusinessPayload` in `service/n8n.ts`; post types STANDARD, EVENT, OFFER; CTA types BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL.
- Our BullMQ scheduler publishes at the scheduled time (not `LocalPost.scheduledTime`) so behaviour matches the other platforms. Timezone: store UTC plus IANA zone.
- Idempotency key per workspace, location, content version and channel. After a timeout, query the provider before retrying; store provider post ID.
- Error classes: OAuth, permission, quota, media, policy, network. Policy and permission errors are not blindly retried.
- Approval states: DRAFT → APPROVAL_PENDING → SCHEDULED → PROCESSING → PUBLISHED / FAILED / NEEDS_REAUTH. Auto-publish opt-in only.

### 4.6 Exit criteria
Pilot publishes a supported test post and photo with provider ID stored; no duplicate after a forced retry; timezone and cancellation tests pass.

## 5. Geotag rewrite: how it's built and the safeguards

Behaviour (Decision 4, revised Oct 15): **every image we publish gets the business's exact latitude and longitude**, whatever its original GPS was, including AI-generated posters.

| Original GPS | Action |
|---|---|
| Present (any distance) | Record it in `originalGps`, then overwrite with the business's coordinates |
| Absent, or AI-generated poster | Write the business's coordinates |

There is deliberately **no "near" threshold**. Earlier I proposed "keep the GPS if it's near the business", which needs a distance cutoff (e.g. 500 m), because a phone's GPS inside the shop never exactly matches the map pin. Since the requirement is now the exact business coordinates on every image, that cutoff isn't needed. If nearby photos should be left untouched instead, the threshold comes back as a setting.

Implementation notes:
- Coordinates come from the connected location's `latlng` in the Business Information API (the pin Google has for the business), stored on `GbpLocation`. Confirm the field name in the spike. If it isn't returned, staff paste the coordinates from the Google Maps pin. Staff confirm the coordinates once per location on the staff dashboard, since a wrong pin would geotag every image wrongly.
- Use **exiftool** (spawned like `ffprobe` in `media-probe.ts`) to write `GPSLatitude`, `GPSLongitude` and their reference tags. Output is JPEG, because PNG and WebP do not reliably carry EXIF GPS; AI-generated images are converted first.
- Safeguards: per-workspace switch `geotagEnabled` (default on), original GPS kept in `originalGps`, applied coordinates in `geotagLat`/`geotagLng`, an `AuditEvent` per write, and a staff-visible column showing what happened to each image.
- Reality check to carry into the pilot: reports say Google strips EXIF on upload, so the coordinates may not survive to the served image. The spike (§4.4) uploads a test image and inspects what Google serves.

## 6. Phase 3 (V2.2) and Phase 4 (V2.3)

- **V2.2:** review fetch and reply drafts with human approval, multi-location per workspace, Performance dashboard (daily metrics, monthly keyword impressions, per-photo `insights.viewCount` if it works), usage caps and plan limits.
- **V2.3:** rank grid through a contracted provider, after real unit costs are known (`v2Plan.md` §9).

## 7. Testing and rollout

- Mock-first: all of Phase 1 and most of Phase 2 testable without Google.
- Edge cases from the blueprint §15: wrong account, no location access, revoked OAuth, quota zero, 403, unsupported media, timeout-after-success, DST, cancellation race, AI inventing facts, tenant isolation.
- Pilot with 3-5 real businesses in managed mode before any broader onboarding.
- Observability: GBP error classes into the existing Grafana/OTel setup; alerts on revoked OAuth, quota, repeated failures and AI spend.

## 8. GCP setup and filing the access request (do this now)

`gcloud` isn't installed on this machine, so these are Cloud Console steps. Use the **same Google account that will be added as Manager on the client's profile**, so one login owns the project and the application.

### 8.1 Create a separate project
1. Open https://console.cloud.google.com/projectcreate while signed in with that account.
2. Name: `postuploaders-gbp` (project ID is generated, e.g. `postuploaders-gbp-123456`). Organization: leave as "No organization" unless you have one. Create.
3. On the project dashboard, copy the **Project number** from the "Project info" card (a numeric value, not the project ID). You paste this into the form.

### 8.2 OAuth consent screen
1. APIs & Services → OAuth consent screen (Google Auth platform → Branding in newer consoles). User type: **External**.
2. App name `postUploaders`, user support email, logo (the badge used on the landing page), app domain `https://app.postuploaders.com`, privacy policy and terms links (the existing legal pages), authorized domain `postuploaders.com`, developer contact email.
3. Scopes: add `https://www.googleapis.com/auth/business.manage`.
4. Leave the app in **Testing** with your own Google account (and the client's owner/manager account) as test users until the API is approved; publishing and verification come later, as with YouTube.

### 8.3 OAuth client
APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**. Authorized redirect URI: `https://app.postuploaders.com/api/auth/google-business/callback` (we choose this path when building the route, so confirm it then; add `http://localhost` dev URIs separately). Save the client ID and secret into the backend env/secret store, never in chat or Git.

### 8.4 Enable the APIs
Google's setup page lists seven APIs: Google My Business API, My Business Account Management, Lodging, Place Actions, Notifications, Verifications and Business Information. Per that page, **Google My Business API only appears in the console after the access request is approved**; enable the others (at minimum Account Management and Business Information) now and the rest after approval. Lodging and Place Actions aren't needed for our scope.

### 8.5 Get your login added as Manager on the client's profile
The client does this on their Business Profile: open the profile, open the settings menu, People and access, Add, enter your email, choose **Manager**, send. You then accept the invite from the email or the Business Profile dashboard. Menu labels change, so follow the on-screen wording. Confirm you can now see the profile when signed in with your login.

### 8.6 File the form
1. Open https://support.google.com/business/contact/api_default signed in with the same account.
2. Choose "Application for Basic API Access" and fill in the requested fields, including the project number from 8.1 and the email that is Manager on the client's profile. (I haven't seen the form's other fields; it needs a login to open.)
3. Use-case text to paste or adapt:

> postUploaders (https://app.postuploaders.com) is a web application that helps small local businesses and the agencies that manage them keep their Google Business Profile accurate and active. With each business owner's explicit OAuth consent, the app (1) reads their profile and shows an audit of its details, (2) after the owner approves, updates fields such as the description, (3) creates and schedules Business Profile posts and photo uploads that the owner has reviewed and approved, (4) drafts replies to reviews for the owner to approve, and (5) shows performance insights. We never ask for a Google password, we request only the business.manage scope, tokens are stored encrypted, and owners can disconnect at any time. Content is generated only from facts the owner has confirmed, and nothing is published without owner approval unless the owner opts in to automatic publishing. We are launching with a pilot of a small number of businesses managed by our team.

4. After submitting, watch the inbox for Google's reply. Check Cloud Console → APIs & Services → Business Profile API quotas: **0 means not approved, 300 per minute means approved.** Test the connection with the OAuth 2.0 Playground and scope `business.manage` against `https://mybusinessaccountmanagement.googleapis.com/v1/accounts` (expect 200).

### 8.7 In parallel
Record the OAuth demo video for `business.manage` verification later (same shape as the YouTube one), and add a Business Profile section to the privacy policy before submitting for verification.

## 9. Open items
- Price target per location (what you plan to charge per location per month; sets the AI, image and rank-scan caps). Caps ship as config, so this can be decided after the pilot starts.
- Real staff emails to replace the sample on the allowlist.
- Whether vision-assisted alt text (§4.4 level 2) is wanted after the pilot.
