---
layout: post
title: Building a Kubernetes Lab with k3s and LXD Part 3 Installing k3s
description: Install k3s across five LXD nodes to form a three master HA cluster with two workers, then break quorum on purpose to see how etcd protects itself.
date: 2026-07-15 08:00:00 +0800
published: true
categories: [kubernetes]
tags: [k3s, kubernetes, lxd, ubuntu, snap, lxc, container]
toc: true
media_subpath: /assets/media/2026/kubernetes-lab-with-k3s-and-lxd-part-3-installing-k3s
image: kubernetes-lab-part3.webp
---

This is **Part 3** of a series on building a Kubernetes lab with k3s and LXD. If you are just arriving, start with [**Part 1, Preparing the Ubuntu Host**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-1-preparing-the-ubuntu-host/) and then [**Part 2, Building the Five Nodes**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-2-building-the-five-nodes/). This part picks up exactly where Part 2 left off.

**Where you are.** Part 2 built five containers: `master1` to `master3` on `10.99.99.11` to `.13`, and `worker1` to `worker2` on `.21` to `.22`. They can already reach each other and the internet, every kernel module, kernel setting, and permission k3s will ask for is in place, and there is a `pre-k3s` snapshot on all five.

**What this part does.** It turns those five machines into one Kubernetes cluster: three masters that share a database and vote on decisions, and two workers that run programs. Then it deliberately breaks the cluster to show you what the voting was for.

**What this part does not do.** It does not run any real applications. That is Part 4. This part gets the cluster standing and proves it is healthy.

---

## Words you'll need

Building on Part 2's list. These are the new ones.

| Word | What it means |
|---|---|
| **server (k3s sense)** | A node that runs the control plane *and* holds a copy of the database. Your three masters. Confusingly, a k3s "server" also runs your programs unless you tell it not to. |
| **agent (k3s sense)** | A node that only runs programs and takes orders. Your two workers. |
| **control plane** | The part of Kubernetes that makes decisions: what runs where, what's healthy, what to do when something dies. Lives on the masters. |
| **API server** | The single front door to the cluster. Every command, every component, every `kubectl` goes through it. Listens on port `6443`. |
| **token** | A shared secret. A node proves it's allowed to join by presenting it. You pick one string and reuse it on all five. |
| **`--cluster-init`** | The flag that tells the *first* master "start a brand-new cluster and its database." Used exactly once, ever. |
| **quorum** | The minimum number of database members that must agree before the cluster will accept a change. For three members, that's two. This is the whole reason there are three masters. |
| **etcd member** | One master's copy of the database. Three masters means three members of one etcd. |
| **leader** | The one etcd member that coordinates all writes; the other two are followers that acknowledge its changes. etcd elects it automatically. Quorum is *how many* must agree; the leader is *who* they agree with. |
| **leader election** | What the surviving members do when the leader vanishes: pick a new one, automatically and in about a second, as long as a quorum is still present. No quorum, no election. |
| **kubeconfig** | A small file holding the address of the API server and the key to talk to it. `kubectl` reads it to know where to connect. |
| **`kubectl`** | The command you type to talk to the cluster. Runs anywhere that has a kubeconfig. |
| **snapshotter** | The part of containerd that stacks image layers into a running filesystem. It has a few implementations. **Which one works depends on your storage, and this is the one thing in Part 3 that can genuinely stop you.** |
| **taint** | A mark on a node that says "don't run ordinary programs here." Real clusters taint masters so the control plane isn't fighting your apps for memory. |
| **Ready / NotReady** | Kubernetes' word for whether a node is answering. A stopped node goes `NotReady`, not "gone." |

---

## Three things to know before you start

### 1. Part 3 is where Part 2 gets paid back

Everything you did in Part 2 was so that this part would be boring. If it was done right, k3s installs in about a minute per node and just works.

If a Part 2 step was skipped, **this is where it surfaces**, but usually not pointing at itself. A missing module shows up as a node that never goes Ready. A missing sysctl shows up as the *third* master failing while the first two are fine. The inotify limit from Part 2's Step 2 is the classic: masters 1 and 2 join, master 3 dies with "too many open files," and it looks like master 3 is broken hardware.

So Step 1 below re-checks Part 2 before touching k3s. Don't skip it to save ninety seconds.

### 2. One thing here *does* fail loudly, and that's a relief

Part 2 warned you that nothing fails loudly. Part 3 has one exception, and it's worth knowing in advance because it's the single most likely thing to stop you: **the containerd snapshotter, on ZFS.**

If your Part 1 storage was ZFS, k3s's built-in containerd may refuse to start with an error naming `overlayfs`. Unlike everything in Part 2, this one turns red and stops. The node never goes Ready and the log says so plainly. The relief is that it's visible. The trap is that the error blames `overlayfs` when the real cause is "ZFS underneath, inside a container." Step 2 handles it head-on. If your storage was `dir`, this can't happen to you.

### 3. "server" and "agent" are the two words to keep straight

k3s calls a master a **server** and a worker an **agent**, and the join commands are shaped differently for each. Servers join with a `--server` *flag*. Agents join with a `K3S_URL` *environment variable*. Mix them up and you'll either turn a worker into a database member by accident, or watch an agent refuse to start. Each command below says which it is at the top.

---

## Step 1 — Check Part 2 is still good

**Why:** if a container drifted, or the host lost a module across a reboot you did last week, you want to know before k3s is involved, not after, when the same fault wears a Kubernetes costume.

**Safe to run:** everything here only reads.

First, **wake LXD**. This is the socket thing from Part 2's Step 0, and it will still fool you after a host reboot:

```bash
lxc info | head -3      # THIS starts LXD if it's asleep. Don't skip it.
sleep 3
lxc list
# Expect: five RUNNING rows on .11-.13 and .21-.22, plus a STOPPED "template".
```

Now the host still holds what Part 2 gave it:

```bash
# The six modules, checked the way k3s checks them.
for m in overlay nf_conntrack br_netfilter iptable_nat iptable_filter vxlan; do
  [ -d "/sys/module/$m" ] && echo "ok   $m" || echo "MISSING $m"
done
# Expect: six "ok". Any MISSING means Part 2 Step 1 didn't survive; fix
# it there before continuing, or the matching node will never go Ready.

sysctl fs.inotify.max_user_instances kernel.keys.maxkeys
# Expect: 1024 and 2000. If these read 128 and 200, Part 2 Step 2 is gone,
# and master3 will be the one that pays for it.

swapon --show           # expect: nothing
```

