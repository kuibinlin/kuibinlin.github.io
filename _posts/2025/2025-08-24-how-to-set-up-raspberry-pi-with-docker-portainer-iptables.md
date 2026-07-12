---
layout: post
title: How to Set Up Raspberry Pi with Docker, Portainer & iptables
description: Set up Raspberry Pi as a Docker homelab server with Portainer management interface and iptables firewall rules.
date: 2025-08-24 00:10:00 +0800
published: true #false or true
categories: raspberrypi
toc: true
media_subpath: /assets/media/2025/how-to-set-up-raspberry-pi-with-docker-portainer-iptables
image: raspberrypi_docker.webp
tags: [pi, docker, portainer, iptables]
---

Raspberry Pi has come a long way from being just a tinkering board. The latest models pack up to **16GB of RAM**, making them powerful enough to act as a lightweight **Docker server** capable of running multiple containers. Setting up a Raspberry Pi as part of your **homelab** is an excellent way to learn about servers, containers, and network security in a low-power, cost-effective environment.

With **Docker** and **Portainer** installed, you can quickly deploy and manage applications through both the command line and a clean web interface. By adding **iptables firewall rules**, you’ll ensure your system is secure, protecting your services while still giving you full control over what to expose.

This guide will walk you through:

1. Setting up Raspberry Pi OS
2. Configuring cooling, networking, and security
3. Installing Docker and Portainer
4. Setting up firewall rules with iptables

---

## Part 1 – Raspberry Pi OS Setup

### Step 1 – Download Raspberry Pi Imager

Download the official Raspberry Pi Imager:
👉 [Raspberry Pi Software](https://www.raspberrypi.com/software/)

---

### Step 2 – Flash the OS to the SD Card

Use the Raspberry Pi Imager to flash the OS. During setup, configure:

* ✅ Enable SSH
* ✅ Set Wi-Fi SSID & password
* ✅ Set hostname
* ✅ Create username & password

---

### Step 3 – Boot the Raspberry Pi

Insert the SD card into the Raspberry Pi and power it on.

---

### Step 4 – Update the System

Run the following to update all packages:

```bash
sudo apt update && sudo apt upgrade -y
```

---

### Step 5 – Configure Fan, Wi-Fi, and Bluetooth

Edit the configuration file:

```bash
sudo nano /boot/firmware/config.txt
```

Add these lines at the bottom:

```ini
[all]
# Fan control settings
dtparam=fan_temp0=35000
dtparam=fan_temp0_hyst=5000
dtparam=fan_temp0_speed=175

# Disable Wi-Fi
dtoverlay=disable-wifi

# Disable Bluetooth
dtoverlay=disable-bt
```

Save, exit, and reboot.

---

### Step 6 – Assign a Static IP

#### 1. List connections

```bash
nmcli connection show
```

Find the connection linked to `eth0` (e.g., *Wired connection 1*).

#### 2. Set static IP

Replace `<conn-name>` with your connection name:

```bash
sudo nmcli connection modify "<conn-name>" ipv4.addresses 192.168.1.50/24
sudo nmcli connection modify "<conn-name>" ipv4.gateway 192.168.1.1
sudo nmcli connection modify "<conn-name>" ipv4.dns 8.8.8.8
sudo nmcli connection modify "<conn-name>" ipv4.method manual
```

#### 3. Apply changes

```bash
sudo nmcli connection down "<conn-name>"
sudo nmcli connection up "<conn-name>"
```

⚠️ **Warning:** If you’re on SSH, you’ll be disconnected after `down`.

#### 4. Verify IP

```bash
ip addr show eth0
```

#### 5. Test internet

```bash
ping google.com
```

---

## Part 2 – Install Docker

Follow the official Docker guide:
👉 [Install Docker Engine](https://docs.docker.com/engine/install/debian/)

Then complete the post-install steps:
👉 [Linux Post-Installation Guide](https://docs.docker.com/engine/install/linux-postinstall/)

---

## Part 3 – Install Portainer

### What is Portainer?

Portainer is a simple web UI for managing Docker containers. It makes it much easier for beginners to deploy and monitor containers without using only the command line.

👉 [Portainer Official Guide](https://docs.portainer.io/start/intro)

💡 **Note:** Portainer Business Edition (BE) includes a free plan for up to 3 nodes.

---

## Part 4 – Configure iptables Firewall

Use the following script to secure your system with iptables:

```bash
# Check if the script is being run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root or with sudo"
  exit 1
fi

# Function to prompt for persistent firewall installation
install_persistent() {
  read -p "iptables-persistent/iptables-services not installed. Install now? (yes/no): " choice
  case "$choice" in
    y|Y|yes|Yes )
      if [ -x "$(command -v apt-get)" ]; then
        apt-get update && apt-get install -y iptables-persistent || { echo "Installation failed."; exit 1; }
      elif [ -x "$(command -v yum)" ]; then
        yum install -y iptables-services || { echo "Installation failed."; exit 1; }
      else
        echo "Unknown package manager. Install manually."
        exit 1
      fi
      ;;
    * )
      echo "Skipping installation. Rules won’t persist after reboot."
      ;;
  esac
}

# Detect system type
if [ -x "$(command -v dpkg-query)" ]; then
  SYSTEM="debian"
  dpkg-query -W iptables-persistent &>/dev/null || install_persistent
elif [ -x "$(command -v rpm)" ]; then
  SYSTEM="redhat"
  rpm -q iptables-services &>/dev/null || install_persistent
else
  echo "Unsupported system."
  exit 1
fi

# Reset existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
iptables -t raw -F
iptables -t raw -X

# Default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# SSH protection
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -m recent --set --name SSH
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -m recent --update --seconds 60 --hitcount 4 --name SSH -j DROP
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Optional: Web traffic
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Optional: Portainer ports
iptables -A INPUT -p tcp --dport 81 -j ACCEPT
iptables -A INPUT -p tcp --dport 9443 -j ACCEPT

# Logging
iptables -A INPUT -m limit --limit 5/min --limit-burst 10 -j LOG --log-prefix "iptables denied: " --log-level 7

# Save configuration
if [ "$SYSTEM" == "debian" ]; then
  iptables-save > /etc/iptables/rules.v4
elif [ "$SYSTEM" == "redhat" ]; then
  service iptables save
fi

echo "iptables rules configured and saved."
echo "Check with: sudo iptables -L -v"
```

---

✅ **At this point your Raspberry Pi should be:**

* Running the latest OS
* Secured with a firewall
* Ready with Docker & Portainer

