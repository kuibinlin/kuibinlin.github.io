---
layout: post
title: Building a Kubernetes Lab with k3s and LXD Part 2 Building the Five Nodes
description: Get five LXD containers ready to run k3s. Load kernel modules, set sysctls, create a privileged LXD profile, and build five nodes from one template.
date: 2026-07-14 08:00:00 +0800
published: true
categories: [kubernetes]
tags: [k3s, kubernetes, lxd, ubuntu, snap, lxc, container]
toc: true
media_subpath: /assets/media/2026/kubernetes-lab-with-k3s-and-lxd-part-2-building-the-five-nodes
image: kubernetes-lab-part2.webp
---

This is **Part 2** of a series on building a Kubernetes lab with k3s and LXD. If you have not done Part 1 yet, start there: [**Part 1, Preparing the Ubuntu Host**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-1-preparing-the-ubuntu-host/). It gets the machine ready for everything below.

**Where you are.** By the end of Part 1, one Ubuntu machine had become a host ready to run containers. Docker was removed, swap was off, LXD was installed, a virtual network called `lxdbr0` was set up on the `10.99.99.0/24` range, and a ZFS storage pool was ready. There are no containers yet.

**What this part does.** It builds the five machines that k3s will run on, three masters and two workers, and proves each one works properly *before* Kubernetes is anywhere in the picture.

**What this part does not do.** It does not install k3s. That happens in [**Part 3, Installing k3s**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-3-installing-k3s/).

---

## Words you'll need

This part leans on a fair number of Linux and Kubernetes terms, and the steps read much more smoothly if those words already mean something to you. So rather than stop and explain each one mid-step, here they all are up front, in plain language. You do not need to memorise them. Skim the list now to build a rough picture, and come back to it whenever a word trips you up.

| Word | What it means |
|---|---|
| **kernel** | The core of Linux. It talks to<br>the hardware and decides what<br>every program is allowed to do. |
| **kernel module** | An optional piece of the kernel<br>that can be switched on when<br>needed, like a plug-in. Example:<br>the code for handling a certain<br>type of network traffic. |
| **`lsmod`** | Command that lists which kernel<br>modules are currently switched on. |
| **`modprobe`** | Command that switches a<br>kernel module on. |
| **sysctl** | A kernel setting you can change<br>while the machine is running.<br>Example: "how many files can one<br>user watch at once." |
| **container** | A program (or whole operating<br>system) that runs in an isolated<br>box on your machine. Faster and<br>smaller than a virtual machine. |
| **LXD** | The tool from Part 1 that creates<br>and manages containers. `lxc` is<br>the command you type; LXD is the<br>background service that does the<br>work. |
| **host** | Your actual Ubuntu server,<br>the machine everything runs on. |
| **node** | One of the five containers you're<br>about to build. Kubernetes calls<br>its machines "nodes." |
| **profile** | A saved set of container settings<br>in LXD. Apply a profile to a<br>container and it gets all those<br>settings at once. |
| **k3s** | A small, complete version of<br>Kubernetes. What you're building<br>this lab for. |
| **kubelet** | The part of Kubernetes that runs<br>on each node and starts and stops<br>the actual programs. |
| **kube-proxy** | The part of Kubernetes that sets<br>up network rules so programs can<br>find each other. |
| **containerd** | The program k3s uses to actually<br>run containers. So: containers,<br>inside your container. |
| **etcd** | The database where Kubernetes<br>stores everything. The three<br>masters will share one. |
| **flannel** | The default networking system in<br>k3s. It connects programs running<br>on different nodes. |
| **`lxdbr0`** | The virtual network switch LXD<br>created in Part 1. Your five nodes<br>plug into it. |
| **snapshot** | A saved copy of a container at<br>one moment. You can jump back<br>to it later. |

---

## Three things to know before you start

### 1. Nothing here fails loudly

This is the most important thing on the page.

If you skip a step in this guide, k3s will **not** stop with an error. It will start, report that it is healthy, and then something that looks unrelated will break later on. Here are some real examples of what you would actually see:

| What you skipped | What you would see instead |
|---|---|
| One kernel module | Programs on different nodes can't talk to each other |
| One kernel setting | The *third* node fails to start, while nodes 1 and 2 are fine |
| One container permission | "Permission denied" errors in five different places |

None of those point back at the real cause. That is why this part exists, and why it checks everything as it goes.

### 2. Most of this is needed because of LXD, not Kubernetes

If you installed k3s straight onto an Ubuntu server, with no containers involved, you could skip almost this entire guide. k3s sets itself up.

The catch is that k3s cannot do that from *inside* a container, because a container is not allowed to change the kernel. So you do that groundwork for it, on the host, before k3s ever runs.

Wherever a step is genuinely required rather than just tidy, this guide says so.

### 3. Some checks will look alarming for no reason

A few times in this guide, a perfectly healthy system gives you an answer that looks like a disaster. For example, a command may report that LXD is not running when LXD is actually fine.

This happens because a check sometimes answers a slightly different question than the one you had in mind. It is not your mistake, and it is not a fault.

Each case is explained right where it happens, so there is nothing to memorise now. Just carry one habit with you: **when a check surprises you, suspect the check before you suspect your machine.**

---

## Step 1 — Check Part 1 is still good

**Why:** everything below assumes Part 1's setup. If something drifted, find out now, not in three hours.

**Safe to run:** every command here only *reads*. Nothing changes.

```bash
# --- The host itself ---

swapon --show
# Lists swap space. Swap = disk used as pretend RAM.
# Kubernetes refuses to start if swap is on. Expect: nothing printed.

free -h | grep -i swap
# Second opinion on the same thing. Expect: Swap: 0B

which docker || echo "docker: gone"
# Part 1 removed Docker so there's only one thing managing container
# networking. Expect: "docker: gone"

# --- LXD ---

snap list lxd
# Confirms LXD is installed and shows its version.

systemctl is-active snap.lxd.daemon.unix.socket
# See the note below. Check the SOCKET, not the daemon. Expect: active

lxc info | head -3
# This wakes LXD up. Don't skip it; the next commands need it awake.

lxc list
# Expect: an empty table. No containers yet.

lxc network list
# Expect: lxdbr0, MANAGED = YES, IPv4 = 10.99.99.1/24

lxc storage list
# Expect: a pool named "default", type zfs (or dir)

# --- The virtual network ---

ip -brief addr show lxdbr0
# Shows lxdbr0's address. Expect: 10.99.99.1/24

ip route | grep lxdbr0
# Shows that traffic for 10.99.99.0/24 goes to lxdbr0.

# --- Free space ---

sudo zpool list
# Your ZFS storage pool. Expect: ~199G, HEALTH ONLINE, almost empty.

df -h /
# Free space on the main disk, separate from the ZFS pool.
```

### About that LXD check

**Don't run `systemctl is-active snap.lxd.daemon` here.** It will say `inactive`, and that is **normal**.

Here's why. LXD doesn't sit running all the time when it has nothing to do. Instead:

1. A **socket** listens quietly. (A socket is a doorway other programs knock on.)
2. When something knocks (say, your `lxc list`), LXD starts up and answers.
3. When it's idle again with no containers, it stops.

So with zero containers, "the daemon isn't running" is a healthy state, not a fault:

```
snap.lxd.daemon.unix.socket   active     ← always, if LXD is installed
        ↓  "lxc info" knocks on the door
snap.lxd.daemon               active     ← now it's awake
```

Once your five nodes are running, LXD stays awake permanently and this stops being confusing.

**Write down your network range now.** This guide uses `10.99.99.0/24` from Part 1's example. If you chose something different, swap it in everywhere below.

---

## Step 2 — Switch on the kernel modules k3s needs

This is the first of two small config files you create in this part. Both follow the same shape: you look at what is already there, you write one file, and then you check that it took effect. This step writes `/etc/modules-load.d/k3s.conf`, which tells Linux to switch on a handful of kernel modules every time the machine boots.

