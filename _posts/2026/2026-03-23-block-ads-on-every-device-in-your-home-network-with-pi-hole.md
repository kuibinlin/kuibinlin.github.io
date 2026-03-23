---
layout: post
title: Block Ads on Every Device in Your Home Network with Pi-hole
description: Learn how to set up Pi-hole on a Raspberry Pi to block ads, trackers, and telemetry across all devices on your home Wi-Fi without installing anything on each device.
date: 2026-03-23 15:00:00 +0800
media_subpath: /assets/media/2026/block-ads-with-pihole
image: pihole.png
published: true
categories: homelab
tags:
  [pi-hole, ad-blocker, dns, raspberry-pi, home-network, self-hosted, privacy]
---

We all deal with ads on the internet. They pop up when you're reading the news, they auto-play before a recipe video, and sometimes they take over your entire screen on mobile. Most of us have installed some kind of ad blocker in our browser, and it does the job. But it only works for that one browser, on that one device.

What about your phone apps? Your smart TV? Your kid's tablet? At home, all of these are connected to your Wi-Fi, and they're loaded with ads and trackers that you can't block with a browser extension. Some of them don't even have a browser. They just quietly send data about you in the background, and there's really nothing you can do about it.

Or is there? What if you could block ads and trackers for every single device on your home network, all at once, without installing anything on each device?

That's exactly what Pi-hole does.

## What Is Pi-hole?

[Pi-hole](https://pi-hole.net/) is a network-level ad blocker that acts as a DNS sinkhole. You run it on your home network, and instead of blocking ads inside a single browser, it filters DNS requests for every device connected to your Wi-Fi.

Here's how it works in plain terms:

1. Every time a device in your home tries to load something, whether it's a webpage, an app, or a smart TV dashboard, it first asks a DNS server to translate the domain name (like `ads.trackingcompany.com`) into an IP address.
2. Normally, your home router forwards that request to your ISP's DNS server, which happily resolves everything, including ad and tracking domains.
3. With Pi-hole, you point your home network's DNS to the Pi-hole instead. It checks every request against a blocklist. If the domain is a known ad or tracker, Pi-hole simply refuses to resolve it. The request goes nowhere.
4. Legitimate domains pass through as normal and get resolved by an upstream DNS provider of your choice, like Cloudflare or Google.

The result is that ads, trackers, and telemetry are blocked before they even reach any device in your home. No extensions needed. Every device on your home Wi-Fi benefits automatically: phones, tablets, smart TVs, game consoles, IoT gadgets, everything.

## Why Use Pi-hole?

**Ad blocking without extensions.** It works across all devices on your network, including those that don't support browser extensions like smart TVs, streaming sticks, and mobile apps.

**Faster browsing.** Blocked requests never download, so pages load faster and use less bandwidth. You'd be surprised how much of a typical webpage is just ads and tracking scripts.

**Privacy.** Many apps and devices silently send telemetry and tracking data in the background. Pi-hole gives you visibility into all of this through its dashboard, and blocks what you don't want leaving your network.

**Lightweight.** Pi-hole is incredibly resource-efficient. It runs comfortably on a Raspberry Pi Zero, making it one of the cheapest and most impactful things you can add to a home network.

## How to Set It Up

Pi-hole runs on any Debian-based Linux system. A [Raspberry Pi](https://www.raspberrypi.com/) is the most common choice, but any small machine or even a VM will do.

### 1. Install Pi-hole

SSH into your device and run the one-line installer:

```bash
curl -sSL https://install.pi-hole.net | bash
```

The installer walks you through choosing an upstream DNS provider, setting up blocklists, and configuring the web admin interface. It takes a few minutes at most.

### 2. Point Your Network's DNS to Pi-hole

Once installed, you need to tell your devices to use Pi-hole as their DNS server. The easiest way is to change the DNS setting in your router's DHCP configuration to the local IP of your Pi-hole (e.g., `192.168.1.100`). That way, every device that connects to your network will automatically use Pi-hole, with no per-device configuration needed.

Alternatively, you can set the DNS manually on individual devices if you only want certain ones to go through Pi-hole.

### 3. That's It

Open the Pi-hole admin dashboard (usually at `http://pi.hole/admin` or your device's local IP) and you'll see a live view of every DNS query on your network. You can see what's being allowed, what's being blocked, and which devices are making the requests.

For full documentation, advanced configuration, and blocklist management, visit the official Pi-hole site: [https://pi-hole.net/](https://pi-hole.net/)

## Pi-hole as a Local DNS Server

Beyond ad blocking, Pi-hole also doubles as a local DNS server. This means you can map custom hostnames to devices on your network.

Say your NAS is at `192.168.1.50`, your Home Assistant is at `192.168.1.60`, and your media server is at `192.168.1.70`. Remembering all those IPs gets old fast. With Pi-hole, you can create local DNS records so that `nas.home`, `homeassistant.home`, and `jellyfin.home` all resolve to the right addresses.

You set this up in the Pi-hole admin dashboard under **Local DNS > DNS Records**. Just add a domain and point it to a local IP. No config files to edit.

This is especially handy when you're running multiple self-hosted services. Bookmarking IP addresses with port numbers gets messy quickly. With local DNS entries, you get clean, memorable addresses that work across every device on your network. And if you ever change a device's IP, you update it in one place instead of fixing every bookmark on every device.

## Pi-hole + PiVPN: A Great Combo

If you've already set up [PiVPN](/posts/run-your-own-vpn-at-home-with-pivpn/), Pi-hole pairs with it nicely. During the PiVPN setup, you can point your VPN clients' DNS to your Pi-hole's local IP. That means even when you're away from home and connected through your VPN, all your DNS queries still go through Pi-hole. Ads and trackers get blocked on the go, just like at home.

Both can run on the same Raspberry Pi without any issues.
