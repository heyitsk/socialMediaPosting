# smPosting — AWS Deployment Implementation Plan

> Written Oct 3, 2026. Turns the strategy in [deploymentPlan.md](deploymentPlan.md) (one EC2 box + docker compose + Caddy) into ordered, checkable work. `<domain>` stands for the domain you bought. Region is **ap-south-1 (Mumbai)**, the same as the media bucket (`AWS_REGION` default in `backend/src/lib/env.ts`).
>
> Platform review rules (Meta, Google, LinkedIn) change often. Items marked *(verify)* should be checked against the current developer docs before you rely on them.

## 0. Critical path

App reviews take weeks, and the infrastructure takes days. **Start Phase 1 (legal pages) and Phase 7 (platform reviews) straight away, in parallel with the infra work.** Reviews need a live HTTPS site, so Phases 2-5 have to be finished before the review submissions go in.

```
Week 1: Phase 1 legal pages ─┐   Phase 2 AWS account hygiene → Phase 3 containers → Phase 4 infra → Phase 5 go-live
                             └─► Phase 7 reviews submitted as soon as https://app.<domain> is up
Weeks 2-6: review back-and-forth (Meta / Google / YouTube audit); Phase 6 CI/CD, backups, monitoring meanwhile
```

Until the reviews pass, production works for **you and the test users you add**, but not for the public. Section 7 covers exactly what each platform does before approval.

---

## T. Tester launch first (decided Oct 3): deploy publicly, publish nothing

The first deploy is for a small group of remote, non-technical testers who use the real URL like normal users. **No app gets published or reviewed yet.** Every platform has a tester mode that allows this:

| Platform | Mode we stay in | What each tester needs | Limits while in this mode |
|---|---|---|---|
| Meta: Facebook + IG via Page | App in **Development** mode | A **Facebook tester role**: App Roles → Roles → Add People → Tester, using their FB profile. They accept at `developers.facebook.com/requests` (this may ask them to register as a Meta developer, which is a one-click form). To post they need a **Facebook Page they admin**. For IG through the Page, an **Instagram professional (Business/Creator) account linked to that Page**. | Only role holders can connect. Posts made by a dev-mode app may only be visible to app role holders, not the public *(verify)*. Neither matters for testing. |
| Meta: Instagram Login | Development | An **Instagram tester** invite (App Roles → Instagram Testers, by IG username). They accept in Instagram → Settings → *Apps and websites* → **Tester invites** (or instagram.com/accounts/manage_access). The account must be **professional**, not personal. | Role holders only |
| Meta: Threads | Development | A **Threads tester** invite (App Roles → Threads Testers). They accept in Threads → Settings → Account → *Website permissions* → **Invites**. | Role holders only |
| Google login project | **Publish it** (Testing → In production) | Nothing. With only `openid email profile`, publishing is instant and shows no "unverified app" warning. *If you leave it in Testing, add every tester's Gmail as a test user instead.* | None that matter |
| Google YouTube project | **Testing** | Their Google account added under **Audience → Test users** (max 100). At consent they'll see "Google hasn't verified this app" → **Advanced → Go to smPosting (unsafe)**. Warn them in advance. | **Refresh tokens expire after 7 days**, so testers must reconnect YouTube weekly. 10k quota units/day ≈ **6 uploads/day in total**. Uploads are probably **private-only** (unaudited project). |
| LinkedIn | As it is (self-serve products) | Nothing | Tokens last ~60 days |

