---
layout: post
title: Deploying n8n AI Starter Kit on Raspberry Pi
description: Deploy n8n AI Starter Kit on Raspberry Pi using Docker and Portainer with CPU-only Ollama support.
date: 2025-08-24 18:00:00 +0800
published: true #false or true
categories: n8n
toc: true
media_subpath: /assets/media/2025/deploying-n8n-ai-starter-kit-on-raspberry-pi
image: raspberrypi_n8n.webp
tags: [n8n, pi, docker, portainer]
---

This guide simplifies the [official n8n Self-Hosted AI Starter Kit](https://github.com/n8n-io/self-hosted-ai-starter-kit) for Raspberry Pi. Unlike the original, this setup:

* Works on Raspberry Pi with **Ollama (CPU-only)**.
* Uses **Portainer** for easy stack management.
* Requires **no CPU profile configuration**.
* Strips away unnecessary complexity.

---

## Step 1: Create Docker Volumes

Run the following commands to create persistent storage for your containers:

```bash
docker volume create n8n_storage && \
docker volume create postgres_storage && \
docker volume create qdrant_storage && \
docker volume create ollama_storage
```

If something goes wrong and you need a fresh start, delete the volumes:

```bash
docker volume rm n8n_storage postgres_storage qdrant_storage ollama_storage
```

Also create a shared folder:

```bash
mkdir -p ~/n8n-shared
```

🔹 **Why `n8n-shared`?**
This folder allows you to pass files between n8n workflows and Ollama/Qdrant. For example, you can store prompt files, workflow outputs, or logs in one place accessible by both services.

---

## Step 2: Prepare the `.env` File

Create a `.env` file with the following content:

```ini
POSTGRES_USER=root
POSTGRES_PASSWORD=strongpass
POSTGRES_DB=n8n

N8N_ENCRYPTION_KEY=<secret key>  # Use `openssl rand -hex 32`
N8N_USER_MANAGEMENT_JWT_SECRET=<secret key> # Use `openssl rand -hex 32`

SHARED_FOLDER=/home/<user>/n8n-shared

# Hostname n8n uses to generate webhook & callback URLs.
# Use "localhost" for local dev, replace with your real domain in production.
N8N_DOMAIN=localhost
```

📌 **Notes:**

* Use strong, randomly generated secrets for encryption and JWT.
* Adjust `<user>` in `SHARED_FOLDER` to your actual Linux username.

---

## Step 3: Deploy the Stack in Portainer

1. Go to **Portainer → Stacks → Add Stack**.
2. Paste the following **docker-compose.yaml** into the editor.

```yaml
networks:
  n8nnet:

services:
  # n8n (main app)
  n8n:
    image: n8nio/n8n:latest
    networks: ['n8nnet']
    hostname: n8n
    container_name: n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      # Database connection (Postgres)
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_USER: ${POSTGRES_USER}
      DB_POSTGRESDB_PASSWORD: ${POSTGRES_PASSWORD}
      DB_POSTGRESDB_DATABASE: ${POSTGRES_DB}

      # n8n hardening
      N8N_DIAGNOSTICS_ENABLED: "false"
      N8N_PERSONALIZATION_ENABLED: "false"
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
      N8N_USER_MANAGEMENT_JWT_SECRET: ${N8N_USER_MANAGEMENT_JWT_SECRET}

      # Ollama endpoint
      OLLAMA_HOST: http://ollama:11434

      # Store binary data on filesystem not in Postgres
      N8N_DEFAULT_BINARY_DATA_MODE: filesystem

      # Custom url
      N8N_HOST: ${N8N_DOMAIN}
      N8N_PROTOCOL: https
      WEBHOOK_URL: https://${N8N_DOMAIN}/
      N8N_EDITOR_BASE_URL: https://${N8N_DOMAIN}
      N8N_SECURE_COOKIE: "true"
    volumes:
      - n8n_storage:/home/node/.n8n
      - ${SHARED_FOLDER}:/data/shared
    depends_on:
      postgres:
        condition: service_healthy

  # PostgreSQL (Database for n8n)
  postgres:
    image: postgres:16-alpine
    networks: ['n8nnet']
    hostname: postgres
    container_name: postgres
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_storage:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -h localhost -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
      interval: 5s
      timeout: 5s
      retries: 10

  # Qdrant (vector Database)
  qdrant:
    image: qdrant/qdrant:latest
    networks: ['n8nnet']
    hostname: qdrant
    container_name: qdrant
    restart: unless-stopped
    ports:
      - "6333:6333"
    volumes:
      - qdrant_storage:/qdrant/storage

  # Ollama (CPU only for Raspberry Pi)
  ollama:
    image: ollama/ollama:latest
    networks: ['n8nnet']
    hostname: ollama
    container_name: ollama
    restart: unless-stopped
    ports:
      - "11434:11434"
    volumes:
      - ollama_storage:/root/.ollama

# Tell Compose to use pre-existing Docker volumes with these
# exact names. Compose will NOT create/delete them.
volumes:
  n8n_storage:
    external: true
  postgres_storage:
    external: true
  ollama_storage:
    external: true
  qdrant_storage:
    external: true
```

3. Upload your `.env` file in Portainer.

When creating the stack in **Portainer → Stacks → Add Stack**:

- Scroll down to the **Environment variables** section.
- Toggle **"Upload from file"**.
- Click **Browse** and select your prepared `.env` file from your computer (the one you created in **Step 2**).
- Once uploaded, Portainer will automatically inject those variables into the stack.


4. Deploy the stack.



5. Check all containers are running correctly.

🚨 Troubleshooting Qdrant on Raspberry Pi

If the **Qdrant** container fails to start and the logs show:

```
<jemalloc>: Unsupported system page size
terminate called without an active exception
```

This means your Raspberry Pi is running with **16 KB memory pages** (the Pi 5 default).
Qdrant’s allocator (`jemalloc`) only supports **4 KB pages**, so it aborts immediately.

**Fix:** switch your Pi to the 4 KB-page kernel:

```bash
sudo nano /boot/firmware/config.txt
```

Add near the top (outside any `[section]`):

```ini
kernel=kernel8.img
```

Save, reboot, and verify:

```bash
getconf PAGESIZE   # should show 4096
```

Now Qdrant will run correctly.


---

## Step 4: Open Required Ports

Allow n8n’s UI port (5678) on your server firewall:

```bash
iptables -A INPUT -p tcp --dport 5678 -j ACCEPT
```

⚠️ **Important:**
After modifying `iptables`, you may need to restart Docker. This is because Docker manages iptables rules for container networking, and changes outside may not take effect until Docker reloads its own network configuration.

---

## Step 5: Access n8n

* Without a domain:

  ```
  http://192.168.1.50:5678
  ```
* With **Nginx Proxy Manager (NPM)**:

  ```
  https://n8n.mydomain.com
  ```

👉 If using a domain, ensure you configure **reverse proxy** with SSL in Nginx Proxy Manager.

---

## Step 6: Ollama Endpoint Fix

Inside n8n, set the Ollama endpoint to:

```
http://ollama:11434
```

❌ Do not use `http://localhost:11434`, as localhost resolves inside the n8n container, not on your Raspberry Pi host.

---

## Step 7: Download LLM Models

Your Ollama container is running, but it has **no models yet**. Since we’re on Raspberry Pi (8GB or 16GB RAM), stick to **lightweight models** that balance speed and quality. Avoid large models — they’ll swap and crawl.

### 7.1 Enter the Ollama container

Open a shell in Portainer (**Containers → ollama → Console → /bin/sh**) or from your Pi:

```bash
docker exec -it ollama sh
```

### 7.2 Pull small chat models (choose 1–2 to start)

```bash
# DeepSeek
ollama pull deepseek-r1:1.5b # OR ollama pull deepseek-r1:1.5b-qwen-distill-q4_K_M

# Gemma
ollama pull gemma3:1b  # OR ollama pull gemma3:1b-it-q4_K_M
ollama pull gemma3:1b-it-q8_0

# Qwen
ollama pull qwen3:0.6b
ollama pull qwen3:1.7b # OR ollama pull qwen3:1.7b-q4_K_M
```

### 7.3 Pull embedding models (for Qdrant)

For vector search in Qdrant, install at least one embedding model:

```bash
ollama pull nomic-embed-text:latest
ollama pull bge-m3:latest
ollama pull mxbai-embed-large:latest
```


### 7.4 Verify installed models

```bash
ollama list
```

### 7.5 Quick test (optional)

```bash
ollama run deepseek-r1:1.5b "Write a 2-sentence summary of what n8n does."
```

### 7.6 Manage space (optional)

If you need to remove unused models later:

```bash
ollama rm qwen3:1.7b
```


✅ You now have a **lightweight, Raspberry Pi-optimized AI automation stack** running n8n, Qdrant, Postgres, and Ollama — all managed via Portainer.

