---
layout: post
title: Setting Up Ruby, RubyGems, and Build-Essential for Jekyll
date: 2024-11-05 12:30:00 +0800
published: true #false or true
categories: ML
media_subpath: /assets/media/2024/setting-up-ruby-rubygems-and-build-essential-for-jekyll
image: ruby-jekyll.webp
tags: [ruby, jekyll]
---

This guide provides a step-by-step approach to setting up Ruby, RubyGems, and essential tools for a Jekyll environment on Linux (ubuntu).

---

### **Step 1: Install Ruby and RubyGems**
Ruby is the programming language required to run Jekyll, and RubyGems is the package manager for Ruby. Here’s how to set them up:

1. **Update the System Package List**:
   ```bash
   sudo apt update
   ```

2. **Install Ruby (using `ruby-full`)**:
   ```bash
   sudo apt install ruby-full
   ```
   - **What happens**:  
     - This installs Ruby and its package manager, RubyGems.
     - Ruby binaries are placed in `/usr/bin` or `/usr/local/bin`, which are system-wide directories already in the `PATH`.
   - **Verify Installation**:
     ```bash
     ruby -v
     gem -v
     ```
     - You should see the versions of Ruby and RubyGems, confirming the installation.

---

### **Step 2: Install Supporting Tools**
Ruby and RubyGems require certain tools and libraries to compile and run gems. 
These are: build-essential, and zlib1g-dev

1. **Install Build-Essential**:
   ```bash
   sudo apt install build-essential
   ```
   - **What is installed**:  
     - Compilers like `gcc`, `make`, and related tools needed to compile software and Ruby gems with native extensions.
   - **Where it is installed**:  
     - Binaries are placed in `/usr/bin` (e.g., `/usr/bin/gcc`).

2. **Install zlib Development Files**:
   ```bash
   sudo apt install zlib1g-dev
   ```
   - **What is installed**:  
     - The zlib compression library, used by Ruby and other programs for handling compressed files.
   - **Where it is installed**:  
     - Libraries are stored in `/usr/lib`, and headers are in `/usr/include`.

---

### **Step 3: Understanding and Adding to PATH**
The `PATH` environment variable defines where the system looks for executable files when you type a command.

#### **How `PATH` Works**
1. When you type a command (e.g., `ruby`), the system searches for the corresponding executable in the directories listed in the `PATH`.
   - Example of `PATH`:
     ```
     /usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin
     ```
   - The directories are checked in order. The first match is executed.

2. If an executable is not in a directory listed in `PATH`, you’ll get an error like:
   ```
   command not found
   ```

---

### **Step 4: Configuring RubyGems for User-Specific Installation**
RubyGems is a package manager for Ruby (like apt for Ubuntu). You'll use it to install Jekyll.

By default, RubyGems installs gems globally (e.g., `/usr/local/lib/ruby/gems`). This requires `sudo` and affects all users.

Even though it’s technically optional in some scenarios, adding `~/gems/bin` to `PATH` is highly recommended for the following reasons:

- **Convenience:** Avoid installing RubyGems packages (called gems) as the root user. Allows you to run commands (like jekyll, bundler) directly without specifying full paths.
- **Best Practice:** Encourages the use of user-specific installations (`gem install` without `sudo`), which is safer and avoids modifying system-wide directories.
- **Future-Proofing:** If you install more gems later, you won’t need to keep worrying about their paths.

To allow user-specific installations:
1. **Set `PATH`**:
   - Add the following lines to your `~/.bashrc`:
     ```bash
     echo '# Install Ruby Gems to ~/gems' >> ~/.bashrc
     echo 'export GEM_HOME="$HOME/gems"' >> ~/.bashrc
     echo 'export PATH="$HOME/gems/bin:$PATH"' >> ~/.bashrc
     ```
   - Apply the changes:
     ```bash
     source ~/.bashrc
     ```
   - **What this does**:
     - **`GEM_HOME`**: Specifies the directory (e.g., `~/gems`) where RubyGems `gem` will install gems for the current user.
     - **`PATH`**: Ensures the system can locate executables installed by RubyGems `gem` in `~/gems/bin`.

2. **Effect on the System**:
   - When `GEM_HOME` is set:
     - Gems are installed in `~/gems` instead of system-wide directories.
     - The user can install gems without `sudo`, and each user has their own isolated gem environment.
   - Adding `~/gems/bin` to `PATH` ensures that gem executables (e.g., `jekyll`, `bundle`) can be run directly.

---


### **Final Steps: Installing Jekyll and Bundler**
After setting up Ruby, RubyGems, and updating your `PATH`, follow these steps to complete the Jekyll setup:

1. **Install Jekyll and Bundler Gems**:
   ```bash
   gem install jekyll bundler
   ```
   - Installs `jekyll` and `bundler` in `~/gems` if `GEM_HOME` is set.

2. **Check the Executables Directory**:
   ```bash
   ls $HOME/gems/bin
   ```
   - You should see the `jekyll` and `bundler` executables listed here.

3. **Verify `PATH` Includes `~/gems/bin`**:
   ```bash
   echo $PATH
   ```
   - Confirm that `~/gems/bin` appears in the output. If not, update your `PATH`.

4. **Run an Installed Gem**:
   ```bash
   bundler -v
   ```
   - This should display the installed version of Bundler, confirming the installation was successful.

---

### **Summary**

1. **Ruby and RubyGems**:
   - Ruby binaries are typically located in `/usr/bin` or `/usr/local/bin`.
   - RubyGems `gem` is bundled with Ruby and is used to manage gem installations.

2. **Essential Supporting Tools**:
   - **Build-essential**: Required for compiling software and some gems.
   - **zlib1g-dev**: Provides compression support required by some gems.

3. **Adding `~/gems/bin` to `PATH`**:
   - Ensures gem executables (like `jekyll` and `bundler`) can be run directly from the terminal.

4. **User-Specific vs System-Wide Installations**:
   - Setting `GEM_HOME` enables user-specific installations, avoiding system-wide conflicts and the need for `sudo`.


















