---
layout: post
title: Setting up a Travel Router with VPN Back to Your Home Network
description: Configure GL.iNet travel router with WireGuard VPN to securely route traffic through your home network while travelling.
date: 2025-05-11 12:00:00 +0800
published: true #false or true
categories: router
toc: true
media_subpath: /assets/media/2025/setting-up-a-travel-router-with-vpn-back-to-your-home-network
image: travel_router_vpn_guide.webp
tags: [router, travel, vpn, wireguard]
---


## **Why You Might Want to Do This**

Your GL.iNet travel router is capable of much more than simply repeating hotel or public Wi-Fi. Without a VPN, it passes traffic from those networks directly to your devices — traffic that **might be unencrypted** or exposed.

While it’s convenient — your devices only need to connect to your travel router's SSID once — public networks (hotels, airports, cafés) **might not be secure**. The travel router acts as a **middle layer**, handling the Wi-Fi login and sharing connectivity with all your devices, but it doesn’t protect your traffic unless you enable a VPN.

Some countries also restrict access to websites like Google, YouTube, or social platforms. A VPN helps bypass such restrictions by routing your traffic securely through your home network.

If you also run a **Pi-hole DNS server at home**, you can route all DNS queries through it to block ads, trackers, and log DNS usage — further increasing privacy.

---

This guide will show you how to:

* Configure WireGuard VPN on your GL.iNet router.
* Set up a **guest network** to isolate untrusted devices.
* Add **firewall rules** to prevent guests from accessing your home network.
* *(Optional)* Allow guests to use your home DNS server securely over the VPN.

---

## **What You'll Need**

