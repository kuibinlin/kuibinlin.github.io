---
layout: post
title: Building a Kubernetes Lab with k3s and LXD Part 1 Preparing the Ubuntu Host
description: Prepare a single Ubuntu server to run k3s inside LXD containers. Remove Docker, disable swap, handle the nftables firewall, and install LXD with ZFS storage.
date: 2026-07-13 08:00:00 +0800
published: true
categories: [kubernetes]
tags: [k3s, kubernetes, lxd, ubuntu, snap, lxc, container]
toc: true
media_subpath: /assets/media/2026/kubernetes-lab-with-k3s-and-lxd-part-1-preparing-the-ubuntu-host
image: kubernetes-lab-part1.webp
---

Most Kubernetes tutorials hand you a cluster that someone else already set up. You learn how to *use* it, which is useful, but you never build one from scratch, and you never get to break it and watch it recover. That last part is where the real learning is. Building a cluster, breaking it, and seeing how it picks itself back up teaches you far more than reading about it ever will.

So why doesn't everyone learn this way? Usually it comes down to hardware. A proper multi-node cluster needs several servers, and that means either buying machines or renting cloud instances that charge you for every hour they're running.

**This lab gets around all of that.** All you need is one computer with Ubuntu on it, and that's easy to set up on an old PC or a spare laptop. That single machine becomes your *host*. On top of it you run five small LXD containers, and each one plays the part of a separate server: three for the control plane and two as workers. Because all five share the host's kernel, they barely use any resources and start in about two seconds, so you can happily run all five at once, and tear any of them down and rebuild it whenever you feel like it.

And it genuinely behaves like the real thing. Every node has its own hostname and IP, the three control-plane nodes form a real etcd quorum, and when one goes down, it goes down for real. All of that from a single machine, with no second computer and no cloud bill.

> **Goal of this part:** get one Ubuntu machine ready to run five LXD containers as k3s nodes (3 masters, 2 workers).
>
> **Scope:** we don't install k3s yet. This part only gets the host ready, so that container networking and Kubernetes both work later. Skip it, and you'll spend a later afternoon chasing Kubernetes errors that really come from a host setting you changed months ago.
{: .prompt-info }

**Before we go further, a quick word about the firewall.** In this lab it matters more than you might expect, so it's worth a moment now.

Your containers talk to each other, and out to the internet, by passing through the host. If the host's firewall blocks that traffic, nothing points at the firewall as the cause. Instead your nodes can't find each other, the cluster never comes together, and downloads inside a node just hang. It all looks like Kubernetes is broken, when the real culprit is a single firewall setting. That's why it's worth getting right before k3s is even in the picture.

> **Good news:** if you've never touched your firewall, there's nothing to do here. A fresh Ubuntu install lets everything through by default, so your containers just work. The firewall steps later in this guide are only for people who've deliberately locked their firewall down.
{: .prompt-tip }

This guide uses **nftables**, the firewall built into Ubuntu 22.04 and 24.04. One thing to know: the old `iptables` command still exists, but these days it just writes to nftables behind the scenes. So `iptables` and `nft` aren't two firewalls, they're the same one with two names. To keep things clear, everything here uses `nft`.

## Hardware

**Reference machine** — what this guide was written against:

| | |
|---|---|
| OS | Ubuntu 24.04 LTS |
| RAM | 32 GB |
| CPU | 12 cores |
| Disk | 1 TB, LVM, with unallocated space in the volume group |

**Requirements for the 5-node lab** (3 masters + 2 workers):

| | Requirement | Why |
|---|---|---|
| OS | **Ubuntu 24.04 LTS** | What this guide is built and tested on |
| RAM | **8 GB** | ~1.5 GB per node |
| CPU | **4 cores** | 3 etcd members plus workloads |
| Disk | **At least 50 GB** of unallocated space<br>in your LVM volume group<br>(this becomes the LXD storage pool),<br>plus ~20 GB free for the host | Images, k3s, snapshots, monitoring |

**This guide assumes you have at least 50 GB of unallocated space in your volume group** and uses ZFS on a dedicated logical volume. Step 1 checks that. If your volume group is full, see the note at the end of Step 6.

---

## Step 1 — Survey the host

Every command here is read-only. Nothing changes yet. The point is to find out what you're working with before making decisions that depend on it.

