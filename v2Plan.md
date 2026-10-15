# postUploaders V2 — Google Business Profile (Local SEO) Automation

Status: research + planning only (Oct 14, 2026). Nothing here is built.
Inputs: client's `V2 Blueprint.docx` (Click 72, Oct 14), the V1 codebase, Google's GBP API docs, public competitor info.

## 0. TL;DR

- **Feasible: yes**, for the core product (connect GBP, audit, keyword-driven posts + photos, scheduling, review replies, performance reporting). It fits V1's architecture almost one-to-one.
- **Gate: Google's GBP API is approval-gated.** A new Cloud project has quota 0 until Google approves "Basic API Access". Requirements include a verified GBP that is 60+ days old with a website. Also, `business.manage` is a sensitive OAuth scope, so it needs OAuth verification and a demo video, like the YouTube one. The access request should be filed now, because it is the only thing outside our control.
- **Two parts of the original idea don't survive contact with the facts** (details in §2):
  1. **Geotagging photos with the business's location** — independent tests show no ranking effect, Google strips EXIF on upload, and writing coordinates into a photo taken elsewhere is falsified metadata. The client's own blueprint says do not build it.
  2. **Alt text on GBP photos/posts** — the GBP API has no alt-text field. Alt text only helps on the client's *website*.
- **What does move local rankings** is the 5-keyword strategy applied where Google actually reads it: profile description, services, categories, post copy, review replies, photo/post cadence, plus reviews and profile completeness. That part of the idea is sound, and it is what we build.
- **Likely gap: video.** The v4 media docs say only `PHOTO` is supported, so videos probably can't be pushed to GBP through the API. To be confirmed in a spike (§8).

## 1. Product workflow (end to end)

```
 OUR TEAM                         CLIENT (business owner)                 SYSTEM
 ────────                         ───────────────────────                 ──────
                                  1. Signs up, creates workspace
                                  2. "Connect Google Business Profile"
                                     -> Google OAuth (business.manage)     store encrypted refresh token
                                                                           list accounts + locations
                                  3. Picks the location(s)                 role/status/verification check
                                                                           read-only AUDIT (name, categories,
                                                                           address, hours, description, etc.)
 4. Reviews audit, does keyword
    research (MANUAL, off-platform)
 5. Enters the 5 keywords per
    location into admin screen   ─────────────────────────────────────►    KeywordPlan v1 saved (versioned)
                                  6. Confirms business facts
                                     (services, USPs, offers, tone,        BusinessFact rows (source+approval)
                                     areas served) via questionnaire
                                  7. Approves profile suggestions
                                     (description, categories, services)   write with update masks, read back
                                                                           CONTENT PLANNER builds a calendar:
                                                                           5 keywords × services × content angles
                                  8. Uploads photos (or none)              validate, store in S3, label
                                                                           AI drafts post copy from facts + keyword
                                                                           (no invented prices/claims)
                                  9. Approves drafts (default) or opts
                                     into auto-publish after trial         queue (BullMQ) -> n8n GBP workflow
                                                                           -> GBP API -> callback, provider ID stored
                                 10. Dashboard: posts, photos, views,      Performance API metrics, monthly
                                     calls, direction requests, keyword    search-keyword impressions
                                     impressions                           reconcile, retry, alert on failure
```

Same flow with the failure branches the blueprint requires: wrong Google account, no location access, OAuth revoked, API quota 0 (stay in draft/manual mode with a truthful banner), post rejected by policy.

### Photo handling (the replacement for "geotag + alt tag")

```
 Upload (or AI/template visual if none)
   -> validate MIME/magic bytes, size, dimensions, corruption
   -> store ORIGINAL privately in S3 (random id, tenant-scoped key; V1 already does this)
   -> read EXIF GPS for DIAGNOSTICS only
        GPS present and near the business   -> keep as-is (truthful)
        GPS present but far from business   -> flag to our team ("taken in Delhi, business is in Kolkata"), never rewrite
        GPS absent                          -> fine, nothing to do
   -> asset label / filename: descriptive and keyword-aware, for organisation + website SEO workflows
   -> publish to GBP via media sourceUrl (presigned S3 URL, same as Meta posts in V1)
   -> (optional, only if the client has a website we can write to) generate website alt text
```

## 2. The premise check: geotagging and alt tags

Not a "no" to the goal, a no to two specific mechanisms. Please read this before we commit scope.