And each node still has its permissions. Check one; they're all copies of it:

```bash
lxc exec master1 -- cat /proc/self/uid_map     # expect: 0 0 4294967295
lxc exec master1 -- ls /dev/kmsg               # expect: /dev/kmsg
lxc exec master1 -- stat -fc %T /sys/fs/cgroup # expect: cgroup2fs
lxc exec master1 -- free -h | grep -i mem      # expect ~4.0Gi, NOT the host's RAM
```

**If `free` shows the host's full memory instead of ~4 GB, stop and fix it in Part 2's Step 5.** This is the one that comes back to bite hardest: kubelet reports whatever `free` says, so an unlimited node tells Kubernetes it has 32 GB, and the scheduler will cheerfully overbook a machine that doesn't have the room. Better to catch it now as a wrong number than in Part 4 as a dead host.

### Pick your token now, before any install command

You'll reuse it on all five nodes. Choose one string, and **run this line first, in the terminal you'll be installing from:**

```bash
export TOKEN="lab-shared-token"     # your choice; the same on all five nodes
```

`export` puts it in the environment so the install commands below can substitute it in. This is a lab on your own machine, so a memorable token is fine. On anything real it would be a long random secret. It's the password to your cluster: anything holding it can add a node.

**This lasts only as long as this terminal.** If you close the window, drop the SSH connection, or come back tomorrow and open a fresh shell, `$TOKEN` will be empty and the next join will fail with a blank token. Before each install command, or any time you're unsure, confirm it's still set:

```bash
echo "$TOKEN"     # should print your token. If it's blank, re-run the export line above.
```

Re-running the `export` line is harmless, since it's the same string every time. You only need it during the install steps (2, 4, and 5); once all five nodes have joined, the token isn't used again.

---

## Step 2 — Start the cluster on master1

### What this command does

One node becomes the first master: it starts the control plane, creates the database, and makes itself the first of what will be three voting members. `--cluster-init` is the flag that means "begin a new cluster." **You run it exactly once, on master1, ever.** The other four nodes *join* what this one creates.

### Settle the snapshotter question before you install

This is the ZFS thing from the intro. Rather than install and hope, decide up front.

**If your Part 1 storage was `dir`:** skip this box. The default snapshotter works. Go to "Install."

**If it was ZFS:** k3s's containerd will try to use `overlayfs` on top of your ZFS-backed container filesystem. Whether that works depends on your ZFS version. Ubuntu 24.04 ships ZFS 2.2, which added the support that makes it *usually* fine. But "usually" is not "always," and the failure is total: the node never goes Ready and the log repeats a line about `overlayfs` "cannot be enabled ... try using fuse-overlayfs or native."

You have two honest options:

- **Try the default first.** It may just work on 24.04. If it does, you've spent nothing. The install below does this, and the check after it tells you within a minute whether containerd came up.
- **Force `native` up front** and never think about it. Add `--snapshotter=native` to the install line. It's slower and uses more disk (it copies layers instead of stacking them), but it does not care what's underneath it, so it cannot hit this wall. For a five-node lab the slowness is not something you'll notice.

This guide tries the default and checks. If the check fails, it tells you the one flag to add and re-run. **Don't reach for the flag pre-emptively unless you'd rather not think about it.** On 24.04 you may not need it at all.

### Install

```bash
lxc exec master1 -- bash -c "
  curl -sfL https://get.k3s.io | \
    INSTALL_K3S_CHANNEL=stable \
    K3S_TOKEN='$TOKEN' \
    sh -s - server \
      --cluster-init \
      --node-ip 10.99.99.11 \
      --write-kubeconfig-mode=644
"
```

Line by line:

| Part | Why |
|---|---|
| `INSTALL_K3S_CHANNEL=stable` | Pins to the current stable release train instead of "whatever's newest today." All five nodes should be on the same channel. |
| `K3S_TOKEN='$TOKEN'` | The shared secret the other four will present to join. |
| `server` | This node is a master (a k3s "server"). |
| `--cluster-init` | Start a new cluster and its database. **master1 only.** |
| `--node-ip 10.99.99.11` | Pin the address k3s advertises. The node has one interface, but saying so removes any guessing; flannel and kubelet both use this. |
| `--write-kubeconfig-mode=644` | Makes the cluster's key file readable so you can pull it out easily. A **lab convenience**; on a shared machine you'd leave it locked to root. |

**Notice what's *not* here.** No `--flannel-backend`: k3s defaults to vxlan, which is exactly the module you loaded in Part 2 for cross-node traffic. No `--tls-san`: k3s automatically puts each node's own IP into its certificate, and you'll join and connect using those IPs, so there's nothing to add. You'd only need `--tls-san` later if you put a name or a shared address in front of the cluster.

### Check it came up (the snapshotter verdict lands here)

```bash
lxc exec master1 -- systemctl is-active k3s
# Expect: active. If it says "activating" for more than a minute or
# "failed", the next command tells you why.

lxc exec master1 -- k3s kubectl get nodes
# Expect: one node, master1, STATUS Ready, ROLES control-plane,etcd,master.
```

If `get nodes` shows `master1` as `Ready`, the snapshotter is fine and you're done with Step 2. If the node never reaches `Ready`, read the log:

```bash
lxc exec master1 -- journalctl -u k3s --no-pager | grep -i 'snapshotter' | tail -20
```