### Why this file has to exist

A kernel module is an optional piece of Linux you switch on when you need it, a bit like a plug-in for the core of the system. A lot of networking and container features live in these modules.

On a normal server you would never think about this. When k3s starts, it switches on the modules it needs by itself.

Your nodes are not normal servers, though. They are containers, and that is what changes things:

> All five containers share the host's single kernel. There is only one set of modules for the whole machine, and a container is not allowed to change them. An unprivileged container that tries to switch a module on is refused, because changing the kernel would affect the host and every other container too.

So when k3s starts inside a node and reaches for a module, it cannot switch one on. The fix is to switch the modules on yourself, once, on the host. Because all five containers share that same kernel, a module you load on the host is instantly available inside every node.

### Why k3s will not warn you

Here is the part that makes this step easy to skip and painful to debug: k3s does not stop when a module is missing. It just carries on.

When k3s starts, for each module it needs it does two things, in order:

1. It looks for a folder named `/sys/module/<module>`. That folder exists only when the module is already switched on. If k3s finds it, it says "already loaded" and moves on happily.
2. If the folder is not there, k3s tries to switch the module on itself, with a command called `modprobe`. Inside a container that attempt fails, but k3s only writes a warning to its log and keeps going.

So a node with a missing module still starts, still reports "Ready", and is quietly broken. Here is what that looks like in a real log, with one module missing and one already present:

```
level=warning msg="Failed to load kernel module nf_conntrack with modprobe"
level=info    msg="Module br_netfilter was already loaded"
```

Nothing crashed. Nothing turned red. One module simply is not there.

The good news is hidden in point 1 above. If you switch the module on from the host first, that `/sys/module/<module>` folder already exists by the time k3s looks. Your container can see it, because it is the host's kernel. k3s finds it, says "already loaded", and never runs the `modprobe` that would have failed. You are not fighting k3s. You are handing it the answer it checks for first.

### Which modules to switch on

For a typical k3s setup with its default Flannel networking on Ubuntu 24.04, these are the modules that matter. The exact set can shift a little with your kernel, your k3s version, and your networking choices, but this list covers the common case, and loading a couple of extras does no harm.

| Module | What it is for | If it is missing |
|---|---|---|
| `overlay` | Lets containerd stack image layers into a container's filesystem | containerd usually cannot unpack images, so nothing runs |
| `nf_conntrack` | Tracks live network connections so replies find their way back | Replies get dropped |
| `br_netfilter` | Makes bridge traffic visible to the firewall rules Kubernetes writes | Kubernetes' internal service addresses do not work |
| `iptable_nat` | Lets the older iptables path redirect traffic | Traffic can go nowhere on that path |
| `iptable_filter` | The table the older iptables path writes rules into | Nothing to write rules into on that path |

And one more that k3s does not name, but Flannel needs:

| Module | What it is for | If it is missing |
|---|---|---|
| `vxlan` | Builds the tunnel Flannel uses to carry traffic between different nodes | Programs on the same node still talk. Across nodes, nothing gets through. |

A note on `vxlan`: Flannel expects Linux to load it on demand when it builds the tunnel, and on modern kernels that often happens on its own. Loading it up front just removes the "did it or did not it" question. A note on `iptable_nat` and `iptable_filter`: Ubuntu 24.04 leans on the newer nftables system, so these older iptables modules are often not strictly needed. They are tiny and harmless, so this guide loads them anyway, as insurance in case something reaches for the older path.

You will also see longer lists online with names like `xt_conntrack`, `ip_vs`, or `dm_thin_pool`. The `xt_*` ones get pulled in automatically as dependencies, and the rest are for features you are not using here. A short list you understand beats a long one you copied.

### First, check what is already loaded

Before writing anything, see which of these are switched on already:

```bash
lsmod | grep -E '^(overlay|br_netfilter|nf_conntrack|vxlan|iptable_nat|iptable_filter)\s'
# lsmod lists the modules that are currently switched on.
# The grep narrows it to just the ones we care about.
```

On the reference machine (Ubuntu 24.04, right after Part 1), the whole output was a single line:

```
nf_conntrack          200704  3 nf_nat,nft_ct,nft_masq
```

Only one was present. Here is why:

| Module | Present? | Why |
|---|---|---|
| `nf_conntrack` | **yes** | LXD switched it on itself, so containers can reach the internet. |
| `overlay` | **no** | Docker usually loads this, and Part 1 removed Docker. Nothing else needed it. |
| `br_netfilter` | **no** | A plain Ubuntu server has no reason to switch it on. |
| `vxlan` | **no** | Same. |
| `iptable_nat`, `iptable_filter` | **no** | Ubuntu 24.04 uses nftables by default, so the old iptables modules were never loaded. |

`overlay` being missing is the one that earns this whole step. Without it, containerd usually cannot unpack an image, and the error you get back tends to look like a download or disk problem rather than a missing module. It is the most important line in the file you are about to write.

### Write the file

This writes the module list to `/etc/modules-load.d/k3s.conf`, which Linux reads at every boot, and then loads the modules right now so you do not have to reboot:

```bash
sudo tee /etc/modules-load.d/k3s.conf >/dev/null <<'EOF'
# Linux reads this file at every boot and switches on the modules listed.
#
# They are here because k3s cannot switch them on from inside a container.
# k3s checks /sys/module/<name> first and skips its own attempt if the
# module is already on, which is exactly what this file arranges.

# --- The ones k3s asks for ---
overlay
nf_conntrack
br_netfilter
iptable_nat
iptable_filter

# --- Not named by k3s, but Flannel needs it ---
# Without this, programs on different nodes cannot reach each other.
vxlan
EOF
```

Then switch the modules on right now, so you do not have to reboot:

```bash
sudo systemctl restart systemd-modules-load.service
# Reads the file above and switches on the listed modules immediately.
```

### Verify it worked

```bash
systemctl status systemd-modules-load.service --no-pager | head -5
# Did the service run cleanly? Expect: "active (exited)".
# "exited" is correct here. It does its job once and stops.

lsmod | grep -E '^(overlay|br_netfilter|nf_conntrack|vxlan)\s'
# Expect: all four now listed.

# The check that matters most. This is exactly what k3s will look for:
for m in overlay nf_conntrack br_netfilter iptable_nat iptable_filter vxlan; do
  [ -d "/sys/module/$m" ] && echo "ok   $m" || echo "MISSING $m"
done
```

That last loop is worth more than trusting `lsmod`, because `/sys/module/<name>` is the exact folder k3s checks. Six `ok` lines mean k3s will say "already loaded" six times and never reach for the `modprobe` it cannot run. Any `MISSING` is a warning line waiting for you in Part 3.

You may see `refcnt 0` next to the new modules. That just means nothing is using them yet, which is correct. Nothing will, until k3s starts.

If the service reports a failure:

```bash
journalctl -u systemd-modules-load.service -b --no-pager
# Shows why. Usually a typo in a module name.
```

### Worth knowing

- **LXD has a setting that looks like it does the same job** (`linux.kernel_modules`). It does work, but it only runs when a container starts, it fails without telling you, and it hides a fact about your host inside a container's config. Keep this file as the real answer. You will add the LXD setting in Step 4 as a backup, not a replacement.
- **The order is handled for you.** Step 3 changes kernel settings, and some of those settings do not exist until `br_netfilter` is switched on. Linux runs modules-load before sysctl automatically, so this works out. You just cannot do it the other way round.
- **If you ever rebuild this lab on virtual machines, delete this step.** Each VM has its own kernel and k3s handles the modules itself. This file exists only because of containers.

---

## Step 3 — Change the kernel settings k3s needs

This is the second of the two config files. It follows the same shape as Step 2: check what is there, write one file, then verify. This step writes `/etc/sysctl.d/99-k3s-lxd.conf`, a few kernel options that k3s needs but cannot set for itself from inside a container.

### Why this file is needed

