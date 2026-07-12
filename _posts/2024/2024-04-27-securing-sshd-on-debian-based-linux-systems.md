---
title: Securing SSHD on Debian-based Linux Systems
description: Harden SSH security on Debian Linux by adding sudo users, generating key pairs, and implementing secure authentication.
date: 2024-04-27 12:00:00 +0800
categories: linux
toc: true
media_subpath: /assets/media/2024/securing-sshd-on-debian
image: sshd.webp
tags: [linux, ssh]
pin: false
math: true
mermaid: true
comments: true
---

## Securing SSHD on Debian-based Linux Systems

### 1 Add User to Sudoers

To add a user to the `sudo` group, you can edit the sudoers file using `visudo`:

```bash
sudo visudo
```

In the `visudo` editor, add your user to the sudoers group with the following line (replace `<user>` with your username):

```bash
<user> ALL=(ALL:ALL) ALL
```

Adding a user to the `sudo` group ensures they have administrative privileges to perform system-level tasks on a Linux system. Granting `sudo` privileges to a user is generally safer than allowing direct root login. It requires explicit use of `sudo` to perform privileged actions, providing a layer of accountability and reducing the risk of accidental or unauthorized changes. When a user uses `sudo`, the action is logged in the system logs, providing a record of who performed what administrative tasks. This is useful for auditing and troubleshooting.

Adding a user to `sudoers` using `visudo` is the recommended method because `visudo` checks for syntax errors and ensures that changes are applied correctly. This prevents errors that could lock out administrative access or cause other system issues.

Thus, if you want to secure SSHD or perform other administrative tasks on a Linux system, adding a user to the `sudo` group is a necessary first step.

### 2 Generate SSH Keys on your local machine

If you're using a Windows machine as your local system and connecting to a remote SSH server, here's how to generate SSH keys and set them up for secure SSH authentication.


To use key-based authentication for SSH, you first need to generate an SSH key pair on your Windows machine.

1). **Install an SSH Client**: Ensure you have an SSH client installed. Windows 10 and later versions include `OpenSSH`, but you might need to install it on earlier versions or consider using tools like [PuTTY](https://www.putty.org/).

2). **Generate SSH Key Pair**:
   - If you're using `OpenSSH` on Windows, open a command prompt or PowerShell and run the following command to generate a key pair:
     ```bash
     ssh-keygen
     ```
   - If you're using PuTTY, use `PuTTYgen` to generate an SSH key pair.

