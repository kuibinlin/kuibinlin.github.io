---
layout: post
title: Run Your Own VPN at Home with PiVPN
description: A step-by-step guide to setting up PiVPN with WireGuard on a Raspberry Pi for secure remote access to your home network.
date: 2026-03-23 12:00:00 +0800
media_subpath: /assets/media/2026/run-your-own-vpn-at-home-with-pivpn
image: pivpn-home-vpn.png
published: true
categories: homelab
tags: [vpn, pivpn, wireguard, homelab, self-hosting, networking]
---

VPN. You've probably heard the term before. Maybe it's the thing you turn on to access your company's intranet from your work laptop. Or maybe you know it as the tool people use when visiting China, where Google services like YouTube, Gmail, and most social media platforms are blocked without one.

So what is a VPN? At its core, a VPN (Virtual Private Network) creates an encrypted tunnel between your device and a server somewhere else. All your internet traffic flows through that tunnel, hidden from anyone in between. The server you connect to becomes your gateway to the internet, so to the outside world, your traffic appears to come from wherever that server is, not from where you actually are.

Most people think of VPNs as something you subscribe to — a commercial service like NordVPN or ExpressVPN. But here's the thing: you can run your own VPN server, right at home, and it opens up a whole set of possibilities that a commercial VPN simply can't offer.

## Why Run a VPN at Home?

There are two major reasons to host your own VPN server at home, and both come down to one thing: extending the security and access of your home network to wherever you are in the world.

### 1. Encrypt Your Traffic on Public Wi-Fi

Imagine you're at a coffee shop, airport, or hotel. You connect to the free Wi-Fi, open your laptop, and start browsing. The problem? That network is shared with strangers, and your traffic is exposed.

With a home VPN, here's what happens instead:

1. Your device connects to the public Wi-Fi as usual.
2. It then establishes an encrypted VPN tunnel back to your home network.
3. All your internet traffic flows through that tunnel — encrypted and unreadable to anyone on the public network.
4. The traffic exits through your home router and goes out to the internet from there.

From the outside, it looks like you're browsing from home. From the coffee shop's perspective, all they see is a single encrypted connection. Your DNS queries, browsing history, login credentials — everything is shielded.

### 2. Access Your Local Network Remotely

Maybe you have a NAS storing family photos, a Home Assistant instance controlling your smart devices, or a self-hosted Jellyfin server. These are all sitting on your local network, and for good reason — you don't want to expose them directly to the internet.

But what if you're overseas, or simply at work, and you need to access them?

A home VPN solves this. Once connected, your phone or laptop behaves as if it's physically on your home network. You can reach any local IP address, access your intranet services, manage IoT devices — all without punching holes in your firewall or exposing services to the public internet.

This is one of the biggest benefits of a home-hosted VPN: secure, private access to your entire home network from anywhere.

---

## Option 1: Use Your Router's Built-in VPN Server

Before buying any extra hardware, check your router. Many modern routers — especially from ASUS, TP-Link, Ubiquiti, or those running OpenWrt — have a built-in VPN server feature. You usually just need to enable it in the admin panel and choose between OpenVPN or WireGuard.

If your router supports this, it's the simplest path. No extra device, no extra power draw. Just configure it, set up a client profile, and you're done.

However, not every router has this feature, and even those that do may have limited performance or configuration options. That's where PiVPN comes in.

---

## Option 2: Set Up PiVPN on a Raspberry Pi (or Any Mini PC)

If your router doesn't support running a VPN server, or you want more control, the next best option is to run [PiVPN](https://www.pivpn.io/) on a small, low-power device like a Raspberry Pi.

PiVPN is a lightweight installer that sets up either WireGuard or OpenVPN on any Debian-based system. It handles all the heavy lifting — key generation, firewall rules, client profile creation — through a simple interactive setup.

### What You Need

- A [Raspberry Pi](https://www.raspberrypi.com/) (any model with Ethernet, though a Pi 4 or Pi 5 is ideal) or any small mini PC.
- A microSD card (16 GB or more).
- A wired Ethernet connection to your router (recommended over Wi-Fi for stability).

### Before You Start: Static IP or DDNS

For a VPN to work from outside your home, your VPN client needs to know where your home is on the internet — which means it needs your home's public IP address. The problem is that most residential ISPs assign a dynamic IP, and it can change without notice. If it does, your VPN config suddenly points to nowhere.

You'll want to sort this out before installing PiVPN, since the installer will ask for your public IP or hostname during setup.

**Static IP** — Some ISPs offer a static (fixed) public IP, sometimes for an extra fee. If you have one, you can use it directly and skip the rest of this section.

**DDNS (Dynamic DNS)** — If you don't have a static IP, a DDNS service is the next best thing. It maps a hostname (like `myhome.ddns.net`) to your current public IP and automatically updates it whenever your IP changes. Many ASUS routers include a free DDNS service built in — look for it under WAN settings in the admin panel. Other popular options include [No-IP](https://www.noip.com/) and [DuckDNS](https://www.duckdns.org/).

Set up your DDNS hostname first, then use it during the PiVPN installation when prompted. That way, even if your ISP changes your IP down the road, your VPN connection will always find its way home.

### Step 1: Install the OS

Flash a Debian-based operating system onto your device:

- **Raspberry Pi OS** — [https://www.raspberrypi.com/software/](https://www.raspberrypi.com/software/)
- **Ubuntu Server** — [https://ubuntu.com/download/server](https://ubuntu.com/download/server)

Use the Raspberry Pi Imager or Balena Etcher to write the image to your SD card. Boot the device, connect it to your network, and make sure you can SSH into it.

### Step 2: Install PiVPN

SSH into your device

Update the package list and upgrade installed packages:

```
sudo apt update && sudo apt full-upgrade -y
```

Run the PiVPN installer:

```bash
curl -L https://install.pivpn.io | bash
```

The interactive wizard will walk you through everything. The key choices are:

- **WireGuard or OpenVPN** — WireGuard is recommended. It's faster, lighter, and easier to manage.
- **Port** — The default for WireGuard is `51820`. You can change it if needed.
- **DNS provider** — You can pick a public DNS like Cloudflare (`1.1.1.1`) or use your own (e.g., Pi-hole).

Once finished, create a client profile:

```bash
pivpn add
```

This generates a `.conf` file (for WireGuard) or `.ovpn` file (for OpenVPN) that you transfer to your phone or laptop.

For full documentation, visit the official PiVPN site: [https://www.pivpn.io/](https://www.pivpn.io/)

### Step 3: Configure Port Forwarding on Your Router

Your VPN server is running, but incoming connections from the internet can't reach it yet. You need to tell your router to forward VPN traffic to your Pi.

Log into your router's admin page and set up a port forwarding rule:

- **External port**: `51820` (or whichever port you chose)
- **Internal IP**: The local IP of your Raspberry Pi (e.g., `192.168.1.100`)
- **Internal port**: `51820`
- **Protocol**: UDP

Now, when you connect to your home's public IP on port `51820`, the traffic will be forwarded to your Pi and into the VPN tunnel.

---

## Wrapping Up

A home VPN is one of the most practical things you can self-host. It keeps your traffic private on untrusted networks, gives you remote access to everything on your local network, and costs almost nothing to run — a Raspberry Pi draws about 5 watts.

Whether you use your router's built-in feature or set up PiVPN on a Pi, the end result is the same: a secure tunnel home, available from anywhere in the world.