**The one line that means trouble is `"overlayfs" snapshotter cannot be enabled`.** That, and only that, is the ZFS wall. Fix it by reinstalling master1 with the `native` snapshotter (the uninstall is clean and there's nothing to lose yet):

```bash
lxc exec master1 -- /usr/local/bin/k3s-uninstall.sh
lxc exec master1 -- bash -c "
  curl -sfL https://get.k3s.io | \
    INSTALL_K3S_CHANNEL=stable \
    K3S_TOKEN='$TOKEN' \
    sh -s - server \
      --cluster-init \
      --node-ip 10.99.99.11 \
      --write-kubeconfig-mode=644 \
      --snapshotter=native
"
```

**If you switch to `native` here, use it on every other node too.** A cluster where one node stacks layers and another copies them isn't broken, but it's an inconsistency you'll forget and then trip over. Whatever master1 uses, all five use.

### The scary log line that isn't: `modprobe: FATAL: Module ... not found`

If you go looking through the full k3s log, you will almost certainly see lines like these near the start:

```
modprobe: FATAL: Module br_netfilter not found in directory /lib/modules/6.8.0-...
modprobe: FATAL: Module overlay not found in directory /lib/modules/6.8.0-...
```

**This is the exact thing Part 2's Step 1 predicted, and it is not a fault.** It's the container's own `modprobe` failing, which, as Part 2 explained at length, it *always* does, because a container is not allowed to load kernel modules. k3s only reaches for `modprobe` when it didn't already find `/sys/module/<name>`, so seeing it try just means its early check ran a moment before the module was visible. It logs a warning and carries on, exactly as designed.

**The log line is not the ground truth. `/sys/module/<name>` is.** That's the folder k3s actually checks, and it's the host's kernel, shared into the container. So don't trust or distrust the FATAL line either way. Check the real thing, on the **host**:

```bash
for m in overlay nf_conntrack br_netfilter iptable_nat iptable_filter vxlan; do
  [ -d "/sys/module/$m" ] && echo "ok   $m" || echo "MISSING $m"
done
```

- **Six `ok`** → the modules are present, the FATAL lines were cosmetic, you're done. This is the normal outcome, and it's why master1 is `Ready` despite the scary log.
- **`overlay` or `br_netfilter` MISSING** → your host actually lost Part 2's Step 1 (usually a reboot where the module list didn't reload). Fix it on the host, then restart k3s so the parts that check early re-run against a host that now has them:

  ```bash
  sudo systemctl restart systemd-modules-load.service   # reloads /etc/modules-load.d/k3s.conf
  # re-run the six-module check above; expect all ok
  lxc exec master1 -- systemctl restart k3s
  ```

This is the whole "suspect the check before the machine" reflex from Part 2, in its most common Part 3 form: a red-looking log line, a healthy machine underneath, and one host-side command that tells you which you've got.

### One more look before moving on

```bash
lxc exec master1 -- k3s kubectl get pods -A
```

Expect a handful of pods in `kube-system`: `coredns`, `local-path-provisioner`, `metrics-server`, and (unless you disabled them) `traefik` and a `svclb`. They should be `Running` or moving toward it. This is the control plane's own machinery, running as the first programs on your cluster. If they're stuck `Pending` or `ContainerCreating` for more than a couple of minutes, that's the snapshotter or a Part 2 module talking; check the log as above.

**Two of those pods will read `Completed`, not `Running`, and that's success, not a problem:**

```
helm-install-traefik-crd-xxxxx   0/1   Completed   0
helm-install-traefik-xxxxx       0/1   Completed   2 (Nm ago)
```

These are **one-time setup Jobs**, not services. k3s installs its default ingress controller (Traefik) by running two Helm jobs: the first (`-crd`) registers Traefik's custom object types so Kubernetes knows what an `IngressRoute` is, and the second installs Traefik itself, which is why you also see a running `traefik` pod and the `svclb-traefik` load-balancer pods. A Job does its work and exits, so:

- **`Completed` is the finished state**, the opposite of a crash. It's a receipt that the install ran.
- **`0/1` next to it is correct**, not a warning. `READY` counts *live* containers; a finished Job has none. Read `Completed` as the verdict and `0/1` as its natural consequence.
- **A couple of `RESTARTS` on the second one is normal.** It retries while the API server and CRDs are still settling in the first minute, then succeeds. A *completed* Job with early restarts is a non-event. Only a Job stuck in `Error` or `CrashLoopBackOff`, never reaching `Completed`, is worth chasing.

They'll sit there as `Completed` records for the life of the cluster. Ignore them from here on.

---

## Step 3 — Talk to the cluster from the host

### Why bother, when `k3s kubectl` already works

You *can* run every command as `lxc exec master1 -- k3s kubectl ...`, and for a quick look that's fine. But you'll be running a lot of these, and threading each one through `lxc exec` gets old fast. Pulling the kubeconfig out to the host lets you type plain `kubectl`.

**This needs `kubectl` on the host.** If you don't have it, the `lxc exec master1 -- k3s kubectl` form keeps working and you can skip this whole step without losing anything. If you want it:

```bash
# On the host, if kubectl isn't already installed:
sudo snap install kubectl --classic
```

### Pull the key and point it at master1

The kubeconfig k3s wrote assumes you're on master1 itself, so it points at `127.0.0.1`. From the host, that's the wrong address; you need master1's real one.

```bash
mkdir -p ~/.kube
lxc file pull master1/etc/rancher/k3s/k3s.yaml ~/.kube/config
# Pulls the cluster's key file out of the container onto the host.

sed -i 's/127.0.0.1/10.99.99.11/' ~/.kube/config
# The file points at 127.0.0.1 (fine on master1, wrong from the host).
# Repoint it at master1's real address.

kubectl get nodes
# Expect: master1, Ready. Now from the host, no lxc exec.
```

That `sed` is the one thing people forget, and the symptom is a `kubectl` that hangs or refuses the connection, because it's trying to reach a Kubernetes API on the host's own `127.0.0.1`, where nothing is listening. **If `kubectl` can't connect, check that line ran.**

`~/.kube/config` is the default place `kubectl` looks, so you don't need to export anything. From here on, this guide writes plain `kubectl`. If you skipped this step, put `lxc exec master1 -- k3s ` in front of each one.

---

## Step 4 — Join master2 and master3

### What "joining a server" means

master2 and master3 install the same way as master1, with one difference each: instead of `--cluster-init` (start a new cluster), they get `--server https://10.99.99.11:6443` (join the one master1 started). Presenting the same token, each one adds itself as a second and third **etcd member**: a third of the shared database, and a third of the vote.

**Do these one at a time and let each finish.** They're joining a database, and a database would rather add members in an orderly line than all at once. It costs you thirty seconds.

### master2

This is a **server** join. Note the `--server` *flag* (not the `K3S_URL` variable that workers use):

