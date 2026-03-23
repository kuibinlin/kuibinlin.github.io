---
layout: post
title: Sending Email from Raspberry Pi Using msmtp with Gmail OAuth 2.0
description: Set up msmtp on Raspberry Pi to send emails via Gmail using OAuth 2.0 instead of deprecated app passwords.
date: 2025-04-17 07:00:00 +0800
published: true #false or true
categories: linux
toc: true
media_subpath: /assets/media/2025/sending-email-from-raspberry-pi-using-msmtp-with-gmail-oauth2
image: raspi-email.webp
tags: [linux, debian, msmtp, oauth2.0]
---

## App Passwords No Longer Work – Use OAuth 2.0 for Gmail SMTP with msmtp
*(Note: OAuth 2.0 is now required for msmtp to work with Gmail because Google no longer supports simple password authentication.)*

This guide explains how to set up msmtp—a lightweight SMTP client—to send mail via Gmail using OAuth 2.0 (XOAUTH2) instead of static passwords. You will create a Google Cloud project, configure OAuth 2.0 (without needing to enable the Gmail API), install required software, set up msmtp as your system sendmail, and deploy two Python scripts for authorization and token refreshing.

> This setup has been tested on a Raspberry Pi, but it should also work on Debian and any Debian-based Linux distribution (such as Ubuntu, Linux Mint, Pop!_OS, etc.).

---

## Step 1. Create and Configure Your Google Cloud Project

