---
title: Sending Email from Raspberry Pi using MSMTP and MUTT
description: Configure MSMTP and Mutt on Raspberry Pi to send system notification emails via Gmail's SMTP server.
date: 2024-04-28 09:00:00 +0800
categories: linux
toc: true
media_subpath: /assets/media/2024/sending-email-from-raspberry-pi
image: raspi-email.webp
tags: [linux, email, raspberrypi]
pin: false
math: true
mermaid: true
comments: true
---


### 📢 Note: Updated Version
> An updated version of this guide is available at:
> [https://linsnotes.com/posts/sending-email-from-raspberry-pi-using-msmtp-with-gmail-oauth2/](https://linsnotes.com/posts/sending-email-from-raspberry-pi-using-msmtp-with-gmail-oauth2/)
> *(OAuth 2.0 is now required for `msmtp` to work with Gmail, as Google no longer supports simple password authentication.)*

Sending emails from a Raspberry Pi for system notifications can be efficiently achieved using `msmtp` and `mutt` in conjunction with Gmail's SMTP server. This guide outlines the simple steps to install and configure `msmtp` and `mutt`, along with setting up a Google App Password for secure authentication.

### Step 1: Install `msmtp`
1). Open a terminal on your Raspberry Pi.
2). Install `msmtp` using the following command:
   ```bash
   sudo apt-get update
   sudo apt-get install msmtp msmtp-mta
   ```
During the installation process, you may encounter a prompt asking whether to enable `AppArmor` support. Make sure to select **YES** to enable AppArmor support, which enhances the security of your system by confining the capabilities of programs like msmtp, thus reducing the potential impact of security breaches.


### Step 2: Configure `msmtp`
1). Create a system-wide configuration file for `msmtp` by running the following command:

```bash
sudo nano /etc/msmtprc
```

This system-wide configuration ensures that the settings are applied globally, allowing other programs on your Raspberry Pi to utilize email functionalities seamlessly. It provides a centralized location for email configuration, enabling easier management and consistent behavior across various applications and scripts.


2). Add the following configuration for Gmail SMTP:
   ```bash
   account default
auth on
tls on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
tls_starttls off
logfile /var/log/msmtp.log

host smtp.gmail.com
port 465

from <your-gmail-email-address>
user <our-gmail-email-address>
password <your-google-app-password>

   ```
Disabling `tls_starttls` helps mitigate potential **Man-in-the-Middle** attacks by ensuring that the connection between msmtp and the SMTP server remains encrypted from the start, without relying on an additional layer of encryption negotiation (STARTTLS). This adds an extra layer of security to your email communications, especially when transmitting sensitive information.


3). Replace `<our-gmail-email-address>` with your own gmail email address. Don't include the angle brackets.

4). Save and close the file by pressing `Ctrl + O`, then `Enter`, and `Ctrl + X`.

**To generate a Google App Password, you'll need to follow these steps:**

1). **Go to your Google Account settings:**
   
   Visit https://myaccount.google.com/ and sign in to your Google account if you're not already signed in.

2). **Navigate to Security settings:**
   
   In the left-hand menu, click on "Security."

3). **Find "Signing in to Google" section:**
   
   Scroll down until you find the "Signing in to Google" section.

4). **Access "2-Step Verification" settings:**
    
   Scroll down to the "Signing in to Google" section and locate the "2-Step Verification" option. Click on it to access your 2-Step Verification settings. If you haven't set up 2-Step Verification, you'll need to do so first. Follow the prompts to set it up for your Google account. Once it's set up, return to the Security settings to proceed with generating the app password.

5). **Generate App Password:**
   Once authenticated,  give it a name related to your Raspberry Pi or the application using it. Click on "Create" or similar. Google will then generate a unique app password for you.

7). **Copy and Store the App Password Securely:**
   
   Google will display the generated app password once. It's crucial to copy it and securely store it, as you'll need it for configuring msmtp on your Raspberry Pi. If you forget or lose the password, you'll need to delete it and create a new one, as Google typically doesn't display the password again for security purposes. Make sure to store it in a safe and accessible location.

### Step 3: Change Onwership and user to msmtp group