```bash
lxc exec master2 -- bash -c "
  curl -sfL https://get.k3s.io | \
    INSTALL_K3S_CHANNEL=stable \
    K3S_TOKEN='$TOKEN' \
    sh -s - server \
      --server https://10.99.99.11:6443 \
      --node-ip 10.99.99.12 \
      --write-kubeconfig-mode=644
"
```

Wait for it to settle, then confirm from the host:

```bash
kubectl get nodes
# Expect: master1 AND master2, both Ready, both control-plane,etcd,master.
```

**Give master2 up to a minute to reach `Ready`.** It has to download k3s, join etcd, and start its own control plane. `NotReady` for thirty seconds is normal; `NotReady` for five minutes is not; check `journalctl -u k3s` on master2, and remember the snapshotter and inotify from Steps 1 and 2.

### master3, and watch this one

master3 is identical except for its address:

```bash
lxc exec master3 -- bash -c "
  curl -sfL https://get.k3s.io | \
    INSTALL_K3S_CHANNEL=stable \
    K3S_TOKEN='$TOKEN' \
    sh -s - server \
      --server https://10.99.99.11:6443 \
      --node-ip 10.99.99.13 \
      --write-kubeconfig-mode=644
"
```

Wait for it to settle, then confirm from the host:

```bash
kubectl get nodes
# Expect: three masters, all Ready.
```

**master3 is the node Part 2 kept warning you about.** If you skipped the inotify or keys sysctls in Part 2's Step 2, this is very often where it shows: masters 1 and 2 came up on a fresh pool of a shared limit, and master3 is the one that runs out. The error will say "too many open files" or a program will fail to start, and it will look like master3 is the problem. It isn't. It's the host setting, and the fix is in Part 2, not here.

If all three are `Ready`: **you now have a highly available control plane.** Three members, a quorum of two. What that's worth is Step 8.

Confirm the database sees three members:

```bash
kubectl get nodes -l node-role.kubernetes.io/etcd=true
# Expect: exactly master1, master2, master3.
```

---

## Step 5 — Join the workers

### What "joining an agent" means

Workers install differently from masters, and this is the distinction to keep straight. An **agent** joins with `K3S_URL` as an *environment variable*, not a `--server` flag, and its type is `agent`, not `server`. It gets no copy of the database and no vote; it shows up, presents the token, and waits for work.

Getting this wrong is a real mistake with a quiet result: use the `server` form on a worker and you've accidentally added a fourth database member, which breaks the "odd number for voting" arithmetic Step 8 depends on. So read the type in each command.

### worker1

**Agent** join, using the `K3S_URL` variable and type `agent`:

```bash
lxc exec worker1 -- bash -c "
  curl -sfL https://get.k3s.io | \
    INSTALL_K3S_CHANNEL=stable \
    K3S_URL='https://10.99.99.11:6443' \
    K3S_TOKEN='$TOKEN' \
    sh -s - agent \
      --node-ip 10.99.99.21
"
```

### worker2

```bash
lxc exec worker2 -- bash -c "
  curl -sfL https://get.k3s.io | \
    INSTALL_K3S_CHANNEL=stable \
    K3S_URL='https://10.99.99.11:6443' \
    K3S_TOKEN='$TOKEN' \
    sh -s - agent \
      --node-ip 10.99.99.22
"
```

### Check

```bash
kubectl get nodes -o wide
```

Expect all five, all `Ready`. The three masters read `control-plane,etcd,master`; the two workers read `<none>` under ROLES. **`<none>` is correct, not an error.** It just means "an ordinary worker with no special jobs." The `-o wide` view also shows each node's INTERNAL-IP, which should be exactly the `.11` to `.13` and `.21` to `.22` you assigned. A wrong IP here means a node advertised something other than what you pinned, which is worth chasing now.

If you'd like the workers to *say* "worker" instead of `<none>`, it's cosmetic, but you can label them:

```bash
kubectl label node worker1 node-role.kubernetes.io/worker=worker
kubectl label node worker2 node-role.kubernetes.io/worker=worker
```

That changes the ROLES column and nothing else. Kubernetes doesn't use it; it's for your eyes.

---

## Step 6 — Prove the cluster actually works (and leave no trace)

`Ready` means "the node is answering." It does not mean "a program can run here and reach a program over there." Those are different claims, and this step checks the second one, cheaply, before Part 4 leans on it.

### What this test does and does not leave behind

Read this first if you're wary of it downloading things or making a mess. It's a fair worry, so here's the whole footprint up front:

- **It creates** a deployment (`web`, two nginx copies), a service (`web`), and one throwaway probe pod (`busybox`). That's four short-lived objects, all in the `default` namespace, all named by you.
- **It downloads** two small public images, `nginx` (~70 MB) and `busybox` (~4 MB), onto whichever nodes the pods land on. They get cached in each node's containerd image store. This is the only thing that lingers, and the cleanup below removes it.
- **It creates no storage.** Neither image asks for a volume, so no PersistentVolumeClaim, no data written to disk, nothing to clean in that department. You can confirm at the end that `kubectl get pvc -A` is still empty.
- **Nothing touches the control plane or `kube-system`.** If a step fails, the worst case is a leftover `web` deployment you delete by name, and it cannot damage the cluster.

The plan is four phases: **record the clean state → run the test → remove everything → confirm you're back where you started.** After phase 4 the cluster is byte-for-byte the tidy thing Part 4 expects.

### Phase 1: Record the clean state, so you can prove you got back to it

```bash
kubectl get nodes
kubectl get pods -A -o wide
# Every kube-system pod should be Running (the two helm-install Jobs read
# Completed, that's fine, see Step 2). The -o wide column shows which node
# each landed on: control-plane pods across the masters, svclb on all five.

kubectl get all -n default
# Expect ONE line: service/kubernetes (ClusterIP, port 443). That's the
# built-in API-server endpoint; it lives in "default" permanently, in every
# cluster, and is not test residue. Your baseline is "only service/kubernetes,
# nothing else." Cleanup should return you to exactly this one line.

kubectl get pvc -A
# Expect: "No resources found." Nothing stored now; nothing should be after.
```

### Phase 2: Run one real thing across two nodes

This is the test that matters: schedule a program twice, make the copies land on different nodes, then confirm they can talk. It exercises flannel and the vxlan tunnel from Part 2 for real.