### Geotagging
- Sterling Sky (Joy Hawkins, Jan 2024) tested 5 locations: no measurable ranking change from geotagged GBP photos, and none for geotagged website photos either. Hypetrix replicated it. A Search Engine Land write-up of a 27-location test with a no-EXIF control period reports the same ([Sterling Sky](https://www.sterlingsky.ca/geotagging-photos-impact-ranking/), [Search Engine Land](https://searchengineland.com/geotagging-photos-google-business-profile-rank-453525)). I couldn't open the SEL article itself (HTTP 403), so I'm relying on the search summary for it.
- Several of those sources report Google strips EXIF on upload, so the GPS wouldn't be in the served image anyway. Also, WhatsApp/most messengers already strip EXIF before the photo reaches us.
- Your scenario (photo opened on your laptop, so the geotag is yours) is real for *screenshots/re-saves*, but the fix isn't to inject the client's coordinates. Overwriting GPS with the business's location is writing metadata that isn't true. The client's blueprint explicitly lists "falsely geotagging a photo with the target business location" as something not to build, and I agree. It is also a risk to a client's profile if Google ever treats it as spam.
- What we *can* do, truthfully: ask clients to take photos with the phone's location on and send them as a document/file (not as a compressed photo), keep EXIF intact through our pipeline, and flag mismatches. Cost: low. Expected ranking value: low, and we shouldn't promise any.

### Alt text
- `LocalPost` has no alt-text field, and `MediaItem` has none either (checked the v4 reference pages). The blueprint says the same.
- `MediaItem.description` appears in the schema; the page didn't explain it, so whether it is writable for location photos and shown anywhere is unknown. Spike item.
- Alt text is worth doing on the client's **website** (accessibility + image search). We can generate it as a deliverable (copy-paste or CMS integration later), clearly separate from GBP.

### What the 5 keywords should drive instead
Profile description and services, categories (primary + secondary), post copy (natural, not stuffed), review replies, Q&A answers, product/service entries, photo captions where supported, and the website. Relevance, distance and prominence are Google's documented local ranking factors; reviews, completeness and consistent activity feed prominence. This is what Dhanda AI and Grexa sell in practice: Grexa's page lists profile rewrite with SEO keywords, review replies, daily posts, an AI photo scheduler and analytics ([grexa.ai](https://grexa.ai/)), priced roughly ₹7k-10k for the GBP-only plan ([pricing](https://grexa.ai/pricing)). Dhanda AI looks like an early-stage tool (founded 2025, unfunded per [Tracxn](https://tracxn.com/d/companies/dhanda-ai/__gC1Q0hz90xRRFPBsI1QeZF3CqVH4rCnoMLL44Pe8IY8)); I found no pricing or independent reviews. So we'd be competing on workflow and trust, not on a secret trick.

## 3. Feasibility by feature

| Feature | Verdict | Notes |
|---|---|---|
| OAuth connect + list accounts/locations | Yes, after API approval | Scope `business.manage`. Offline access, refresh token stored encrypted (same pattern as YouTube). |
| Audit of profile fields | Yes | Business Information API, read-only first. |
| Profile edits (description, categories, hours, services) | Yes, with approval | Explicit update masks, read-after-write. Never auto-change name/address/category. |
| Text + photo posts (STANDARD / EVENT / OFFER) | Yes | CTA types: BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL. |
| Scheduling | Yes | `LocalPost.scheduledTime` exists, but use our own BullMQ scheduler (V1 already has it) so behaviour is uniform and testable. |
| Photos to the location gallery | Yes | `media.create` with `sourceUrl`, categories COVER/PROFILE/EXTERIOR/INTERIOR/PRODUCT/AT_WORK/etc. Only one COVER and one PROFILE per location. |
| **Videos** | **Probably not via API** | v4 media docs: only PHOTO supported. Spike before promising. Fallback: manual upload checklist. |
| Review fetch + reply drafts | Yes, human-approved | Never auto-reply at first; never review-gate. |
| Performance dashboard | Yes | Performance API: daily metrics + monthly keyword impressions. Not a rank tracker. |
| Rank grid (heatmap) | Yes, but later and paid | Needs a contracted provider (e.g. DataForSEO Maps SERP ~$0.0006/point, Local Falcon). Never scrape Maps. See §9. |
| Geotag injection | Not recommended | §2. |
| GBP photo alt text | Not possible | §2. |

Timeline risk is almost entirely **Google approval** (access request: reported anywhere from days to ~14 days; sensitive-scope verification: 3-5 business days per Google, up to ~10 in practice; the two reviews are separate). Sources: [Google prereqs](https://developers.google.com/my-business/content/prereqs), secondary guides. Google publishes no guaranteed turnaround.

## 4. Fit with the V1 codebase

V1 is already shaped for this. The blueprint's "provider adapter, don't rewrite the publisher" matches `websitePlan.md` §5/§10.

| Need | V1 piece to reuse | Change |
|---|---|---|
| New platform | `Platform` enum, `capabilities.ts` (`POSTABLE_PLATFORMS`, `MEDIA_TYPES`, `CAPTION_LIMITS`), `ConnectionMethod` | Add `GOOGLE_BUSINESS` / `GBP_LOGIN`; GBP media types TEXT + IMAGE only |
| One connected account per location | `ConnectedAccount` (`platformAccountId` = `accounts/{a}/locations/{l}`) | Reuse; add GBP-specific `Location` metadata table |
| Token storage/refresh | `crypto.ts` AES-GCM, `RefreshStrategy.ON_DEMAND`, `service/youtube-token.ts` | Clone the pattern for GBP |
| OAuth connect | `routes/auth/youtube.ts`, `lib/youtube.ts`, `connect-state.ts` | New `routes/auth/google-business.ts` with `business.manage`; separate OAuth client |
| Publish pipeline | BullMQ `publish-queue/worker`, `service/n8n.ts`, per-platform n8n workflows, `/api/webhooks/n8n-callback` | New `google-business-poster.json` workflow + `buildGoogleBusinessPayload` |
| Scheduling, retries, limits | `PostGroup`/`Post`, `posting-limits`, `limit-pauses` | Reuse; add idempotency key per location+content version |
| Media in S3 | `MediaAsset`, `lib/s3.ts`, `media-probe.ts` (sharp/ffprobe), `render.ts` | Keep originals with EXIF; **note `render.ts` uses sharp which drops EXIF on renditions**, fine for publishing copies, but diagnostics must read the original |
| Workspaces/roles | `Workspace`, `Membership`, `WorkspaceRole` | Agency model fits: workspace = client business |
| Observability | OTel + Grafana plan | Add GBP error classes (oauth / permission / quota / media / policy) |

New tables (minimum): `GbpLocation` (details/status/last sync), `BusinessFact` (value, source, approver, expiry), `KeywordPlan`/`Keyword` (5 per location, versioned, who/when), `ContentPlanItem` (keyword, service, angle, date, cooldown), `GeneratedDraft` (prompt version, source facts, model, human edits), `AuditEvent`, `UsageLedger`. `MediaAsset` gains EXIF summary, licence/consent, location association, and a descriptive `label`. The blueprint's `tenant_id` everywhere maps to our existing `workspaceId`.

New moving parts: AI drafting service (Claude API with structured output, grounded on `BusinessFact`s, with a fact-check pass that rejects invented prices/services), GBP-specific composer UI (post type, CTA, offer dates), Audit + Keyword Plan screens, admin screen for our team.

## 5. Phased plan

| Phase | Scope | Blocked by |
|---|---|---|
| **V2.0a** (start now, in parallel) | File GBP API access request; add consent-screen/scope justification; record demo video; research spike on video/`description`/scheduledTime against a test location | Need a qualifying GBP (60+ days, verified, with website) |
| **V2.0b** | GBP adapter behind a mock; OAuth connect, location picker, audit screen, facts questionnaire, admin keyword-plan entry | Real API calls need approval |
| **V2.1** | Content planner, AI drafting, photo pipeline (validation, EXIF diagnostics, labels), approval flow, publish via n8n, status/retry/reconcile, audit log | V2.0 |
| **V2.2** | Review fetch + reply drafts, multi-location, performance dashboard, usage caps/plans | V2.1 |
| **V2.3** | Rank grid via contracted provider, heatmaps, trend reports | Provider contract + cost model |

Pilot with 3-5 real businesses before onboarding more (blueprint rule, and I agree).

## 6. Risks

1. **Approval delay or rejection** is the schedule risk, with no appeal clarity from Google. Mitigation: file immediately, build against a mock, apply with a client's real profile.
2. **Shared Google Cloud project.** The existing project is mid-verification for YouTube. Adding a second sensitive scope to the same consent screen can restart review. Recommendation: use a **separate GCP project and OAuth client** for GBP. (My judgment, not a documented requirement.)
3. **Over-promising rankings.** Position the product as "consistent, keyword-focused profile activity and measurement", never guaranteed rank.
4. **AI hallucinating facts** in client-facing posts. Needs grounded briefs, a verification pass, and approval-by-default.
5. **Policy/spam flags:** keyword-stuffed posts or names, fake geotags, review gating. All out of scope.
6. **Cost:** per-location AI and image generation, and rank-grid queries scale with usage, so caps and a usage ledger from day one.
7. **Single EC2 box** (current production) running more workers. Fine for the pilot; revisit with the K8s direction in `websitePlan.md` later.

## 7. Decisions and open questions

Decided Oct 15: see `v2Implementation.md` §1 (managed service first, OAuth per owner, no video, human approval by default, staff login by Google sign-in + allowlist). **Geotag and alt text are in, overriding the recommendation in §2**: every image (uploaded or AI-generated) gets the business's exact coordinates written into its EXIF, and alt text built from the assigned keyword is embedded in the image metadata (not a website deliverable). Caveat unchanged: Google reportedly strips metadata and the GBP API has no alt-text field, so neither is promised to affect ranking. Also decided: alt text is a keyword-led sentence by default, exact business coordinates on every image, posts in Hindi and English. Still open: price target per location, real staff emails. Original questions below for reference.

1. Do you have (or can a pilot client provide) a **verified GBP, 60+ days old, with a website**? The API access request needs one. Is it OK to file the request from your account/company?
2. Who runs keyword research: "a client of our own company" — an in-house team member, or an outside client? Either way it's a manual entry screen, but it decides whether the admin screen is internal-only or needs its own login role.
3. **Connect model:** does each business owner connect via OAuth themselves, or will they add your agency Google account as a Manager on their profile (one login, many locations)? OAuth per client is more scalable and compliant; manager-invite is simpler to start.
4. **Geotagging/alt text:** OK to replace them with the truthful pipeline in §1 (EXIF diagnostics + website-only alt text)? If the client insists on geotags, I need that decision from you explicitly.
5. **Video:** how important is video on GBP? If the API can't take it, is a manual-upload checklist acceptable?
6. **Product shape:** managed service (your team operates for the client, workspace = client) or self-serve SaaS, or both? Affects the admin screens and plan limits.
7. **Languages/markets:** India only, with Hindi/regional-language posts? Affects prompts and keyword handling.
8. **Approval policy:** default human approval before every post, or auto-publish from day one for trusted clients?
9. **Branching:** I read "v2 branch" as a long-lived integration branch that feature branches merge into, then v2 -> main -> production. Or should features branch from main directly with `v2` just as a label?
10. **Pricing/targets:** any price point vs Grexa's ₹7k-10k/yr GBP-only plan? It sets the AI/image cost budget per location.

## 8. Spike checklist (needs a real approved project + test location)

- [ ] Can `media.create` upload video? What does `MediaItem.description` do?
- [ ] `scheduledTime` semantics (timezone, editing, cancellation) vs. our own scheduler.
- [ ] Post `summary` length limit and rejection behaviour (not stated on the reference page).
- [ ] Does Google keep or strip EXIF on served images (so we know what to tell clients)?
- [ ] Manager-level vs owner-level role: which operations work for a Manager.
- [ ] Per-project quota after approval (docs: 300 QPM approved vs 0 not approved).

## 9. Rank grid (V2.3) sketch

A snapshot of "where does this business appear for keyword K at each point of an N×N grid". Done through a contracted provider (DataForSEO Maps SERP takes one coordinate per task, so a 5×5 scan is 25 tasks; Local Falcon sells scan credits), never by scraping Google Maps. Store provider, method, timestamp, point, and rank/not-found/error separately (an error is never rank 100). Cost preview and hard caps before every scan. Decide build-vs-resell after V2.2 when real unit costs are known.

## 10. Sources

- Google: [API prerequisites](https://developers.google.com/my-business/content/prereqs), [OAuth](https://developers.google.com/my-business/content/implement-oauth), [LocalPost reference](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts), [Media reference](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.media), [Performance API](https://developers.google.com/my-business/reference/performance/rest)
- Geotag studies: [Sterling Sky](https://www.sterlingsky.ca/geotagging-photos-impact-ranking/), [Search Engine Land](https://searchengineland.com/geotagging-photos-google-business-profile-rank-453525)
- Rank providers: [DataForSEO grid how-to](https://dataforseo.com/help-center/build-grid-rank-tracker-maps), [Local Falcon](https://www.localfalcon.com/)
- Competitors: [Grexa](https://grexa.ai/), [Dhanda AI](https://dhanda.app/)
- Client blueprint: `V2 Blueprint.docx` (not committed; client document)