```bash
# Capacity
lsb_release -a
free -h
nproc
df -h /

# Existing network layout
ip -brief addr
ip route

# Existing container stack
docker ps 2>/dev/null
docker system df 2>/dev/null

# The entire packet filter, in one place
sudo nft list ruleset

# Swap
swapon --show
grep -i swap /etc/fstab

# Real disk capacity (not just what's mounted)
sudo vgs
sudo lvs
```

### What you're looking for

| Command | The question | Why it matters |
|---|---|---|
| `free -h` | At least 8 GB, for five<br>nodes at ~1.5 GB each? | 8 GB is the<br>required minimum |
| `df -h /` | At least ~20 GB free<br>on the host? | 20 GB is the host minimum;<br>later parts want more<br>(images, monitoring) |
| `ip route` | Which subnets are<br>already claimed? | Your bridge must not collide<br>with any. This guide uses<br>`10.99.99.0/24` |
| `docker ps` | Anything running<br>you must not break? | Docker is removed in Step 2,<br>so on a fresh Ubuntu install<br>there's nothing to do here |
| `nft list ruleset` | Is forwarded<br>traffic allowed? | Forwarded traffic must be<br>allowed; bridged container<br>traffic hits the forward hook |
| `swapon --show` | Will kubelet<br>refuse to start? | It will, if swap is on |
| `vgs` / `lvs` | At least 50 GB unallocated<br>in the volume group? | 50 GB is the required minimum;<br>installers often carve out<br>far less than the disk holds |

**Reading `nft list ruleset`.** Empty output means nothing is being filtered, which is Ubuntu's default and exactly what you want. Nothing to do here.

If the output is *not* empty, you've set up a firewall at some point. The easy path is to reset nftables back to its default of allowing everything. If you'd rather keep your firewall, that's fine, but make sure it allows the traffic this lab depends on:

- **All traffic in and out of the LXD bridge `lxdbr0`** (it gets created later). This is what carries traffic between the nodes and out to the internet.
- **DHCP and DNS from the nodes to the host.** Without these, a node can't get an IP address or resolve names.

Steps 4 and 8 come back to the firewall once the bridge exists.

---

## Step 2 — Remove Docker (if present)

### Why

**Removing Docker isn't about a conflict with k3s.** The two actually get along fine. k3s brings its own containerd on its own socket and ignores whatever else is installed, so they run side by side without any trouble.

The real reasons are more specific, and there are three of them.

The first is about networking. Every time the Docker daemon starts, it sets the firewall's forward policy to *drop*. Traffic between containers on a bridge is forwarded traffic, so it runs straight into that policy. Docker then adds its own allow rules to get around the block it just created, and LXD adds its own on top. Most of the time this works. When it doesn't, you get a networking failure that is genuinely hard to trace.

The second reason matters more, and it's about keeping problems easy to diagnose. Things will break during this lab. That's the whole point. When two nodes can't reach each other, you want only one thing that could be at fault. With Docker gone, the cause is either LXD or something you did yourself. Leave Docker running, even when it's idle, and every networking issue turns into a three-way guessing game that costs you an hour you didn't need to spend.

The third reason is specific to nftables. When LXD starts, it decides which firewall system to use by looking for existing iptables rules, and Docker's rules look exactly like those. So if Docker is still installed, LXD can quietly fall back to the older firewall backend, which is the one this guide is trying to avoid. Step 8 checks which backend you ended up with.

So remove it. You can always put it back once the lab is stable, and by then you might well prefer to move those workloads into k3s anyway.

### Check whether Docker is installed

A couple of quick checks tell you whether Docker is on the machine at all:

```bash
which docker && docker --version
snap list docker 2>/dev/null
```

If both come back empty, Docker isn't installed and you can skip the rest of this step. If either one shows something, Docker is here and needs to go.

### Remove it completely

If you're running Docker, you already know your way around it, so this part is light on step-by-step. Do three things, in this order:

1. **Back up any container data you want to keep.** Once Docker is removed, its volumes go with it and there is no undo. Save anything that matters before you start.
2. **Remove Docker entirely.** Not just the packages, but its images, volumes, config, the apt repository it added, and any leftover network bridges. A half-removed Docker is worse than none, because the leftovers are exactly what send you chasing ghosts later.
3. **Clear the firewall rules it left behind.** Docker rewrites its own rules on every start, including the forward policy set to `drop`. The cleanest way to wipe them is to reboot once the packages are gone, since nothing puts them back.

### Final state

When Docker is truly gone, all of these should hold. This is the clean starting point the rest of the guide assumes:

