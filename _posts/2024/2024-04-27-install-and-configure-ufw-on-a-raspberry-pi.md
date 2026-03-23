---
title: Install and Configure UFW on a Raspberry Pi
description: Set up UFW firewall on Raspberry Pi with practical rules to secure SSH and control network traffic.
date: 2024-04-27 19:00:00 +0800
categories: linux
toc: true
tags: [linux, firewall, ssh]
pin: false
math: true
mermaid: true
comments: true
---

## Install and Configure ufw on a Raspberry Pi

UFW (Uncomplicated Firewall) is a simple and effective way to manage firewall rules on Linux-based systems, including Raspberry Pi. Here's how you can install and configure UFW on a Raspberry Pi to ensure better security:

### 1. Update Your System
Before installing UFW, ensure your system is up-to-date:
```bash
sudo apt update && sudo apt upgrade
```

### 2. Install UFW
Install UFW using the following command:
```bash
sudo apt install ufw
```

### 3. Set Default Policies
It's best to set restrictive default policies and then allow only specific traffic. Set the default policy to deny incoming traffic and allow outgoing traffic:
```bash
sudo ufw default allow outgoing
sudo ufw default deny incoming
```

### 4. Allow SSH Connections
Here's the corrected version:

If you use SSH to connect to your Raspberry Pi, you must allow SSH traffic to avoid locking yourself out:
```bash
sudo ufw allow ssh
```

However, if you connect to your Raspberry Pi via SSH on a different port instead of the default port 22, use the following command:

```bash
sudo ufw allow <your_ssh_port>/tcp comment 'allow-ssh'
```
This command allows TCP traffic on the specified SSH port in UFW, with an added comment for easier identification.



### 5. Add Custom Rules
Depending on your setup, you might need to allow other ports. For example, if you're running a web server, you might want to allow HTTP (port 80) or HTTPS (port 443):
```bash
sudo ufw allow http
sudo ufw allow https
```

### 6. Enable UFW
Enable UFW to start enforcing the firewall rules:
```bash
sudo ufw enable
```
You might be asked to confirm; press `y` and hit `Enter`.

### 7. Check UFW Status
To confirm that UFW is running and to view active rules, use the following command:
```bash
sudo ufw status
```

### 8. Configure Logging
To monitor potential security threats, consider enabling UFW logging:
```bash
sudo ufw logging on
```

### 9. Summary
- **Default Policies**: Set and outgoing traffic to "allow" and incoming traffic to "deny".
- **Specific Rules**: Allow necessary services (like SSH, HTTP, or HTTPS).
- **UFW Status**: Confirm UFW is active and check current rules with `ufw status`.

This setup should provide a good balance of security and accessibility on your Raspberry Pi.

### 10. Verifying SSH Access After Configuring UFW

After you've configured UFW (Uncomplicated Firewall) on your system, it's crucial to ensure your changes haven't inadvertently blocked SSH access. Follow these steps to confirm your SSH connection still works:

1). **Keep the Original Terminal Open**  
   After setting up UFW, do not close the current terminal. This ensures you can make further adjustments if needed.

2). **Open a New Terminal**  
   Open a separate terminal window. This provides an isolated environment to test your SSH connection without affecting the original configuration session.

3). **Test Your SSH Connection**  
   In the new terminal, attempt to connect to the remote server using SSH. If you can connect as usual, your UFW configuration is working correctly.

4). **Handle Connection Failures**  
   If the SSH connection fails, return to the original terminal. You can use this terminal to adjust your UFW rules and correct any misconfigurations that might have blocked SSH access.

5). **Close the Original Terminal Only After Successful SSH Connection**  
   Once you've confirmed that SSH works properly, it's safe to close the original terminal.

By following these steps, you can confidently test your SSH access after configuring UFW without risking getting locked out of your system.