```bash
kubectl create deployment web --image=nginx --replicas=2
kubectl expose deployment web --port=80

# Wait for both copies to be Running, and see where they landed:
kubectl get pods -l app=web -o wide
# Ideally one on worker1 and one on worker2. Kubernetes chooses; with two
# replicas and two workers it usually spreads them.

# Now reach the service from a third pod, by name:
kubectl run probe --image=busybox --rm -it --restart=Never -- \
  wget -qO- --timeout=5 http://web
# Expect: the nginx welcome HTML. This proves a pod resolved a service
# NAME, found a pod on ANOTHER node, and got bytes back, which is
# exactly the cross-node path vxlan carries.
# The --rm flag deletes the probe pod automatically when it exits.
```

**If the `wget` returns HTML, the hard part works.** DNS inside the cluster, service routing, and cross-node networking all just closed in one line. **If it hangs or times out** and the two `web` pods are on different nodes, that's the flannel/vxlan path; check that `vxlan` is still loaded on the host (Part 2 Step 1) and that node-to-node traffic passes (Part 2 Step 6). This is the same networking you already proved between containers; k3s is just using it now.

### Phase 3: Remove everything the test created

```bash
# 1. The Kubernetes objects. Deleting the deployment cascades to its pods;
#    deleting the service removes it. This empties the default namespace.
kubectl delete deployment web
kubectl delete service web

# 2. The probe pod is usually already gone (that's what --rm does), but if the
#    wget was interrupted it can linger. This removes it if present, and is a
#    no-op if it isn't:
kubectl delete pod probe --ignore-not-found

# 3. The cached images. This is the "extra stuff downloaded" part, the only
#    thing kubectl's deletes don't touch. Remove nginx and busybox from every
#    node's containerd store. (They're not in use once the pods are gone, so
#    this succeeds; it's a no-op on nodes that never ran them.)
for n in master1 master2 master3 worker1 worker2; do
  echo "== $n"
  lxc exec "$n" -- k3s crictl rmi docker.io/library/nginx    2>/dev/null || true
  lxc exec "$n" -- k3s crictl rmi docker.io/library/busybox  2>/dev/null || true
done
```

**Removing the images is optional, not required.** Kubernetes garbage-collects unused images on its own once a node's disk fills past a threshold, so leaving them costs you ~74 MB per affected node and nothing else. Remove them if you want a pristine slate to compare against; skip step 3 if you'd rather not bother. Part 4 works either way.

### Phase 4: Confirm you're back to the baseline

```bash
kubectl get all -n default
# Expect ONE line again: service/kubernetes, same baseline as Phase 1.
# If web or probe still show here, their delete didn't finish; re-run it.

kubectl get pvc -A
# Expect: "No resources found." Nothing was ever stored.

# If you did the image cleanup, confirm they're gone (blank output = gone):
for n in master1 master2 master3 worker1 worker2; do
  echo -n "$n: "; lxc exec "$n" -- k3s crictl images | grep -E 'nginx|busybox' || echo "clean"
done

kubectl get nodes
# Expect: five Ready. The cluster itself never changed.
```

If `default` shows only `service/kubernetes` and the nodes are all `Ready`, you've proven the cluster works *and* returned it to exactly the state Part 4 wants. The only permanent thing this step added to your cluster is confidence.

### A note on the masters running your programs

By default, k3s lets the masters run your programs alongside the control plane. Deploy something and Kubernetes may place it on any of the five nodes. On a five-node lab that's usually what you want: more nodes to schedule onto, and the control plane here isn't under enough load to mind the company.

Real clusters do the opposite. The masters run the machinery everything else depends on (the API server, scheduler, and the etcd database), and you don't want a busy application starving those of CPU or memory. So production clusters put a **taint** on the masters: a "don't schedule ordinary programs here" mark. A program can only land on a tainted node if it carries a matching **toleration**, an explicit "I'm allowed here" pass. The control plane's own pods carry that pass, so they keep running on the masters; your ordinary deployments don't, so they get pushed to the workers.

If you'd rather run the lab the production way, taint the three masters:

```bash
kubectl taint nodes master1 master2 master3 \
  node-role.kubernetes.io/control-plane=:NoSchedule
```

`NoSchedule` affects **new** pods only. It won't evict anything already running on a master; it just stops fresh ones landing there. Undo it by repeating the command with a trailing `-` instead of `=`:

```bash
kubectl taint nodes master1 master2 master3 \
  node-role.kubernetes.io/control-plane:NoSchedule-
```

That's a genuine choice, not a fix; the default is fine for this lab. It's here so you understand what the default *is*, and so tainting doesn't look like magic if you meet it in a real cluster later. If you do taint, remember you've cut your schedulable nodes from five to two; a couple of small deployments won't notice, but it's why the guide leaves the masters open.

---

## Step 7 — Save a restore point (and understand why it's trickier now)

You have a working cluster. That's worth being able to get back to. But snapshotting a cluster is **not** the same as snapshotting the five idle machines you saved in Part 2, and the difference is the whole reason Part 2 kept harping on stopped snapshots.

### Why you can't just snapshot the running masters

Each master holds a live etcd member, and the three are constantly agreeing with each other about the cluster's exact state. If you snapshot them while they're running:

- Each snapshot catches a database mid-write, at a slightly different instant.
- Worse, if you ever **restore just one master** from such a snapshot, you're dropping a member with a stale, divergent history back into a cluster that has moved on. etcd may reject it, or, more confusing, accept it and disagree with itself.

Part 2 said "a mid-write snapshot of a running database member is far less trustworthy than a stopped one." This is the situation it was warning you about. So the safe pattern is: **stop all three masters together, snapshot all five at the same quiet moment, start them back up.** All-or-nothing.

### Do it

```bash
# Stop everything. Masters last is tidy but order barely matters when all go.
for n in worker1 worker2 master1 master2 master3; do lxc stop "$n"; done

# Snapshot all five at the same stopped instant.
for n in master1 master2 master3 worker1 worker2; do
  lxc snapshot "$n" post-install
done

# Bring them back.
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 20

kubectl get nodes        # expect: all five Ready again within a minute
sudo zpool list default  # ALLOC barely moves; the snapshots are near-free
```