3). **Save the SSH Keys**:
   - When prompted, choose a location to save the key pair. The default location is usually `C:\Users\<your_username>\.ssh\`.
   - Save the public key (`id_rsa.pub` or the equivalent) and the private key (`id_rsa` or similar).


### 3 Check if `scp` is Installed
Before proceeding with any secure copy operations, ensure `scp` is installed on your on your local machine. 

`scp` (secure copy) does not come pre-installed on Windows by default, but there are several ways to get it. Here are the common methods to enable `scp` on a Windows system:

1). **OpenSSH in Windows 10 and Later**:
   Windows 10 and later versions have a built-in OpenSSH client, which includes `scp`. You can check if it's installed by opening a command prompt or PowerShell and typing:
   ```bash
   scp --version
   ```
   If you get a version response, `scp` is available. If not, you can enable OpenSSH in Windows settings:
   - Open **Settings** > **Apps** > **Optional Features**.
   - Click **Add a Feature** and find **OpenSSH Client** to install it.

2). **PuTTY's `PSCP`**:
   PuTTY is a popular SSH client for Windows, and it includes a secure copy tool called `PSCP`. To use it:
   - Download and install PuTTY from [the official site](https://www.putty.org/).
   - Add the PuTTY installation directory to your system's `PATH` variable to use `PSCP` from the command line.

3). **Git for Windows**:
   If you install [Git for Windows](https://git-scm.com/download/win), you get a Unix-like environment with common tools like `ssh` and `scp`. This is useful if you also use Git for version control.

### 4 How to Use `scp` in Windows
Once `scp` is installed, you can use it to transfer files between your Windows system and a remote SSH server. Here's an example command to copy a file from your Windows system to a remote SSH server:
```bash
scp C:\path\to\file.txt <user>@<host>:/remote/path/
```
Replace `<user>`, `<host>`, and `/remote/path/` with your SSH server's details and desired remote path.

If `scp` isn't installed on your Windows system, you can use one of the methods above to get it.



### 5 Set Up Public Key on Remote SSH Server
After generating your SSH key pair, you need to add the public key to the remote SSH server's `authorized_keys` to allow key-based authentication.

1). **Transfer the Public Key to the SSH Server**:
   - Use `scp` (secure copy) to transfer the public key to the remote server:
     ```bash
     scp ~/.ssh/id_rsa.pub <user>@<host>:/home/<user>/.ssh/
     ```
   - If you're using PuTTY, you can use tools like `PSCP` or `FileZilla` to upload the public key.

2). **Add Public Key to `authorized_keys`**:
   - Connect to the SSH server.
   - Append the public key to the `authorized_keys` file in the `~/.ssh/` directory:
     ```bash
     cat ~/id_rsa.pub >> ~/.ssh/authorized_keys
     ```


### The following steps will guide you through configuring SSHD on a remote machine to make it more secure.

### 6 Backup the SSHD Configuration
First, create a backup of your existing SSHD configuration to avoid data loss in case of errors:

```bash
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bku
```



### 7 Edit SSHD Configuration
To secure SSHD, you need to edit the SSHD configuration file:

```bash
sudo nano /etc/ssh/sshd_config
```

Refer to the SSHD configuration guide for more information on different settings:

```bash
man sshd_config
```


Make the following changes to your SSHD configuration to enhance security:

- **Change the default SSH port**:
  ```bash
  Port <new_port>
  ```
  Changing from the default port (22) reduces exposure to automated attacks.

- **Specify allowed users**:
  ```bash
  AllowUsers <user>
  ```
  Restricts SSH access to specified users, reducing unauthorized access.

- **Disallow root login**:
  ```bash
  PermitRootLogin no
  ```
  Prevents logging in as the root user, minimizing the risk of unauthorized access.

- **Limit authentication attempts**:
  ```bash
  MaxAuthTries 3
  ```
  Reduces the number of failed login attempts to prevent brute-force attacks.

- **Disable password authentication**:
  ```bash
  PasswordAuthentication no
  ```
  Forces users to use key-based authentication, enhancing security.


- **Disallow empty passwords**:
  ```bash
  PermitEmptyPasswords no
  ```
  Prohibits accounts with empty passwords from logging in, enhancing security.


- **Disable Kerberos authentication**:
  ```bash
  KerberosAuthentication no
  ```
  Prevents Kerberos-based authentication, which is generally not used in typical SSH configurations.



- **Set client alive settings to maintain connections**:
  ```bash
  ClientAliveInterval 300
  ClientAliveCountMax 0
  ```
  Ensures that SSH connections are properly maintained or terminated to prevent idle sessions.

- **Limit SSHD startups**:
  ```bash
  MaxStartups 3:5:10
  ```
  Limits the rate of incoming SSH connections to reduce potential denial-of-service attacks.



### 8 Restart SSHD for Changes to Take Effect
After making changes, restart SSHD to apply them:

```bash
sudo systemctl restart sshd
```


### 9 Test SSHD Before Closing the Terminal
**Do not close your current terminal yet**. Before ending your SSH session, ensure that the changes you've made to the SSHD configuration haven't locked you out. Open a new SSH session from a different terminal or device to confirm that you can still connect.

If you close your current terminal and get locked out, you'll need physical access to the remote machine to correct the SSHD configuration. This can be problematic, especially if the machine is in a remote location or a data center. **Always test your SSH connection first to avoid unintended lockouts**.



### 10 Check SSH Login Logs
To review recent login attempts, you can check the authentication log:

```bash
sudo tail -n 10 /var/log/auth.log
```

### 11 SSH Port Forwarding
You can establish an SSH connection with port forwarding:

```bash
ssh -L <local_port>:localhost:<remote_port> -p <ssh_port> <user>@<host>
```

Replace `<local_port>`, `<remote_port>`, `<ssh_port>`, `<user>`, and `<host>` with your respective port numbers, username, and SSH server hostname or IP address.
