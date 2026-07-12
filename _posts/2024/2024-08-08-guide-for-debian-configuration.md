---
title: Simple Guide for Ubuntu/Debian Configuration
description: Essential Ubuntu/Debian configuration guide covering firewall setup, SSH key generation, and sshd security.
date: 2024-08-08 12:00:00 +0800
categories: linux
toc: true
media_subpath: /assets/media/2024/guide-for-debian-configuration
image: ubuntu-config.webp
tags: [linux, ubuntu, debian]
pin: false
math: true
mermaid: true
comments: true
---

### Simple Guide for Ubuntu/Debian Configuration

1. **Set up Firewall**
   ```bash
   sudo apt update
   sudo apt install wget -y
   wget https://raw.githubusercontent.com/linsnotes/iptables-setup/main/configure-iptables.sh
   chmod +x configure-iptables.sh
   sudo ./configure-iptables.sh
   ```

2. **Generate SSH Key on Client Machine**
   ```bash
   ssh-keygen -t rsa -b 4096 -C "comments"
   # Copy the Public Key to the Remote Server
   ```
   
3. **Configure `sshd`**
   ```bash
   sudo nano /etc/ssh/sshd_config.d/mysshd.conf
   # Add or modify configurations as needed, then restart SSH service
   #PermitRootLogin no
   #PasswordAuthentication no
   #KbdInteractiveAuthentication yes
   #UsePAM yes
   #Banner /etc/ssh/sshd_config.d/banner.txt
   #AuthenticationMethods publickey,keyboard-interactive
   ```

   ```bash
   sudo nano /etc/ssh/sshd_config.d/banner.txt

   # copy and paste the following
   *****************************************************************************
   
                                WARNING NOTICE
   
    You are accessing a secure system. This system is for the use of authorized
    users only. All connections are logged and monitored. Any unauthorized
    access or misuse of this system will be prosecuted to the fullest extent
    of the law. If you are not an authorized user, disconnect now.
    
    *****************************************************************************
   ```

4. **Run SSH Login Alert Script**
   ```bash
   wget https://raw.githubusercontent.com/linsnotes/ssh-login-alert/main/ssh-login-alert.sh
   chmod +x ssh-login-alert.sh
   sudo ./ssh-login-alert.sh
   ```

5. **Set Up 2FA**
   ```bash
   sudo apt install libpam-google-authenticator
   google-authenticator
   sudo nano /etc/pam.d/sshd
   # Comment: # @include common-auth
   # Add: auth required pam_google_authenticator.so
   sudo systemctl restart ssh
   ```

6. **Run the WireGuard Script**
   ```bash
   wget https://raw.githubusercontent.com/linsnotes/wireguard-vpn-server-script/main/wgvpn.sh
   chmod +x wgvpn.sh
   sudo ./wgvpn.sh add <client_name>
   ```

7. **Create Aliases**
   ```bash
   sudo nano /etc/profile.d/myaliases.sh
   # Add aliases, make script executable
   sudo chmod +x /etc/profile.d/myaliases.sh
   source /etc/profile.d/myaliases.sh
   ```

### Conclusion
These simplified steps cover the essential configurations for setting up a firewall, SSH key, SSH daemon, SSH login alerts, 2FA, WireGuard VPN, and custom aliases on Ubuntu/Debian.
