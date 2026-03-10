---
layout: post
title: Open WebUI Self-Hosted Setup Guide (Docker + Ollama + PostgreSQL on Ubuntu)
date: 2026-03-10 08:10:00 +0800
published: true #false or true
categories: local-llm
toc: true
media_subpath: /assets/media/2026/open-webui-self-hosted-setup-guide
image: openwebui.png
tags: [llm, openwebui, ollama]
---

A minimal guide to running [Open WebUI](https://github.com/open-webui/open-webui) on a Linux (Ubuntu) server using a single `docker-compose.yml`, with Ollama running on the host and PostgreSQL as the database backend.

---

## Requirements

- Ubuntu Linux server
- [Docker](https://docs.docker.com/engine/install/ubuntu/) installed
- [Ollama](https://ollama.com/download/linux) installed on the **host** (not as a container)

> **Why host-based Ollama?**  
> Running Ollama directly on the host avoids the complexity of GPU passthrough, device mounts, and container-specific Ollama configuration. The WebUI container reaches it via `host.docker.internal`.

---

## 1. Install Ollama on the Host

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Expose Ollama to Docker containers

By default Ollama only listens on `127.0.0.1`. The WebUI container needs to reach it, so bind Ollama to all interfaces.

Edit the systemd service override:

```bash
sudo systemctl edit ollama
```

Add the following and save:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

Restart the service:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

---

## 2. Open Required Firewall Ports

| Port | Purpose |
|------|---------|
| `11434` | Ollama API — Docker container → host |
| `3000` | Open WebUI — browser → server |

```bash
sudo ufw allow 11434
sudo ufw allow 3000
```

---

## 3. Create the Project Directory

```bash
mkdir -p ~/docker/open-webui
cd ~/docker/open-webui
```

---

## 4. Create `docker-compose.yml`

```bash
nano docker-compose.yml
```

Paste in the following, then save with `Ctrl+O` → `Enter` and exit with `Ctrl+X`.

```yaml
networks:
  open-webui-net:
    name: open-webui-net

services:
  postgres:
    image: postgres:18
    container_name: open-webui-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - open-webui-pgdata:/var/lib/postgresql
    networks:
      - open-webui-net

  open-webui:
    image: ghcr.io/open-webui/open-webui:${WEBUI_TAG}
    container_name: open-webui
    restart: unless-stopped
    ports:
      - "${WEBUI_PORT}:8080"
    environment:
      WEBUI_SECRET_KEY: ${WEBUI_SECRET_KEY}
      WEBUI_AUTH: ${WEBUI_AUTH}
      WEBUI_ADMIN_EMAIL: ${WEBUI_ADMIN_EMAIL}
      WEBUI_ADMIN_PASSWORD: ${WEBUI_ADMIN_PASSWORD}
      # ENABLE_SIGNUP: ${ENABLE_SIGNUP}
      # DEFAULT_USER_ROLE: ${DEFAULT_USER_ROLE}
      CORS_ALLOW_ORIGIN: ${CORS_ALLOW_ORIGIN}
      OLLAMA_BASE_URL: ${OLLAMA_BASE_URL}
      DATABASE_URL: ${DATABASE_URL}
      HF_TOKEN: ${HF_TOKEN}
      USER_AGENT: ${USER_AGENT}
    volumes:
      - open-webui:/app/backend/data
    extra_hosts:
      - host.docker.internal:host-gateway
    depends_on:
      - postgres
    networks:
      - open-webui-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

volumes:
  open-webui:
    external: true
  open-webui-pgdata:
    external: true
```

---

## 5. Create `.env`

Use `.env.example` below as reference. Create your actual `.env` in the same directory:

```bash
nano .env
```

Fill in all required values (see the reference below), then save with `Ctrl+O` → `Enter` and exit with `Ctrl+X`.

### `.env.example`

```dotenv
# -------------------------------------------------------
# Open WebUI
# -------------------------------------------------------

# Port exposed on the host
WEBUI_PORT=3000

# Pin to a specific release tag — do not use "main" in production
# Check the version in the github repo: https://github.com/open-webui/open-webui
WEBUI_TAG=v0.8.10

# Generate a strong random string: openssl rand -hex 32
WEBUI_SECRET_KEY=

# First-run admin account — only used on initial startup
# If no admin exist in DB, this admin account is created automatically
WEBUI_ADMIN_EMAIL=
WEBUI_ADMIN_PASSWORD=

# Auth settings
WEBUI_AUTH=true

# Allow sign up, new users are assigned the 'user' role
# ENABLE_SIGNUP=true
# DEFAULT_USER_ROLE=user

# Only required if exposing via a public domain through Cloudflare Tunnel.
# Internally, traffic is routed via Pi-hole DNS + Nginx Proxy Manager.
# Set this to your public-facing domain (no trailing slash).
# e.g. https://chat.yourdomain.com
CORS_ALLOW_ORIGIN=

# HuggingFace API token — required only if downloading private or gated models
HF_TOKEN=

# Identifies this instance in HTTP request headers sent to external services
USER_AGENT=

# -------------------------------------------------------
# Ollama Backend
# -------------------------------------------------------

OLLAMA_BASE_URL=http://host.docker.internal:11434

# -------------------------------------------------------
# PostgreSQL
# -------------------------------------------------------

POSTGRES_USER=openwebui

# Generate a strong password: openssl rand -hex 24
POSTGRES_PASSWORD=

POSTGRES_DB=openwebui_db

# Must stay in sync with the three values above
# Format: postgresql://[POSTGRES_USER]:[POSTGRES_PASSWORD]@postgres:5432/[POSTGRES_DB]
DATABASE_URL=postgresql://xxxxxx:yyyyyyy@postgres:5432/zzzzzzz
```

### Key values to fill in

| Variable | How to generate / what to set |
|----------|-------------------------------|
| `WEBUI_SECRET_KEY` | `openssl rand -hex 32` |
| `WEBUI_ADMIN_EMAIL` | Your admin login email |
| `WEBUI_ADMIN_PASSWORD` | A strong password |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `DATABASE_URL` | Replace `xxxxxx`, `yyyyyyy`, `zzzzzzz` with your `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |

> `WEBUI_ADMIN_EMAIL` and `WEBUI_ADMIN_PASSWORD` are only used on the **very first startup** to seed the admin account. If an admin already exists in the database, these values are ignored.

---

## 6. Create Docker Volumes

The `docker-compose.yml` declares both volumes as `external: true`, so they must exist before the stack starts. Run this once:

```bash
docker volume create open-webui
docker volume create open-webui-pgdata
```

---

## 7. Start the Stack

Make sure you are in the project directory (`~/docker/open-webui`) and both files are present:

```bash
ls
# docker-compose.yml  .env
```

Then bring up the stack:

```bash
docker compose up -d
```

Check that both containers are running:

```bash
docker compose ps
```

Tail the logs to confirm a clean startup:

```bash
docker compose logs -f open-webui
```

Look for a line indicating the server is listening (e.g. `Uvicorn running on http://0.0.0.0:8080`). The healthcheck gives the container up to 30 seconds before it starts probing.

---

## 8. Access Open WebUI

Open a browser and navigate to:

```
http://<your-server-ip>:3000
```

On first load, the admin account you set in `.env` is automatically created. Log in with `WEBUI_ADMIN_EMAIL` and `WEBUI_ADMIN_PASSWORD`.

---

## Useful Commands

| Task | Command |
|------|---------|
| Stop the stack | `docker compose down` |
| Restart a single service | `docker compose restart open-webui` |
| Pull latest images | `docker compose pull` |
| View live logs | `docker compose logs -f` |
| Check Ollama is reachable | `curl http://localhost:11434` (from host) |

---

## Troubleshooting

**WebUI can't reach Ollama**  
Confirm Ollama is bound to `0.0.0.0` (`sudo systemctl show ollama | grep Environment`) and that port `11434` is open in the firewall.

**Container exits immediately**  
Check `docker compose logs postgres` — a missing or mismatched `DATABASE_URL` is the most common cause.

**Admin account not created on first boot**  
Ensure `WEBUI_AUTH=true` and that `WEBUI_ADMIN_EMAIL` / `WEBUI_ADMIN_PASSWORD` are set before the *first* `docker compose up`. They have no effect after the initial database seed.
