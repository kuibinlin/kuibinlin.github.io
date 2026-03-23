---
title: Manage Multiple SSH keys in Windows
description: Configure Windows SSH to use different keys for different hosts, enabling seamless multi-server connections.
date: 2024-04-27 13:00:00 +0800
categories: linux
toc: true
tags: [linux, ssh]
pin: false
math: true
mermaid: true
comments: true
---


### Configuring SSH Config File on Windows
To manage multiple SSH keys in Windows, you can create or edit the SSH config file, which is typically located at `C:\Users\<your_username>\.ssh\config`. This file allows you to set specific configurations for different SSH connections, including which SSH key to use for each host.

#### 1. Open or Create the SSH Config File
Open your preferred text editor (such as Notepad, Notepad++, or VSCode) and locate the SSH config file:

- Navigate to `C:\Users\<your_username>\.ssh\`.
- If the `config` file doesn't exist, create it.

#### 2. Configure SSH Settings
Add or update configurations in the SSH config file to specify which SSH key to use for each host. Here's an example configuration for two different hosts, each using a different SSH key:

```bash
Host host1
    HostName host1.example.com
    User user1
    IdentityFile C:/Users/<your_username>/.ssh/key1

Host host2
    HostName host2.example.com
    User user2
    IdentityFile C:/Users/<your_username>/.ssh/key2
```

- Replace `<your_username>` with your Windows username.
- Use forward slashes (`/`) for the file path, as it's commonly used in SSH configurations.
- Modify `HostName`, `User`, and `IdentityFile` to match your specific SSH connections.

#### 3. Test SSH Connections
After updating the SSH config file, test your SSH connections to ensure the correct key is used for each host:

```bash
ssh host1
```

```bash
ssh host2
```

This should connect to `host1` and `host2` using the specified SSH keys.

#### 4. Secure Your SSH Keys
Ensure that your SSH keys have the correct permissions to prevent unauthorized access:

- In a command prompt or PowerShell, you can restrict permissions for the SSH keys:
  ```bash
  icacls C:/Users/<your_username>/.ssh/key1 /inheritance:r /grant:r <your_username>:(F)
  ```
- This command sets full access permissions for your user and removes inherited permissions.

---

With this approach, you can effectively manage multiple SSH keys on Windows by configuring the SSH config file. It allows for customized connections and better organization when dealing with various SSH keys.