### a. Create a Google Account (if needed)
1. Visit [Google Account Signup](https://accounts.google.com/signup) to create an account.

### b. Access the Google Cloud Console and Create a New Project
1. **Go to the Console:**  
   Open [Google Cloud Console](https://console.cloud.google.com/).
2. **Create a New Project:**  
   - Click the project drop-down in the top navigation bar.
   - Choose **New Project**.
   - Enter a project name (e.g., **msmtp**) and fill in any required details.
   - Click **Create** and wait for the project to initialize.

### c. Configure the OAuth Consent Screen
1. Navigate to **APIs & Services > OAuth consent screen > Get Started**.
2. Fill in the required fields:
   - App Information: App name, User support email
   - Audience: select "External"
   - Contact information: Email adresses
   - Finish

### d. Create an OAuth Client ID
1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials > OAuth client ID**.
   - Under **Application type**, choose **Desktop app**.
   - Name of your OAuth 2.0 client (for example, “Raspberry Pi 5”).
3. Click **Create**.
4. When the dialog appears, click **Download** to save the JSON file (This is needed for Step 3).

---

## Side Note on OAuth 2.0 Scopes for Gmail SMTP Authentication
> Just a side note — NO ACTION is needed for this part.

You do **NOT** need to enable the Gmail API.

- **Difference Between Gmail API and SMTP Access:**

  * The Gmail API scope \[`https://www.googleapis.com/auth/gmail.send`] is intended only for the API’s own send-message endpoint and is therefore more restrictive.
  * Supplying only the `gmail.send` scope will cause XOAUTH2 authentication failures.
  * `msmtp` authenticates to Gmail’s regular SMTP server via XOAUTH2, which requires a token bearing the full Gmail scope. 

- **Required Scope for SMTP:**  
  For SMTP (and IMAP/POP3) access, Gmail requires that the OAuth token include the full access scope:
  ```
  https://mail.google.com/
  ```
  This full scope guarantees that the token carries all the permissions the SMTP server expects. Although this grants broader permissions, it is required for successful authentication.

- **Common Error – “Username and Password Wrong”:**  
  If msmtp constructs an XOAUTH2 authentication string with a token generated under the restricted scope, Gmail’s SMTP server will reject it—leading to the “username and password wrong” error message.

---

## Step 2. Install Required Linux and Python Packages

### a. Install Required System Packages
> On your Raspberry Pi, open the terminal and run the following two commands. 
If you're prompted with any questions, type `yes` or `y` to continue.

```bash
sudo apt update
sudo apt install msmtp msmtp-mta python3 python3-pip
```
- **msmtp & msmtp-mta:**
  Used as a lightweight replacement for sendmail.
- **python3 python3-pip:**
  Provide the Python environment and package manager.

---


## Step 3. Set Up msmtp and OAuth 2.0 Scripts Folder 
> Tip: It’s best to SSH into your Raspberry Pi from another computer that has a web browser. This makes it easier to copy and paste the commands and scripts.

Create a dedicated folder (for example, `~/msmtp`) to store your OAuth files and scripts:
```bash
mkdir -p ~/msmtp
cd ~/msmtp
touch client_secret.json authorize.py get_token.py msmtp.log 
```

### Set Up Python venv & Install Packages

1. **Create a dedicated virtual environment**
> Isolates dependencies, avoids conflicts, and keeps Linux’s system-wide Python untouched.
   ```bash
   python3 -m venv ~/msmtp/venv
   ```

2. **Activate the environment**
> Your shell prompt will change (often to something like `(venv)`), confirming that anything you install now stays inside this project.
   ```bash
   source ~/msmtp/venv/bin/activate
   ```

3. **Install the required libraries**
> `-U` (or `--upgrade`) tells `pip` to fetch the latest version of each listed package, updating them if they’re already present.
   ```bash
   pip install -U google-auth google-auth-oauthlib google-auth-httplib2 requests
   ```

4. **Deactivate when finished (optional but handy)**
> This drops you back to your system-wide Python environment.
   ```bash
   deactivate
   ```



### **client_secret.json**
In Step 1, the OAuth client ID credentials file was downloaded. Now, copy its contents into the file named `client_secret.json`. To do this, open the file with:

```bash
nano ~/msmtp/client_secret.json
```
In the nano editor (you’ll follow these same 4 steps when editing other files later):
1. Paste the copied contents into the file.
2. Press `Ctrl + O` to save.
3. Press `Enter` to confirm the filename.
4. Press `Ctrl + X` to exit the editor.

### **authorize.py**
> Ensure the script’s shebang (`#!`) points to the Python interpreter inside your virtual environment. For example, `#!/home/youruser/msmtp/venv/bin/python3`.

This script runs the initial OAuth authorization flow and saves your credentials. Open the file with `nano ~/msmtp/authorize.py` and paste:

```python
#!/home/pi/msmtp/venv/bin/python3

# ↑ EDIT THIS PATH so it points to *your* virtual-env’s python3 interpreter.
#   It **must** remain the very first line (the shebang) or Unix won’t know
#   which Python to run.

"""
--------------------------------------------------------------------------
authorize.py · interactive one-time OAuth 2.0 flow for msmtp + Gmail SMTP
--------------------------------------------------------------------------


What it does
------------
* Starts Google’s “loop-back” (localhost) OAuth flow on the Raspberry Pi.
* Does not try to launch a GUI browser (safe on a headless Pi).
* Prints a consent-screen URL that you can open on any other device.
* When you finish signing in, the Pi receives the callback and writes a
  long-lived refresh-token to   credentials.json .
* That file is later read by  get_token.py , which msmtp uses at send time.


Before you run this script
--------------------------
1. Virtual-env ready – the shebang above must point at the Python inside
   the venv where you installed google-auth and google-auth-oauthlib, e.g.

       /home/pi/msmtp/venv/bin/python3
       └───┬──────────────┬──────────┘
           │              └ your venv dir
           └ user account home

2. client_secret.json – download it from Google Cloud Console
   (“OAuth 2.0 Client IDs → Desktop”) and place it in the same folder
   as this script.

3. Pick a listen port – set LISTEN_PORT below.
   • 0 = choose any free port automatically (easy when you run a local
     browser on the Pi).

     set 0 ONLY if you can open the consent-screen in a graphical browser running on the Raspberry Pi itself.
     (That means the Pi has a GUI desktop and you’re sitting at it.)

   • A fixed port. 8888 is the default in this script.

     This script assumes:
     • Your Raspberry Pi is headless (no desktop / no GUI browser).
     • You have an SSH session open from another computer that does have a web browser.
       (We’ll call that machine “computer X”)
     • You will copy-paste the consent URL (printed by this script)
       into the browser on computer X.

     Important: Before clicking the URL, open a *second* terminal on computer X
                and start an SSH tunnel so the browser’s callback can reach the Pi:

                ssh -NT -L 8888:localhost:8888 <your-user>@<pi-ip>

                Example:

                ssh -NT -L 8888:localhost:8888 pi@192.168.1.100

     • Leave that tunnel running.  Now open the consent URL in the browser on computer X.
     • When Google redirects to   http://localhost:8888/?code=…,
       the request is carried through the tunnel and delivered to port 8888 on the Pi,
       allowing the OAuth flow to complete successfully.


     After it prints “Credentials saved → credentials.json”
     you can delete the SSH tunnel by pressing Ctrl + C in the terminal where you started the `ssh -NT -L` command. It will close the SSH session and the tunnel.

"""

from __future__ import annotations
import pathlib
import sys
from google_auth_oauthlib.flow import InstalledAppFlow

# ─────────────────────────── paths & constants ────────────────────────────
BASE_DIR        = pathlib.Path(__file__).resolve().parent
CLIENT_SECRETS  = BASE_DIR / "client_secret.json"   # OAuth client downloaded
TOKEN_FILE      = BASE_DIR / "credentials.json"     # output used by get_token.py
SCOPES          = ["https://mail.google.com/"]      # full Gmail SMTP scope
LISTEN_PORT     = 8888                              # 8888 ⇒ default, 0 ⇒ random free port

# ─────────────────────────────── main logic ───────────────────────────────
def main() -> None:
    """Run the interactive OAuth consent flow and save credentials.json."""
    if not CLIENT_SECRETS.exists():
        sys.exit(
        "❌  client_secret.json not found next to authorize.py\n\n"
        "  To generate it:\n"
        "  1. Open https://console.cloud.google.com and create (or select) a project.\n"
        "  2. In the left menu choose  ▶ APIs & Services ▸ OAuth consent screen.\n"
        "     • Pick ‘External’, fill in the bare-minimum fields, and save.\n"
        "  3. Still under ▶ APIs & Services, go to ▸ Credentials ▸ “+ CREATE CREDENTIALS”\n"
        "     • Choose **OAuth client ID**.\n"
        "     • Application type → **Desktop app** (name it anything).\n"
        "  4. Click **Download JSON**.\n"
        "  5. Rename that file to  client_secret.json  and place it in the same\n"
        "     directory as authorize.py, then run this script again.\n"
        )

    flow = InstalledAppFlow.from_client_secrets_file(
        CLIENT_SECRETS,
        SCOPES,
    )

    # run_local_server starts a tiny HTTP server on the Pi and waits
    creds = flow.run_local_server(
        port=LISTEN_PORT,
        open_browser=False,           # headless-safe: don’t auto-launch GUI
        authorization_prompt_message=(
         "\n    🔑  ACTION REQUIRED\n\n"


         "    🚧 BEFORE YOU CONTINUE 🚧\n"

         "       Make sure the SSH tunnel is already running; otherwise the Pi can’t\n"
         "       receive the browser’s callback and the OAuth flow will fail.\n\n"
         "       ssh -NT -L 8888:localhost:8888 <your-user>@<pi-ip>\n\n"
         "       Not sure what this means?  Open this script in any code editor and\n"
         "       read the block of comments for the full step-by-step explanation.\n\n"

         "    1. Copy the URL below into ANY browser (phone, laptop…):\n"
         "\n{url}\n\n"
         "    2. Sign in with your Google account and click Allow.\n\n"
         "    3. When browser shows “✅  All done – you may now close this tab/window.”, return here.\n"
        ),
        success_message=(
         "✅  All done – you may now close this tab/window."
        ),
    )

    # Write Google’s JSON structure verbatim; get_token.py can read it back
    TOKEN_FILE.write_text(creds.to_json())
    print(f"\n💾  Credentials saved → {TOKEN_FILE}\n")

# ──────────────────────────────── entry ───────────────────────────────────
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nAborted by user.")
```


### **get_token.py**
> Ensure the script’s shebang (`#!`) points to the Python interpreter inside your virtual environment. For example, `#!/home/youruser/msmtp/venv/bin/python3`.

This script is invoked by msmtp (via the `passwordeval` directive) to retrieve a valid access token, refreshing it if necessary. Open the file with `nano ~/msmtp/get_token.py` and paste:

```python
#!/home/pi/msmtp/venv/bin/python3
# ↑ EDIT this path so it points to **your** virtual-env’s python3.
#   It must remain the very first line (the she-bang) or the shell
#   won’t know which interpreter to launch.

"""
get_token.py
============

Purpose
-------
Called by **msmtp** (via the `passwordeval` directive) to print a fresh
OAuth 2.0 *access-token* for Gmail.
If the cached credentials are expired, the script silently refreshes them.

How it fits together
--------------------
                ┌──────────────┐
  authorize.py ─►  credentials.json   (one-time, interactive)   ─┐
                └──────────────┘                                 │
                                                                 ▼
                            ┌───────────────────────┐    sendmail /
  msmtp ─ passwordeval ────►│   get_token.py (this) │──►  cron   /
                            └───────────────────────┘            /

Prerequisites
-------------
1. **Python virtual-env** with up-to-date libraries:

       pip install --upgrade google-auth google-auth-oauthlib \
                               google-auth-httplib2 requests

2. **credentials.json** generated by `authorize.py` must be located in
   the *same* directory as this script.

3. **msmtprc** should reference this file **without** prepending `python3`,
   e.g.:

       passwordeval "/home/pi/msmtp/get_token.py"
       auth         oauthbearer

Maintenance notes
-----------------
* Deleting `credentials.json` forces a new OAuth consent run.
* If you move or replace the virtual-env, update the she-bang above.
* Logging / debugging can be enabled by inserting `print()` statements or
  using Python’s `logging` module—keep output quiet in normal operation
  because msmtp expects the token only.

"""

from __future__ import annotations

import pathlib
import sys

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

# ─── Constants ────────────────────────────────────────────────────────────
BASE_DIR = pathlib.Path(__file__).resolve().parent
TOKEN_FILE = BASE_DIR / "credentials.json"           # produced by authorize.py
SCOPES = ["https://mail.google.com/"]                # full Gmail SMTP scope

# ─── Helper ───────────────────────────────────────────────────────────────
def fresh_token() -> str:
    """
    Return a valid access-token, refreshing credentials if required.
    Exits with an error message (non-zero code) if no usable refresh-token
    is present.
    """
    if not TOKEN_FILE.exists():
        sys.exit("credentials.json missing – run authorize.py first")

    creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            # Silent refresh (HTTP request to Google’s token endpoint)
            creds.refresh(Request())
            TOKEN_FILE.write_text(creds.to_json())
        else:
            sys.exit("No valid refresh-token – re-run authorize.py")

    return creds.token

# ─── CLI entry point ──────────────────────────────────────────────────────
if __name__ == "__main__":
    # msmtp reads whatever is printed to stdout.
    print(fresh_token())
```



### Run these commands to ensure that the scripts are executable and that the current user has the correct ownership:
```bash
sudo chmod +x ~/msmtp/authorize.py ~/msmtp/get_token.py
sudo chown -R "$(whoami):$(whoami)" ~/msmtp
chmod 600 ~/msmtp/client_secret.json
chmod 700 ~/msmtp/get_token.py ~/msmtp/authorize.py
```

---

## Step 4. Configure msmtp as the System Sendmail

### a. Edit the msmtp System Configuration File  
Open (or create) the file `/etc/msmtprc` with sudo:
```bash
sudo nano /etc/msmtprc
```
Copy and paste the configuration below, making sure to adjust any values as needed for your setup:
```bash
# Global defaults
defaults
auth           oauthbearer
tls            on
tls_trust_file /etc/ssl/certs/ca-certificates.crt

# Path to log file — change this to your preferred location
logfile        /home/pi/msmtp/msmtp.log

# Gmail account configuration
account        gmail
host           smtp.gmail.com
port           587

# Your Gmail address — change both 'from' and 'user' to your actual Gmail address
from           your-email@gmail.com
user           your-email@gmail.com

# Path to the token-fetching script — update if you move or rename the script
passwordeval   "/home/pi/msmtp/get_token.py"

# Set a default account
account default : gmail
```
*Note:* The `auth oauthbearer` directive tells msmtp to use OAuth 2.0 rather than a static password. The `passwordeval` directive executes a Python script to supply a fresh access token each time msmtp is invoked.

Save and exit (in nano, press `Ctrl+O` then `Ctrl+X`).



## Step 5. Testing and Sending Email


### a. Run the Authorization Script

> **What you need**
> **Raspberry Pi (Assuming it has no GUI or browser):** Runs the `authorize.py` script.
> **Computer X:** Has a web browser and SSH access to the Pi.


**Run the script on the Pi (over SSH)**

It will print a long Google “consent URL”.
```bash
cd ~/msmtp
./authorize.py
```


**⚠️ Important: Before you open the long Google “consent URL”, launch a second terminal on Computer X and start an SSH tunnel.**

> Runs an SSH tunnel so Computer X’s port 8888 is piped straight to port 8888 on the Pi.
> Forward **local port 8888** on Computer X → **port 8888** on the Pi.
> ➡️ Keep this terminal open until the consent flow finishes.

```bash
ssh -NT -L 8888:localhost:8888 <your-user>@<pi-ip>
# e.g.
# ssh -NT -L 8888:localhost:8888 pi@192.168.1.100
```



**Grants Your Raspberry Pi Access to Gmail**

> On Computer X, paste the consent URL into the browser, choose your Gmail account, and click `Continue`. This grants your Raspberry Pi access to Gmail.

Google will redirect to
`http://localhost:8888/?code=…`

> Thanks to the SSH tunnel, the browser’s callback reaches the Pi on port 8888, completes the OAuth flow, and creates **`credentials.json`** in the same directory.

You will see something similar like this in the SSH tunnel terminal:
```
channel 2: open failed: connect failed: Connection refused
```
> It simply means the temporary SSH tunnel tried to pass one more connection after OAuth had finished, but `authorize.py` had already stopped listening on port 8888. Your authorization succeeded; you can safely press Ctrl-C to close the tunnel and carry on.


**Watch for the message**

```
Credentials saved → credentials.json
```

**Close the tunnel**
> Press Ctrl + C in the terminal where you started the `ssh -NT -L` command. It will close the SSH session and the tunnel.


### b. Verify Token Retrieval
Test the token refresh script by running:
```bash
cd ~/msmtp
./get_token.py
```
You should see the token printed to the console — this is the access token that `msmtp` will use for authentication, as it reads the password from the script's standard output. It's important to print only the token, with no extra messages. If your server is used by multiple users, make sure to set strict file permissions (e.g., `chmod 600` for config and credentials, `chmod 700` for the script) so that only the intended user can access the token and related files.


### c. Send a Test Email

Once `msmtp` is properly configured (via `/etc/msmtprc`), it acts as a lightweight SMTP client that can send email via Gmail using OAuth 2.0. You can test email delivery.

When configured correctly, **any system process or script that sends mail via `sendmail` will automatically use `msmtp` under the hood**. This includes tools like `cron`, `logwatch`, or custom alert scripts — making it a simple and secure way to receive automated system notifications via Gmail.


**Quick one-liner test using `sendmail`**

```bash
echo -e "Subject: Test Email\n\nThis is a test email sent using msmtp with Gmail OAuth 2.0." | sendmail recipient-email@gmail.com
```

This confirms that the `sendmail` command is correctly routed to `msmtp`.



**Create a test email file and send it manually**

```bash
cat <<EOF > testmail.txt
From: Your Name <your-email@gmail.com>
To: Recipient Name <recipient@example.com>
Subject: Test Email from msmtp

Hello,

This is a test email sent from msmtp using OAuth 2.0.
EOF
```

```bash
msmtp recipient@example.com < testmail.txt
```

> This method gives you more control over the message structure and headers, and is helpful for debugging formatting or content issues.



### d. Debugging and Logs
If sending fails, check the msmtp log file for details:
```bash
cat ~/msmtp/msmtp.log
```
The log file will help diagnose any authentication issues or token errors.

---

## Summary

1. **Google Cloud Setup:**  
   - Create a new project.
   - Configure the OAuth consent screen.
   - Create an OAuth 2.0 Client ID.

2. **System Setup:**  
   - Install msmtp, msmtp-mta, Python 3, and the necessary Python libraries.

3. **Scripts:**  
   - Place `client_secret.json`, `authorize.py`, `get_token.py` and `msmtp.log`  in a dedicated folder (e.g., `~/msmtp`).
   - Run `./authorize.py` to perform the OAuth flow and save credentials.
   - Verify token retrieval with `./get_token.py`.

4. **msmtp Configuration:**  
   - Configure `/etc/msmtprc` to use OAuth 2.0 (`auth oauthbearer`) with a `passwordeval` command calling your token script.

5. **Test Email:**  
   - Send a test email using the `sendmail` command, and review logs if errors occur.

By following these updated steps on your Raspberry Pi or Ubuntu system, you will have successfully configured msmtp to send emails via Gmail using OAuth 2.0 authentication—ensuring both enhanced security and compliance with Google’s current requirements.