* **GL.iNet Travel Router**
  *(e.g., GL.iNet Slate 7 (GL-BE3600): [product link](https://www.gl-inet.com/products/gl-be3600/)*)
* A **home VPN server** running WireGuard
  *(This guide assumes you host your own VPN. Not intended for commercial VPNs. See [Run Your Own VPN at Home with PiVPN](/posts/run-your-own-vpn-at-home-with-pivpn/) for a setup guide.)*
* WireGuard client configuration that **allows LAN access and DNS routing**
* *(Optional)* A **Pi-hole** or other DNS server running at home

---

## **Step 1: Set Up WireGuard VPN Client on the GL.iNet Router**

### Goal:

Securely route all internet traffic through your **home network** — so your connection appears as if you’re browsing from home, even when travelling.

> Example: If you’re in a hotel in China, but your VPN server is in the UK, using the VPN allows you to access YouTube, Gmail, or any content restricted locally.

---

### Instructions:

1. **Power on your GL.iNet router.**
2. Connect to the router’s Wi-Fi from your laptop or mobile (the SSID and password are printed on the device).
3. Open a browser and go to `http://192.168.8.1` to access the router’s web interface.
4. Navigate to **VPN > WireGuard Client**.
5. Click **“Add a New VPN Configuration”**, assign a name, and import or paste your WireGuard config. Example:

```ini
[Interface]
PrivateKey = <your private key>
Address = 10.0.0.100/24
DNS = 192.168.1.80

[Peer]
PublicKey = <your home server public key>
PresharedKey = <optional preshared key>
Endpoint = yourhome.ddns.net:51820
AllowedIPs = 0.0.0.0/0, ::0/0
```

* `DNS = 192.168.1.80`: points to your **home Pi-hole server**
* `Endpoint`: use your home’s static IP or a dynamic DNS address

6. Click **Save**, then **Connect**.

Now all devices connected to the GL.iNet router will tunnel their internet traffic securely through your home.

---

### Optional: Set the Physical Toggle Switch for VPN

1. Go to **System > Toggle Button Settings**.
2. Assign the toggle switch to **WireGuard Client (on/off)**.

This allows quick VPN control via a physical switch on the router.

---

## **Step 2: Enable the Guest Network (Highly Recommended)**

### Goal:

Isolate less secure or guest devices from your own — such as family phones, smart TVs, or IoT devices.

---

### Instructions:

1. In the GL.iNet interface, go to **Wireless > Guest Wi-Fi**.
2. Enable the **Guest SSID**.
3. Navigate to **Network > Guest Network**, and ensure **Client Isolation** is **ON**.

> **Why this is important:** Devices on the guest network cannot see each other or access the router interface. This prevents accidental or malicious access to your own devices.

---

## **Step 3: Block Guest Clients from Accessing Your Home Network via VPN**

### Problem:

Even though guests are isolated locally, traffic from the guest network **still goes through the VPN** — meaning they could access your home LAN (e.g., `192.168.x.x`, `10.x.x.x`, `172.16.x.x`) if not blocked.

---

### Solution:

Use a firewall rule to block all guest traffic going to common private IP ranges via VPN.

---

### Instructions (in LuCI interface):

1. Go to **System > Advanced Settings** to open LuCI.
2. Navigate to **Network > Firewall > Traffic Rules**.
3. Click **Add**, and fill in:

| Field                   | Value                                       |
| ----------------------- | ------------------------------------------- |
| **Name**                | Block Guest to Home Network                 |
| **Protocol**            | TCP + UDP                                   |
| **Source zone**         | `guest`                                     |
| **Source address**      | leave blank                                 |
| **Source port**         | any                                         |
| **Destination zone**    | `wgclient` (your VPN zone)                  |
| **Destination address** | `192.168.0.0/16, 172.16.0.0/12, 10.0.0.0/8` |
| **Destination port**    | any                                         |
| **Action**              | Drop                                        |

Click **Save & Apply**.

> **Why this is important:** This ensures guest devices can access the internet via the VPN, but not your home network — protecting your NAS, printers, or internal services.

---

## **Step 4: *(Optional)* Allow Guest Access to Your Home DNS Server (Pi-hole)**

### Only do this if:

You want guest devices to use your **home DNS server** (e.g., Pi-hole) for DNS filtering and logging, rather than public DNS (e.g., Google or Cloudflare).

---

### (A): Edit the Default GL.iNet DNS Forwarding Rules

1. Go to **LuCI > Network > Firewall > Port Forwards**.
2. Edit the following two rules:

   * `dns for vpn` → source zone: `lan`
   * `dns for vpn guest` → source zone: `guest`
3. Update:

   | Field                   | Value                        |
   | ----------------------- | ---------------------------- |
   | **Internal IP address** | `192.168.1.x` (your Pi-hole) |
   | **Internal port**       | `53`                         |

---

### (B): Add a Traffic Rule to Allow Guest DNS

1. Go to **Network > Firewall > Traffic Rules**.
2. Click **Add**, and fill in:

| Field                | Value                           |
| -------------------- | ------------------------------- |
| **Name**             | Allow Guest DNS to Pi-hole      |
| **Protocol**         | TCP + UDP                       |
| **Source zone**      | `guest`                         |
| **Source address**   | leave blank                     |
| **Source port**      | any                             |
| **Destination zone** | `wgclient`                      |
| **Destination IP**   | `192.168.1.x` (your Pi-hole IP) |
| **Destination port** | `53`                            |
| **Action**           | Accept                          |

Click **Save & Apply**.

> **Why this is useful:** This ensures guest clients can use your home DNS server for name resolution — without giving them access to anything else in your home network.

---

### **Understanding Firewall Rule Order**

* **You do not need to reorder firewall rules manually.**
* OpenWrt (used by GL.iNet) processes rules based on **specificity**, not visual order.

Example:

* A rule that allows DNS to `192.168.1.80:53` will **override** a broader block to `192.168.0.0/16`.
* If you remove the allow rule, the block rule takes full effect.

---

## ✅ Final Outcome

* ✅ A secure travel router that encrypts all traffic via your **home VPN**
* ✅ A guest network that protects your trusted devices
* ✅ A firewall that blocks guests from accessing your home LAN
* ✅ *(Optional)* Controlled DNS routing for better privacy and filtering
* ✅ Easy control via a toggle switch for the VPN