```bash
which docker || echo "docker: gone"
dpkg -l | grep -i -E 'docker|containerd' || echo "packages: gone"
sudo nft list ruleset
ip -brief addr
df -h /
```

- The `docker` command is gone, and no `docker` or `containerd` packages remain.
- `nft list ruleset` shows no Docker tables or chains, and nothing setting the forward policy to `drop`.
- There is no `docker0`, and no leftover `br-*` or `veth*` interfaces.
- `df -h /` shows noticeably more free space than before.

---

## Step 3 — Turn off swap

### Why

**Kubernetes won't start while swap is on.** The kubelet checks for it and refuses to run. This is a hard error by default, not a warning you can wave away.

Here's the reasoning. Kubernetes assumes that memory limits mean something real. When you tell it a pod may use 512 MB, the scheduler packs pods onto nodes based on that number, and the kubelet steps in to evict pods when a node runs low on memory. Swap quietly breaks all three of these. A pod that goes over its limit should be killed, but with swap on it just spills to disk and keeps crawling along about a hundred times slower. The node reports free memory that isn't really there. And eviction never kicks in, because the node never looks like it is under pressure. Nothing crashes. The cluster just gets slower and slower for no reason you can see, and that silent, confusing failure is exactly why Kubernetes refuses to start instead.

**You only turn swap off once, on the host, not inside each container.** LXD containers share the host's kernel, and swap is a kernel-level facility, so there is no separate swap inside a container. When the kubelet in a node checks whether swap is on, it is really reading the host's setting. Turn swap off on the host and all five nodes see it as off.

(Kubernetes 1.28 and later has a beta feature called NodeSwap that allows swap in certain cases. It is off by default, needs cgroup v2, and adds complexity for no real gain in a lab, so we leave it alone.)

### Turn it off

First, find out what your swap actually is, a file or a partition:

```bash
swapon --show
grep -i swap /etc/fstab
```

On Ubuntu it is almost always a swap **file**. If so:

```bash
sudo swapoff /swap.img
sudo sed -i '/swap.img/ s/^/#/' /etc/fstab
sudo rm /swap.img
```

If yours is a swap **partition** instead, use its device name and skip the `rm`:

```bash
sudo swapoff /dev/<device>
sudo sed -i '/\sswap\s/ s/^/#/' /etc/fstab
```

Here is what those commands do:

- `swapoff` turns swap off in the running system right away. On its own, though, it only lasts until the next reboot.
- The `sed` line is what makes it stick. It finds the swap line in `/etc/fstab` and puts a `#` in front of it, so the line is commented out and swap does not come back at boot. Commenting instead of deleting means you can undo it later by removing that one `#`.
- `rm` deletes the swap file itself, which frees the disk space it was using (often several gigabytes). Swap stays off for this lab, so there is no reason to keep the file around.

### Check it worked, before you reboot

```bash
grep -i swap /etc/fstab    # the swap line should now start with #
swapon --show              # should print nothing
free -h                    # Swap should read 0B
```

Do this now, while a mistake is easy to fix. If the `sed` edit went wrong, this is where you catch it. Miss it, and swap quietly comes back at the next boot, and then k3s fails for a reason you were sure you had already dealt with.

If you ever want swap back, recreate the file and turn it on with `sudo fallocate -l 8G /swap.img && sudo mkswap /swap.img && sudo swapon /swap.img`, then uncomment the line in `/etc/fstab` so it survives a reboot.

---

## Step 4 — Review your firewall

This step is only for people who have deliberately set up a firewall on the host. If you've never touched yours, skip ahead to Step 5. A fresh Ubuntu install allows everything by default, so LXD will just work.

If you did set one up, deal with it now, before LXD goes in. For a lab, the simplest and safest choice is to reset your firewall back to its default of allowing everything. This opens every port again, SSH on port 22 included, so you won't lock yourself out of the machine. With nothing filtering, nothing can quietly block your nodes.

If you'd rather keep your firewall, that's fine, but it needs to allow the traffic this lab depends on:

- All traffic in and out of the LXD bridge `lxdbr0` (it gets created in Step 7). This carries traffic between the nodes and out to the internet.
- DHCP and DNS from the nodes to the host, so each node can get an IP address and resolve names.

You set the firewall up, so you already know how to open those. This guide won't walk through your specific ruleset.

Either way, check where you're starting from and save a copy for later:

```bash
sudo nft list ruleset | tee ~/nft-before-lxd.txt
```

