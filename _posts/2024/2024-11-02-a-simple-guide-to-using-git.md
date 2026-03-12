---
layout: post
title: A Simple Guide to Using Git
date: 2024-11-02 12:30:00 +0800
published: true #false or true
categories: ML
media_subpath: /assets/media/2024/simple-guide-to-using-git/
image: git.webp
tags: [github, git]
---

Git is like a magic organizer for your work, whether you’re working alone or with a team. It helps you save every version of your project, so you can go back to an earlier version if something goes wrong.

This is useful even if you’re working solo because it prevents losing progress, keeps things organized, and lets you experiment without fear.

For teams, Git takes it a step further by allowing everyone to work on the same project without overwriting each other’s changes. It tracks what was done, when, and by whom, making collaboration smooth and conflict-free.

One of Git’s key features is branching. It’s like making a copy of your work to try out new ideas without affecting the original. If the new idea works, you can merge it back into the main project. If not, you can discard it without any risk. For teams, branching allows multiple people to work on different tasks at the same time while keeping the main project stable. It’s a safe way to experiment and collaborate effectively.


### **1: Install Git**
- Install Git based on your operating system.
- Follow the official instructions on the [Git website](https://git-scm.com/).


---
### **2: Ensure Git is Installed**
Check if Git is installed by running:
```bash
git --version
```
You should see the installed version of Git (e.g. `git version 2.x.x`).

---

### **3: Clone a Repository from GitHub**
step 1. Copy the repository URL from GitHub.
step 2. Clone the repository:
   ```bash
   git clone https://github.com/username/repository.git
   ```
step 3. Navigate to the cloned repository:
   ```bash
   cd /repository/path
   ```

step 4. Verify the Repository**
To check the status of your repository:
```bash
git status
```

---
### **4: Make Changes, Stage**

#### **a) Staging Changes**
- **What is Staging?**
  - Staging prepares changes (modified, added, or deleted files) to be included in the next commit.
  - Use:
    ```bash
    git add <file-name>  # Stage a specific file
    git add .            # Stage all changes
    ```

#### **b) Unstaging Changes**
- If you staged changes by mistake:
  ```bash
  git restore --staged <file-name>  # Unstage a specific file
  git restore --staged .           # Unstage all changes
  ```

---
### **5: Commit the Changes**
After staging changes, commit them with a descriptive message:
```bash
git commit -m "Your commit message"
```

---
#### **Issue - Author Identity Unknown**

```bash
Author identity unknown

*** Please tell me who you are.

Run

  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"

to set your account's default identity.
Omit --global to set the identity only in this repository.
```


This message appears when you try to make a commit, but Git does not know who you are. Specifically, Git requires your **username** and **email address** to associate with the commit.

You’ll see this message if:
- You have not set up your Git identity (username and email) globally or for the current repository.
- You’re using Git for the first time on this system.
- The identity settings in your Git configuration are missing or incomplete.

If you don’t set your identity:
- Git will not allow you to make a commit until your identity is configured.
- This ensures every commit has an identifiable author.


Git tracks the **author's information** for every commit made in a repository. This information is recorded in the commit metadata and is displayed in Git history. The **identity settings** include:
- **`user.name`**: Your name (e.g., "John Doe"). This identifies the person who made the commit.
- **`user.email`**: Your email address (e.g., "johndoe@example.com"). This is usually your GitHub or work email, identifying you as the author.

This metadata helps collaborators know who made each commit and can also be used to verify commit authorship.

When you make a commit, Git captures the following metadata:
1. **Author Name**: The name set using `git config user.name`.
2. **Author Email**: The email address set using `git config user.email`.
3. **Commit Message**: The description you provide when making the commit (e.g., "Fixed bug in login feature").
4. **Timestamp**: The date and time the commit was made.

Example Git commit log:
```plaintext
commit abc123456789 (HEAD -> main)
Author: John Doe <johndoe@example.com>
Date:   Tue Nov 28 10:30:00 2024 +0800

    Fixed bug in login feature
```

This information is essential for tracking changes, collaborating with others, and maintaining transparency in version control.

#### **To Fix - Author Identity Unknown**

You need to configure your Git identity by setting your **username** and **email address**. You can set this **globally** (for all repositories) or **locally** (for the current repository only).

#### **a) Set Globally (Recommended for Beginners)**
This sets your identity for all Git repositories on your system:
```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

#### **b) Set Locally (For a Single Repository)**
This sets your identity for the current repository only:
```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

#### **c) Verify Your Configuration**
After setting your identity, you can confirm it with:
```bash
git config --global --list  # For global settings
git config --list           # For current repository settings
```

Example output:
```
user.name=John Doe
user.email=johndoe@example.com
```


### **Managing Your Git Identity and Email Privacy**

When using Git, it’s important to configure your username and email address appropriately to ensure proper attribution and protect your privacy.



#### **Choosing a Username and Email Address**
- Use a **username** and **email address** that matches your GitHub account (or the account you use for version control) to ensure proper attribution of your work.
- For personal projects, you can use your personal email address.
- If you’re concerned about privacy, GitHub allows you to use its **no-reply email**. This email address ensures your personal email remains private. An example of a GitHub no-reply email looks like this::
    ```
    12345678+username@users.noreply.github.com
    ```



#### **Protecting Your Email Address**
To prevent your private email from being exposed, enable the following settings in your GitHub account under **Emails**:
- **Keep my email addresses private**
- **Block command line pushes that expose my email**

By enabling these settings, GitHub will automatically use your no-reply email for web-based and command-line operations, ensuring your privacy.


---


### **6: Push Changes to the Remote Repository**

#### **Push Your Changes**
Push your local commits to the remote repository:
```bash
git push origin main
```

#### **Error 1: Password Authentication Removed**
If you see:
```
remote: Support for password authentication was removed on August 13, 2021.
```
GitHub now requires one of the following:
a). **Personal Access Token (PAT)**
b). **SSH Key**

#### **Using a Personal Access Token (PAT)**
step 1. Go to **GitHub Settings** > **Developer settings** > **Personal access tokens** > **Tokens (classic)** > **Generate new token**.
step 2. Copy the token and use it as your password when prompted:
   ```bash
   git push origin main
   ```
step 3. Enter your username and paste the token as your password.

#### **Using SSH (Optional)**
step 1. Generate an SSH key:
   ```bash
   ssh-keygen -t rsa -b 4096 -C "comments"
   ```
step 2. Add the SSH key to GitHub (**Settings** > **SSH and GPG keys**).
step 3. Update the repository's remote URL:
   ```bash
   git remote set-url origin git@github.com:username/repository.git
   ```
step 4. Push using SSH:
   ```bash
   git push origin main
   ```


#### **Error 2: Resolve Email Privacy Issues**

If you see:
```
remote: error: GH007: Your push would publish a private email address.
```

#### **Cause**
GitHub blocks pushes that expose your private email due to privacy settings.

This happens because the following settings are enabled in your GitHub account:
   - **Keep my email addresses private**
   - **Block command line pushes that expose my email**

#### **Solution**
step 1. Update your Git configuration to use the no-reply email:
   ```bash
   git config --global user.email "12345678+username@users.noreply.github.com"
   ```
step 2. Amend the last commit to reset the author email:
   ```bash
   git commit --amend --reset-author -m "Updated commit author"
   ```
step 3. Push the changes:
   ```bash
   git push origin main
   ```

---

### **8: Others**
Use `git log` to review commit history.
