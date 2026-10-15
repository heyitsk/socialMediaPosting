# postUploaders V2 — Implementation Plan (Google Business Profile)

Status: planning (Oct 15, 2026). Companion to `v2Plan.md` (research + feasibility). Nothing here is built.
Convention: feature branches off `v2`, merged back into `v2`, then `v2` → `main` → `production` via PR (see branch-strategy memory). DB changes are hand-written SQL migrations, never `migrate dev` reset.

## 1. Decisions locked (Kushagra, Oct 15)

| # | Decision |
|---|---|
| 1 | Pilot client has a verified GBP, 60+ days, with a website; it is the profile used for the API access application. |
| 2 | Customers connect through **OAuth themselves**. The Manager invite is only needed so our Google login can file the access request. |
| 3 | **Managed service first**, built as one workspace per business so self-serve can follow. |
| 4 | **Geotag: rewrite, not just flag.** GPS near the business: keep. GPS far from the business: overwrite with the business's coordinates. GPS absent: add the business's coordinates. **Alt text: generate for the owner's website.** See §5 for the safeguards this plan adds. |
| 5 | **Video skipped** for V2. |
| 6 | Human approval before posting by default; auto-publish is opt-in later. |
| 7 | Keyword research done by **staff** (a member of our company), entered through a staff dashboard reached by **Google sign-in + email allowlist**, not a seeded password login (§3). |

Note for the record: the client's `V2 Blueprint.docx` lists falsifying EXIF GPS as something not to build, and independent tests found no ranking effect from geotags. Decision 4 overrides that on Kushagra's call. We do not promise ranking gains from it in any customer-facing copy, and it ships behind a per-workspace switch (§5).

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
- `MediaAsset` additions: `label`, `exifSummary` (json), `geotagAction` (`KEPT`/`REWRITTEN`/`ADDED`/`NONE`), `originalGps`, `licenceNote`.
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

### 4.3 Photo pipeline
Reuse V1: `MediaAsset`, presigned S3 upload, `media-probe.ts`, `render.ts`.
1. Validate MIME and magic bytes, size, dimensions.
2. Store the **original untouched** (EXIF intact) in private S3.
3. Read EXIF GPS from the original, compute distance to the location's coordinates, decide the geotag action (§5).
4. Make the publish copy (`render.ts` uses sharp, which drops EXIF), then write the final GPS on the publish copy as the **last** step.
5. Descriptive filename and label from the keyword and service.
6. Publish to GBP through `media.create` with a presigned `sourceUrl`.

### 4.4 Alt text for the owner's website
- Vision model writes one concise, accurate description per image; the keyword is used only where it truly describes the image.
- Delivered in the app (copy button, plus a CSV/zip of image + alt text per month). Direct website integration (e.g. WordPress REST media `alt_text`) is a later option. **Open question: which website platforms do the pilot owners use?**
- Clearly labelled "for your website", never as a GBP field.

### 4.5 Publishing
- `google-business-poster.json` n8n workflow and `buildGoogleBusinessPayload` in `service/n8n.ts`; post types STANDARD, EVENT, OFFER; CTA types BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL.
- Our BullMQ scheduler publishes at the scheduled time (not `LocalPost.scheduledTime`) so behaviour matches the other platforms. Timezone: store UTC plus IANA zone.
- Idempotency key per workspace, location, content version and channel. After a timeout, query the provider before retrying; store provider post ID.
- Error classes: OAuth, permission, quota, media, policy, network. Policy and permission errors are not blindly retried.
- Approval states: DRAFT → APPROVAL_PENDING → SCHEDULED → PROCESSING → PUBLISHED / FAILED / NEEDS_REAUTH. Auto-publish opt-in only.

### 4.6 Exit criteria
Pilot publishes a supported test post and photo with provider ID stored; no duplicate after a forced retry; timezone and cancellation tests pass.

## 5. Geotag rewrite: how it's built and the safeguards

Behaviour (Decision 4):
| Original GPS | Action |
|---|---|
| Within **N metres** of the business (N configurable, default 500 m) | Keep as-is, `KEPT` |
| Further away | Overwrite with the business's coordinates, `REWRITTEN`; log the original |
| Absent | Add the business's coordinates, `ADDED` |

Implementation notes:
- Business coordinates come from the connected location's `latlng` (confirm the field name in the Business Information API during the spike), not from a staff-typed address.
- Use **exiftool** (CLI, spawned like `ffprobe` in `media-probe.ts`) to write GPS tags. sharp's EXIF writing for GPS is fiddlier, and I'm not confident of its format, so check it in the spike.
- Applies to **real photos only**. AI-generated posters and templates are not geotagged (there is no camera capture to describe).
- Safeguards I'm adding: a **per-workspace switch** (default on, since you want it), the original kept and recorded in `MediaAsset.originalGps`, an `AuditEvent` per rewrite, and a staff-visible "geotag action" column so a human can see what happened to each photo.
- Reality check to carry into the pilot: reports say Google strips EXIF on upload, so it may not survive to the served image. The spike checklist includes uploading a geotagged test photo and inspecting the served copy.

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
- Website platforms of the pilot owners (decides alt-text delivery).
- Language(s) of posts (English only, or Hindi/regional).
- Price target per location (sets the AI cost cap).
- Staff emails to put on the allowlist.