A **sysctl** is just a kernel setting you can change while the machine is running. An example is "how many things one user is allowed to watch for changes at once." k3s does set its own sysctls when it starts, so it is fair to ask why this step exists at all.

The answer is that these settings come in two kinds, and k3s can only handle one of them from inside a container.

**Per-container settings.** Each container gets its own private copy. k3s changes these inside each node and it works fine. Setting them on the host would do nothing for your nodes, so you leave them alone.

**Whole-machine settings.** There is a single copy shared by the entire machine, and a container is allowed to read it but not change it. When k3s tries, it gets "permission denied", writes a line to a log nobody reads, and carries on with whatever value was already there.

That second kind is the whole reason for this file. There are only four of them, and they are the ones to get right.

### The settings that actually matter

These are the whole-machine settings a container cannot change for itself. If you do nothing else in this step, do these four.

| Setting | Default | Change to | Why |
|---|---|---|---|
| `fs.inotify.max_user_instances` | 128 | `1024` | "inotify" is how programs watch files for changes, and Kubernetes leans on it heavily. All five nodes run as the same user and share this one pool. With the default of 128 and enough pods, a node can run out and refuse to start with "too many open files". Because the pool is shared, it tends to be a later node that hits the wall while the earlier ones are fine, which makes it look like that one node is broken when it is not. |
| `fs.inotify.max_user_watches` | 65536 | `1048576` | The same shared-pool problem, just slower to appear. When it runs out, changes to config files quietly stop being noticed. |
| `kernel.keys.maxkeys` | 200 | `2000` | containerd uses the kernel's keyring to hold secrets and identifiers, and that allowance is shared across all your nodes. Set too low, it can show up as containers randomly failing to start. |
| `kernel.keys.maxbytes` | 20000 | `2000000` | The same keyring, measured in bytes rather than number of keys. Raise it for the same reason. |

The pattern is the same every time: a single shared pool that all five nodes draw from. That is the shared-kernel trade-off again. On five real servers, each would have its own pool and none of this would come up.

### Settings k3s handles, that you pin anyway

These next four are the per-container kind, so k3s already sets them inside each node. You set them on the host too, not because the nodes need it, but so that if something goes wrong later the host is not one more place you have to check.

| Setting | Change to | Why bother |
|---|---|---|
| `net.netfilter.nf_conntrack_max` | `393216` | k3s sets this per node, but whether it fully takes effect from inside a container is not guaranteed, and if it fails it fails silently. A sensible value on the host gives you a sensible fallback. |
| `net.bridge.bridge-nf-call-iptables` | `1` | This one does not reach your nodes; each has its own copy that k3s sets. On the host it only affects `lxdbr0`, and it is usually already `1` once `br_netfilter` is on. You are writing down a value, not fixing one. |
| `net.bridge.bridge-nf-call-ip6tables` | `1` | The same thing for IPv6. Harmless. |
| `net.ipv4.ip_forward` | `1` | LXD already turned this on so containers can reach the internet. You are pinning it so a later change cannot quietly undo it. |

If you set only the first four, the lab will work. This second group is insurance, and it is worth knowing which half is which.

### Two quiet traps before you write the file

Neither of these gives you an error. Both quietly produce the wrong result and report success, so they are worth knowing first.

**Trap 1: a comment only works at the very start of a line.** If you write:

```
net.ipv4.ip_forward = 1   # for lxdbr0
```

Linux tries to set the value to the whole string `1   # for lxdbr0`. You get away with it here by luck, because Linux reads the `1`, hits a space, and stops, but there is no warning and next time you may not be so lucky. Keep every comment on its own line.

**Trap 2: your file runs last, so it can undo something Ubuntu set on purpose.** Files in `/etc/sysctl.d/` are applied in number order, and your file is numbered `99-`, so it runs after Ubuntu's own files and wins any disagreement. Suppose you copied `vm.max_map_count = 262144` from some guide. Ubuntu 24.04 has already set that to `1048576` in its own file. Because yours runs later, you would quietly cut it to a quarter of what Ubuntu chose, and `sysctl --system` would report that as a success.

So before adding any setting, check that nobody has already set it:

```bash
grep -rn "vm.max_map_count\|inotify\|conntrack_max" \
  /etc/sysctl.d/ /usr/lib/sysctl.d/ /etc/sysctl.conf 2>/dev/null
# Searches every sysctl file on the system for these settings.
# If Ubuntu already sets one, leave it alone.
```

The numbering system exists so you can override things. That cuts both ways.

### Write the file

```bash
sudo tee /etc/sysctl.d/99-k3s-lxd.conf >/dev/null <<'EOF'
# Kernel settings for running five k3s nodes as LXD containers.
# Comments must be on their own line. Linux does not strip a comment
# from the end of a value line; it tries to use it as part of the value.

# ---------------------------------------------------------------
# The four that matter: a single shared copy for the whole machine,
# and no container can change them. All five nodes run as the same
# user and draw from these shared pools. THIS IS WHY THIS FILE EXISTS.
# ---------------------------------------------------------------
fs.inotify.max_user_instances = 1024
fs.inotify.max_user_watches   = 1048576
kernel.keys.maxkeys           = 2000
kernel.keys.maxbytes          = 2000000

# ---------------------------------------------------------------
# The rest: k3s sets these per node itself. These host values are
# just so the host is not a second thing to check when debugging.
# ---------------------------------------------------------------
net.netfilter.nf_conntrack_max = 393216

# Each node has its own copy, so this only affects lxdbr0 on the host.
# Usually already 1 once br_netfilter is on. Pinned, not fixed.
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1

# For lxdbr0's internet access. LXD already set this.
net.ipv4.ip_forward = 1

# ---------------------------------------------------------------
# LEFT OUT ON PURPOSE: vm.max_map_count
# Ubuntu 24.04 already sets it to 1048576 in 10-map-count.conf.
# This file runs later (99-), so setting it here would only risk
# lowering Ubuntu's value. Leave Ubuntu's alone.
# ---------------------------------------------------------------
EOF
```

Then apply the settings now, without rebooting:

```bash
# --system is very noisy; it prints every file and every setting.
# The grep hides the noise and shows only real problems.
sudo sysctl --system 2>&1 | grep -iE 'error|cannot|denied|invalid'
```

That grep should print nothing at all. Silence is success here.

### Verify it worked

```bash
sysctl fs.inotify.max_user_instances \
       fs.inotify.max_user_watches \
       kernel.keys.maxkeys \
       kernel.keys.maxbytes \
       net.netfilter.nf_conntrack_max \
       net.bridge.bridge-nf-call-iptables \
       net.ipv4.ip_forward \
       vm.max_map_count
```

- The four that matter should read back exactly what you put in the file.
- `vm.max_map_count` should be **1048576**, Ubuntu's value, which you left alone. Anything lower means something else in `/etc/sysctl.d/` is overriding it, so find it with the `grep` above.
- `No such file or directory` on the `net.bridge.*` lines means `br_netfilter` is not switched on. Go back to Step 2. This is the ordering point from Step 2 showing up as a failure.

### Two lines in the output worth reading

Scroll back through what `sysctl --system` printed. Two lines are worth a look.

**`net.ipv4.conf.all.rp_filter = 2` is good news.** This setting decides how strictly Linux checks that a reply comes back the way the request went out. Ubuntu ships mode `2`, the relaxed one. Mode `1`, the strict one, breaks Kubernetes networking, because replies take a different path and get thrown away. You already have the right value and did nothing to get it. If you ever inherit a server set to `1`, this is where that problem hides.

**`/run/sysctl.d/zz-lxd.conf` means LXD wrote a settings file of its own.** The next section is about that.

### The Ubuntu 24.04 AppArmor setting, which LXD already handles

Ubuntu 24.04 added a security restriction that stops ordinary programs from creating certain kinds of isolation. The programs k3s runs inside your container need exactly that kind of isolation. This restriction did not exist on 22.04, and left on, it causes confusing failures.

You do not need to do anything about it, but it is worth understanding rather than skipping. Ubuntu's own file turns the restriction on:

```
kernel.apparmor_restrict_unprivileged_userns = 1
```

Yet at the very end of `sysctl --system`, you see this:

```
* Applying /run/sysctl.d/zz-lxd.conf ...
kernel.apparmor_restrict_unprivileged_userns = 0
kernel.apparmor_restrict_unprivileged_unconfined = 0
```

LXD wrote that file itself when you installed it in Part 1. The `zz-` prefix is deliberate: files apply in alphabetical order, so `zz-` runs last and wins, over Ubuntu's `10-` and over your `99-` too. LXD knows its containers need this and turns the restriction off on their behalf. (The exact settings LXD writes have shifted a little across LXD versions, so treat this as how current Ubuntu 24.04 with the LXD snap behaves, and check yours below rather than trusting the text.)

Three things follow from that:

- **Do not add this setting to your own file.** LXD handles it, and `zz-` beats `99-` anyway, so your line would do nothing while looking important.
- **It lives in `/run`, not `/etc`.** `/run` is wiped and rebuilt at every boot. That is correct: the change lasts exactly as long as LXD is installed and disappears cleanly if you ever remove it. Do not "fix" this by copying it into `/etc`.
- **You have accepted a trade-off without being asked.** A security protection is off so your lab can run. It is the same bargain as Part 1's, and LXD simply made the call at install time.

Check yours rather than trusting the text:

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
# Expect: 0

cat /run/sysctl.d/zz-lxd.conf 2>/dev/null || echo "not present, investigate before Step 4"
# Expect: a small file that explains itself.
```

If you get `1`, LXD did not write it. Find out why before you build five nodes on top.

### Reboot now, while it is free

The whole point of these two files is that they survive a reboot. The only honest way to know is to reboot and look.

Do it here. You have no containers yet, so there is nothing to lose, and this is the last moment that stays true.

```bash
sudo reboot
```

When it comes back, check the host first, and only the host. None of this involves LXD yet:

```bash
# Did Step 2 survive?
for m in overlay nf_conntrack br_netfilter iptable_nat iptable_filter vxlan; do
  [ -d "/sys/module/$m" ] && echo "ok   $m" || echo "MISSING $m"
done

# Did Step 3 survive?
sysctl fs.inotify.max_user_instances kernel.keys.maxkeys vm.max_map_count

# Does Part 1 still hold?
swapon --show          # expect: nothing
```

Expect six `ok`, your four settings, `vm.max_map_count = 1048576`, and no swap.

Now wake LXD up before you check anything LXD owns. This is the socket thing from Step 1 again, and it will fool you if you forget:

```bash
lxc info | head -3     # THIS is what starts LXD. Don't skip it.
sleep 3

ip -brief addr show lxdbr0
ls -l /run/sysctl.d/zz-lxd.conf
sysctl kernel.apparmor_restrict_unprivileged_userns
```

If you check these before waking LXD, you get two alarming answers that are both wrong:

- `Device "lxdbr0" does not exist`, because LXD creates the network when it starts, and with no containers nothing has woken it yet.
- `apparmor_restrict_unprivileged_userns = 1`, because `/run` was wiped at boot and LXD has not rewritten its file yet.

Neither is a fault, though both look exactly like one.

Two more things in that output are worth understanding:

**`lxdbr0 DOWN` is correct.** A virtual switch with nothing plugged into it has no signal, so Linux marks it down. The address is there and the setup is fine. It comes UP the moment the first container plugs in, in Step 5. A switch still DOWN once five containers are running would be a real problem.

**The AppArmor setting reads `0`, and the file's timestamp is only seconds old, not from boot time.** That answers a question the file's location raises. Ubuntu applies sysctl files very early in boot, long before LXD starts, so it could never have read `zz-lxd.conf`, because the file did not exist yet. LXD does not rely on the file at all. It applies the setting itself when it starts, and writes the file only so anything that reads it later sees the right value. So the restriction really is `1` early in boot and drops when LXD wakes. That is harmless, because no container can start before LXD does anyway.

---

## Step 4 — Create the k3s profile

### Why the default settings aren't enough

Part 1's `lxd init` created a `default` profile giving every container a network connection and a disk. That's enough to boot Ubuntu and get an address. For most purposes, that *is* a machine.

k3s is not most purposes. **k3s wants to be an operating system that runs containers, inside a container.** Specifically:

- It runs **its own containerd**, which needs to create isolated environments and mount filesystems, things containers are normally blocked from doing.
- It runs **kube-proxy**, which rewrites firewall rules and writes to system folders that are normally read-only.
- It runs **kubelet**, which reads the kernel's log device, which containers don't have.

Each of those hits a wall. The profile below takes the walls down one at a time. **Each one costs you something.**

### What each setting does

| Setting | What it does | What breaks without it |
|---|---|---|
| `security.nesting: true` | Allows containers **inside** this container | containerd won't start at all. k3s never gets going. |
| `security.privileged: true` | Turns off the usual translation that makes "root" inside the container a harmless nobody outside it | A scattering of "permission denied" errors that each look like a different problem |
| `lxc.apparmor.profile=unconfined` | Removes the security profile wrapped around the container | containerd errors when starting programs, because it wants to apply its own profiles and can't |
| `lxc.mount.auto=proc:rw sys:rw` | Makes two system folders writable | kube-proxy can't write its network settings and quietly gives up |
| `/dev/kmsg` device | Passes the kernel's log device into the container | kubelet fails to start. **Very common, rarely explained.** |
| `boot.autostart: true` | Nodes come back after you reboot the host | You reboot and wonder where your cluster went |
| `linux.kernel_modules` | Backup for Step 2. **Must list the same six modules.** | Nothing, if Step 2 is right |

### The cost, said plainly

`security.privileged` + no AppArmor + writable system folders means:

> **Root inside one of these containers is root on your host.**

These nodes are **not** a security boundary. Anything that escapes one owns your machine.

That's fine on a computer you own and use for learning. It is **not** fine on a shared server, and it is not something to copy into anything real. Part 1 named this trade-off, 2-second boots in exchange for weaker isolation. This is where you sign it.

### Create it

```bash
lxc profile create k3s
# Makes an empty profile named "k3s".
```

Now fill it in. The command below replaces the whole profile with the YAML, which is why `name` and `description` are in it. It replaces the profile rather than merging into it:

```bash
cat <<'EOF' | lxc profile edit k3s
name: k3s
description: Privileged node profile for running k3s inside LXD. NOT a security boundary.
config:
  # Come back automatically after a host reboot.
  boot.autostart: "true"

  # Allow containers inside this container. k3s runs its own.
  security.nesting: "true"

  # Container root = host root. Needed for the mounts and settings
  # kubelet and kube-proxy make. THIS IS THE ONE THAT REMOVES ISOLATION.
  security.privileged: "true"

  # Backup for Step 2's /etc/modules-load.d/k3s.conf.
  # Must be the SAME SIX modules. If you change one, change both.
  linux.kernel_modules: overlay,nf_conntrack,br_netfilter,iptable_nat,iptable_filter,vxlan

  raw.lxc: |
    # Remove the security profile; containerd wants to apply its own.
    lxc.apparmor.profile=unconfined
    # Make /proc and /sys writable; kube-proxy writes to them.
    lxc.mount.auto=proc:rw sys:rw
devices:
  # Pass in the kernel's log device. kubelet reads it at startup
  # and fails without it.
  kmsg:
    source: /dev/kmsg
    path: /dev/kmsg
    type: unix-char
EOF
```

### Check it

```bash
lxc profile show k3s
lxc profile list
```

Both `default` and `k3s` should be there, both with `USED BY 0`. The `k3s` profile has no network and no disk in it, and **that's correct.**

**LXD will not show you back exactly what you typed, and that's fine.** It sorts the settings alphabetically and adds `used_by: []` and `project: default`. What matters is that every setting you wrote is present with the value you gave it. **A setting that's *missing* means LXD rejected your text, and it does that quietly.** That's the failure to look for.

**Profiles stack.** You'll launch containers with `-p default -p k3s`:

```
default profile  →  network connection + disk
k3s profile      →  the permissions above
                 →  container gets both
