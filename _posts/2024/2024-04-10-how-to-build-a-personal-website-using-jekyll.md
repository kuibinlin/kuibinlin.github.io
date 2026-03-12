---
layout: post
title: How to Build a Personal Website Using Jekyll
date: 2024-04-10 20:30:00 +0800
published: true #false or true
categories: website
tags: [jekyll, ruby]
---
# How to Build a Personal Website Using Jekyll
Note: This guide assumes that you are using a Windows machine.

## 1. What is Jekyll?
Imagine you're making a scrapbook. You have photos, texts, and decorations that you want to include. Normally, you would manually place each item on the pages. But what if you had a machine into which you could feed your photos and texts, and it would automatically arrange them into a finished scrapbook? Jekyll is like that machine, but for creating websites.

Here’s the key point: Jekyll creates "static" websites. Think of a static website as a printed book. Once it's printed, the content doesn’t change unless you print a new edition. It’s different from a live TV show, where things can change every minute. Jekyll takes your content (like articles or blog posts), formats it with a design of your choice, and creates a final website that doesn't change until you decide to update and ‘reprint’ it.

## 2. Ruby
Check if Ruby is Already Installed on Your Machine.
Command to check if Ruby is installed:

```powershell
ruby -v
```

## 3. Install Ruby

If Ruby is not installed, follow the guides on the Jekyll website to download and install it: [**Jekyll Installation Guide**](https://jekyllrb.com/docs/installation/).

## 4. Install Jekyll and Bundler

After installing Ruby, use the gem command to install Jekyll:
```powershell
gem install jekyll bundler
```

## 5. Build Your Website Locally

After installing Jekyll and Bundler, open PowerShell and use the command below to create your personal website:
```powershell
jekyll new directory_name
```

For example:
```powershell
jekyll new myblog
```
This will create a new directory called **myblog** in your current directory, populating it with the necessary files and structure for a new Jekyll site. This includes default configurations, templates, and content for a simple blog.

- /myblog
  - /_posts
    - yyyy-mm-dd-welcome-to-jekyll.md
  - .gitignore
  - _config.yml
  - about.md
  - Gemfile
  - Gemfile.lock
  - index.md

## 6. Serve Your Website Locally

In PowerShell, enter either:
```powershell
bundle exec jekyll serve
```
or
```powershell
jekyll serve
```
While **jekyll serve** alone often works fine, using **bundle exec jekyll serve** is a best practice in Ruby development. It ensures that your project's dependencies are properly managed and consistent.

## Customize your website
For more details on customizing your site, visit the Jekyll documentation on themes and overrides: [**Jekyll Themes Documentation**](https://jekyllrb.com/docs/themes/#understanding-gem-based-themes).