Empty output means nothing is filtering, which is the clean state you want. If it shows rules, sort them out now, then run this again so the saved copy reflects your final state. Step 8 uses this file to show you exactly what LXD adds once the bridge exists.

---

## Step 5 — Install LXD

### Why LXD and not something else

k3s needs to run on something that looks like a real machine. It expects `systemd` running as its first process, its own network, its own filesystem, and its own hostname. That rules out some options straight away and turns the rest into a tradeoff.

| | What it gives you | Boot | RAM per node | Verdict for this lab |
|---|---|---|---|---|
| **Docker** | one process, no init | instant | tiny | **No.** The first process is your app, not systemd, so k3s can't run here. |
| **VirtualBox** | full VM, own kernel | 30s+ | 2 GB+ | Works, but heavy and awkward to script. |
| **Multipass** | full VM, own kernel | 20s+ | 2 GB+ | Works, but still a full kernel per node. |
| **LXD** | full OS, shared kernel | ~2s | ~1.5 GB | **Yes.** Machine-like, cheap, and instant. |

Docker is out because a container there runs a single process with no init system, which is not the machine-like environment k3s needs. VirtualBox and Multipass both work, but each node is a full virtual machine with its own kernel, so you are looking at 2 GB or more per node and 20 to 30 seconds just to start one.

LXD is the sweet spot. Because all the containers share the host's kernel, a node uses about 1.5 GB and starts in around two seconds. That speed changes how you use the lab. When you kill a master to watch etcd lose its quorum, `lxc stop master1` is instant and `lxc start master1` brings it back before you have finished reading the error. You will do that fifty times without thinking about it. With real VMs you would do it five times and give up.

There is one real downside, and it is worth being honest about. Sharing the kernel means k3s needs extra privileges that a normal container does not get, so these containers are **not** a security boundary. That is fine on your own machine, and it is exactly why you would never do this on shared or production infrastructure. A VM would give you real isolation; LXD gives you speed, and for a lab that is the better trade.

### Install LXD

On Ubuntu, LXD comes as a snap, and one command installs it:

```bash
sudo snap install lxd
```

`sudo` is required, because installing a snap changes the system. On Ubuntu 24.04 this gives you the current, supported version of LXD, which is exactly what you want. There is nothing else to pick.

One thing you might notice: `which lxd` can point at `/usr/sbin/lxd`. That is just a small helper script Ubuntu ships, not LXD itself. The real LXD is the snap you just installed, so you can ignore the helper.

### Check it installed

```bash
snap list lxd
lxc list
ip -brief addr
```

- `snap list lxd` should show the snap and its version.
- `lxc list` should print an **empty table**. That alone proves the LXD daemon is running and you can reach it. If you get a permission error on the socket instead, add yourself to the `lxd` group with `sudo usermod -aG lxd $USER`, then run `newgrp lxd`. You can also just put `sudo` in front of your `lxc` commands.
- `ip -brief addr` should show **no `lxdbr0` yet**. Installed is not the same as set up, and you configure the network in Step 7. If a bridge is already there, something set LXD up before you did, so look into that before moving on.

---

## Step 6 — Decide, and prepare storage

### What `lxd init` is for

Installing LXD gave you the software, but the daemon still has nothing set up. It has no storage to put containers on and no network to attach them to. `lxd init` is a one-time setup wizard that fills both in, a lot like `git init`. You run it once, answer a short list of questions, and LXD saves the result. Until you do, `lxc launch` has nowhere to put a container, so it just fails.

You will actually run the wizard in Step 7. It asks fifteen questions, and nearly all of them have a sensible default you can accept. Only two are worth deciding up front: the **network** your containers sit on, and the **storage** they run from. This step settles both.

### Decision 1: the container subnet

Your five nodes need a small private network of their own. You pick the range, and the one real rule is that it must not overlap a network you already use.

Steer clear of two things:

- **Your own LAN.** If the container range overlaps your real home or office network, traffic meant for those addresses goes to the containers instead and quietly vanishes, and the cause looks nothing like a container problem. Check what you already use with `ip route` and `ip -brief addr`, and check your router too, since a subnet you reach through the gateway won't show up in `ip route`.
- **k3s's own ranges**, which are `10.42.0.0/16` for pods and `10.43.0.0/16` for services.

`10.99.99.0/24` sits well clear of all of that, so that's what this guide uses. Give each node a fixed address from it:

| Node | Address |
|---|---|
| bridge / gateway | `10.99.99.1` |
| master1 | `10.99.99.11` |
| master2 | `10.99.99.12` |
| master3 | `10.99.99.13` |
| worker1 | `10.99.99.21` |
| worker2 | `10.99.99.22` |

### Decision 2: ZFS storage

For storage, use **ZFS**. The whole reason is snapshots. On ZFS, saving a container and restoring it later takes about a second and almost no disk, because ZFS points at the existing data instead of copying it. That matters here, because later parts of this lab are all about breaking things on purpose and rolling them back:

```bash
# 1. Save master1's current state. The snapshot name is yours to choose;
#    "before-i-wreck-it" just describes what it is for.
lxc snapshot master1 before-i-wreck-it

# 2. Now break something on purpose: kill etcd, corrupt a config, anything.

# 3. Roll master1 back to exactly how it was when you took the snapshot.
lxc restore master1 before-i-wreck-it
```

When that costs a second, you take a snapshot before every risky step and never think about it. So use ZFS if you possibly can.

ZFS wants its own space to manage, and the cleanest way to give it that is a dedicated logical volume. All it needs is **50 GB of unallocated space in your LVM volume group**, which on any normal disk in 2026 is easy to find. Ubuntu's installer usually leaves most of the disk unallocated in the volume group anyway, which is exactly what the `vgs` check back in Step 1 was for.

Create the volume now, before `lxd init`, so the wizard can point straight at it.

> **Your volume group is almost certainly named `ubuntu-vg`.** When you install Ubuntu with its default LVM layout, the installer creates one volume group and calls it `ubuntu-vg`, and every command below assumes that name. Confirm it with `sudo vgs` and look at the `VG` column. If yours shows a different name, use that in place of `ubuntu-vg` from here on.
{: .prompt-tip }

```bash
sudo vgs                                     # confirm the volume group name and free space
sudo lvcreate -L 50G -n lxd-zfs ubuntu-vg    # carve a 50 GB volume for ZFS out of it
```

That gives you a fresh, empty block device at `/dev/ubuntu-vg/lxd-zfs`. Nothing is formatted or resized, and your system disk is untouched. You are only claiming unused space, and you can hand it back any time with `sudo lvremove /dev/ubuntu-vg/lxd-zfs`. Step 7 installs the ZFS tools and runs `lxd init`, which formats and manages this device for you.

50 GB is enough for the whole series. If you have plenty of room, feel free to give it more, say 100 or 200 GB, which leaves the storage and monitoring parts in later chapters a bit more breathing space.

> **If you can't spare the space for ZFS:** LXD's `dir` backend stores each container as a plain folder and needs no dedicated volume, so the lab still runs. The only thing you give up is fast, near-free snapshots, since with `dir` each one is a full copy that takes real time and disk. If you go this way, choose `dir` instead of `zfs` when `lxd init` asks, and skip the volume above.
{: .prompt-info }

---

## Step 7 — Run `lxd init`

### Run it

> **These answers assume you chose ZFS in Step 6**, which is the path this guide uses. If you picked `dir` instead, it is simpler: skip the `zfsutils-linux` install just below, answer `dir` at the storage-backend question, and the three ZFS-only questions that follow it (create a ZFS pool, use an existing block device, and the path to it) never appear. The network answers are identical either way.
{: .prompt-info }

On ZFS, install the ZFS tools first, or `lxd init` won't offer the backend:

```bash
sudo apt -y install zfsutils-linux
```

Then:

```bash
sudo lxd init
```

Answers matching the decisions above:

```
Would you like to use LXD clustering?                        no
Do you want to configure a new storage pool?                 yes
Name of the new storage pool                                 default
Name of the storage backend to use                           zfs        (or dir)
Create a new ZFS pool?                                       yes
Would you like to use an existing empty block device?        yes        (if you made an LV)
Path to the existing block device                            /dev/ubuntu-vg/lxd-zfs
Would you like to connect to a MAAS server?                  no
Would you like to create a new local network bridge?         yes
What should the new bridge be called?                        lxdbr0
What IPv4 address should be used?                            10.99.99.1/24
Would you like LXD to NAT IPv4 traffic?                      yes
What IPv6 address should be used?                            none
Would you like the LXD server to be available over network?  no
Would you like stale cached images to be updated?            yes
```

If you have no spare block device, answer `no` to the block-device question and give a size for the loop file instead (50GiB is comfortable).

### What those answers actually configured

**The bridge** — `lxdbr0` is a software Ethernet switch. Everything plugged into it reaches everything else at layer 2, as if patched into the same physical switch.