**Still required for the tester launch:**
- Domain + HTTPS. Meta and Google reject non-HTTPS redirect URIs, and ngrok isn't an option because the testers need it running 24/7, not only while your laptop is on.
- All of Phase 2 (AWS hygiene), Phase 3 (containers), Phase 4 (infra) and Phase 5 (go-live). **n8n must be deployed too.** Frontend, backend, Postgres and Redis alone can't post, because every post goes through the n8n poster workflows. S3 is already there.
- Production redirect URIs added in the Meta, Google and LinkedIn dashboards, and the production origin added to S3 CORS.
- Keep `POSTING_LIMITS_PROFILE=dev` **while Meta is in Development mode** (that's what the profile is for). Remove it when Meta goes Live.

**Deferred until you publish:** Phase 1 (legal pages, Meta deletion callbacks), Meta Business Verification and App Review, Google brand verification for YouTube, the YouTube audit, the LinkedIn Company Page link, and the Google login project's logo. Phase 6 CI/CD and backups are still worth doing in week one, since testers' data and schedules live on the box.

**Tester onboarding sheet** (send this to each tester; you do the dashboard side):
1. Send me: Facebook profile link, Instagram username, Threads username, Gmail address.
2. Accept the invites: Facebook (developers.facebook.com/requests), Instagram (Settings → Apps and websites → Tester invites), Threads (Settings → Account → Website permissions → Invites).
3. Make sure your Instagram is a **Business or Creator** account, and for the Facebook route, linked to a Facebook Page you manage.
4. Open `https://app.<domain>` → Sign in with Google → Connect each platform.
5. YouTube: on the "Google hasn't verified this app" screen, click **Advanced → Go to smPosting**. Reconnect YouTube if it shows disconnected (expected weekly during testing).

---

## Phase 1 — Pages and endpoints the reviews require (code)

All three platforms reject apps that don't have these. None exist yet. The landing page is already on `main`, but there are no privacy, terms or data-deletion pages.

- [x] **Privacy policy** page (`/privacy`): what data you store (OAuth tokens encrypted at rest, media in S3 deleted 15 days after posting, Google login email), why, how long, and how to delete it. For the YouTube audit it **must** link the [Google Privacy Policy](https://policies.google.com/privacy) and explain how to revoke access through [Google security settings](https://security.google.com/settings/security/permissions) *(verify the current YouTube API Services policy wording)*.
- [x] **Terms of service** page (`/terms`). For YouTube it must say that users agree to the [YouTube Terms of Service](https://www.youtube.com/t/terms).
- [x] **Data deletion** page (`/data-deletion`): instructions, plus a way to request deletion.
- [x] **Meta callback endpoints** (built Oct 6, `backend/src/routes/meta-callbacks.ts`; set the dashboard fields to `https://app.postuploaders.com/api/webhooks/meta/{deauthorize,delete}?product=facebook|instagram|threads`; verified with the HMAC and each product's own app secret):
  - Facebook Login: *Data Deletion Request callback*. It returns `{ url, confirmation_code }`.
  - Instagram (Instagram Login product): *Deauthorize callback* + *Data deletion request URL*.
  - Threads: *Uninstall callback* + *Delete callback*.
  - Each one should mark the matching `SocialAccount` disconnected, delete its tokens, and log it. A single route `/api/webhooks/meta/{deauthorize,delete}?product=...` is enough.
- [ ] The public pages must be reachable **without logging in** (they're outside `RequireAuth` in `frontend/src/App.tsx`), and the landing page must link to them.

## Phase 2 — AWS account hygiene (you, ~1 hour, before anything else)

You said you have the root login and an IAM user that was made for S3. **Don't give either one to me or to CI.** Do this instead:

- [ ] Turn on **MFA on the root user**, then stop using root. It's only for billing and account-level emergencies.
- [ ] In **IAM Identity Center** (ap-south-1), create your everyday admin user with MFA and the `AdministratorAccess` permission set. Then run `aws configure sso` locally with a profile such as `smposting-admin`. That gives short-lived credentials for the CLI and for the AWS MCP tools in Claude Code.
- [ ] Leave the existing S3 IAM user (`AWS_PROFILE=smposting`) **for local dev only**. Production uses the EC2 instance role instead, so no keys go on the server. Make sure it only has the `smposting-backend-media-ap-south-1` policy. It signs in with `aws login` (its console password), so **keep console access**. Add MFA to it, and delete any unused access keys.
- [ ] **AWS Budgets**: alert at $30 (forecast) and $50 (actual), sent to your email.
- [ ] Billing → Free Tier: check whether the account still has free-tier or credits.
- [ ] `aws ssm` Session Manager works from a local shell once the plugin is installed (`session-manager-plugin`). That replaces SSH.

## Phase 3 — Production containers (code)

- [ ] **`backend/Dockerfile`** (multi-stage, `oven/bun` arm64): `bun install --frozen-lockfile --production`, `bunx prisma generate`. The entrypoint runs `bunx prisma migrate deploy && bun src/index.ts` (**never** `migrate dev`, see the Prisma gotcha). Run it as a non-root user and add a `HEALTHCHECK` against `/health`.
- [ ] **Frontend build**: `bun run build` in CI with `VITE_FARO_URL` / `VITE_APP_VERSION` set (leave `VITE_API_URL` unset, because the app stays same-origin). Bake `dist/` into a small **Caddy image** (`infra/caddy/Dockerfile`), so one image carries both the static files and the proxy config.
- [ ] **`infra/caddy/Caddyfile`**:
  - `<domain>`, `www.<domain>` → SPA (landing + legal pages). Or redirect the apex to `app.` if the landing page lives inside the SPA.
  - `app.<domain>`: `/api/*` and `/health` → `backend:4000`, everything else → SPA with `try_files {path} /index.html`.
  - `n8n.<domain>` → `n8n:5678`, behind `basic_auth` **and** a `remote_ip` allowlist. Leave out `/webhook/*`, because the backend calls n8n over the Docker network.
  - Security headers (HSTS, `X-Content-Type-Options`, `Referrer-Policy`), gzip/zstd, long cache on hashed assets, no cache on `index.html`.
- [ ] **`docker-compose.prod.yml`** (the dev compose stays as it is):
  - Services: `caddy`, `backend`, `postgres:18`, `redis:8.0`, `n8n` (pinned `2.41.4`). No `otel-lgtm`/`alloy`, because production telemetry goes to Grafana Cloud.
  - Only Caddy publishes ports (80/443). Postgres, Redis and n8n stay internal.
  - All secrets come from `/opt/smposting/.env`, which is generated at deploy time from SSM Parameter Store. **No literals in the file.** The dev `CALLBACK_SECRET` is committed in a public repo, so production gets a newly generated one.
  - Postgres: an init script creates an `n8n` database and user. n8n gets `DB_TYPE=postgresdb`, a fixed `N8N_ENCRYPTION_KEY`, `N8N_EDITOR_BASE_URL=WEBHOOK_URL=https://n8n.<domain>`, `N8N_PROXY_HOPS=1`, `N8N_SECURE_COOKIE=true`, and `N8N_OTEL_EXPORTER_OTLP_ENDPOINT` set to Grafana Cloud (or tracing off).
  - Redis: `--appendonly yes --appendfsync everysec`, with a `maxmemory` policy of `noeviction`, because BullMQ requires it.
  - Backend env: `PUBLIC_BACKEND_URL=FRONTEND_URL=https://app.<domain>`, `N8N_BASE_URL=http://n8n:5678`, `REDIS_HOST=redis`, `DATABASE_URL=postgres://...@postgres:5432/smposting`, **no `AWS_PROFILE`** (the SDK picks up the instance role), `POSTING_LIMITS_PROFILE=dev` while Meta is in Development mode (unset once it's Live), and OTLP set to Grafana Cloud.
  - `restart: unless-stopped`, healthchecks with `depends_on: condition: service_healthy`, and json-file log rotation (`max-size: 10m`, `max-file: 3`).
- [ ] Confirm that cookies are `Secure` in production and that the backend trusts `X-Forwarded-Proto` from Caddy for building OAuth redirect URLs.

## Phase 4 — Infrastructure as code (`infra/app-server.yaml`, CloudFormation)

- [ ] **EC2 `t4g.medium`**, Amazon Linux 2023 arm64 (AMI from the SSM public parameter, so it's never hardcoded), 30 GB gp3 encrypted root volume, IMDSv2 required.
- [ ] **Elastic IP**: this is the DNS target for every hostname.
- [ ] **Security group**: inbound 80/443 from `0.0.0.0/0` and `::/0` only. **No port 22.**
- [ ] **Instance role** with `AmazonSSMManagedInstanceCore`, the existing `arn:aws:iam::675474620265:policy/smposting-backend-media-ap-south-1` (passed in as a parameter: the media bucket and this policy were created by hand on Oct 4, not by `infra/media-bucket.yaml`, so don't deploy that template, because the bucket name is already taken), `ssm:GetParametersByPath` on `/smposting/prod/*` plus `kms:Decrypt` for the SSM key, write access to the backups bucket, and `ecr:Get*` if you choose ECR.
- [ ] **Backups bucket** (`smposting-backups-<account>-ap-south-1`): private, encrypted, 30-day expiration.
- [ ] **DLM policy**: daily EBS snapshots, keep 7.
- [ ] **CloudWatch alarms**: `StatusCheckFailed` → auto-recover, plus an SNS email. The disk alarm needs the CloudWatch agent, so a cron script that alerts at 80% is the simpler option.
- [ ] **UserData**: install docker and the compose plugin, add a 2 GB swap file (a safety net for video runs), create `/opt/smposting`, and install a `deploy.sh` that pulls the SSM params into `.env` and runs `docker compose pull && up -d`.
- [ ] **Update `infra/media-bucket.yaml`**: add `https://app.<domain>` to `AllowedOrigins`, keeping localhost and the ngrok origin for dev.
- [ ] DNS stays at Hostinger, so it isn't in the template. Point the records at the `ElasticIp` stack output (Phase 5).

## Phase 5 — First deploy and go-live (you + me)

- [ ] **DNS (Hostinger hPanel → Domains → `<domain>` → DNS / Nameservers → DNS records)**: DNS stays at Hostinger. Remove Hostinger's default parking `A`/`AAAA` records for `@` and the `www` CNAME. Add `A` records for `@`, `www` and `app` → the Elastic IP, with TTL 300. Skip `n8n` if the editor is reached over an SSM tunnel. Delete any leftover `AAAA` records, because Let's Encrypt would try IPv6 first and fail. If there's a `CAA` record, it must allow `letsencrypt.org`.
- [ ] **SSM parameters** (`SecureString` under `/smposting/prod/`): `TOKEN_ENCRYPTION_KEY_V1` (a **new** key, since prod data starts empty), `N8N_CALLBACK_SECRET`, `N8N_ENCRYPTION_KEY`, Postgres passwords, all OAuth client IDs and secrets, Grafana Cloud OTLP headers, and n8n basic-auth credentials.
- [ ] **OAuth redirect URIs**: add the `https://app.<domain>/api/...` URIs alongside the ngrok ones in each dashboard (paths are listed in `backend/.env.example`):
  - Meta: Facebook Login for Business, Instagram Login, Threads. Also set the App Domains, Privacy Policy URL, Terms URL, Data Deletion URL, and the Phase 1 callback URLs.
  - LinkedIn: `/api/auth/linkedin/callback`.
  - Google login project: `/api/login/google/callback`. YouTube project: `/api/auth/youtube/callback`. Add `<domain>` as an **authorized domain** on both consent screens.
- [ ] **n8n**: open `https://n8n.<domain>`, create the owner account, import `workflows/*.json`, recreate the S3 and other credentials (they aren't in the exports), then **activate every workflow**. They're all exported with `"active": false`, and inactive webhook workflows return 404.
- [ ] **Smoke test**: Google login → connect each platform → post an image and a video to each → check callbacks, history, and the media cleaner. Then restart the stack and confirm a scheduled post survives the restart (Redis AOF + the in-flight reconciler).
- [ ] **Uptime monitor** (UptimeRobot / Better Stack free tier) on `https://app.<domain>/health`.

## Phase 6 — CI/CD, backups, observability (in the first week after go-live)

- [ ] **GitHub Actions `deploy.yml`, triggered on push to `production`.** That push only happens by merging a `main → production` PR, because branch protection is on. Steps: build the arm64 backend and caddy images on a `ubuntu-24.04-arm` runner, push to **GHCR** tagged with the git SHA, then `aws ssm send-command` → `deploy.sh <sha>`.
- [ ] **Auth from GitHub to AWS through OIDC**: a `GitHubDeployRole` in CloudFormation that trusts only `repo:heyitsk/socialMediaPosting:ref:refs/heads/production` and can only `ssm:SendCommand` to the app instance. **No AWS keys in GitHub secrets.**
- [ ] **`ci.yml` on PRs to `main`**: biome, `tsc`, `bun test`, frontend build. You can then add it as a required status check on `production`.
- [ ] **Nightly `pg_dump`** of both databases → backups bucket (a systemd timer or cron on the host). **Do a test restore once** into a scratch container.
- [ ] **Grafana Cloud**: create the production stack, put the OTLP endpoint and headers in SSM, import `observability/dashboards` and `observability/alerts` using the existing scripts, and set `VITE_FARO_URL` to the Grafana Cloud Faro collector.

---

## 7. Publishing the platform apps

The scopes below are the ones the code requests today.

### 7.1 Meta app (Facebook Pages, Instagram, Threads)

| Product | Scopes (from code) | File |
|---|---|---|
| Facebook Login for Business | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management` | `backend/src/lib/facebook.ts` |
| Instagram API with Instagram Login | `instagram_business_basic`, `instagram_business_content_publish` | `backend/src/lib/instagram.ts` |
| Threads API | `threads_basic`, `threads_content_publish` | `backend/src/lib/threads.ts` |

**What happens before approval:** in **Development** mode the app only works for people who have a role on the app (admin, developer or tester; Threads and Instagram testers are invited separately). Switching to **Live** without Advanced Access still only allows role holders to grant these permissions. That's fine for your own accounts, but not for customers.

Steps:
1. [ ] **App settings → Basic**: app icon (1024×1024), category, **App Domains** = `<domain>`, Privacy Policy URL, Terms URL, User Data Deletion (callback or instructions URL), contact email.
2. [ ] **Business Verification** of your business in Meta Business Manager. You need legal business documents, and the name must match the documents. smPosting acts on *other* businesses' Pages, so Meta also treats you as a **Tech Provider** and requires **Access Verification** *(verify the current tech-provider flow)*. **This is the one that blocks you if you don't have a registered business**, see question 3.
3. [ ] **App Review → Permissions and Features**: request **Advanced Access** for each permission above. For each one, provide:
   - A plain-English explanation of why you need it and how the user benefits.
   - A **screencast** in English with captions, showing the full flow on production: log in to smPosting → connect the account → consent dialog with the exact permissions → compose → the post appearing on Facebook, Instagram or Threads.
   - **Test credentials so the reviewer can get into smPosting.** Your login is Google-only, so create a dedicated Google account for reviewers and write the steps in the review notes.
4. [ ] Threads and Instagram Login are reviewed as their own **use cases** in the same app. Submit them alongside the Facebook permissions.
5. [ ] Use **Data Use Checkup** and complete the annual data-use attestations when Meta prompts.
6. [ ] Switch the app to **Live**.

Expect 1-3 weeks with at least one rejection round. The usual reasons for rejection are a screencast that doesn't show the permission being used end to end, a reviewer who can't log in, and a missing or generic privacy policy.

### 7.2 Google — two projects

**Login project** (`openid email profile`, non-sensitive):
1. [ ] Verify `<domain>` in **Google Search Console** (DNS TXT record). The same verification serves both projects if you're the owner.
2. [ ] OAuth consent screen (Google Auth Platform → Branding): app name, logo, support email, homepage `https://<domain>`, privacy and terms links, authorized domain `<domain>`.
3. [ ] **Publish app** (Testing → In production). With non-sensitive scopes, brand verification is quick (usually a few days) and mostly checks your logo and name.

**YouTube project** (`youtube.upload`, `youtube.readonly`, both **sensitive** scopes):
1. [ ] Same branding steps as above, then **Publish app** and **submit for verification**. Sensitive-scope verification asks for:
   - The reason you need each scope.
   - A **demo video** (unlisted YouTube link) showing the consent screen with the app name, the OAuth client ID visible in the URL bar, and the upload feature using the scope.
   - Privacy policy on the verified domain.
   - No CASA security assessment, because that's for *restricted* scopes *(verify)*.
2. [ ] **Before verification:** while the project is in *Testing*, refresh tokens **expire after 7 days** and you're limited to 100 test users. That means YouTube connections would break weekly in production, so publish as soon as possible.
3. [ ] **YouTube API Services audit and quota extension.** This is separate from OAuth verification, and it matters more:
   - The default quota is **10,000 units/day**. `videos.insert` costs **~1,600 units**, which is about **6 uploads/day across all users**.
   - Videos uploaded from an **unaudited** API project (created after July 2020) are **locked to private** *(verify that this still applies)*.
   - Submit the *YouTube API Services Audit and Quota Extension* form with your expected volume, after the legal pages from Phase 1 are live.
4. [ ] The `youtube.readonly` scope is only needed to read the channel. If `fetchChannel` can work with `youtube.upload` alone (it probably can't, *verify*), dropping `readonly` makes the review simpler.

### 7.3 LinkedIn

Scopes: `openid profile w_member_social` (posting to the member's **personal profile** only).

1. [ ] Both products, *Sign In with LinkedIn using OpenID Connect* and *Share on LinkedIn*, are **self-serve**. They work for any LinkedIn member once added, with **no review**. So LinkedIn is the one platform that's ready at launch.
2. [ ] **App settings**: **verify the app against a LinkedIn Company Page** (a page admin approves the link; create a smPosting page if you don't have one), add the logo and privacy policy URL, and add the production redirect URL.
3. [ ] Know the limits:
   - Member access tokens last **60 days and there are no refresh tokens** for non-partner apps *(verify)*, so users have to reconnect about every 2 months. The UI should prompt them before expiry.
   - There are per-member daily call limits.
4. [ ] **Later, optional**: posting to **Company Pages** (`w_organization_social`) needs the *Community Management API*. That requires a separate app, a registered legal entity, and an application review. Out of scope for v1.

---

## 8. Questions for you

1. **What's the domain, and where is its DNS?** (Cloudflare, Route 53, or the registrar's own DNS.) I'd move DNS to **Cloudflare (free)** or **Route 53 ($0.50/mo, can go in CloudFormation)**. Either works.
2. **How should I get AWS access?** I'd suggest you do Phase 2 and run `aws configure sso` yourself. Then I can deploy the CloudFormation stacks through the AWS tools in Claude Code with your temporary admin credentials. I should never get the root or IAM-user password.
3. **Do you have a registered business** (company, LLP, or sole proprietorship with GST/registration documents)? Meta Business Verification needs one before strangers can connect Facebook, Instagram or Threads. Without it, Meta posting works only for accounts you add as testers.
4. **How do you want to reach the n8n editor?** Choices: basic-auth + IP allowlist on `n8n.<domain>` (simple, but your home IP changes), or **no public hostname plus an SSM port-forward** (`aws ssm start-session ... AWS-StartPortForwardingSession`), which is more secure and costs nothing. I'd pick SSM.
5. **Do you have a Grafana Cloud account for production yet**, or should telemetry be off at launch and added in Phase 6?
6. **Do you want the landing page and legal pages on the apex (`<domain>`) or inside the app (`app.<domain>/privacy`)?** Reviews accept either, as long as it's your domain.
7. **Is $28-35/month OK**, or should I plan for Lightsail ($24 flat, but needs IAM keys on the box)?

## 9. Suggestions

- **Start the reviews now.** Infra is 2-4 days of work. Meta business verification, Google sensitive-scope verification, and the YouTube audit are 2-6 weeks and can't be rushed.
- **Expect to launch in stages:** LinkedIn works for everyone right away. YouTube works for everyone once published, but probably uploads as private until the audit. Meta works only for testers until App Review. Show "coming soon" in the composer for anything not yet approved, rather than letting users hit errors.
- **Production starts with a fresh database**, with no copy of dev data. Use new encryption keys and secrets everywhere. Dev tokens were encrypted with the dev key and point at dev and test accounts anyway.
- **Remove `POSTING_LIMITS_PROFILE=dev` once Meta goes Live.** It halves the posting caps. It's right during the tester launch (section T), because Meta is still in Development mode.
- **Treat EBS snapshots and `pg_dump` as two separate safety nets.** Redis AOF makes schedules survive a restart, but losing the volume loses them. Snapshots cover that case.
- **Use a 1-year Compute Savings Plan** once the instance size has been stable for a month. It saves about 30-40% on EC2.

---

## 10. Future Scaling

> Not needed for the tester launch. Written Oct 4 so the path is clear before it's needed. The binding limit for a long time will be the platform API quotas (Meta, YouTube), not hardware. `deploymentPlan.md` §5-6 has the triggers for each step.

**The rule:** stateless parts (backend API, workers, n8n workers, Caddy) scale **horizontally**, by running more copies. Stateful parts (Postgres, Redis) scale **vertically** first, by getting a bigger machine. Every stage below is about separating the two.

### Stage 1: bigger box
- On one EC2 instance everything shares the same CPU and RAM. Running more backend copies there doesn't scale Postgres; it just splits the same box.
- When CPU or RAM is regularly above ~70%, change `InstanceType` in `infra/app-server.yaml` (`t4g.medium` → `t4g.large` → `t4g.xlarge`). Expect about 5 minutes of downtime and no code changes.

### Stage 2: move the data off the box
- **Postgres → Amazon RDS** (managed backups, patching, optional Multi-AZ standby). Restore a `pg_dump` into it and change `DATABASE_URL`.
- **Redis → Amazon ElastiCache** with a replica for failover. Change `REDIS_HOST`. Keep `noeviction`.
- After this the app server holds nothing that can't be rebuilt, so it can run as several copies.

### Stage 3: many stateless copies behind a load balancer

| Component | How it scales |
|---|---|
| Caddy | Replaced by an **Application Load Balancer** (HTTPS with an ACM certificate). The SPA moves to **S3 + CloudFront**. |
| Backend | Split by role, using the same image with `ROLE=api` / `worker` / `render`. API scales on request load, workers on BullMQ queue length, render (ffmpeg) on render queue length. |
| n8n | **Queue mode**: one main (editor + webhooks) + N workers on a Redis queue, scaled on queue length. |
| Postgres (RDS) | Bigger instance class, then **read replicas** for read-only pages (history, dashboard). Add **RDS Proxy / PgBouncer** once copies × pool size nears `max_connections` (each backend pool is up to 10). Archive old posts and logs. Shard by workspace only as a last resort. |
| Redis (ElastiCache) | More memory + a replica. Then separate instances for BullMQ, the n8n queue, and sessions/rate limits. Avoid Redis Cluster unless needed, because BullMQ requires hash-tagged queue prefixes there. |

### Stage 4: automatic scaling
- **ECS Fargate**: AWS-native, low ops. Scales on CPU and requests, and on queue length through CloudWatch metrics.
- **Kubernetes (EKS) + KEDA**: the websitePlan.md end state. KEDA scales n8n and BullMQ workers directly on Redis queue length. Costs ~$73/month for the control plane plus ops time. k3s on EC2 is a cheaper way to start.

### Code changes required before running more than one backend copy
- [ ] **Make the per-process timers run once across all copies.** Today each process runs its own `setInterval`, so N copies run them N times:
  - schedule reconciler (`backend/src/queue/publish-worker.ts`, `startScheduleReconciler`)
  - render reconciler (`backend/src/queue/render-worker.ts`, `startRenderReconciler`)
  - media cleaner (`backend/src/service/media.ts`, `startMediaCleaner`)

  Move them to BullMQ job schedulers (`queue.upsertJobScheduler`), which fire once per interval no matter how many workers listen, or guard them with a Postgres advisory lock.
- [ ] **Role switch in `backend/src/index.ts`**: start only the HTTP server, the queue workers, or the render worker depending on `ROLE`, defaulting to all of them (today's behaviour).
- [ ] **n8n binary data before queue mode**: `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` isn't shared across n8n workers. Confirm that every workflow path streams from S3 (the relay) or switch modes (`deploymentPlan.md` §5).
- [ ] **Pool sizing**: set `max` on the `PrismaPg` adapter in `backend/src/db/client.ts` explicitly, so copies × max stays under the database's connection limit (or the proxy's).

Already compatible with multiple copies: sessions and rate limits live in Redis, and BullMQ workers already share jobs safely through Redis.