```

Keeping them separate means `lxc profile show k3s` shows you exactly what you gave away, on one screen, with nothing else mixed in.

**Keep the module list matching Step 2:**

```bash
lxc profile get k3s linux.kernel_modules
grep -v '^#\|^$' /etc/modules-load.d/k3s.conf | tr '\n' ',' | sed 's/,$//'
# Prints both lists so you can compare them.
```

Different order is fine. Different **contents** is a question to settle now.

Two lists that disagree are worse than no list at all. Nothing will break, because this setting is only a backup and Step 2's file does the real work, but in six months, neither list tells you which one you meant.

---

## Step 5 — Build one machine, not five

### Why one first

You're about to install the same packages and make the same checks five times. Don't.

Build **one** container, get it right, save it, and copy it. Three reasons, in order of importance:

**1. A saved template is an undo button for this whole step.** Get something wrong and you fix one container, not five that have already drifted apart.

**2. It's a comparison tool later.** In Part 3, when one node misbehaves, `lxc copy template/base test1` gives you a known-good node in one second to compare against. That's worth more than the setup time it saves.

**3. It's nearly free on ZFS.** This is Part 1's storage choice paying off. ZFS uses **copy-on-write**: making a copy doesn't duplicate anything, it just points the copy at the same data and only writes something when the copy changes. Five nodes from one 700 MB template cost about 700 MB, not 3.5 GB.

### Launch it

```bash
lxc launch ubuntu:24.04 template -p default -p k3s
# ubuntu:24.04  = Canonical's official image
# template      = the container's name
# -p default    = network + disk (from Part 1)
# -p k3s        = the permissions (from Step 4)

lxc list
```

**About the image name.** Use `ubuntu:24.04`. Older guides say `images:ubuntu/24.04`, but that source was removed from LXD's defaults and the command now fails on a fresh install. There's no reason to use it here.

Give it a few seconds, then check it can reach the outside world:

```bash
lxc exec template -- ping -c2 1.1.1.1
# Can it reach the internet by address? Tests LXD's address translation.

lxc exec template -- curl -sI https://archive.ubuntu.com | head -1
# Can it reach a website by name? Tests DNS, routing, and encryption
# all at once. Expect: HTTP/1.1 200 OK
```

**If either fails, stop.** Don't continue into k3s with a node that can't reach the internet, or you'll spend the afternoon reading installer errors instead. This is Part 1's firewall setup coming back. Fix it there.

### Three separate things just got proven

They're separate, and passing one tells you nothing about the others:

| What you saw | What it proves |
|---|---|
| The container has an address at all (`10.99.99.105` or similar) | It asked the host for one and got an answer. Requests to `10.99.99.1` go **to the host**, so a closed firewall would silently starve it of an address, and nothing would point at the firewall. |
| `ping 1.1.1.1` works | LXD's address translation is working. This is a completely different mechanism from the one above. |
| `curl` works | Name lookup, address choice, routing, and encryption all work, which is what `apt` and the k3s installer actually need. |

The address will be some number from LXD's pool. Ignore the specific value; Step 6 replaces it with a fixed one per node.

### Why `curl` and not the obvious DNS command

The obvious way to test name lookup is `getent hosts archive.ubuntu.com`. **Don't.** On a setup with IPv6 turned off (which is what Part 1 told you to do), it returns **nine IPv6 addresses and zero IPv4 addresses.**

It looks like a disaster. It's nothing at all. `getent hosts` asks for IPv6 first and reports what the *name service* knows, ignoring what your container can actually *reach*.

(`getent ahosts` shows the truth: only IPv4, because Linux notices the container has no IPv6 address and filters the IPv6 results out before you see them. Your Part 1 choice is being respected all the way down.)

But **`curl -sI` is the better test regardless**, because it tests what you actually depend on: DNS, address choice, route, and encryption, in one line. `HTTP/1.1 200 OK` closes all of it at once.

### Install what the nodes need

```bash
lxc exec template -- bash -c '
set -e
# set -e = stop immediately if any command fails.

apt-get update
apt-get -y upgrade
apt-get -y install curl ca-certificates iptables nfs-common open-iscsi jq netcat-openbsd
systemctl enable --now iscsid
'
```

What each package is for:

| Package | Why |
|---|---|
| `curl` | The k3s installer is downloaded with it |
| `iptables` | k3s brings its own, but this lets you *look at* the firewall rules from inside a node. You'll want to, constantly. |
| `nfs-common`, `open-iscsi` | Storage exercises in Part 4. One apt run now instead of five later. |
| `jq` | Reads JSON output nicely. You'll thank yourself. |
| `netcat-openbsd` | Tests whether a specific network port is reachable. Used in Step 7 to check the ports k3s needs. |

**Expect apt to tell you it had almost nothing to do.** On Ubuntu's official image, `curl`, `ca-certificates`, `iptables`, `open-iscsi` and `jq` are already there. Only `nfs-common` is genuinely new. That's fine; the point is that the requirement is now written down and verified rather than assumed.

**Expect the upgrade to install some odd things.** You'll watch a container with no screen install `plymouth` (a boot animation), a container with no hardware install `fwupd` (a firmware updater), and Linux defer building a boot image for a kernel this container doesn't have and can't boot. All of it inert.

It's the shared-kernel trade-off from the other side: the image is a complete operating system, and some of it is for hardware that isn't there. On ZFS your five copies share those files and it costs nothing. On the `dir` storage option you'd have paid for the boot animation five times.

**The last line is the one that matters.** `systemctl enable --now iscsid` succeeding proves that:

- **systemd is running as the container's main program**, and
- **services can be enabled and started normally.**

That's Part 1's whole "LXD not Docker" argument, demonstrated instead of asserted. In a Docker container, that command has nothing to talk to.

### Check the firewall inside the container

Ubuntu's image includes `ufw`, a firewall. It should be off, because an active firewall **inside** a node would fight Kubernetes' own rules in a way that's genuinely nasty to trace.

```bash
lxc exec template -- ufw status
# Expect: Status: inactive
```

**Ask ufw, not systemd.** `systemctl is-enabled ufw` says `enabled` on every Ubuntu image and tells you nothing useful. The *service* is enabled, so it runs at boot, reads its config, sees it's switched off, and exits without doing anything. Enabled service, inactive firewall. That's the shipped default.

If it says `inactive`, **do nothing.** Don't disable the service, because you'd be removing something you might want in Part 5, to solve a problem you don't have.

### Check the permissions actually applied

```bash
lxc exec template -- cat /proc/self/uid_map
# Expect exactly:  0          0 4294967295

lxc exec template -- ls -l /dev/kmsg
# Expect: a device file. kubelet needs this.

lxc exec template -- stat -fc %T /sys/fs/cgroup
# Expect: cgroup2fs  (the modern resource-control system)

lxc exec template -- ls /sys/module/br_netfilter
# Expect: a folder listing. See below; this one is the point of Step 2.

lxc exec template -- free -h | grep -i swap
# Expect: 0B. Inherited from the host. Kubernetes checks this.
```

**Reading `uid_map`:** it says which user IDs inside map to which outside. `0 0 4294967295` means "user 0 inside = user 0 outside, for all 4 billion of them." **No translation. Root inside is root outside.** That's `security.privileged` working, and it's the bill for the 2-second boots. If you see something like `0 1000000 1000000000` instead, your profile didn't apply: check you used `-p k3s`, and remember `security.privileged` needs a **restart** to take effect if you set it after launch.

**Reading `ls /sys/module/br_netfilter`:** this is Step 2 paying off, and it's worth a moment.

You are looking at the **host's** kernel information, from inside the container, because they share one kernel. When k3s runs here it will check this exact folder, find it, and log "Module br_netfilter was already loaded", never attempting the `modprobe` that would have failed. Step 2 explained that from k3s's source code. This is the same thing seen from the node's side.

### Freeze it

```bash
sudo zpool list default        # note the ALLOC column