`lxc snapshot` refuses to overwrite an existing name, so re-running this is safe; worst case, an error. The twenty-second sleep is because etcd needs a moment to re-elect and agree after a cold start; `NotReady` for a few seconds after is normal.

### The right tool for cluster *state* is different

An LXD snapshot rolls back a whole *machine*, good for "I broke this node, give me the node back." For rolling back the *cluster's data*, the "I deleted something I shouldn't have" case, k3s has its own etcd snapshots, which are consistent by design because etcd takes them itself:

```bash
lxc exec master1 -- k3s etcd-snapshot save
# Writes a consistent database backup inside master1. This is what you'd
# actually restore cluster contents from. Different job from lxc snapshot.
```

**When do you actually run that?** Two things to know, and they answer it together:

First, **you're already covered for routine protection.** k3s takes etcd snapshots *automatically* out of the box: every 12 hours by default, keeping the last 5, saved under `/var/lib/rancher/k3s/server/db/snapshots`. You didn't set anything up; it's on. So you don't run `save` manually just to "have a backup"; the schedule handles that. Confirm it any time with:

```bash
lxc exec master1 -- k3s etcd-snapshot list
# Lists the snapshots k3s has taken; scheduled ones appear on their own.
```

Second, **you run `save` manually right before you deliberately do something risky to cluster data.** The scheduled snapshot might be eleven hours old; a manual one is a fresh, named point taken *at this exact instant*, just before the scary thing. Concretely, save first when you're about to:

- upgrade k3s to a new version,
- apply a large or unfamiliar manifest that creates/changes a lot of objects,
- bulk-delete things, or do any "cluster surgery" you're unsure about,
- run an experiment that mutates cluster state and you want a clean point to return to.

The pattern is `save → do the risky thing → if it went wrong, restore; if it went fine, carry on`. It's the same reflex as Part 2's `lxc snapshot before-i-wreck-it`, just aimed at the database instead of the machine.

**One caveat with manual saves:** unlike the scheduled ones, on-demand snapshots are **not** auto-pruned; they pile up until you remove them yourself with `k3s etcd-snapshot delete <name>` or `k3s etcd-snapshot prune`. Not a concern on this lab yet; worth knowing before you get in the habit.

The two aren't interchangeable, and the difference is which layer you broke: the *machine*, or the *data on it*. Concretely:

