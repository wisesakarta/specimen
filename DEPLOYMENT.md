# Deployment Guide

## Method: GitHub Actions + ghcr.io + Self-hosted Runner

### Why this method

| Concern | Decision |
|---|---|
| Build infrastructure | GitHub Actions (`ubuntu-latest`) — not the home server |
| Container registry | ghcr.io — free, integrated with GitHub, no separate account |
| Deployment trigger | Self-hosted runner on the home server — no public SSH exposure needed |
| Server workload | Pull pre-built image only — no `npm install`, no `npm run build`, no pip |

---

## Architecture

```
git push main
      │
      ▼
GitHub Actions — ubuntu-latest (GitHub infrastructure)
  ├── docker buildx build  (cache: type=gha — incremental on repeat pushes)
  └── docker push → ghcr.io/wisesakarta/specimen:latest + :sha-XXXXXXX
      │
      ▼ (needs: build)
GitHub Actions — self-hosted (home server: wisesa@100.90.222.22)
  ├── git pull origin main
  ├── docker pull ghcr.io/wisesakarta/specimen:latest
  ├── docker compose up -d
  └── docker image prune -f
      │
      ▼
specimen.krtalabs.xyz → localhost:8085
```

**Result:** Server never compiles source code. Deploy time after first run: ~30–60 seconds.

---

## One-time Setup

### Step 1 — Register the self-hosted runner on the home server

On the home server (`ssh wisesa@100.90.222.22`):

```bash
mkdir -p /home/wisesa/actions-runner && cd /home/wisesa/actions-runner
```

Go to the GitHub repository:
**Settings → Actions → Runners → New self-hosted runner → Linux → x64**

Copy and run the three commands shown (they contain a unique registration token):

```bash
# 1. Download
curl -o actions-runner-linux-x64-2.x.x.tar.gz -L https://github.com/actions/runner/releases/...
tar xzf ./actions-runner-linux-x64-2.x.x.tar.gz

# 2. Configure (use defaults for all prompts — runner name, labels, work folder)
./config.sh --url https://github.com/wisesakarta/specimen --token <TOKEN_FROM_GITHUB>

# 3. Install as a systemd service so it survives reboots
sudo ./svc.sh install wisesa
sudo ./svc.sh start
```

Verify the runner is online:
```bash
sudo ./svc.sh status
# GitHub → Settings → Actions → Runners → status should show "Idle"
```

**Requirement:** The `wisesa` user must be in the `docker` group to run Docker without sudo:
```bash
sudo usermod -aG docker wisesa
# Log out and back in for the group change to take effect
```

---

### Step 2 — Make the ghcr.io package visible (after first build)

After the first successful CI run, the package `ghcr.io/wisesakarta/specimen` will appear in GitHub.

To allow the server to pull without authentication (simplest setup):

**GitHub → Profile → Packages → specimen → Package settings → Change visibility → Public**

If you keep it private, add a pull secret on the server:
```bash
# Create a GitHub PAT with read:packages scope, then:
echo "YOUR_PAT" | docker login ghcr.io -u wisesakarta --password-stdin
```

---

### Step 3 — Trigger the first deploy

```bash
# On your dev machine — push any commit to main:
git push origin main
```

GitHub Actions will:
1. Build and push the image to ghcr.io (~4–8 min first time, incremental after)
2. The self-hosted runner pulls and restarts the container automatically

Monitor at: **GitHub → Actions** tab.

---

## Day-to-day Workflow

```bash
# On dev machine — this is the only manual step:
git push origin main
```

Everything else is automated. The Actions tab shows build and deploy progress.

---

## Rollback

List images available on the server:
```bash
docker images ghcr.io/wisesakarta/specimen
```

Roll back to a specific commit SHA:
```bash
cd /home/wisesa/10Projects/active/specimen
IMAGE_TAG=sha-abc1234 docker compose up -d
```

The `docker-compose.yml` uses `${IMAGE_TAG:-latest}` — setting `IMAGE_TAG` overrides which image runs without modifying the file.

---

## Manual Deploy (bypassing CI)

If you need to deploy without pushing to main (e.g., after a server restart):

```bash
ssh wisesa@100.90.222.22
cd /home/wisesa/10Projects/active/specimen
docker compose pull
docker compose up -d
```

---

## Updating App Version / Build Tag

`NEXT_PUBLIC_*` variables are **baked into the JavaScript bundle at compile time** by Next.js. Runtime environment variables in `docker-compose.yml` have no effect on them.

To update the version or build tag:
1. Edit `NEXT_PUBLIC_APP_VERSION` and `NEXT_PUBLIC_APP_BUILD` in `Dockerfile` (lines 14–15)
2. `git push origin main` — CI rebuilds the image with the new values

---

## Monitoring

```bash
# Live logs
docker logs specimen-runtime-prod -f --tail=100

# Resource usage
docker stats specimen-runtime-prod

# Runner service status
sudo /home/wisesa/actions-runner/svc.sh status
```

---

## Infrastructure Reference

| Resource | Value |
|---|---|
| Home server | `wisesa@100.90.222.22` (Tailscale) |
| Active project path | `/home/wisesa/10Projects/active/specimen` |
| Container name | `specimen-runtime-prod` |
| Production port | `8085 → 3000` |
| Container registry | `ghcr.io/wisesakarta/specimen` |
| Runner directory | `/home/wisesa/actions-runner` |
| Production domain | `specimen.krtalabs.xyz` |