lxc stop template
# Stop it first. See below. This matters.

lxc snapshot template base
# Save the current state under the name "base".

lxc list template
# The SNAPSHOTS column should now read 1.

lxc info template | sed -n '/Snapshots:/,$p'
# Show the snapshot's details.

sudo zpool list default        # compare ALLOC
```

**Watch `ALLOC`. It should not move.** On the reference machine it read `738M` before and `738M` after. **The snapshot cost zero measurable bytes**, because ZFS copied nothing. It simply stopped throwing away the data that's already there.

That's Part 1's storage argument, checked instead of claimed. And it matters for a reason that isn't about disk space: **because saving is free, you'll actually do it** before every risky thing in Parts 3 to 5. On the `dir` option this would have been ~700 MB and a real pause, which is exactly how that habit dies.

**`STATEFUL NO` is correct**, and it's why you stopped it first. A "stateful" snapshot also captures the container's live memory, which only applies to a running container. You want disk state here. A frozen memory image of a half-started k3s node is a much more fragile thing to restore.

**A note on the command:** use `sed -n '/Snapshots:/,$p'`, not `grep -A3`. `lxc info` prints a heading, a border, a column header, and another border, four lines in all, *before* the data. `grep -A3` shows you an empty box and hides the snapshot you just made.

`template` now stays stopped forever. It is your known-good starting point.

---

## Step 6 — Make five copies

### The address plan

From Part 1. Repeated here because you're about to type it:

| Node | Address | Job |
|---|---|---|
| the host | `10.99.99.1` | not a node, this is your server |
| master1 | `10.99.99.11` | starts the cluster |
| master2 | `10.99.99.12` | joins it |
| master3 | `10.99.99.13` | joins it |
| worker1 | `10.99.99.21` | runs your programs |
| worker2 | `10.99.99.22` | runs your programs |

Three masters, because Kubernetes' database needs an odd number to vote on decisions. Two workers, because that's enough to see things move between them.

### The order, and why

Everything here happens **while the containers are stopped.** `lxc copy` creates them stopped and they stay that way until 5.4. That's not incidental; it's what makes 5.2 and 5.3 free to get wrong and redo.

| # | Do this | When | If you get it wrong |
|---|---|---|---|
| **5.1** | Copy the five | first | none |
| **5.2** | Fixed addresses | **before first start** | Node grabs a random address and keeps it; needs a restart |
| **5.3** | Memory/CPU limits | any time before start | Just run `lxc config set` again; it overwrites |
| **5.4** | Start them | after 5.2 and 5.3 | none |
| **5.5** | Check | after starting | none |

**Only 5.2 is order-sensitive**, and only mildly. A node that starts without a fixed address asks the host for one, gets a random one from the pool, and holds onto it. Setting the fixed address afterwards doesn't move it, so you'd restart anyway. Doing it first means the node's **first** request gets the right answer.

### What needs a restart, and what doesn't

This decides whether changing your mind costs 2 seconds or 20:

| Change | Takes effect |
|---|---|
| `limits.memory`, `limits.cpu` | **Immediately.** LXD applies it live. No restart. |
| Fixed address | At the container's next start |
| `security.privileged`, `security.nesting` | **Restart required.** Set on a running container, it *appears* to work and doesn't. |
| Profile changes | Restart required, for every container using it |

### 5.1 Copy

```bash
sudo zpool list default        # note ALLOC, should be ~738M

for n in master1 master2 master3 worker1 worker2; do
  lxc copy template/base "$n"
done
# Copies the SNAPSHOT (template/base), not the live container.
# Creates each one STOPPED.

lxc list
# Expect: five STOPPED rows with no addresses yet. That's correct.

sudo zpool list default        # compare
```

**Watch `ALLOC` again.** Five nodes from a 700 MB template should cost almost nothing, because ZFS points all five at the same data rather than duplicating it.

On the reference machine: **738M → 792M. Fifty-four megabytes, for five machines.** Each node has drifted by about 11 MB (its own ID, its own logs) and shares everything else.

If `ALLOC` instead jumps by ~3.5 GB, ZFS made real copies rather than pointers. Worth knowing before you build a habit on a promise that isn't holding.

**This closes Part 1's storage argument.** Step 5 proved snapshots are free. This proves copies are.

### 5.2 Fixed addresses (do this before starting them)

```bash
lxc config device override master1 eth0 ipv4.address=10.99.99.11
lxc config device override master2 eth0 ipv4.address=10.99.99.12
lxc config device override master3 eth0 ipv4.address=10.99.99.13
lxc config device override worker1 eth0 ipv4.address=10.99.99.21
lxc config device override worker2 eth0 ipv4.address=10.99.99.22
```

**What `override` means here.** The network connection (`eth0`) came from the `default` profile, which all five share. `override` makes a **private copy** of that setting for one container, which you can then change. The profile itself stays untouched, which is why this is per-node config and not five separate profiles.

**To change an address later, use `set`, not `override`.** The `override` command is only for the first time, because its whole job is to copy the inherited `eth0` into the container. Once that private copy exists, running `override` on it again just fails with an error that the device already exists. From then on, `lxc config device set` is what edits the copy you already made, for example `lxc config device set master1 eth0 ipv4.address=10.99.99.14`.

Check before moving on:

```bash
for n in master1 master2 master3 worker1 worker2; do
  echo -n "$n: "
  lxc config device get "$n" eth0 ipv4.address 2>/dev/null || echo "(none)"
done
```

Expect `.11`, `.12`, `.13`, `.21`, `.22`. Any `(none)` means it didn't apply, so fix it now, not after starting.

**This doesn't configure the container's network card.** It tells the **host's address service** to always give that container the same answer. The node still asks for an address at boot like normal; it just always gets the same one.

That's the right place for it: nothing inside the node knows or cares, so a rebuilt node keeps its address for free. It's also why the `template`, which had no override, got a random `10.99.99.105`.

### 5.3 Memory and CPU limits (set them, but not for the obvious reason)

**The obvious reason is wrong.** You'd think limits protect the host from a runaway node, and conclude you can skip them on a big machine. That conclusion is wrong, for an interesting reason.

**LXD makes each container see its own limits as if they were the whole machine.** When you set `limits.memory=4GiB`, the container's own "how much RAM do I have?" answer becomes 4 GB. That's a feature called lxcfs, and it exists precisely for this.

**Set no limits and every node sees the entire host.** On a 32 GB / 12-core server:

```
Node       CPU    Memory
master1    12     32Gi
master2    12     32Gi
master3    12     32Gi        ← every node believes it has the whole machine
worker1    12     32Gi
worker2    12     32Gi
                             Kubernetes now thinks it has 60 cores and 160 GB.
```

kubelet reads exactly those numbers and reports them to Kubernetes. Kubernetes then places programs based on capacity **that does not exist**. The first real deployment runs the host out of memory, and **Linux picks what to kill**, not Kubernetes, not you. Nothing in `kubectl` will point at the cause.

So limits aren't protection here. **They're how each node learns its share of one machine.** That's the shared-kernel trade-off again: on real servers or virtual machines you'd have assigned RAM at creation and never thought about it.

**For a 32 GB / 12-core host:**

```bash
for n in master1 master2 master3; do
  lxc config set "$n" limits.memory=4GiB limits.cpu=2
done
for n in worker1 worker2; do
  lxc config set "$n" limits.memory=6GiB limits.cpu=4
done

