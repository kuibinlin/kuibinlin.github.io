---
layout: post
title: How to Safely Backup and Restore Nginx Proxy Manager in Docker
description: Back up and restore Nginx Proxy Manager Docker containers with SSL certificates and configurations safely.
date: 2025-08-24 00:20:00 +0800
published: true #false or true
categories: raspberrypi
toc: true
media_subpath: /assets/media/2025/how-to-safely-backup-and-restore-nginx-proxy-manager-in-docker
image: nginx.webp
tags: [pi, docker, portainer, nginx]
---

## What is Nginx Proxy Manager?

[Nginx Proxy Manager (NPM)](https://nginxproxymanager.com/) is a lightweight, web-based interface that simplifies managing **reverse proxies**, **SSL certificates**, and **domain routing** using Docker.

Homelab enthusiasts love NPM because:

* It makes hosting multiple web services behind one IP address easy.
* It automates **Let's Encrypt SSL certificates**.
* It provides a **friendly web UI** instead of complex Nginx config files.

Because it often handles **SSL certificates and domain configurations**, losing its data can mean downtime and reconfiguration headaches. That’s why having a proper **backup and restore process** is critical.

---

## Step 1: Create Volumes on the New Server

When moving to a new server (where Docker is already installed), recreate the required Docker volumes:

```bash
docker volume create npm_data
docker volume create npm_letsencrypt
```

These will hold configuration data and SSL certificates.

---

## Step 2: Back Up from the Old Server

Stop the running container and back up the NPM volumes into `.tar` files.

```bash
#!/bin/bash

# Stop the container (‘npm-app-1’ is the container name)
docker stop npm

# Backup npm_data
docker run --rm -v npm_data:/data -v /home/pi:/backup alpine \
  sh -c "cd /data && tar cvf /backup/npm_data_backup.tar ."

# Backup npm_letsencrypt
docker run --rm -v npm_letsencrypt:/etc/letsencrypt -v /home/pi:/backup alpine \
  sh -c "cd /etc/letsencrypt && tar cvf /backup/npm_letsencrypt_backup.tar ."

# Restart container
docker start npm
```

---

## Step 3: Transfer Backup Files to the New Server

Use **`scp`** to securely move backup archives between servers.

### Local → Remote

```bash
scp /home/pi/npm_data_backup.tar username@remote_host:/home/username/
scp /home/pi/npm_letsencrypt_backup.tar username@remote_host:/home/username/
```

### Remote → Local

```bash
scp username@remote_host:/home/username/npm_data_backup.tar /home/pi/
```

### Direct Server → Server

```bash
scp user1@server1:/home/pi/npm_data_backup.tar user2@server2:/home/username/
```

✅ Add `-r` for recursive directories.
✅ Add `-P <port>` if using a non-default SSH port.

---

## Step 4: Restore Volumes on the New Server

Now restore the archives directly into the Docker volumes:

```bash
# Restore npm_data
cat ~/npm_data_backup.tar | docker run --rm -i -v npm_data:/restore alpine \
  sh -c "cd /restore && tar xpf -"

# Restore npm_letsencrypt
cat ~/npm_letsencrypt_backup.tar | docker run --rm -i -v npm_letsencrypt:/restore alpine \
  sh -c "cd /restore && tar xpf -"
```

### What’s happening here:

* `cat ~/npm_data_backup.tar` → Reads the archive.
* `|` → Pipes the data into the container.
* `docker run ... alpine sh -c ...` → Runs a tiny Alpine container to extract.
* `-v npm_data:/restore` → Mounts the target Docker volume.
* `tar xpf -` → Extracts the archive preserving file permissions.

Result: Your backup is unpacked directly into the named Docker volume.

---

## Step 5: Redeploy Nginx Proxy Manager

Use Docker Compose (example below shows Portainer setup):

```yaml
services:
  app:
    image: 'jc21/nginx-proxy-manager:latest'
    container_name: npm
    restart: unless-stopped
    ports:
      # These ports are in format <host-port>:<container-port>
      - '80:80' # Public HTTP Port
      - '443:443' # Public HTTPS Port
      - '81:81' # Admin Web Port
      # Add any other Stream port you want to expose
      # - '21:21' # FTP

    # Uncomment the next line if you uncomment anything in the section
    environment:
      # Uncomment this if you want to change the location of
      # the SQLite DB file within the container
      # DB_SQLITE_FILE: "/data/database.sqlite"

      # Uncomment this if IPv6 is not enabled on your host
      DISABLE_IPV6: 'true'

    volumes: 
      - npm_data:/data
      - npm_letsencrypt:/etc/letsencrypt

# tell Compose use pre-existing Docker volumes with these exact names don’t create or delete them
volumes:
  npm_data:
    external: true
  npm_letsencrypt:
    external: true
```

The `external: true` ensures Compose uses the restored volumes instead of overwriting them.

---

## ✅ Final Notes

* Always **stop containers** before backing up.
* Test the **restore process** on a staging server if possible.
* Automate backups with cron jobs for peace of mind.

---



