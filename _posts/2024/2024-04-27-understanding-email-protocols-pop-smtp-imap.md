---
title: Understanding Email Protocols - POP, SMTP, and IMAP
description: Learn the differences between POP, SMTP, and IMAP email protocols, plus mail agents like MTA, MDA, and MUA.
date: 2024-04-28 09:00:00 +0800
categories: linux
toc: true
media_subpath: /assets/media/2024/understanding-email-protocols/
image: email-protocol.webp
tags: [linux, email]
pin: false
math: true
mermaid: true
comments: true
---

POP (Post Office Protocol) retrieves emails from a server, typically downloading them to your device and then removing them from the server. SMTP (Simple Mail Transfer Protocol) is designed for sending emails. IMAP (Internet Message Access Protocol) retrieves emails but keeps them on the server, allowing access from multiple devices and enabling synchronization.


- **SMTP** is for sending emails.
- **POP** is for receiving emails by downloading and removing them from the server.
- **IMAP** is for receiving emails while keeping them on the server for multi-device access.

- **MTA (Mail Transfer Agent)**: Responsible for sending and routing emails between servers. Examples include Postfix, Sendmail.
- **MDA (Mail Delivery Agent)**: Handles the final delivery of emails to a local mailbox on a server. It processes incoming emails and deposits them into a user's inbox. Examples are Procmail and Dovecot's LDA.
- **MUA (Mail User Agent)**: The email client that users interact with to read, send, and manage emails. Examples include Outlook, Thunderbird, and Apple Mail.