lxc config get master1 limits.memory   # check one
```

That's 24 GB committed, 8 GB left for the host.

- **Masters get 4 GB.** The database uses a few hundred MB at this size, so there's real room for Part 3's exercises. **Don't go below 4 GB.** You'll see 2 GB suggested elsewhere. It's tight enough that a master can be killed **by your own limit** in the middle of an experiment, and separating "the failure I was studying" from "the failure I configured" is a genuinely annoying hour.
- **Workers get 6 GB** because they run your actual programs.
- Scale both down together if you're near Part 1's 8 GB floor. The ratio matters more than the numbers.
- **CPU deliberately over-allocates** (3×2 + 2×4 = 14 of 12). `limits.cpu` shapes what each node *reports*; containers still share the real cores.

**Note the `=` signs.** `lxc config set <name> <key> <value>` works for a *single* setting, but with more arguments it switches to `key=value` form. The space-separated version fails with `Invalid key=value configuration: limits.memory`, which is the command complaining, not your container. Nothing was changed.

**One caveat.** ZFS uses spare memory as a cache, up to about half your RAM by default. So 24 GB of nodes plus that cache is technically more than you have. It's fine; the cache gives memory back when something needs it. Cap `zfs_arc_max` if you'd rather it be exact.

**Changed your mind?** These are settings on stopped containers; nothing is committed until they start:

```bash
for n in master1 master2 master3 worker1 worker2; do
  lxc config unset "$n" limits.memory
  lxc config unset "$n" limits.cpu
done
```

### 5.4 Start them

```bash
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 10
lxc list
```

The `sleep 10` matters. `lxc list` straight after `lxc start` can show `RUNNING` with no address, because the container is up but hasn't finished asking for one.

### 5.5 Check

Three separate things, and none implies the others.

```bash
# 1. Running, with the addresses you chose
lxc list

# 2. Each node sees its own limit, not the host's
lxc exec master1 -- free -h | grep -i mem     # expect ~4.0Gi, NOT 32Gi
lxc exec worker1 -- free -h | grep -i mem     # expect ~6.0Gi
lxc exec master1 -- nproc                     # expect 2

# 3. Each node has its own name
for n in master1 master2 master3 worker1 worker2; do
  echo -n "$n -> "; lxc exec "$n" -- hostname
done

# And what the copies cost
sudo zpool list default
```

**1. Addresses.** Five `RUNNING` rows on `.11` to `.13` and `.21` to `.22`. A *different* address means that node started before its override and is holding a random one: `lxc restart <name>` and it'll ask again.

**2. Capacity.** If `free` shows 32 GB, the limit isn't being reflected and **kubelet will report your host's size as the node's size.** Fix it here. In Part 3 this shows up as Kubernetes claiming 32 GB per node and cheerfully overbooking five times over, with Linux, not Kubernetes, choosing what dies.

**3. Names.** LXD updates the hostname when copying, so this usually just works. Check anyway: **k3s registers nodes by hostname**, and five nodes all called `template` is a mess you don't want to untangle from inside the database.

```bash
lxc exec master1 -- hostnamectl set-hostname master1
lxc restart master1
```

**`Error: Instance is not running`** from any of these just means you're at 5.4, not 5.5. `lxc copy` leaves containers stopped.

---

## Step 7 — Check everything, before k3s exists

**Why this is the step not to skip:** everything here is cheap now and expensive in three hours. Right now, a networking problem is a networking problem. After Part 3, the exact same problem arrives disguised as a Kubernetes error, and you'll be looking in the wrong place.

```bash
# --- 1. All five up, right addresses ---
lxc list

# --- 2. Node to node, by address ---
lxc exec master1 -- ping -c2 10.99.99.12
lxc exec worker1 -- ping -c2 10.99.99.11
# Proves the virtual switch carries traffic between containers.

# --- 3. Node to node, by name ---
lxc exec master1 -- getent ahosts master2.lxd
lxc exec master1 -- ping -c2 master3.lxd
# Proves the host's name service knows your new nodes.
# (Names end in .lxd, which LXD adds automatically.)

# --- 4. Node to internet ---
lxc exec worker2 -- ping -c2 1.1.1.1
lxc exec worker2 -- curl -sI https://get.k3s.io | head -1
# That URL is literally what the Part 3 installer downloads.
# Expect: HTTP/2 200

# --- 5. Permissions, on every node, not just the template ---
for n in master1 master2 master3 worker1 worker2; do
  echo "== $n"
  lxc exec "$n" -- cat /proc/self/uid_map        # expect: 0 0 4294967295
  lxc exec "$n" -- ls /dev/kmsg                  # expect: /dev/kmsg
  lxc exec "$n" -- stat -fc %T /sys/fs/cgroup    # expect: cgroup2fs
done
# You've been ASSUMING the copies inherited the profile. This checks it.

# --- 6. The host still has its modules and settings ---
lsmod | grep -E '^(overlay|br_netfilter|vxlan|nf_conntrack)\s'
sysctl fs.inotify.max_user_instances net.netfilter.nf_conntrack_max

# --- 7. Disk, you're about to add five k3s installs ---
df -h /
sudo zpool list
```

### Reading the results

| What you see | Where the cause is |
|---|---|
| Node→node ping fails | LXD's firewall rules, or your own firewall wiped them. Part 1's firewall setup. **Reboot the host and retest before touching anything.** |
| By address works, by name fails | The host's name service. Those requests go **to the host**, which is a different firewall path from traffic passing *through* it. Part 1's firewall setup again. |
| Internet fails but node→node works | LXD's address translation is gone. Classic sign a firewall script ran while LXD was live. Reboot. |
| `uid_map` shows an offset | The profile didn't apply, or the container needs a restart. |
| `/dev/kmsg` missing | Check the container was launched **with** `-p k3s`, not just that the profile exists. |
| `/sys/fs/cgroup` isn't `cgroup2fs` | Unusual on 24.04. Investigate before installing k3s. |

**Notice what none of those mention: Kubernetes.** That's the entire value of doing this now.

### Two numbers worth reading

**Node-to-node is ~0.08 ms. Internet is ~3.5 ms.** That 40× gap is what you want to see; it means your nodes really are talking directly across the virtual switch, not being sent the long way round. The database in Part 3 will be happy at those speeds.

**`HTTP/2 200` from `get.k3s.io`** isn't a stand-in for the real thing. That **is** the address the Part 3 installer downloads from, tested from a real worker node.

### One thing ping does *not* prove

The pings above show the nodes can reach each other. But `ping` is a different kind of traffic from what k3s actually uses. A firewall can allow ping and still block the ports k3s needs, and that failure shows up in Part 3 disguised as "master2 won't join the cluster," which is a much worse place to discover it.

So here are the exact ports k3s will need, from the official requirements. **If you have no custom firewall, these are all open already and you can just read this as a preview.** If you have your own firewall rules (Part 1's `nftables.conf`), check them against this list *now*.

| Port | Type | Between | What it's for | Testable now? |
|---|---|---|---|---|
| 6443 | TCP | workers → masters | The main Kubernetes control channel | Yes |
| 2379, 2380 | TCP | master ↔ master | The shared database (etcd). **Only the three masters.** | Yes |
| 10250 | TCP | all nodes | Node statistics | Yes |
| 8472 | UDP | all nodes | flannel's tunnel, carries all traffic between programs on different nodes. This is what `vxlan` is for. | No, UDP, see below |

**You can test this now**, before k3s exists. The trick: you don't even need something listening. An open path and a blocked path behave *differently*, and this command reads that difference for you and prints a plain verdict:

```bash
lxc exec master1 -- bash -c '
nc -zv -w3 10.99.99.12 2379 2>&1 | grep -q -e succeeded -e refused \
  && echo "PASS: path to master2:2379 is open" \
  || echo "FAIL: path blocked (timed out), check firewall"'
