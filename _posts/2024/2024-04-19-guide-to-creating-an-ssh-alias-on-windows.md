---
title: Guide to creating an SSH alias on Windows
description: Create SSH aliases on Windows to simplify connecting to remote servers without typing full credentials.
date: 2024-04-19 11:33:00 +0800
categories: linux
toc: true
media_subpath: /assets/media/2024/ssh-alias-on-windows
image: ssh-alias.webp
tags: [linux, ssh]
pin: false
math: true
mermaid: true
comments: true
---

## Step-by-step user guide on how to create an SSH alias on a local Windows machine

### Step 1: Open PowerShell

Open PowerShell on your Windows machine. You can do this by searching for "PowerShell" in the Start menu and selecting the application.

### Step 2: Navigate to the SSH Configuration Directory

In PowerShell, navigate to the SSH configuration directory. By default, this directory is located at `%USERPROFILE%\.ssh`. You can navigate to it using the following command:

```powershell
cd $env:USERPROFILE\.ssh
```

### Step 3: Create or Edit the SSH Configuration File

If you already have an SSH configuration file (`config`), you can open it with a text editor. If not, create a new file named `config`.

```powershell
notepad config
```

### Step 4: Add Your SSH Alias Configuration

In the text editor, add the following configuration for your SSH alias:

```plaintext
Host myserver
    Hostname hostname_or_ip
    User username
    Port port_number
    IdentityFile ~\.ssh\my_private_key
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

Replace the placeholders `<myserver>`, `<hostname_or_ip>`, `<username>`, `<port_number>`, and `<my_private_key>` with the actual values corresponding to your server:

- `<myserver>`: A nickname or alias for your server.
- `<hostname_or_ip>`: The hostname or IP address of your server.
- `<username>`: Your username on the server.
- `<port_number>`: The SSH port number (default is 22).
- `<my_private_key>`: The filename of your private key file located in the `.ssh` directory. If you've generated an SSH key pair using the ssh-keygen command, the default name for the private key is `id_rsa`.

### Step 5: Save and Close the Configuration File

Save the changes you made to the configuration file and close the text editor.

If the file is being saved with the `.txt` extension despite selecting "All Files (*.*)" as the save type, it's possible that Windows is adding the `.txt` extension automatically due to its default settings.

You can try the following alternative methods to save the file without the `.txt` extension:

Method 1: Save with Quotation Marks

1. Specify the filename within quotation marks in the "Save As" dialog. For example, enter `"config"` instead of just `config`.
2. Choose "All Files (*.*)" as the save type.
3. Click the "Save" button.

Method 2: Use Command Line

1. Open PowerShell.
2. Navigate to the directory where your SSH configuration file is located using the `cd` command.
3. Use the `Rename-Item` command to rename the file to `config` without the `.txt` extension. For example:
   ```powershell
   Rename-Item config.txt config
   ```

After using one of these methods, the file should be saved as `config` without the `.txt` extension, and SSH should recognize it properly as the SSH configuration file.


### Step 6: Test Your SSH Alias

You can now test your SSH alias by opening PowerShell and typing:

```powershell
ssh myserver
```

Replace `myserver` with the alias you defined in the configuration file. This command will attempt to SSH into the server using the configured parameters.

That's it! You've successfully created an SSH alias on your local Windows machine. You can now use this alias to easily connect to your server without having to type the full connection details every time.