| What went wrong | Which snapshot | Why |
|---|---|---|
| "I ran a bad command inside master2 and its OS is a mess." | **LXD** (`lxc restore master2 ...`) | The node itself is broken. You want the whole machine back, k3s and all. |
| "A host reboot left a node wedged / won't rejoin." | **LXD** | Same; restore the machine to a known-good moment. |
| "I `kubectl delete`d the wrong deployment / namespace." | **etcd** | The machines are fine; the *cluster's records* are wrong. Only an etcd restore rewinds what Kubernetes remembers. |
| "An upgrade or a bad manifest corrupted cluster objects." | **etcd** | The data is the casualty, not the OS. |
| "I want to experiment and be able to undo *everything*." | **LXD, all five together** (Step 7's `post-install`) | Rolling every node back to the same stopped instant rewinds machines *and* their etcd data at once, the blunt, reliable reset. |

The rule of thumb: **broke a box → LXD; broke what's *in* the cluster → etcd.** And when in doubt on this lab, the all-five-together LXD restore from Step 7 covers both, because it takes the whole cluster back to one consistent moment.

You don't need an etcd snapshot right now; there's nothing in the cluster to lose yet. It's here so that when Part 4 puts real data in, you already know which of the two "snapshots" saves it. **LXD snapshots restore machines, etcd snapshots restore data.** Part 2's whole snapshot habit was the first kind; this is the second.

---

## Step 8 — Break it on purpose

This is the point of building three masters. You're about to watch quorum work, then watch it fail, then bring it back, and it's safe because Step 7 gave you a way back.

> **Read this before you start, or the first command will confuse you.** `kubectl get nodes` is **not a live ping.** It shows the control plane's *last recorded belief* about each node, and it lags reality by up to a minute. So when you stop a master, it can keep showing `Ready` for ~40 to 60 seconds before flipping to `NotReady`, because the control plane waits out a grace period after the node's last heartbeat before declaring it down. And while quorum is lost, the control plane can't write *any* status updates, so a node's status can be frozen at whatever it was when the outage began. **The honest, real-time view is `lxc list`** (the container's actual state); `kubectl` is answering "what did I last hear," not "is it alive right now." When the two disagree for a minute, believe `lxc list`. This is Part 2's "suspect the check before the machine" in yet another costume.

### What "voting" actually is: quorum has a leader

The guide has said the three masters "vote on decisions," which is true enough to build on but hides one piece worth knowing before you watch it break: **the three etcd members are not equal peers taking a fresh vote each time. One of them is the *leader*.**

etcd uses a consensus algorithm called Raft, and it works like this:

- **One member is elected leader; the other two are followers.** All writes go through the leader. It proposes each change to the followers, and the change is *committed* once a majority, the quorum, has acknowledged it. So "the masters vote" really means "the leader proposes, and a change counts the moment a majority has stored it."
- **Quorum is the count; the leader is the coordinator.** They're two halves of the same mechanism. Quorum is *how many must agree* (two of three); the leader is *who they're agreeing with*.
- **If the leader disappears, the survivors hold an election.** They notice the missing heartbeats and, *provided a quorum still exists*, pick a new leader in about a second, and then writes resume. This is automatic; you don't do anything.
- **No quorum means no leader can be elected.** You can't crown a leader without a majority agreeing to it. That's the deeper reason the cluster freezes when two masters are down: not just "can't write," but "can't even agree who's in charge."

This reframes the experiment you're about to run. Killing a master does one of two things depending on which one it was:

| You stop... | What happens | Why |
|---|---|---|
| a **follower** | barely a blip | the leader is still there; nothing needs electing |
| the **leader** | a ~1-second pause, then normal | the two survivors elect a new leader, then writes resume |
| a **second** master | writes stop entirely | one member left can't form a majority, so no leader can hold or be elected |

You won't know in advance which master is the leader, so when you kill one you might see a brief write pause (you killed the leader) or nothing at all (you killed a follower). Both are correct.

**Want to see who the leader is?** k3s embeds etcd inside its own process rather than running it as a pod, and, unlike some Kubernetes distributions, it doesn't ship the `etcdctl` tool, so there's no one-liner built in. Two ways to look.

**Option A, read the log (no install).** The trap here is that the word "leader" appears in the log for *three unrelated things*: etcd's database leader (what you want), Kubernetes' controller-manager leader-election (noise), and a command-line flag (noise). The clean filter is to keep only the **raft** lines, because raft is etcd's consensus engine, so those lines are exactly the database-leader events and nothing else:

```bash
# Past elections; returns immediately. Note: no -f, and --no-pager.
lxc exec master1 -- bash -c "journalctl -u k3s --no-pager | grep raft | grep -iE 'leader|term'"
```

Reading the output: each line ends in a `msg` describing one event:

| Line says (roughly) | What happened |
|---|---|
| `became leader at term N` / `elected leader X at term N` | An election completed. Member `X` is now the leader. |
| `changed leader from X to Y` / `leadership transfer` | The leader moved from `X` to `Y`; this is what a *graceful* `lxc stop` of the leader produces. |
| `lost leader X` then `no leader at term N; dropping...` | The brief gap with **no** leader; this is the ~1-second window before a new one is elected. Seeing it is seeing quorum re-forming. |

Two things to know reading it: the members are named by **hex IDs** like `887ca2eda3b97d6e`, not `master1` (map them to node names with the `member list` command below), and the **term** number rises by one at every election, so a jump in "term" is your count of how many elections have happened.

To *watch an election live*, use `-f` (follow), but know it will **sit blank until you actually trigger one**, because it only prints new events as they occur:

```bash
# Terminal 1: starts blank on purpose; leave it running.
lxc exec master1 -- bash -c "journalctl -u k3s -f | grep --line-buffered raft | grep --line-buffered -iE 'leader|term'"
# Terminal 2: stop the current leader (find it with Option B first),
# and within a second or two Terminal 1 prints the election. Ctrl-C to stop.
```

(The `--line-buffered` flags matter for the live version: without them, `grep` holds output in a buffer and you'd see nothing until a lot had piled up. For the past-events version above they're unnecessary.)

**Option B, the instant "who is leader right now" table (installs a small tool).** This is the more reliable way to answer "which node is the leader this second," and it returns immediately with an `IS LEADER` column that's `true` for exactly one member:

```bash
lxc exec master1 -- apt-get install -y etcd-client

# Map hex member IDs to node names:
lxc exec master1 -- bash -c '
  ETCDCTL_API=3 \
  ETCDCTL_ENDPOINTS="https://127.0.0.1:2379" \
  ETCDCTL_CACERT="/var/lib/rancher/k3s/server/tls/etcd/server-ca.crt" \
  ETCDCTL_CERT="/var/lib/rancher/k3s/server/tls/etcd/server-client.crt" \
  ETCDCTL_KEY="/var/lib/rancher/k3s/server/tls/etcd/server-client.key" \
  etcdctl member list -w table
'

# Show status per member, including which one IS LEADER:
lxc exec master1 -- bash -c '
  ETCDCTL_API=3 \
  ETCDCTL_ENDPOINTS="https://127.0.0.1:2379" \
  ETCDCTL_CACERT="/var/lib/rancher/k3s/server/tls/etcd/server-ca.crt" \
  ETCDCTL_CERT="/var/lib/rancher/k3s/server/tls/etcd/server-client.crt" \
  ETCDCTL_KEY="/var/lib/rancher/k3s/server/tls/etcd/server-client.key" \
  etcdctl endpoint status --cluster -w table
'
```

The `etcd-client` install is the only thing in Step 8 that adds a package to a node. It's harmless and small; remove it later with `lxc exec master1 -- apt-get remove -y etcd-client` if you want the node pristine, or just leave it; it does nothing unless you run it.

**Two things to keep straight about these `etcdctl` commands:**

*They only work because your cluster uses embedded etcd.* That's not a given; it's a consequence of the `--cluster-init` flag from Step 2, which is exactly what chose etcd over the default datastore. A k3s server started *without* `--cluster-init` (and without an external-datastore flag) uses **SQLite** instead, which has no members, no leader, and no `2379` port, so none of these commands apply to it. Your three-master HA setup is the etcd case, so they do.

*Installing the tool isn't enough; it needs the certs and the right endpoint.* `etcdctl` talks to etcd over TLS, so every command carries the four `ETCDCTL_CACERT/CERT/KEY/ENDPOINTS` variables. Drop them and you don't get "command not found"; you get a confusing `context deadline exceeded` as it tries the wrong address with no credentials. That's why the block above looks verbose; the env vars are the point, not decoration.

Quick reference for the three (plus one) commands:

| Command | Purpose |
|---|---|
| `apt-get install -y etcd-client` | Installs `etcdctl`, the tool for inspecting the etcd datastore. |
| `etcdctl member list -w table` | Lists the members (your HA masters) and maps each **hex member ID → node name**; this is what turns `887ca2eda3b97d6e` into `master1`. |
| `etcdctl endpoint status --cluster -w table` | Shows each member's status: DB size, raft term, and the `IS LEADER` flag that marks the current leader. |
| `etcdctl endpoint health --cluster -w table` | *(optional)* The actual health check; reports whether each member is responding. |

To find the current leader you run two of these together: `endpoint status` tells you *which ID* is leader, and `member list` tells you *which node* that ID is. The leader it shows is the same member that most recently logged `became leader at term N` in Option A; the table just answers "who, right now" without waiting for an event.

### First, kill one master, and the cluster shrugs

Three members, quorum of two. Take one away and two remain, which is still a quorum, so nothing should break.

```bash
lxc stop master3
sleep 15

kubectl get nodes
# master3 may still show Ready for up to ~40-60s (the lag from the note
# above) before flipping to NotReady. lxc list shows it STOPPED immediately.
# Either way the cluster answers; the other two masters are a quorum.

kubectl create deployment survive --image=nginx --replicas=1
kubectl get pods -l app=survive -o wide
# Expect: it schedules and runs. The cluster is fully operational on two
# masters, because two of three is still a majority.
```

**master3 is `NotReady` (or about to be), not gone.** Kubernetes is holding its place, waiting for it to come back. Writes still work because the two surviving members can still agree. This is high availability doing exactly its job: a master died and you didn't notice from the outside. (If you want to *see* the status flip rather than wait, `sleep 60` then `kubectl get nodes`, or just check `lxc list` for the truth now.)

### Now kill a second master, and the cluster stops agreeing

Take away a second member and only one remains. One of three is not a majority. The remaining master can't get a second vote, so it refuses to accept changes; it would rather stop than risk disagreeing with members it can't reach.

```bash
lxc stop master2
sleep 15

kubectl get nodes
# Likely hangs, or errors. The API server on master1 can't write to a
# database that has lost quorum, so it stops answering normally.

kubectl create deployment fail --image=nginx --replicas=1
# Expect: an error or a hang. No quorum, no writes.
```

**This is not your cluster breaking. It's your cluster protecting itself.** Faced with "keep going alone and maybe corrupt the shared truth" versus "stop until a majority is back," etcd stops. That refusal is the feature. A database that kept accepting writes with no way to agree on them is how you get two masters that each think they're right.

### Bring quorum back

Start one of the stopped masters. Two of three is a majority again, and the cluster heals itself:

```bash
lxc start master2
sleep 30

kubectl get nodes
# Expect: master1 and master2 Ready, master3 still NotReady (still stopped).
# The cluster ACCEPTS WRITES AGAIN, because two members can agree.

lxc start master3
sleep 30
kubectl get nodes            # all five Ready again
```

Give it a little longer than before; the members have to find each other and re-agree on everything that's true.

### Clean up: put the cluster back exactly as Step 7 left it

Same idea as Step 6's cleanup: this experiment created a couple of `nginx` deployments and re-pulled the image onto whichever nodes ran them, so remove all of it and confirm you're back to the `post-install` baseline.

```bash
# 1. The deployments. --ignore-not-found means "fail" is fine to name even if
#    it never got created (it may not have, since quorum was down when you tried).
#    These created no services and no volumes, so deployments are all there is.
kubectl delete deployment survive fail --ignore-not-found

# 2. Confirm the default namespace is back to just the built-in API service.
kubectl get all -n default
# Expect ONE line: service/kubernetes. If survive/fail still show, their
# delete didn't finish; re-run step 1.

kubectl get pvc -A
# Expect: "No resources found." Nothing was stored, same as before.

# 3. Optional: drop the nginx image from every node's containerd, same as
#    Step 6. Skip if you already pruned it there and it just re-pulled.
for n in master1 master2 master3 worker1 worker2; do
  echo "== $n"
  lxc exec "$n" -- k3s crictl rmi docker.io/library/nginx 2>/dev/null || true
done

# 4. Final health check; the whole point is that the cluster survived.
kubectl get nodes
# Expect: five Ready.

kubectl get nodes -l node-role.kubernetes.io/etcd=true
# Expect: three etcd members again; quorum fully restored.
```

If `default` shows only `service/kubernetes`, all five nodes are `Ready`, and etcd lists three members, you're back to exactly the `post-install` state: you broke quorum on purpose, watched it protect itself, and healed it, leaving no trace. **Re-snapshotting isn't needed**; `post-install` from Step 7 is still an accurate picture of this clean state, so it remains your fallback for Part 4.

### If it doesn't come back cleanly

You have `post-install` from Step 7. Because those snapshots were taken stopped and together, restoring them is the trustworthy move; all three etcd members roll back to the same consistent instant:

```bash
for n in master1 master2 master3 worker1 worker2; do lxc stop "$n"; done
for n in master1 master2 master3 worker1 worker2; do lxc restore "$n" post-install; done
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 30
kubectl get nodes
```

This is the payoff of doing Step 7 as all-or-nothing. A pile of snapshots taken at different moments would be worse than none here; taken together, they're an exact way back.

---

## Where you should be

| Thing | State |
|---|---|
| k3s | Installed on all five, pinned to the `stable` channel |
| Masters | `master1` to `master3`, `control-plane,etcd,master`, three-member etcd, quorum of two |
| Workers | `worker1` to `worker2`, agents, running your programs |
| kubectl | Working from the host against `10.99.99.11`, or via `k3s kubectl` on master1 |
| Networking | Cross-node service reached by name, over vxlan; proven, not assumed |
| Snapshotter | Settled; default on `dir`, default-or-`native` on ZFS, same choice on all five |
| Snapshots | `post-install` on all five, taken stopped and together |
| Quorum | Seen surviving one loss and refusing on two, and recovered |

### Things worth carrying forward

- **"server" is a master, "agent" is a worker, and they join differently.** Servers use the `--server` flag; agents use the `K3S_URL` variable. The mistake is silent: a worker joined as a server becomes an unwanted fourth vote.
- **The snapshotter is the one thing that fails loudly, and only on ZFS.** If a node won't go Ready, read `journalctl -u k3s` for `overlayfs` before suspecting anything else. `--snapshotter=native` is the escape hatch, but use it on all five or none.
- **LXD snapshots and etcd snapshots are different tools.** LXD snapshots restore *machines*; `k3s etcd-snapshot` restores *cluster data*. Reach for the right one.
- **Snapshot the masters stopped and together, always.** A running etcd member snapshotted mid-write is a trap, and restoring one stale member into a live cluster is worse than having no snapshot at all.
- **master3 is still the canary for Part 2's Step 2.** If a third node ever misbehaves where the first two were fine, suspect a shared host limit (inotify or keys) before you suspect the node.
- **Quorum is `floor(n/2)+1`, and it has a leader.** Three members tolerate one loss. Writes flow through one elected leader; lose the leader and the survivors elect a new one in about a second, but only while a quorum survives to do the electing. That's why the cluster has three masters and not two or four.

### What Part 4 does

1. Give the cluster real storage; the `nfs-common` and `open-iscsi` you installed back in Part 2's template were for exactly this.
2. Run stateful programs that keep data across restarts.
3. Watch what happens to that data when a worker dies and comes back.

Step 7's `post-install` snapshot is the clean cluster you'll return to at the start of Part 4.

Continue with [**Part 4, Adding Persistent Storage**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-4-adding-persistent-storage/).