To ensure that the msmtp configuration file is owned by the root user and the msmtp group, and to grant the current user the necessary permissions to access the msmtp configuration, follow these steps:

Change the ownership of the /etc/msmtprc file to root:msmtp:
```bash
sudo chown root:msmtp /etc/msmtprc
```
Add the current user to the msmtp group:
```bash
sudo usermod -aG msmtp $(whoami)
```
These steps will ensure proper ownership and permissions for the msmtp configuration file.



### Step 4: Test `msmtp`
Send a test email to ensure everything works:
   ```bash
   echo "Subject: Test Email" | msmtp --debug -a gmail <recipient-email>
   ```
   - Replace `<recipient-email>` with the email address you want to send to.
   - If the setup is correct, the email should be sent successfully.

### Step 5: Additional Considerations

It's essential to ensure that your firewall allows traffic on the required port for secure email transmission.

To enable communication over port 465/tcp for TLS encryption, you'll need to configure your firewall. If you're using Uncomplicated Firewall (UFW), make sure it's installed before proceeding. If not, you can install it using the following command:
   ```bash
   sudo apt install ufw
   ```
   Once UFW is installed, allow traffic on port 465/tcp with the following command:
   ```bash
   sudo ufw allow 465/tcp comment 'allow-smtp'
   ```
This command allows incoming TCP traffic on port 465 and adds a comment for reference ('allow-smtp'). Adjust your firewall settings according to your specific setup if you're not using UFW.



### Step 6: Setting up Mutt for Sending Emails with Attachments

While msmtp allows you to send basic emails, sending emails with attachments requires additional functionality provided by mutt. Mutt is a text-based email client that integrates seamlessly with msmtp to facilitate sending emails, including attachments, directly from your Raspberry Pi.

1). **Install mutt:**
   If you haven't already installed mutt, you can do so by running the following command:
   ```bash
   sudo apt install mutt
   ```


2). **Testing mutt:**
   You can now test mutt by sending a simple email. For example:
   ```bash
   echo "This is a test email sent using mutt." | mutt -s "Test Email" recipient@example.com
   ```
Replace `recipient@example.com` with the email address you want to send the test email to.

The `-s` flag in the `mutt` command is used to specify the subject of the email. So, when the recipient receives the email, they will see "Test Email" as the subject line.


If you're unable to send emails using msmtp, you can add the following line to your `~/.muttrc` configuration file using a text editor like nano or vim.

Here's how you can do it:

1). Open the mutt configuration file using your preferred text editor. For example:
   ```bash
   nano ~/.muttrc
   ```

2). Add the following line to the configuration file:
   ```
   set sendmail="/usr/bin/msmtp"
   ```

3). Save the changes and exit the text editor.

After making this change, `mutt` will be configured to use `msmtp` for sending emails. You can then retry sending the email to verify the configuration.


**Sending emails with attachments:**
   
   To send emails with attachments using mutt, you can use the `-a` flag followed by the path to the file you want to attach. For example:
   ```bash
   echo "This email contains an attachment." | mutt -s "Email with Attachment" -a /path/to/attachment.txt recipient@example.com
   ```
   Replace `/path/to/attachment.txt` with the actual path to the file you want to attach.

### Conclusion

With msmtp and mutt configured on your Raspberry Pi, you can now send emails, including attachments, directly from the command line. This setup allows you to automate system notifications and other email-related tasks efficiently. By combining msmtp for email delivery and mutt for composing and sending emails, you have a versatile solution for managing email communications on your Raspberry Pi.


**Rich Text Formatting:**

With msmtp alone, you're limited to sending plain text emails without any formatting options. For example:

```bash
echo "This is a plain text email" | msmtp recipient@example.com
```

However, with mutt, you can compose emails with rich text formatting, including HTML content or styled text. For example:

```bash
echo "<h1>This is an HTML-formatted email</h1>" | mutt -e "set content_type=text/html" -s "HTML Email" recipient@example.com
```
This command sends an email with HTML-formatted content, displaying a heading styled as \<h1\>.

