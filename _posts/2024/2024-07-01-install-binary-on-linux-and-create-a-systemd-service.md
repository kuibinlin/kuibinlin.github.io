---
title: Guide to Install a Binary on Linux and Create a Systemd Service
description: Download, install Linux binaries, and create systemd services to manage them automatically. Example uses Cloudflared.
date: 2024-07-01 12:00:00 +0800
categories: linux
toc: true
media_subpath: /assets/media/2024/install-binary-on-linux
image: systemd-cloudflare.webp
tags: [linux, cloudflare, systemd]
pin: false
math: true
mermaid: true
comments: true
---


### Guide to Install a Binary on Linux and Create a Systemd Service

This guide will walk you through the process of downloading and installing a binary on a Linux system, setting the appropriate permissions, and creating a systemd service to manage the binary. For this example, we'll use the `cloudflared` binary for the arm64 architecture.

#### Step 1: Download and Install the Binary

1. **Download the binary:**
   ```bash
   wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
   ```
   
   - **Why use `wget`?**
     `wget` is a command-line utility used to download files from the web. It's simple and effective for downloading a single file via HTTP, HTTPS, or FTP protocols.
   - **Can you use other commands like `curl`?**
     Yes, you can use `curl` as well. `curl` is another powerful tool for transferring data with URLs. For example, the equivalent command with `curl` would be:
   ```bash
   curl -LO https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
   ```
     - **Explanation of `-LO`:**
       - `-L` tells `curl` to follow redirects. This is useful if the URL points to a location that redirects to another URL.
       - `-O` tells `curl` to save the file with the same name as the remote file.


3. **Move the binary to `/usr/local/bin`:**
   ```bash
   sudo mv -f ./cloudflared-linux-arm64 /usr/local/bin/cloudflared
   ```
   - **Why move to `/usr/local/bin`?**
     The `/usr/local/bin` directory is commonly used for storing user-installed binaries. This directory is included in the system's `PATH` environment variable, allowing you to run the binary from anywhere in the terminal without specifying its full path.
   - **Why use `-f` when running `sudo mv -f ./cloudflared-linux-arm64 /usr/local/bin/cloudflared`?**
     The `-f` option forces the `mv` command to overwrite the destination file if it already exists. This ensures that the new binary replaces any existing one without prompting.


5. **Make the binary executable:**
   ```bash
   sudo chmod +x /usr/local/bin/cloudflared
   ```
   
   - **Why make the binary executable?**
     Changing the file's permissions to make it executable allows the operating system to run it as a program.


6. **Verify the installation:**
   ```bash
   cloudflared -v
   ```
   
   - **Why can you start using `cloudflared` after making it executable?**
     Once the binary is executable and placed in a directory that's part of the system's `PATH`, you can run it from the command line. Verifying the installation ensures that the binary is correctly installed and functioning.



#### Step 2: Create a System User for the Binary

1. **Create a system user with no login access:**
   ```bash
   sudo useradd -s /usr/sbin/nologin -r -M cloudflared
   ```
   - **What is a system user?**
     A system user is a user account created for running system processes or services, rather than for interactive login by human users.
   - **What is `nologin` access?**
     Using `nologin` for the shell means the user cannot log in interactively, which enhances security by preventing potential misuse of the account.
   - **Explanation of `-s`, `-r`, and `-M`:**
     - `-s /usr/sbin/nologin`: Sets the user's shell to `nologin`, preventing interactive logins.
     - `-r`: Creates a system account, typically with a UID lower than 1000.
     - `-M`: Prevents the creation of a home directory for the user.


#### Step 3: Configure the Binary

1. **Create and edit the configuration file:**
   ```bash
   sudo nano /etc/default/cloudflared
   ```

   **Example configuration:**
   ```ini
   # Commandline args for cloudflared, using Cloudflare DNS
   CLOUDFLARED_OPTS=--port 5053 --upstream https://1.1.1.1/dns-query --upstream https://1.0.0.1/dns-query
   ```
   
   - **What is `/etc/default` directory for?**
     The `/etc/default` directory is used to store configuration files for various system services. These files typically define environment variables and command-line options.



3. **Set the appropriate permissions for the configuration file and the binary:**
   ```bash
   sudo chown cloudflared:cloudflared /etc/default/cloudflared
   sudo chown cloudflared:cloudflared /usr/local/bin/cloudflared
   ```
   - **Why set owner and group to `cloudflared`?**
     Changing the ownership ensures that only the `cloudflared` user has the necessary permissions to read and execute the binary, enhancing security.



#### Step 4: Create a Systemd Service

1. **Create and edit the systemd service file:**
   - **What is `/etc/systemd/system/` directory for?**
     This directory is used to store service unit files that define systemd services. These files control how services are started, stopped, and managed on the system.

   ```bash
   sudo nano /etc/systemd/system/cloudflared.service
   ```

   **Service file configuration:**

   ```ini
   [Unit]
   Description=cloudflared DNS over HTTPS proxy
   After=syslog.target network-online.target

   [Service]
   Type=simple
   User=cloudflared
   EnvironmentFile=/etc/default/cloudflared
   ExecStart=/usr/local/bin/cloudflared proxy-dns $CLOUDFLARED_OPTS
   Restart=on-failure
   RestartSec=10
   KillMode=process

   [Install]
   WantedBy=multi-user.target
   ```

   **Explanation of the directives:**
   - **[Unit]**
     - **Description**: Describes the service.
     - **After**: Specifies the service dependencies. The service will start after the listed targets.
   - **[Service]**
     - **Type**: Defines the service type. `simple` means the service will be considered started right after the `ExecStart` command is executed.
     - **User**: The user under which the service will run.
     - **EnvironmentFile**: Specifies the file containing environment variables.
     - **ExecStart**: The command to start the service.
     - **Restart**: Defines the restart policy. `on-failure` restarts the service if it fails.
     - **RestartSec**: The time to wait before restarting the service.
     - **KillMode**: How the service's processes are killed.
   - **[Install]**
     - **WantedBy**: Specifies the target under which the service should be started. `multi-user.target` means the service will start in multi-user mode (default for most servers).

#### Step 5: Enable and Start the Service

1. **Enable the service to start on boot:**

   ```bash
   sudo systemctl enable cloudflared
   ```

2. **Start the service:**

   ```bash
   sudo systemctl start cloudflared
   ```

3. **Check the status of the service:**

   ```bash
   sudo systemctl status cloudflared
   ```

#### Additional Information

- **What is `multi-user.target`?**
  `multi-user.target` is a systemd target that signifies the system is in multi-user mode. It's similar to the traditional runlevel 3, where multiple users can log in.


This guide provides a comprehensive example of how to install a binary, create a system user, configure the binary, and set up a systemd service to manage the binary. Adjust the specific paths, user names, and configuration options as needed for your particular use case.
