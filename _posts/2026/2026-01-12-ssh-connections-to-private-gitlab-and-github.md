---
layout: post
title: SSH Connections to Private GitLab and GitHub
description: Secure your Git workflow with SSH key setup, RSA vs Ed25519, and managing multiple accounts for GitHub and GitLab.
date: 2026-01-11 08:10:00 +0800
published: true #false or true
categories: github
toc: true
media_subpath: /assets/media/2026/ssh-connections-to-private-gitlab-and-github
image: git-ssh.webp
tags: [open-source, git, github]
---

Imagine this: you’re a student working on a group project hosted on your **school’s private GitLab**, and you also contribute to a personal project on **GitHub**. You try to clone a repository using HTTPS, but every time you push, Git asks for your username and password. Frustrating, right?

This is where **SSH** comes in — it’s faster, more secure, and password-free once set up properly. In this guide, we’ll explore why SSH is essential, how it works, the difference between RSA and Ed25519 keys, and best practices for managing multiple Git accounts.

---

## Why SSH Is Needed: HTTPS Isn’t Always Enough

Using HTTPS for Git repositories works, but it has some limitations:

1. **Repeated prompts**: Every time you push or pull, Git may ask for your username and password.
2. **Access tokens**: GitHub now requires **personal access tokens** for HTTPS instead of passwords. While secure, tokens are cumbersome to manage and type, especially for scripts or automated workflows.
3. **Automation headaches**: Scripts, CI/CD pipelines, or automated builds can’t easily handle token prompts securely.

SSH solves these problems: once your key is set up, authentication is automatic, secure, and doesn’t require typing credentials every time.

> **TL;DR:** HTTPS with tokens works, but SSH is **faster, simpler, and script-friendly**.

---

## What is SSH?

SSH (**Secure Shell**) is a cryptographic protocol that allows secure communication between your computer and a remote server. For Git:

* SSH lets you authenticate with GitLab or GitHub using **keys instead of passwords**.
* When you connect via SSH, the server never sees your password; it verifies your **public key**.
* You can still interact with repositories (`clone`, `push`, `pull`) without giving your password each time.

Think of SSH as a **secret handshake** — your key proves who you are without exposing your password.

---

## Understanding SSH Keys: Private vs Public

When you generate an SSH key, you actually get **two keys**:

1. **Private key** (`~/.ssh/id_ed25519` or `id_rsa`)

   * **Keeps secret on your local machine**
   * Never share it
   * Used to sign authentication requests

2. **Public key** (`~/.ssh/id_ed25519.pub` or `id_rsa.pub`)

   * **Shared with the server** (GitHub, GitLab)
   * Git server stores this key and maps it to your account
   * When you connect, the server checks that the private key you present matches the stored public key

💡 **Analogy:** Private key = your signature; public key = server’s reference to recognize your signature.

---

## How Git SSH Connections Work

When you run:

```bash
git clone git@school-git.edu:group/project.git
```

* `git` → the username used to connect (all GitLab/GitHub SSH connections use `git`)
* `school-git.edu` → the server hostname
* `group/project.git` → the repository path on the server

SSH will:

1. Present your private key to the server
2. The server checks if the key matches the public key on your account
3. If matched, Git operations are allowed (`clone`, `push`, `pull`)
4. No shell access is granted — only Git commands

---

### How `.ssh/config` Can Simplify

Without config, you must type the full hostname every time:

```bash
git clone git@school-git.edu:group/project.git
```

With `.ssh/config`, you can create an alias:

```ssh
Host school-gitlab
    HostName git.school.edu
    User git
    IdentityFile ~/.ssh/id_ed25519_school
    IdentitiesOnly yes
```

Then clone using the alias:

```bash
git clone git@school-gitlab:group/project.git
```

Much shorter and easier to remember, especially if you have multiple Git accounts.

---

## RSA vs Ed25519: Choosing the Right Key Type

When generating an SSH key, you must choose the key type using `-t`.

```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

* `-t ed25519` → specifies the key type (Ed25519 in this case)
* Other options: `-t rsa` (older standard), `-t ecdsa` (another elliptic curve)
* `-C` → adds a **comment** to identify the key

### About the Comment (`-C`)

* **Purpose:** Helps you identify keys if you have multiple keys on your machine or uploaded to Git servers.
* **Common choice:** Your email address (e.g., `student@school.edu`)
* **Other options:**

  * `School GitLab key`
  * `Work project key`
  * `GitHub personal key`
* **Without comment:** The key works perfectly fine, but it’s harder to tell which key is which if you manage many keys.

> ✅ **Best practice:** Use a descriptive comment. Email is common because it uniquely identifies you, but any clear label works.

| Feature       | RSA                             | Ed25519                         |
| ------------- | ------------------------------- | ------------------------------- |
| Security      | Strong with 4096-bit key        | Stronger, modern elliptic curve |
| Speed         | Slower                          | Faster                          |
| File size     | Large (4–8 KB)                  | Small (~0.5 KB)                 |
| Compatibility | Very high                       | Modern systems only             |
| Recommended   | Only if legacy support required | Default for Git today           |

---

## How to Create an SSH Key

1. **Generate a new key** (Ed25519 recommended):

```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

2. **Choose a passphrase**

* **With passphrase**: encrypts the key on disk; more secure. You’ll unlock it once per session using `ssh-agent`.
* **Without passphrase**: convenient for school projects or scripts; less secure if the device is stolen.

3. **Add key to SSH agent (optional if passphrase is set)**

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

---

## Why SSH Config Matters: Real-World Scenario

Scenario: You have:

* **School GitLab** key: `~/.ssh/id_ed25519_school`
* **GitHub** key: `~/.ssh/id_ed25519_github`

Without configuration:

* SSH tries **all keys** for each connection.
* GitLab/GitHub may reject after “too many attempts.”
* You get confusing errors like `Permission denied (publickey)`.

**Solution: `.ssh/config`**

```ssh
# GitHub
Host github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes

# School GitLab
Host school-gitlab
    HostName git.school.edu
    User git
    IdentityFile ~/.ssh/id_ed25519_school
    IdentitiesOnly yes
```

* `Host` → alias (can match hostname or be custom)
* `HostName` → actual server (needed if alias differs from real hostname)
* `User git` → SSH username for Git servers
* `IdentityFile` → ensures the correct key is used
* `IdentitiesOnly yes` → prevents SSH from trying other keys

Now, you can clone/push without confusion:

```bash
git clone git@github.com:username/repo.git
git clone git@school-gitlab:class/project.git
```

> Note: Even though GitHub HTTPS now uses personal access tokens, SSH is still better for convenience, automation, and avoiding repeated token entry.

---

## Conclusion

SSH is the **best way to securely connect to Git repositories** without typing passwords constantly. 

By understanding:
* Private vs public keys and where they are stored
* How `git clone git@server:path.git` works
* The `-t` flag and key types (RSA vs Ed25519)
* Generating keys with or without passphrases
* The role of key comments (`-C`) for identification
* How `.ssh/config` simplifies multiple accounts
* And why SSH is better than HTTPS with tokens for repeated and automated use

…you can manage multiple Git accounts (GitHub, school GitLab, work GitLab) on the same machine efficiently.

💡 **Pro tip:** Use **Ed25519** for new keys, set a passphrase if security matters, use descriptive comments, and use `.ssh/config` to avoid “Permission denied” errors.


