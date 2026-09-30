# smPosting — Deployment Strategy

> Written Sep 30, 2026. Prices are approximate list prices as of mid-2026 (USD/month, on-demand, no free tier or credits) and change often. Check each provider's pricing page before committing. Where a fact is uncertain it says so.

## TL;DR — what to do

1. **Buy one domain** (~$10-15/year). Use subdomains for everything else.
2. **Stay on AWS, but use one EC2 instance (not serverless, not Kubernetes yet).** An arm64 `t4g.medium` (2 vCPU / 4 GB) in the **same region as the S3 media bucket**, running the existing docker-compose stack plus Caddy for HTTPS. About **$25-35/month** all in.
3. **Run n8n on the same box**, first in regular mode, then in queue mode with 1-2 workers through docker compose. **Postpone Kubernetes + KEDA** (websitePlan.md §5 / Phase 3) until the triggers in [§6](#6-when-to-move-to-kubernetes--keda) are hit.
4. If you'd rather not manage a server at all, **Railway** is the easiest fallback (~$20-50/month for this stack). Don't pick Fly.io for this project.

---

## 1. What we're deploying

Taken from `backend/docker-compose.yml`, `backend/package.json` and websitePlan.md:

| Component | Nature | Needs |
|---|---|---|
| Frontend (Vite/React SPA) | Static files | Any static host / reverse proxy |
| Backend (Bun + Hono) | **Long-running process**: HTTP API **and** BullMQ workers (`publish`, callback deadlines, video-status poller, media cleaner) in one process | Always-on process, public HTTPS for OAuth callbacks |
| PostgreSQL 18 | Stateful | Persistent disk, backups |
| Redis 8 | Stateful (BullMQ jobs, delayed/scheduled posts) | Persistence (AOF), because scheduled posts live here |
| n8n | Long-running, memory-hungry when buffering video | Reachable by the backend; the editor UI should be private |
| S3 media bucket | Already on AWS (`infra/media-bucket.yaml`) | Stays where it is |
| (Planned) sharp/ffmpeg render worker | CPU-heavy BullMQ worker | 2+ vCPU when it lands |

Rough memory budget for one box: Postgres ~250 MB, Redis ~50-100 MB, backend ~200-300 MB, n8n main ~350 MB, each n8n worker ~300-500 MB (more while buffering a video), Caddy ~30 MB, OS ~300 MB. **That's about 1.8-2.5 GB, so choose a 4 GB machine.** 2 GB would swap as soon as a YouTube upload runs.

### Why serverless (Lambda) doesn't fit

- BullMQ workers are persistent Redis consumers with delayed jobs. Lambda can't host them without rewriting the scheduling layer onto EventBridge Scheduler + SQS.
- n8n can't run on Lambda at all.
- The API alone could run on Lambda, but you'd still need servers for everything else, so you'd be running two deployment models.
- **Verdict:** no. Serverless only makes sense if you rebuild the backend around it, and the plan doesn't need that.

---

## 2. Domains

**One registered domain** is enough. Example layout with `smposting.com`:

| Hostname | Points to | Public? | Why |
|---|---|---|---|
| `smposting.com` / `www` | Landing page | Yes | Meta App Review and Google OAuth verification both require a homepage, **privacy policy**, **terms**, and a **data-deletion URL** on a domain you own. Google also requires verifying the domain in Search Console. |
| `app.smposting.com` | Caddy: `/` → SPA static files, `/api/*` → backend `:4000` | Yes | **Same-origin frontend + API.** This keeps the cookie model from websitePlan.md §9.2 (single origin, `SameSite=Lax`, no CORS) working unchanged in production. |
| `n8n.smposting.com` | n8n editor `:5678` | **Restricted** | Only you need the editor. Protect it with an IP allowlist, Caddy basic-auth, or Tailscale, or skip the DNS entry and use an SSM/SSH tunnel. |

Things that **don't** need a public hostname:
- Backend → n8n webhook calls: use the internal Docker network (`http://n8n:5678/webhook/...`).
- n8n → backend callbacks: internal too (`http://backend:4000/api/webhooks/n8n-callback`). Today `callback_url` is built from `PUBLIC_BACKEND_URL`. Either keep that (it works, just goes out and back through Caddy) or add an `INTERNAL_BACKEND_URL` later.

Required config changes at go-live:
- `PUBLIC_BACKEND_URL` and `FRONTEND_URL` become `https://app.smposting.com`.
- **Re-register every OAuth redirect URI** in the Meta, Instagram, Threads, LinkedIn, and Google (both login and YouTube projects) dashboards as `https://app.smposting.com/api/...`. The ngrok ones stay for dev.
- n8n: `WEBHOOK_URL` / `N8N_EDITOR_BASE_URL` → `https://n8n.smposting.com`.
- S3 bucket CORS: add `https://app.smposting.com` as an allowed origin for browser uploads.

Registrar: Cloudflare Registrar (at-cost, free DNS) or Route 53 (~$0.50/month per hosted zone plus the domain price). Either works. Cloudflare DNS is free and fast. Route 53 keeps everything in one AWS bill and in CloudFormation.

---

## 3. Platform comparison

Monthly cost is for **this stack** (API + workers, Postgres, Redis, n8n main + 1 worker, ~4 GB RAM total), at launch-level traffic.

| Platform | Model | Est. cost / mo | Setup effort | Postgres / Redis | n8n (+ queue mode) | Egress / video bandwidth | Fit for smPosting |
|---|---|---|---|---|---|---|---|
| **AWS EC2 (1 box + compose)** | IaaS VM | **~$25-35** (t4g.medium ~$20-25 + EBS 30 GB ~$3 + public IPv4 ~$3.6) | Medium | Self-hosted in compose | ✅ Full control; queue mode through compose | 100 GB/mo free across the account, then ~$0.09-0.11/GB. **S3 → EC2 in the same region is free.** Instance **IAM role** lets the backend reach S3 without access keys. | ⭐ **Recommended** |
| **AWS Lightsail** | Flat-price VPS | **~$24** (4 GB, 2 vCPU, 80 GB SSD, ~4 TB transfer, IPv4 included) | Easy | Self-hosted (or Lightsail managed DB ~$15+) | ✅ same as EC2 | **Big bundled transfer**, good for video uploads | Strong alternative. Downside: **no instance IAM roles**, so the backend needs long-lived IAM user keys for S3. |
| AWS ECS Fargate + RDS + ElastiCache + ALB | Managed containers | **~$100-150+** (ALB ~$18, RDS t4g.micro ~$15, ElastiCache ~$12, 3-4 Fargate tasks ~$15-30 each, NAT or public IPs) | Hard | Managed | ✅ separate services | Normal AWS egress | The eventual "proper AWS" target. Too expensive and complex for launch. |
| AWS EKS (+ KEDA) | Managed Kubernetes | **~$150-250+** (control plane alone ~$73) | Hardest | Managed or in-cluster | ✅ This is the websitePlan.md end state | Normal AWS egress | Only once the §6 triggers are hit |
| AWS Lambda / serverless | FaaS | — | — | — | ❌ | — | ❌ Doesn't fit (see §1) |
| **DigitalOcean Droplet + compose** | VPS | **~$24** (4 GB / 2 vCPU, 4 TB transfer) | Easy-Medium | Self-hosted (managed PG ~$15, managed Valkey ~$15 if wanted) | ✅ | Generous bundled transfer, but S3 downloads now cross clouds (S3 internet egress ~$0.09/GB) | Good. Nearly the same as Lightsail, but off AWS. |
| DigitalOcean App Platform | PaaS | ~$50-80 with managed DB + Valkey | Easy | Managed add-ons | ⚠️ Possible but awkward (needs persistent volume for n8n, separate worker components) | Bundled | OK, but no better than a Droplet here |
| DigitalOcean Kubernetes (DOKS) | Managed K8s | ~$50-80 (**free control plane**, 2 nodes) | Hard | Managed or in-cluster | ✅ + KEDA | Bundled | **Cheapest managed K8s** if you go K8s off AWS |
| **Railway** | PaaS, usage-based | **~$20-50** (Hobby $5 includes $5 usage; about $10/GB-RAM-month + $20/vCPU-month) | **Easiest** | One-click Postgres + Redis (volumes, **not** managed HA) | ✅ One-click n8n templates, including a queue-mode template | Egress ~$0.05/GB | ⭐ Best "don't want to run a server" option |
| Render | PaaS | ~$50-90 (web $7-25, background worker $7-25, PG from ~$6-19, Key Value ~$10, n8n with disk) | Easy | Managed | ✅ (needs paid disk) | Bundled allowance | Fine, but pricier than Railway for this shape |
| Fly.io | Micro-VMs, usage-based | ~$30-70 (machines ~$5-10 per GB; Managed Postgres starts ~$38; Redis through Upstash) | Medium-Hard | Managed PG is the pricey part; Redis is external (Upstash per-command pricing is a poor fit for BullMQ's constant polling) | ⚠️ Works, needs volumes and fly.toml per app | ~$0.02/GB | ❌ Not worth it. Its strength is multi-region edge, which we don't need. |
| Hetzner Cloud + compose (or Coolify) | Cheap VPS | **~$8-15** (4-8 GB) | Medium | Self-hosted | ✅ | 20 TB included | Cheapest by far, but locations are EU/US/Singapore only, and S3 downloads cross clouds |
| Coolify / Dokploy (on any VPS) | Self-hosted PaaS UI | $0 + VPS cost | Easy-Medium | One-click | ✅ n8n template | Depends on VPS | A good layer on EC2/DO/Hetzner if you want a Railway-like UI on your own box |
| Vercel / Netlify / Cloudflare Pages | Static/edge hosting | Free | Easy | — | ❌ | — | Frontend only. **Not recommended here:** it splits frontend and API across origins, which breaks the §9.2 same-origin cookie design. |

### Why AWS EC2 over the others for this project

- **S3 is already on AWS.** n8n downloads media from S3 (YouTube and LinkedIn video uploads). In the same region that transfer is free and fast. From DO, Hetzner, or Railway, every download is billed S3 internet egress.
- **IAM instance role:** the backend's S3 access (`smposting-backend-media-*` policy in `infra/media-bucket.yaml`) attaches to the instance, so there are no AWS keys in `.env`. Lightsail, DO, Railway, and Fly all need long-lived access keys.
- **CloudFormation already exists** (`infra/media-bucket.yaml`). The instance, security group, Elastic IP, and role can go in a second template, following the CLAUDE.md IaC preference.
- **The same compose file moves anywhere.** Nothing here locks you into EC2. You can later move to Lightsail, DO, or Railway with no code changes.
- **Cost-wise, EC2 vs Lightsail vs a DO Droplet is roughly a wash (~$24-35).** The deciding factors are IAM roles and free S3 transfer, and both favour EC2.

**Pick Lightsail instead** if video volume gets high (≫100 GB/month to YouTube/LinkedIn) and the bundled transfer matters more than IAM roles.

---

## 4. Recommended launch architecture (Phase A)

```
                     Internet
                        │  :443 (only 80/443 open)
                ┌───────▼─────────────────────────────── EC2 t4g.medium (arm64) ─┐
                │  Caddy (auto Let's Encrypt HTTPS)                              │
                │   app.smposting.com  /       → /srv/frontend (vite build)      │
                │   app.smposting.com  /api/*  → backend:4000                     │
                │   n8n.smposting.com          → n8n:5678  (IP allowlist/auth)   │
                │                                                                │
                │  backend (Bun: API + BullMQ workers)                           │
                │  n8n (regular mode → queue mode: n8n-main + n8n-worker ×1-2)   │
                │  postgres:18   (dbs: smposting, n8n)                           │
                │  redis:8       (AOF on; BullMQ + n8n queue, separate prefixes) │
                └──────┬──────────────────────────────────────────────┬──────────┘
                       │ IAM instance role                             │ nightly pg_dump
                       ▼                                               ▼
                 S3 media bucket                                S3 backups bucket
```

### What still needs building

1. **Dockerfiles.** None exist yet.
   - `backend/Dockerfile`: `oven/bun` base, `bun install --production`, `prisma generate`, and `prisma migrate deploy` as a release/entry step (never `migrate dev`), then `bun src/index.ts`.
   - Frontend: `vite build` in CI. Caddy serves `dist/` directly, or bake it into a Caddy image.
2. **`docker-compose.prod.yml`** (separate from the dev compose):
   - No host port publishing except Caddy's 80/443. Postgres, Redis, and n8n stay internal.
   - Remove the hardcoded `CALLBACK_SECRET` and default Postgres password in the current compose file. Load them from an env file that's generated at deploy time from SSM Parameter Store / Secrets Manager (see CLAUDE.md secret rules).
   - n8n: `DB_TYPE=postgresdb` pointing to an `n8n` database on the shared Postgres (needed for queue mode anyway; SQLite doesn't work across main + workers), and a fixed `N8N_ENCRYPTION_KEY`.
   - Redis: `appendonly yes`. Scheduled posts are delayed BullMQ jobs, so losing Redis means losing schedules.
   - `restart: unless-stopped`, healthchecks, log rotation (`max-size`).
3. **`infra/app-server.yaml` (CloudFormation):** EC2 t4g.medium (Amazon Linux 2023 or Ubuntu arm64), 30 GB gp3, Elastic IP, security group (80/443 only; **no SSH**, use SSM Session Manager), instance profile with the existing media policy + SSM + a backups-bucket write policy.
4. **CI/CD (GitHub Actions):** build arm64 images → push to GHCR or ECR → deploy by `ssm send-command` (or SSH) running `docker compose pull && docker compose up -d`. Keep it simple, no CodePipeline needed.
5. **Backups:** nightly `pg_dump` (both databases) → S3 with a lifecycle rule (30 days), plus weekly EBS snapshots through Data Lifecycle Manager. **Test a restore once.**
6. **Monitoring (cheap):** UptimeRobot / Better Stack free tier on `https://app.smposting.com/health`, a CloudWatch alarm on instance status check and disk, and an AWS Budget alert at ~$50.

### Estimated monthly cost (Phase A)

| Item | ~USD |
|---|---|
| EC2 t4g.medium on-demand | 20-25 |
| EBS gp3 30 GB | 2.5-3 |
| Public IPv4 (Elastic IP) | 3.6 |
| S3 media + backups (small) | 1-3 |
| Data transfer (within the 100 GB free tier early on) | 0 |
| Domain (annualised) | ~1 |
| **Total** | **~$28-35** |

A 1-year Compute Savings Plan or Reserved Instance cuts the EC2 line by ~30-40% once the size is settled. New AWS accounts may also have free-tier credits; check Billing → Free Tier.

---

## 5. Where n8n lives and how it scales

**Same box, same compose project, private network.** It's the only consumer of the backend's webhooks, and the backend is its only caller, so co-locating them removes a public hop and the network latency.

Step by step. Each step only changes env vars and compose services, not workflows:

| Step | Setup | When |
|---|---|---|
| A1 | **Regular mode**, single container (what dev runs today), but on Postgres instead of SQLite | Launch |
| A2 | **Queue mode**: `n8n-main` (`EXECUTIONS_MODE=queue`, editor + webhooks) + `n8n-worker` × 1-2 (`n8n worker --concurrency=5..10`), sharing Postgres + Redis (`QUEUE_BULL_REDIS_*`, own key prefix so it doesn't collide with BullMQ) | Once there's real traffic, or when a big video run makes the editor sluggish |
| A3 | Workers move to a **second VM** (same compose image, pointed at the first box's Postgres/Redis over the private VPC) or Postgres moves to RDS | When one 4 GB box is saturated |

Notes:
- Regular-mode n8n already runs executions **concurrently**. Queue mode buys process isolation and horizontal spread, not concurrency itself. That's why it can wait.
- ⚠️ **Binary data in queue mode:** the current `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` isn't supported by n8n across main + workers. The documented alternatives are S3 external storage (an n8n **Enterprise-licensed** feature) or the newer database mode. *Verify against current n8n docs before switching.* The **streaming relay fix in websitePlan.md §3** (pipe S3 → YouTube/LinkedIn in a Code node) avoids this entirely, because the video never lands in n8n binary storage. **Do that fix before enabling queue mode.** It also requires `NODE_FUNCTION_ALLOW_BUILTIN=http,https,url`.
- Platform API rate limits remain the real ceiling (websitePlan.md §5). More workers only add headroom.

---

## 6. When to move to Kubernetes + KEDA

websitePlan.md §5 / Phase 3 targets n8n main + KEDA-autoscaled workers on Kubernetes. That's still the right **end state**, but it's premature at launch:

- EKS costs ~$73/month for the control plane before any node runs, and adds ingress, cert-manager, secrets, storage classes, and KEDA to operate.
- The binding constraint is platform API quotas, enforced in the backend before jobs reach Redis. At low volume, KEDA would mostly scale between 1 and 1.

**Move when any of these hold for a sustained period** (watch the n8n queue depth in Redis and the worker CPU/RAM):
1. n8n queue wait routinely exceeds ~1-2 minutes at peak even with workers on a second VM.
2. Traffic is spiky enough that fixed workers are either idle most of the day or overwhelmed at peak (the case KEDA solves).
3. You need zero-downtime deploys / HA that a single VM can't give (paying customers with an SLA).
4. The ffmpeg render worker needs its own scalable pool.

**Migration path, cheapest first:**
- **k3s on the existing EC2 box(es)** + KEDA: no control-plane fee, same manifests you'd use later.
- **DigitalOcean DOKS** (free control plane) or **EKS** (~$73 + nodes, best fit if staying all-in on AWS). Move Postgres → RDS and Redis → ElastiCache at this point too, since stateful services shouldn't live in the cluster.
- KEDA's Redis scaler targets n8n's Bull wait list (`<prefix>:jobs:wait`, confirm the exact key for your n8n version), min replicas 1, max sized to the API quotas.

---

## 7. Fallback: Railway (if you don't want to manage a server)

- Services: backend (from Dockerfile), frontend (static), Postgres, Redis, n8n (template: main + worker).
- Same-origin: serve the frontend from the backend or a small Caddy service on one Railway domain, so `/api` stays same-origin. Otherwise §9.2 cookies break.
- S3 access needs an IAM user with the media policy and access keys stored as Railway variables. That's a weaker posture than the EC2 instance role.
- Railway's Postgres/Redis are containers with volumes, so set up your own `pg_dump` → S3 backup job.
- Expect ~$20-50/month. Usage-based billing can surprise you during a large video run, so set a usage limit.

---

## 8. Go-live checklist

- [ ] Buy domain; set up DNS (`app`, `n8n`, apex/landing)
- [ ] Landing page with privacy policy, terms, data-deletion endpoint/page
- [ ] Google Search Console domain verification; submit Google OAuth app for verification (YouTube scopes are sensitive, so expect review time)
- [ ] Meta App Review for the required permissions, using production URLs
- [ ] Re-register all OAuth redirect URIs to `https://app.<domain>/api/...`
- [ ] Dockerfiles + `docker-compose.prod.yml` + Caddyfile
- [ ] `infra/app-server.yaml` (EC2, EIP, SG, instance role, SSM)
- [ ] Secrets in SSM/Secrets Manager; remove hardcoded secrets from compose
- [ ] S3 bucket CORS: add the production origin
- [ ] n8n on Postgres, fixed `N8N_ENCRYPTION_KEY`, editor locked down, workflows imported
- [ ] Redis AOF on
- [ ] Nightly `pg_dump` → S3, restore tested
- [ ] Uptime check + AWS Budget alert
- [ ] GitHub Actions deploy pipeline
- [ ] YouTube streaming relay fix (§3) before real video sizes / queue mode