**The IPv4 address** does two things at once:
1. Gives the bridge **the host's address on that network** (`10.99.99.1`). Your host is a participant, not just a switch.
2. Defines the subnet.

It also implicitly starts **dnsmasq** on the host, bound to the bridge, serving DHCP and DNS. That's why `master2.lxd` will resolve later.

**This is the address at the centre of the firewall question.** `10.99.99.1` is *on the host*, so DHCP and DNS requests from your nodes are addressed to the host — they traverse the **input** hook, not forward. The forward hook only sees traffic passing *through* the host to somewhere else. If your input policy is `drop` with no rule for the bridge, containers get no IP and no DNS, and nothing points at the firewall.

**NAT** — LXD adds a masquerade rule rewriting `10.99.99.x` to your host's real address on the way out. Same trick your router does for your LAN. Without it: no `apt`, no k3s installer, no images.

**The storage pool** — where container root disks live.

**The default profile** — `lxd init` also edits the `default` profile so every container automatically gets `eth0` on the bridge and a root disk from the pool. That's why `lxc launch ubuntu:24.04 master1` will work later with no extra flags.

### Verify

```bash
lxc network list
lxc storage list
ip -brief addr show lxdbr0
ip route
```

`lxdbr0` shows your chosen address. `ip route` shows `10.99.99.0/24 dev lxdbr0` and **no collision** with anything you use. Confirm you can still reach whatever you were reaching before.

### What exists now

```
your host
├── enp5s0     <your LAN address>     ← your real network
└── lxdbr0     10.99.99.1            ← new: virtual switch + host's address on it
                                     ← dnsmasq here for DHCP/DNS
                                     ← NAT: 10.99.99.0/24 → out via enp5s0
```

Plus an empty storage pool and a default profile. **No containers yet** — this built the room, not the machines.

---

## Step 8 — Confirm the firewall isn't in the way

`lxdbr0` now exists, so two quick checks confirm the firewall will not quietly block your nodes. For most people this is a formality, but do it now anyway: a firewall problem is obvious here, while the exact same problem three hours into Kubernetes just looks like Kubernetes is broken.

### LXD is using nftables

```bash
lxc info | grep -i -A2 firewall
```

You want to see `firewall: nftables`. On Ubuntu 24.04 with Docker removed (Step 2), that is what you get: LXD found no old iptables rules and picked the modern backend on its own.

If it says `firewall: xtables` instead, something is still leaving iptables-style rules around, usually an active `ufw` or a Docker leftover that Step 2 missed. Clear it, then run `sudo systemctl restart snap.lxd.daemon` so LXD chooses again.

### What LXD set up for you

```bash
sudo nft list table inet lxd
```

LXD creates its own `table inet lxd` that lets your nodes pull an address and DNS from the host, allows traffic in and out of the bridge, and NATs it on the way to the internet. In other words, it opens exactly what the nodes need without you writing a single rule. (If you saved a baseline in Step 4, `sudo diff ~/nft-before-lxd.txt <(sudo nft list ruleset)` shows the same thing as a clean before-and-after.)

### If you kept your own firewall

If you never set up a firewall, you are finished: LXD's table is the only thing filtering the bridge, and it already allows everything the nodes need.

If you did keep a firewall, the rules you added back in Step 4 are what let the bridge traffic through, so there is nothing new to add here. Just watch out for one trap:

> **Do not reload a `flush`-based nftables config while LXD is running.** Most `/etc/nftables.conf` files begin with `flush ruleset`, which clears *every* table, LXD's `table inet lxd` included, and LXD will not rebuild it until it restarts. After editing that file, reboot (or run `sudo systemctl restart snap.lxd.daemon`) instead of just reloading, so LXD's table comes back.
{: .prompt-warning }

---

## Where you should be

| | |
|---|---|
| Docker | removed entirely, including its nftables tables |
| Swap | off, and won't return at boot |
| Firewall | nftables only; dead rules closed; `lxc info` reports the nftables backend; `table inet lxd` present alongside your own rules for `lxdbr0` |
| LXD | installed, `lxc list` returns an empty table |
| `lxdbr0` | exists, on a subnet that collides with nothing |
| Storage pool | exists |
| Containers | none yet — that's next |

**Next:** kernel modules and sysctls for k3s-in-LXD, the privileged profile, and launching the five nodes. Continue with [**Part 2, Building the Five Nodes**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-2-building-the-five-nodes/).