```

Expect **PASS**.

**Why "refused" counts as a pass.** Left to itself, `nc` prints `Connection refused` here and calls it a "failure", which is misleading. Nothing is listening on 2379 yet, because k3s isn't installed. But the packet still **reached master2 and got an instant answer back**, which is the only thing this test needs to prove: the network carries traffic between masters on the etcd port. The wrapper above treats both "succeeded" (something listening) and "refused" (nothing listening, but reachable) as PASS, because both mean the path is open.

**The one real failure is a timeout.** If master1's packet leaves and nothing *ever* comes back, `nc` waits the full 3 seconds (`-w3`) and reports a timeout, and *that's* the firewall symptom. Only that prints FAIL. If you have a custom firewall (Part 1's `nftables.conf`), this is where it would show up. Fix it before Part 3.

The distinction is entirely about **speed**: refused comes back instantly (open), timed-out takes 3 seconds (blocked). (`nc` is netcat, a network-testing tool. `-z` = test only, `-v` = explain, `-w3` = give up after 3 seconds.)

To check every master-pair k3s needs, in one go:

```bash
for pair in "master1 10.99.99.12" "master1 10.99.99.13" "master2 10.99.99.13"; do
  set -- $pair
  lxc exec "$1" -- bash -c "
    nc -zv -w3 $2 2379 2>&1 | grep -q -e succeeded -e refused \
      && echo 'PASS: $1 -> $2:2379 (etcd)' \
      || echo 'FAIL: $1 -> $2:2379 blocked'"
done
```

Three PASS lines means the etcd network is ready for Part 3.

**The other ports k3s needs.** The etcd test above is the meaningful one; every port below crosses the *same* virtual switch with the *same* firewall treatment, so if 2379 is open, these almost certainly are too. But the docs list them, so here they are tested rather than assumed:

```bash
# Port 6443 (TCP), workers reach the masters' control channel:
lxc exec worker1 -- bash -c '
nc -zv -w3 10.99.99.11 6443 2>&1 | grep -q -e succeeded -e refused \
  && echo "PASS: worker1 -> master1:6443 (API) open" \
  || echo "FAIL: blocked, check firewall"'

# Port 10250 (TCP), node metrics, between all nodes:
lxc exec worker1 -- bash -c '
nc -zv -w3 10.99.99.11 10250 2>&1 | grep -q -e succeeded -e refused \
  && echo "PASS: worker1 -> master1:10250 (metrics) open" \
  || echo "FAIL: blocked, check firewall"'
```

Both should PASS instantly, for the same reason as the etcd test: nothing's listening yet, so you get a fast "refused," which means the path is open.

**Port 8472 (UDP), flannel's tunnel, can't be tested honestly this way, and it's worth understanding why.** TCP either completes a handshake or gets refused, a clear yes or no. UDP is "send and forget": nothing sends a reply, so a UDP test reports success just because the packet *left*, whether or not anything received it. So this tells you almost nothing:

```bash
# Informational only. A PASS here does NOT prove the packet arrived:
lxc exec worker1 -- nc -zvu -w3 10.99.99.11 8472
```

The honest test for 8472 is Part 3 itself: **if programs on different nodes can talk to each other, flannel's tunnel is working.** There's nothing listening on 8472 before k3s exists to confirm against, so don't chase this one now. Just know it's the port that carries all cross-node traffic, and that Part 3's first cross-node test is what actually verifies it.

**Two important addresses k3s claims for itself**, which is why Part 1 chose `10.99.99.0/24` and not something in these ranges:

- `10.42.0.0/16`, where k3s puts your running programs
- `10.43.0.0/16`, where k3s puts its internal service addresses

Your nodes are on `10.99.99.x`, well clear of both. If you picked your own range in Part 1, confirm it doesn't overlap these two, because an overlap causes networking failures that look nothing like their cause.

**On memory, for reference:** k3s's official minimum is 2 GB for a master and 512 MB for a worker. Your 4 GB / 6 GB from Step 6 sits comfortably above that. If you're tight on RAM, the real floor is Part 1's 8 GB total, not k3s's per-node numbers, so you can shrink the limits toward the official minimums, keeping masters larger than workers.

---

## Step 8 — Save a restore point

You now have five clean, prepared, connected machines and no k3s. **That is a state worth getting back to in one second.**

### Stop them first

A snapshot of a **running** container captures the disk mid-write. It is exactly like pulling the power cord; restoring it gives you a machine that boots as though it crashed.

Right now nothing important is happening, so you'd probably get away with it. **"Probably" is worthless in the thing you fall back to when you're already confused about something else.** Stopped snapshots are exact. It costs twenty seconds.

```bash
# Check what already exists (should be nothing on the five)
for n in master1 master2 master3 worker1 worker2 template; do
  echo "== $n"; lxc info "$n" | sed -n '/Snapshots:/,$p'
done
# Blank output for a node = it has no snapshots. lxc info leaves the
# section out entirely when there are none. That's the answer, not an error.

# Stop, save, start
for n in master1 master2 master3 worker1 worker2; do lxc stop "$n"; done
for n in master1 master2 master3 worker1 worker2; do lxc snapshot "$n" pre-k3s; done
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 10

lxc list                       # SNAPSHOTS column: 1 on all five
sudo zpool list default        # ALLOC barely moves
```

`lxc snapshot` **refuses** to overwrite an existing name rather than silently replacing it, so re-running this is safe. Worst case, an error.

This is the same distinction as `template/base` in Step 5, which read `STATEFUL NO` because you stopped it first. It matters more as you go: a mid-write snapshot of a **running database member** is far less trustworthy than a stopped one, and Part 3 is entirely about database members.

### The habit this is for

```bash
lxc snapshot master1 before-i-wreck-it
# ...break something on purpose...
lxc restore master1 before-i-wreck-it
# Back to normal in about a second.
```

**That reflex is the whole reason Part 1 chose ZFS.** Saving costs nothing and takes no time, so you'll actually do it, which means you'll experiment freely, because undoing a mistake is trivial.

If you used `dir` or a loop file instead, snapshots are slower and bigger. **Take `pre-k3s` anyway.** It's the one that matters most.

---

## Where you should be

| Thing | State |
|---|---|
| Kernel modules | Six switched on, saved in `/etc/modules-load.d/k3s.conf`, survive reboot |
| Kernel settings | Set, saved in `/etc/sysctl.d/99-k3s-lxd.conf`, checked after a reboot |
| `k3s` profile | Exists, stacks on `default`, permissions understood and accepted |
| `template` | Stopped, saved as `base`, ready to rebuild from |
| Nodes | Five running: `master1-3` on `.11-.13`, `worker1-2` on `.21-.22` |
| Networking | Node↔node by address and by name, node→internet, all proven |
| Capacity | Each node reports its own limit, not the host's |
| Snapshots | `pre-k3s` on all five |
| k3s | Not installed. That's next. |

### Things worth carrying forward

- **The template isn't just a shortcut. It's a comparison tool.** When a node misbehaves in Part 3, one command gives you a known-good node to compare against.
- **`security.privileged` and profile changes need a restart.** Set on a running container, they look like they worked.
- **The inotify limit will catch you eventually if you skipped Step 3.** Not at install. At node three, or the fourth deployment, looking like anything except a host setting.
- **Your firewall and LXD are still in tension.** Part 1's rule stands: never run a firewall script that flushes rules on a host with LXD running, without rebooting afterwards. It's now five nodes that go quiet instead of zero.
- **Nothing in this guide made your nodes secure.** They're deliberately not a security boundary. That's the right call for a lab on your own machine, and the wrong call everywhere else.

### What you've built, and what's next

That is Part 2 done. You now have five containers that look and behave like five separate servers: the kernel modules are loaded, the kernel settings are pinned, the privileged `k3s` profile is applied, each node has a fixed address and its own memory and CPU limits, and every node has a `pre-k3s` snapshot to fall back to. None of it is Kubernetes yet, but everything Kubernetes will reach for is already in place.

Part 3 turns these machines into one cluster. You start it on `master1`, then join `master2` and `master3` so that all three masters share the database and vote on decisions, and join `worker1` and `worker2` to run your programs. After that you deliberately stop a master and watch what that voting actually protects you from. The `pre-k3s` snapshots from Step 8 are what let you do that over and over, instead of just once.

Continue with [**Part 3, Installing k3s**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-3-installing-k3s/).