### Sending email using bash script
The Bash script below simplifies sending emails with attachments by prompting the user to input the recipient's email address, the email subject, the content, and an optional attachment file path. Once provided, the script sends the email using mutt and msmtp. Additionally, after sending the email, the user is given the option to save a copy in their Documents/email/ directory, with the saved file named based on the email's date and subject. This script enhances efficiency in email communication, requiring minimal inputs while providing the convenience of archiving sent emails for future reference.

```bash
#!/bin/bash

# Prompt for recipient email
email_pattern='^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
while true; do
    echo "Enter the recipient email:"
    read recipient
    if [[ $recipient =~ $email_pattern ]]; then
        echo "Valid email format. Sending email to: $recipient"
        break
    else
        echo "Invalid email format. Please enter a valid email address."
    fi
done

# Prompt for email subject
echo "Enter the email subject:"
read subject

# Prompt for email content
echo "Enter the email content:"
read content

# Prompt for attachment path

while true; do
    read -p "Enter the attachment file path (or leave empty and press 'Enter' if there's no attachment): " attachment

    # Break if the user says "no", regardless of case, or leaves it blank
    if [ -z "$attachment" ]; then
        echo "No attachment provided."
        break
    elif [ -f "$attachment" ]; then
        # If the file exists, break the loop
        echo "File attached: $attachment."
        break
    elif [[ ! -f "$attachment" ]]; then
        # If the file doesn't exist, prompt the user again
        echo "Error: File does not exist. Please enter a valid file path."
    fi
done


# Create a temporary file for the email content
temp_email=$(mktemp)
# Ensure the temporary file is deleted when the script exits
trap 'rm -f "$temp_email"' EXIT INT TERM HUP
echo -e "$content" > "$temp_email"

# Send the email using mutt with msmtp
if [ -z "$attachment" ]; then
    # No attachment
    mutt -s "$subject" -- "$recipient" < "$temp_email"
else
    # With attachment
    mutt -s "$subject" -a "$attachment" -- "$recipient" < "$temp_email"
fi

# Display email details in the terminal
echo "[Successful] Email sent to $recipient on $(date +"%Y-%m-%d %H:%M:%S")"

echo "Recipient: $recipient" > $temp_email
echo "Subject: $subject" >> $temp_email
echo -e "\nContent:\n$content" >> $temp_email
echo -e "\nAttachment: $attachment" >> $temp_email
while true; do
    read -p "Do you want to save a copy in ~/Documents/email/ directory? (yes/no): " save_copy
    case $save_copy in
        [Yy]|[Yy][Ee][Ss])
            # Create email directory if it doesn't exist
            mkdir -p "$HOME/Documents/email"

            # Generate filename with date and subject
            date_formatted=$(date +"%Y-%m-%d")
            filename="$date_formatted-$(echo "$subject" | tr ' ' '-').txt"
            save_path="$HOME/Documents/email/$filename"
            # Save email copy
            cp "$temp_email" "$save_path"
            rm -f "$temp_email"
            echo "Email copy saved as '$filename' in $HOME/Documents/email."
            break;;
        [Nn]|[Nn][Oo])
            rm -f "$temp_email"
            echo "Email copy not saved."
            break;;
        *)
            echo "Invalid input. Please enter 'yes' or 'no'."
            ;;
    esac
done
```

1). **Copy and Save the Script:**
   Copy the script below and save it with a name of your choice, such as `send_email.sh`.

2). **Make the Script Executable:**
   Use the following command to make the script executable:
   ```bash
   sudo chmod +x send_email.sh
   ```

3). **Optionally Create an Alias:**
   To conveniently run the script from any directory, you can create an alias in your `.bash_aliases` file. Open the file and add the following line:
   ```bash
   alias sendemail="cd /path/to/send_email.sh && ./send_email.sh && cd -"
   ```
   Replace `/path/to/send_email.sh` with the actual path to your script. Since the name `sendmail` is used by a system command, remember to use another name like `sendemail`(email) for the alias."

4). **Run the Script:**
 Now, you can run the script by navigating to the directory where `send_email.sh` is located and typing `./send_email.sh` in your terminal. If you created an alias, you can simply type `sendemail` from any directory in your terminal.

