---
layout: post
title: Building a Kubernetes Lab with k3s and LXD Part 4 Adding Persistent Storage
description: Give the k3s cluster persistent storage with local-path and NFS, then kill a worker to prove a stateful app keeps its data when it moves to another node.
date: 2026-07-16 08:00:00 +0800
published: true
categories: [kubernetes]
tags: [k3s, kubernetes, lxd, ubuntu, snap, lxc, container]
toc: true
media_subpath: /assets/media/2026/kubernetes-lab-with-k3s-and-lxd-part-4-adding-persistent-storage
image: kubernetes-lab-part4.webp
---

This is **Part 4** of a series on building a Kubernetes lab with k3s and LXD. If you're just arriving, start with [**Part 1, Preparing the Ubuntu Host**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-1-preparing-the-ubuntu-host/), [**Part 2, Building the Five Nodes**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-2-building-the-five-nodes/), and [**Part 3, Installing k3s**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-3-installing-k3s/). This part picks up right where Part 3 left off.

**Where you are.** Part 3 turned five machines into one healthy Kubernetes cluster: three masters that share a database and vote, and two workers that run programs. You proved the cluster comes up, that pods on different nodes can talk to each other, and that quorum protects itself when a master dies. But the cluster is empty. Every test in Part 3 cleaned up after itself and confirmed `kubectl get pvc -A` was empty; nothing was ever stored.

**What this part does.** It gives your programs a place to keep data. First with the storage k3s already ships with (local disk), then with network storage (NFS) that any node can reach. Along the way it shows you the one fact that makes cluster storage different from storage on a single machine: **where the data actually lives decides whether it survives a pod moving to another node.** Then it kills a worker on purpose to prove the point.

**What this part does NOT do.** It doesn't set up production-grade replicated block storage in full. That's mentioned at the end (it's what the `open-iscsi` package was for), but the lab's lesson lands with NFS, which is easier to see through.

**What you need before starting.** The `post-install` snapshot from Part 3's Step 6, all five nodes Ready, and the `nfs-common` package that Part 2 put in the template. Step 1 checks all of this.

---

## Words you'll need

These build on Parts 2 and 3. Here are the new ones.

| Word | What it means |
|---|---|
| **stateful** | A program that keeps data it cares about: a database, a wiki, anything with a file that must outlive the program. The opposite is **stateless**: nginx and busybox from Part 3 kept nothing, so killing them lost nothing. |
| **volume** | A directory that Kubernetes hands to a pod for storing files. The question that matters all through Part 4 is: *where does that directory physically live?* |
| **PersistentVolume (PV)** | A piece of storage that exists in the cluster on its own, independent of any pod. Think of it as "a disk the cluster knows about." |
| **PersistentVolumeClaim (PVC)** | A pod's *request* for storage: "I need 1 GB that survives restarts." Kubernetes matches the claim to a PV. Pods ask for PVCs; they don't touch PVs directly. |
| **StorageClass** | A named recipe for making storage automatically. When a PVC names a StorageClass, the cluster creates a PV to satisfy it, so no one has to make the disk by hand. k3s ships with one called `local-path`. |
| **provisioner** | The program behind a StorageClass that actually creates the storage when a PVC asks. `local-path` has one; NFS will need one you add. |
| **dynamic vs static** | *Dynamic*: a PVC arrives, and the provisioner makes a PV on the spot. *Static*: you create the PV by hand first, and the PVC binds to it. Dynamic is the normal way; static is useful for seeing the wiring. |
| **local-path** | k3s's built-in StorageClass. It stores data on the local disk of whichever node the pod runs on. It's fast and needs zero setup, but it's node-locked, which is the whole lesson of Steps 2 and 3. |
| **NFS** | Network File System. One machine (the **server**) shares a directory; other machines (the **clients**) mount it over the network and use it as if it were local. The data lives on the server, so every node reaches the same files. |
| **export** | The directory an NFS server chooses to share, plus the rules for who may use it. It's listed in `/etc/exports` on the server. |
| **ReadWriteOnce (RWO)** | A volume one node can mount at a time. `local-path` is RWO: its data is on one node, so only that node can use it. |
| **ReadWriteMany (RWX)** | A volume many nodes can mount at once. NFS is RWX, because the files live on a server every node can reach. |
| **node-locked / node affinity** | A PV that's tied to one specific node. A pod using it can only run on that node. This is what makes `local-path` unable to follow a pod that moves. |
| **eviction / reschedule** | When a node goes away, Kubernetes waits a grace period, gives up on the pods there, and tries to start fresh copies elsewhere. Whether the *data* comes with them depends entirely on where it lived. |

---

## Three things to know before you start

### 1. The one question this whole part turns on: *where does the data live?*

On a single machine, "storage" is simple: there's one disk, and everything's on it. A cluster breaks that assumption, because a pod can be moved to a different machine at any time. So there are really two kinds of storage here, and the difference isn't speed or size; it's **location**:

- **Local storage** (`local-path`) puts the data on the node the pod happens to run on. If the pod moves, the data doesn't come with it.
- **Network storage** (NFS, and later iSCSI) puts the data on a machine both nodes can reach. The pod can move freely, because the data was never on the node in the first place.

Everything in Part 4 is built to make that difference visible rather than take it on faith. You'll write data with local storage and watch it get stranded, then write data with network storage and watch it survive a worker being killed.

### 2. One thing here can fail loudly, and it's NFS mounting inside a container

This is Part 4's version of Part 3's snapshotter: the single most likely thing to stop you, and (mercifully) it fails visibly. Your nodes are containers, and mounting a network filesystem *inside* a container is more restricted than doing it on a normal machine. Two things have to be true on the host for it to work:

- the host kernel has NFS support loaded (a module thing, like Part 2's six modules), and
- the container is allowed to perform an NFS mount (an LXD permission thing).

Because your nodes are privileged containers (Part 2's `uid_map` reading `0 0 4294967295` is the sign of that), NFS mounts often *just work*. But if they don't, the failure is loud and specific: a pod stuck with a mount error naming `nfs`, or an `apparmor="DENIED"` line. Step 5 tries the mount, and if it's refused, tells you the one setting to add. Same shape as Step 1 of Part 3: try the default, check, and only reach for the fix if the check fails.

### 3. "The pod is Running" does not mean "the data is safe"

A stateless pod that dies is replaced and nobody notices. A stateful pod that dies is only fine if its data outlived it. Those are separate claims, and Kubernetes reports the first one loudly (`Running`, `Ready`) while saying nothing about the second. Part 4 makes you check the second one directly: write a value, kill the thing holding it, and read the value back, because that's the only honest test of storage.

---

## Step 1 — Restore the clean cluster and re-check the basics

**Why:** Part 3 ended by breaking quorum on purpose. It healed, but the tidiest known-good starting point for Part 4 is the `post-install` snapshot, which was taken while everything was stopped and consistent. Starting from it means any trouble in Part 4 belongs to Part 4, not to leftovers from the last experiment.

If your cluster is already healthy and you'd rather not roll back, skip the restore and just run the health checks below. If you want a guaranteed-clean slate, restore first:

```bash
# Optional but recommended: return to Part 3's post-install snapshot.
for n in master1 master2 master3 worker1 worker2; do lxc stop "$n"; done
for n in master1 master2 master3 worker1 worker2; do lxc restore "$n" post-install; done
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 30
```

Now confirm the cluster is whole. These commands only read:

```bash
lxc info | head -3        # wakes LXD if it's asleep, same trick as before
sleep 3
lxc list                  # expect five RUNNING rows, plus the STOPPED template

kubectl get nodes
# Expect: five Ready. Masters read control-plane,etcd,master; workers <none>.

kubectl get nodes -l node-role.kubernetes.io/etcd=true
# Expect: three etcd members; quorum intact.

kubectl get all -n default
# Expect ONE line: service/kubernetes. That's the clean baseline. Anything
# else here is leftover from an earlier experiment; delete it by name.

kubectl get pvc -A
# Expect: "No resources found." You're about to change that on purpose.
```

Now check the one Part 2 package this part depends on. `nfs-common` is the NFS **client**, and every node needs it to mount an NFS share. Part 2 put it in the template, so all five nodes inherited it. Confirm on one:

```bash
lxc exec worker1 -- dpkg -l nfs-common | grep -q '^ii' \
  && echo "ok  nfs-common present" || echo "MISSING nfs-common"
# Expect: ok. If MISSING, install it inside each node:
#   lxc exec <node> -- apt-get install -y nfs-common
```

If all five nodes are Ready, etcd shows three members, `default` shows only `service/kubernetes`, and `nfs-common` is present, you're ready.

---

## Step 2 — Use the storage k3s already gave you (local-path)

**What this does.** k3s ships with a working StorageClass called `local-path`, so you already have dynamic storage with no setup at all. This step proves it works: you write a value to disk, delete the pod, then read the value back from a fresh pod. That's the core "data survives a restart" test in its simplest form.

First, confirm the StorageClass is there and is the default:

```bash
kubectl get storageclass
# Expect: one class, "local-path", marked (default). "default" means a PVC
# that names no class gets this one automatically.
```

Now for the real test. First, here's why saving data matters at all.

When Kubernetes runs a container, it gives it a fresh, empty filesystem. Anything the program writes stays inside that container and nowhere else. That's fine until the pod goes away, and pods go away often: they restart when the program crashes, when you roll out a new version, or when the node reboots. Each restart builds a brand-new container from the image, with an empty filesystem again, so whatever the old one wrote is gone.

For a stateless app, like a web server that only serves pages, losing that is no loss at all. But most real programs keep something they can't afford to lose: a database file, uploaded photos, a user's settings. If that file disappears on every restart, the program is useless. A **PersistentVolumeClaim (PVC)** fixes this by giving the program a folder that isn't part of the container. The program writes to it normally, but the bytes land on a disk that outlives the pod. Delete the pod, start a new one pointing at the same claim, and the file is still there.

You'll do it in four short steps: create the storage and a pod to use it, write one line into the volume once the pod is up, delete the pod, then read the same line back from a completely different pod. If the second pod can read what the first wrote, the data survived. That is persistence.

**Stage 1. Create the claim and a pod to hold the data.** The manifest below holds two objects, joined by the `---` line:

- The **PersistentVolumeClaim** named `local-data` is the request for storage: 100Mi that outlives any single pod. Applying it makes the `local-path` provisioner create a real **PersistentVolume** for it (a folder on one node's disk) and bind the claim to that volume.
- The **Pod** named `writer` is a plain busybox container that just stays running (its command is `sleep 3600`). It declares a volume called `store` that points at the claim (`claimName: local-data`) and mounts it at `/data` inside the container. It doesn't write anything on its own. You'll write the file yourself in a moment, once the pod is up, so the write is a step you can see rather than something hidden in the pod's startup. Because `/data` is the mounted volume, whatever you write there lands on the claimed disk, not inside the throwaway container.

First write both objects into a file called `writer.yaml`:

```bash
cat > writer.yaml <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: local-data
spec:
  accessModes: ["ReadWriteOnce"]      # local-path is RWO, one node at a time
  resources:
    requests:
      storage: 100Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: writer
spec:
  containers:
  - name: writer
    image: busybox
    command: ["sh", "-c", "sleep 3600"]
    volumeMounts:
    - name: store
      mountPath: /data                 # the volume appears here inside the pod
  volumes:
  - name: store
    persistentVolumeClaim:
      claimName: local-data            # the pod uses the claim above
EOF
```

Then apply that file to the cluster:

```bash
kubectl apply -f writer.yaml
```

**Stage 2. Check that the storage bound, and see where the pod landed.** Applying that manifest set off a chain: Kubernetes read the claim, the `local-path` provisioner made a volume for it, bound the two, then scheduled the `writer` pod onto a node and mounted the volume. These two commands confirm each half worked:

```bash
kubectl get pvc local-data
# Expect: STATUS Bound. A PV was created automatically to satisfy the claim.

kubectl get pod writer -o wide
# Expect: Running, on one of the workers. Note WHICH node; call it node A.
# local-path put the data on node A's local disk.
```

`Bound` means the claim now has a real volume behind it, and `writer` is running with that volume mounted at `/data`. Take note of which worker it landed on. With `local-path`, the volume is a folder on that node's own disk, so the data physically sits on **node A** and nowhere else. That detail looks minor right now, but it's the whole point of Step 3.

**Stage 3. Now that the pod is up, write a line into the volume.** The container is running, but nothing is stored yet. Write one line into `/data` (the mounted claim) by running a command inside the pod with `kubectl exec`:

```bash
kubectl exec writer -- sh -c "echo 'hello from the first pod' > /data/note.txt"
```

Read it straight back to confirm it landed:

```bash
kubectl exec writer -- cat /data/note.txt
# Expect: hello from the first pod
```

The write went to `/data/note.txt` inside the pod, but `/data` is the volume, so the line is really stored on the `local-data` claim, not in the container. The next step proves that by throwing the pod away.

**Stage 4. Delete the writer, then read the file back from a new pod.** This is the real test. Deleting the pod leaves the claim and its data untouched, so a fresh `reader` pod that mounts the same claim should still find the line the writer saved. Notice the `reader` pod is a different pod with a different name, but it points at the same `claimName: local-data`.

First delete the writer pod. The claim and its data stay behind:

```bash
kubectl delete pod writer          # the pod is gone; the PVC and its data remain
```

Write the reader pod into `reader.yaml`:

```bash
cat > reader.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: reader
spec:
  containers:
  - name: reader
    image: busybox
    command: ["sh", "-c", "cat /data/note.txt && sleep 3600"]
    volumeMounts:
    - name: store
      mountPath: /data
  volumes:
  - name: store
    persistentVolumeClaim:
      claimName: local-data
EOF
```

Apply it:

```bash
kubectl apply -f reader.yaml
```

Give it a moment to start, then read the file back:

```bash
sleep 5
kubectl logs reader
# Expect: "hello from the first pod". A different pod read a file the first
# pod wrote. The data outlived the pod; that's persistence.
```

That's storage working. But notice something the test quietly relied on: the reader landed on **node A**, the same node as the writer. It had to, and the next step shows why that's a limit, not a coincidence.

---

## Step 3 — See where local-path stops: the data can't leave its node

**What this does.** It shows the one weakness of local storage. The data from Step 2 lives on node A's disk. So any pod that wants it *must* run on node A. If node A is busy or down, the pod can't move somewhere else and bring its data along, because the data isn't stored anywhere else.

Look at the PV (the PersistentVolume) that Kubernetes created, and you'll see it's pinned to one node:

```bash
kubectl get pv
# Find the PV bound to local-data, then describe it:
kubectl describe pv $(kubectl get pv -o jsonpath='{.items[0].metadata.name}') | grep -A3 'Node Affinity'
# Expect: a Node Affinity rule naming ONE node (node A). This is the pin:
# "this volume only exists on node A, so only node A may use it." The literal
# line reads:  Term 0:  kubernetes.io/hostname in [<node A>]   (e.g. [worker2]).
```

Now force the issue. Tell Kubernetes it may not run new pods on node A (`cordon`), then try to start a pod that needs the data.

First cordon node A and remove the running reader, so the next pod has to schedule fresh:

```bash
# Replace <nodeA> with the node name from Step 2.
kubectl cordon <nodeA>             # "no new pods here", and doesn't touch running ones
kubectl delete pod reader
```

Write a new pod, `reader2`, that wants the same data:

```bash
cat > reader2.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: reader2
spec:
  containers:
  - name: reader2
    image: busybox
    command: ["sh", "-c", "cat /data/note.txt && sleep 3600"]
    volumeMounts:
    - name: store
      mountPath: /data
  volumes:
  - name: store
    persistentVolumeClaim:
      claimName: local-data
EOF
```

Apply it:

```bash
kubectl apply -f reader2.yaml
```

Now watch it fail to schedule:

```bash
sleep 5
kubectl get pod reader2
# Expect: Pending, NOT Running. The pod needs node A (that's where its data
# is), but node A is cordoned. It can't run anywhere else, so it waits.

kubectl describe pod reader2 | grep -A5 Events
# Expect: a message about node affinity / volume node conflict. In plain terms:
# "the only node that can supply this volume is off-limits, and no other node
#  has the data." The pod is stuck, and no amount of free workers helps.
```

This is the whole point. **Local storage ties a pod to a place.** For a stateless web server that's fine: it has no data, so any node will do. For a database it's a real constraint. Lose that node and the data is unreachable until the node comes back.

Now clear the local-path example so the lab is clean before the NFS steps. Undo the cordon, delete the leftover pod, and delete the claim. Deleting the claim is what removes the data: local-path sees the claim go and deletes the volume and its files on node A along with it.

```bash
kubectl uncordon <nodeA>
kubectl delete pod reader2 --ignore-not-found
kubectl delete pvc local-data          # deletes the claim; local-path deletes the data
kubectl get all -n default             # expect: only service/kubernetes again

kubectl get pvc,pv
# Expect: "No resources found." Deleting the claim made local-path remove the volume
# and its data directory on node A. (The PV may take a few seconds to disappear.)

rm -f writer.yaml reader.yaml reader2.yaml   # remove the local manifest files
```

The fix for a pod that must be free to move is storage that doesn't live on any single node. That's NFS, and it's the next four steps.

---

## Step 4 — Stand up an NFS server on the host

**What this does.** It turns your LXD host into a small file server. It shares one directory over the lab network, and every node will mount it. Because the files live on the host, not on any node, a pod carrying that storage can run anywhere.

Why the host? It's already on the lab network, it's always up, and it keeps the lab self-contained, with no sixth machine to build. (In production the NFS server would be a dedicated, backed-up box, never a node of the cluster it serves. For a lab, the host is the honest, simple choice.)

First, find the host's address on the lab network; the nodes will mount from it. The host is the gateway the containers already use, almost certainly `10.99.99.1`, but confirm rather than assume:

```bash
# Ask a container what its gateway is; that's the host's IP on the lab bridge.
lxc exec worker1 -- ip route | grep default
# Expect something like: default via 10.99.99.1 dev eth0
# Use whatever IP that shows as HOST_IP below. This guide assumes 10.99.99.1.
```

Now install the server and share a directory. Run this **on the host**:

```bash
sudo apt-get update
sudo apt-get install -y nfs-kernel-server

sudo mkdir -p /srv/nfs/k8s
sudo chown nobody:nogroup /srv/nfs/k8s
sudo chmod 0777 /srv/nfs/k8s          # lab-simple: any node may write. See note.
```

Declare who may use the share by adding one line to `/etc/exports`:

```bash
echo '/srv/nfs/k8s  10.99.99.0/24(rw,sync,no_subtree_check,no_root_squash)' \
  | sudo tee -a /etc/exports
sudo exportfs -ra                     # re-read the exports file
sudo systemctl enable --now nfs-kernel-server
```

What each export option means:

| Option | Why it's there |
|---|---|
| `10.99.99.0/24` | Only machines on the lab network may mount. Your five nodes qualify; nothing outside does. |
| `rw` | Nodes may read *and* write. |
| `sync` | Writes are committed to disk before the server says "done". Safer, and a good default. |
| `no_subtree_check` | Turns off a fragile old check; standard on modern shares. |
| `no_root_squash` | **Lab convenience.** By default NFS turns a client's `root` into a powerless `nobody` (that's "root squash"). Kubernetes mounts as root, so squashing causes permission-denied errors. Turning it off lets it work. On a real server you would *not* do this: it lets a client's root write as root on the server. Here it's a deliberate, contained shortcut, in the same spirit as Part 3's `--write-kubeconfig-mode=644`. |

Confirm the share is live:

```bash
sudo exportfs -v
# Expect: a line showing /srv/nfs/k8s exported to 10.99.99.0/24 with your options.
```

The server is up. Nothing is using it yet; that's the next two steps.

---

## Step 5 — Prove a node can actually mount the share (the loud-failure step)

**What this does.** Before you trust Kubernetes to mount NFS on its own, mount it by hand from one node. If a plain manual mount works, Kubernetes will too. If it's refused, you find out right here, cleanly, in one command, instead of debugging a stuck pod later. This is the step most likely to need a fix, and the fix is small.

Try the mount from `worker1`:

```bash
lxc exec worker1 -- mkdir -p /mnt/nfstest
lxc exec worker1 -- mount -t nfs 10.99.99.1:/srv/nfs/k8s /mnt/nfstest
# (use your HOST_IP if it wasn't 10.99.99.1)
```

**If that command returns silently**, it worked. First confirm it really is an NFS mount, not just an empty directory, with `findmnt`:

```bash
lxc exec worker1 -- findmnt /mnt/nfstest
# Expect: TARGET /mnt/nfstest  SOURCE 10.99.99.1:/srv/nfs/k8s  (fstype nfs4).
# Nothing printed means nothing is mounted there, and /mnt/nfstest is just a
# plain local folder on the container's own disk.
```

Now prove the share is really shared, both ways, so a local folder can't fool you: write from the node and see it on the host, then delete on the host and watch it vanish in the node.

```bash
lxc exec worker1 -- sh -c 'echo "written from worker1" > /mnt/nfstest/proof.txt'
sudo cat /srv/nfs/k8s/proof.txt          # on the host, expect the same line
sudo rm -f /srv/nfs/k8s/proof.txt        # now delete it on the host
lxc exec worker1 -- ls /mnt/nfstest      # expect: empty. The host delete reached
                                         # the node, so it really is one shared folder.
lxc exec worker1 -- umount /mnt/nfstest  # clean up the manual test
```

If that worked, skip the rest of this step and go to Step 6.

> **A hand mount does not survive a restart, and a bare mountpoint is a trap.** A `mount -t nfs` done by hand lasts only until the container stops. Restart it (the AppArmor fix below does exactly that) and the mount is gone, but `/mnt/nfstest` stays behind as an ordinary local folder. Write to it then and the file lands on the container's own disk, not the share, so it can look like NFS still works when nothing is mounted. When unsure, run `findmnt /mnt/nfstest`: a real mount names `10.99.99.1:/srv/nfs/k8s` as its source, and a bare folder shows nothing. This only bites the by-hand test; k3s and the provisioner mount NFS themselves and re-establish it after a restart.

**If the mount was refused**, read the error. It tells you which of two problems you have:

- **`access denied by server while mounting`** means the *export* is wrong (the node isn't in `10.99.99.0/24`, or `exportfs -ra` wasn't run). Fix it back in Step 4. This is a server-side problem.
- **`permission denied`, or an `apparmor="DENIED"` line in the host's `dmesg`** means the *container* isn't allowed to do NFS mounts. This is the LXD restriction from the intro. Here's the fix:

```bash
# Allow NFS mounts inside the node containers. Run on the host, per node.
for n in master1 master2 master3 worker1 worker2; do
  lxc config set "$n" raw.apparmor "mount fstype=nfs,
mount fstype=nfs4,
mount fstype=rpc_pipefs,"
  lxc restart "$n"
done
sleep 30
kubectl get nodes                 # expect all five Ready again after restart
```

Also make sure the host kernel has NFS client support loaded and that it survives reboots (same pattern as Part 2's modules):

```bash
# On the host:
sudo modprobe nfs nfsd
echo -e "nfs\nnfsd" | sudo tee /etc/modules-load.d/nfs.conf
```

Finally, if the mount prints no error but just **hangs or times out**, and `dmesg` shows no `apparmor="DENIED"` line, suspect the host firewall. This one only affects you if you kept a custom firewall from Part 1. Most readers skipped that, because a fresh Ubuntu install allows everything and LXD's own table already lets the bridge reach the host, so there is nothing here to do.

If you did keep a firewall, here is why NFS trips it. Your NFS server runs on the host at `10.99.99.1`, so a node mounting from it sends traffic *to the host*, which hits the host's `input` chain, not the forward one (the input versus forward point from Part 1). If your firewall's input policy is `drop`, it blocks the NFS ports unless you allow them, whatever LXD's table does, because in nftables a packet has to clear every input chain. Confirm it by asking the server what it shares, from a node:

```bash
lxc exec worker1 -- showmount -e 10.99.99.1
# Lists /srv/nfs/k8s: the firewall is fine, look elsewhere.
# Hangs or errors (an RPC or timeout message) while `ping 10.99.99.1` still
# works: the host is dropping the NFS ports.
```

NFS needs two ports open coming in on `lxdbr0`: `2049` (the NFS data port) and `111` (rpcbind, which `showmount` and older NFSv3 clients use). Allow both, TCP and UDP, on the host's input chain. In nftables that is:

```nft
table inet filter {
    chain input {
        iifname "lxdbr0" tcp dport { 111, 2049 } accept
        iifname "lxdbr0" udp dport { 111, 2049 } accept
    }
}
```

Add that to your ruleset the way you manage your other rules. (This guide names the bridge `lxdbr0` throughout; use your own variable if your config defines one.) Then check the syntax and load it:

```bash
sudo nft -c -f /etc/nftables.conf     # syntax check only, changes nothing
sudo systemctl reload nftables        # apply it
```

One caution carried over from Part 1: if your `/etc/nftables.conf` begins with `flush ruleset`, reloading wipes every table, LXD's `table inet lxd` included, and LXD will not rebuild it until it restarts. If yours flushes, reboot or run `sudo systemctl restart snap.lxd.daemon` after loading, so LXD's table comes back.

If you only ever use NFSv4 (what the Kubernetes NFS provisioner uses), port `2049` alone is enough; `111` is only there for `rpcbind` and `showmount`. Opening both is fine for a lab and keeps `showmount` working as a troubleshooting tool, so this guide keeps both.

Then run the manual mount test above again. Once a hand mount succeeds from a node, whatever was blocking it is solved for good, and Kubernetes will mount without trouble.

> Why bother with a manual mount at all? Because when a Kubernetes pod can't mount storage, the symptom is an unhelpful `ContainerCreating` that never finishes. The manual mount turns that silent stall into a plain error message you can act on. It's the "suspect the check before the machine" reflex again: test the smallest piece directly.

---

## Step 6 — Wire NFS into the cluster as a StorageClass

**What this does.** So far, NFS is just a share you can mount by hand. This step teaches the cluster about it, so that a PVC asking for NFS storage gets a volume automatically, exactly like `local-path` did, but backed by the server instead of a node's disk. You install a small **provisioner**, a program that watches for NFS claims and carves out a subdirectory on the share for each one.

Install Helm on the host if you don't have it (it's the easiest way to add the provisioner):

```bash
# On the host:
sudo snap install helm --classic
```

Add and install the NFS provisioner, pointing it at your server and share:

```bash
helm repo add nfs-subdir-external-provisioner \
  https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/
helm repo update

helm install nfs-provisioner \
  nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --set nfs.server=10.99.99.1 \
  --set nfs.path=/srv/nfs/k8s \
  --set storageClass.name=nfs-client
# (use your HOST_IP for nfs.server)
```

Confirm the new StorageClass and the provisioner pod:

```bash
kubectl get storageclass
# Expect two now: local-path (default) and nfs-client.

kubectl get pods -l app=nfs-subdir-external-provisioner
# Expect: one pod, Running. This is the program that makes NFS volumes on demand.
# If it's stuck ContainerCreating, that's the mount problem from Step 5; go back.
```

You now have two kinds of storage the cluster can hand out: `local-path` (on a node) and `nfs-client` (on the server). Both use the same PVC syntax; only the `storageClassName` differs. That symmetry is what makes the next step a fair comparison.

---

## Step 7 — Run a stateful app on NFS and prove the data can move

**What this does.** Step 2 proved data survives a pod restart, but only just: the reader had to land back on **node A**, because that's where local-path pinned the data. Real clusters don't respect that. Pods get moved to other nodes all the time, when a node fills up, gets drained for maintenance, or dies. So the sharper question is: can a new pod pick up its data on a *different* machine? With local-path the answer was no (Step 3). This step asks NFS the same question, and this time it forces the reader onto a different node to make the answer unmistakable.

The answer is yes, and the reason is the whole point of NFS: the storage doesn't live on any node. It lives on the server you built in Step 4, which every node can reach over the network. The data was never tied to a place, so a pod carrying it can run anywhere.

You'll run the same kind of test as Step 2, with one twist at the end: write a line on one node, confirm it's really sitting on the server, then read it back from a pod pinned to a *different* node.

**Stage 1. Create an NFS-backed claim and a pod that writes to it.** This is Step 2's manifest with two changes, both on the claim. `storageClassName: nfs-client` sends the request to the NFS provisioner instead of local-path, so the volume is carved out on the server rather than on a node's disk. And `accessModes: ["ReadWriteMany"]` (RWX) lets many nodes mount the volume at once, which is exactly what network storage allows and local-path could not. The `nfs-writer` pod is otherwise the same as before: it mounts the claim at `/data` and writes one line into `/data/note.txt`. Write it to a file, apply it, then confirm it bound and see which node the writer landed on:

```bash
cat > nfs-writer.yaml <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: nfs-data
spec:
  accessModes: ["ReadWriteMany"]      # NFS is RWX, many nodes at once
  storageClassName: nfs-client
  resources:
    requests:
      storage: 100Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: nfs-writer
spec:
  containers:
  - name: nfs-writer
    image: busybox
    command: ["sh", "-c", "echo 'written on the NFS share' > /data/note.txt && sleep 3600"]
    volumeMounts:
    - name: store
      mountPath: /data
  volumes:
  - name: store
    persistentVolumeClaim:
      claimName: nfs-data
EOF
```

Apply it:

```bash
kubectl apply -f nfs-writer.yaml
```

Then confirm the claim bound and see which node the writer landed on:

```bash
kubectl get pvc nfs-data              # expect: Bound
kubectl get pod nfs-writer -o wide    # expect: Running. Note which node, node A.
```

**Stage 2. Confirm the data is really on the server, not on a node.** With local-path you couldn't check this easily, because the data sat inside one node's disk. With NFS the file is an ordinary file in the host's shared folder, so you can read it straight from the host:

```bash
sudo find /srv/nfs/k8s -name note.txt -exec cat {} \;
# Expect: "written on the NFS share". The file is on the server, not on a node.
```

**Stage 3. Delete the writer, then read the file back from a pod on a *different* node.** This is the twist that local-path failed in Step 3. You delete the writer, then start an `nfs-reader` pod with its `nodeName` set to a worker that isn't node A (the manifest uses `worker2`; if node A was already `worker2`, change it to `worker1`). Setting `nodeName` forces Kubernetes to run the pod on that exact node, so there's no chance it quietly lands back where the data was written. If it still reads the line, the data genuinely moved with the pod:

```bash
kubectl delete pod nfs-writer
```

Now write the reader into `nfs-reader.yaml`. Pick a worker that isn't node A: the file uses `worker2`, so if node A was already `worker2`, change it to `worker1`:

```bash
cat > nfs-reader.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: nfs-reader
spec:
  nodeName: worker2                   # force it onto a specific, different node
  containers:
  - name: nfs-reader
    image: busybox
    command: ["sh", "-c", "cat /data/note.txt && sleep 3600"]
    volumeMounts:
    - name: store
      mountPath: /data
  volumes:
  - name: store
    persistentVolumeClaim:
      claimName: nfs-data
EOF
```

Apply it:

```bash
kubectl apply -f nfs-reader.yaml
```

Give it a moment, then check where it ran and what it read:

```bash
sleep 5
kubectl get pod nfs-reader -o wide    # expect: Running, on worker2
kubectl logs nfs-reader
# Expect: "written on the NFS share", read on a DIFFERENT node than it was
# written on. This is the exact thing local-path could not do in Step 3.
```

That contrast is the heart of Part 4. Same test, one word changed (`local-path` to `nfs-client`), and the Pending pod of Step 3 becomes a Running pod here, because the storage stopped being tied to a place.

---

## Step 8 — Break it on purpose: kill the worker, watch the data survive

**What this does.** This is Part 4's version of Part 3's "break it on purpose." There you killed a master and watched the *control plane* survive. Here you kill the worker running a stateful app and watch its *data* survive, because the data was on the NFS server, not on the worker. Then the app comes back on another node, still holding everything.

First, remember the same "kubectl lags reality" warning from Part 3: after you stop a node, `kubectl get nodes` may show it `Ready` for up to a minute before it flips to `NotReady`. `lxc list` shows the truth right away. When they disagree for a minute, believe `lxc list`.

Set up a small app that keeps *counting*, so you can prove not just that a file survived, but that its exact contents did. It appends a line every few seconds to the NFS share. Write the deployment to `counter.yaml`:

```bash
cat > counter.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: counter
spec:
  replicas: 1
  selector:
    matchLabels: { app: counter }
  template:
    metadata:
      labels: { app: counter }
    spec:
      containers:
      - name: counter
        image: busybox
        command: ["sh", "-c", "while true; do echo \"tick $(date +%T)\" >> /data/log.txt; sleep 3; done"]
        volumeMounts:
        - name: store
          mountPath: /data
      volumes:
      - name: store
        persistentVolumeClaim:
          claimName: nfs-data
EOF
```

Apply it:

```bash
kubectl apply -f counter.yaml
```

Give it a few seconds to start, then check it's running and already writing:

```bash
sleep 10
kubectl get pod -l app=counter -o wide
# Expect: one Running pod. Note its node; call it node X.

kubectl exec deploy/counter -- tail -3 /data/log.txt
# Expect: three recent "tick HH:MM:SS" lines. Remember the last timestamp.
```

Now kill node X, the worker running the counter:

```bash
# Replace <nodeX> with the worker name above.
lxc stop <nodeX>
```

Watch what happens. Kubernetes notices the node's heartbeats stop, waits out its grace period (about 40 to 60 seconds, plus a pod-eviction timeout of a few minutes by default), then gives up on the pod there and starts a fresh copy on the surviving worker:

```bash
lxc list                              # <nodeX> is STOPPED immediately (the truth)

kubectl get nodes                     # <nodeX> flips to NotReady after ~1 min

# Keep checking; the pod gets recreated on the other worker. This can take a
# few minutes (that's the eviction timeout, not a hang):
kubectl get pod -l app=counter -o wide -w
# Expect: eventually a new counter pod, Running, on the OTHER worker.
# Ctrl-C to stop watching once it's Running.
```

While you wait, `kubectl get pod` keeps showing the old pod as `Running` on the stopped node, often for a few minutes. Don't trust that line. The node is off, but its kubelet is no longer alive to report the truth, so the control plane just shows the last status it heard until the eviction timeout expires. It's the same "believe `lxc list`, not `kubectl`" lag from the start of this step. Once the timeout passes, the old pod goes `Terminating` and a fresh one appears `Running` on the other worker. Only then has the app actually moved.

Here's the payoff. **Wait until that new pod shows `Running` on the other worker**, then check the log it's writing to. If you run the next command too early, while the pod on the stopped node is still the target, `kubectl exec` fails with `502 Bad Gateway` or `error dialing backend`. That just means exec tried to reach the pod through its dead node's kubelet; it's not a fault in your setup, only too early, so wait and retry.

```bash
kubectl exec deploy/counter -- tail -5 /data/log.txt
# Expect: the OLD ticks from before you killed node X, followed by NEW ticks
# with a gap in the timestamps. The gap is the outage. The old lines proving
# the data survived is the point: a different pod, on a different node, picked
# up the exact same file.
```

Nothing was lost. The worker died, the app moved, and the data was waiting for it on the server. That move is Kubernetes reconciling **desired state** (the Deployment asks for one running replica) with **actual state** (the node holding it was gone): once it gave up on the dead node, it made a fresh pod on a healthy one to close the gap. **Had this been `local-path` storage, the new pod would be stuck `Pending`**, because its data was on the stopped worker, exactly like Step 3. That's the difference network storage buys you, shown under a real failure instead of a cordon.

Bring the worker back and confirm the cluster returns to five:

```bash
lxc start <nodeX>
sleep 30
kubectl get nodes                     # expect: five Ready again
```

### Clean up and return to the storage-free baseline

```bash
kubectl delete deployment counter --ignore-not-found
kubectl delete pod nfs-reader --ignore-not-found
kubectl delete pvc nfs-data           # removes the claim; provisioner archives its subdir (see below)
rm -f nfs-writer.yaml nfs-reader.yaml counter.yaml   # remove the manifest files

kubectl get all -n default            # expect: only service/kubernetes
kubectl get pvc -A                    # expect: No resources found

# The NFS provisioner (Step 6) is infrastructure; leave it. But confirm the
# share is empty of test data:
sudo ls /srv/nfs/k8s                  # expect: empty, or only archived subdirs
```

**About that `archived-...` directory.** If `ls` shows something like `archived-default-nfs-data-pvc-<id>`, that's expected. The NFS provisioner defaults to *archiving* a claim's folder instead of deleting it: when you removed the PVC, it renamed the folder with an `archived-` prefix rather than erasing it, as a safety net against accidental data loss. Nothing uses it now, so for the lab it's safe to remove:

```bash
sudo rm -rf /srv/nfs/k8s/archived-*
sudo ls -A /srv/nfs/k8s              # expect: no output, a truly empty share
```

You've now proven storage the same way Part 3 proved quorum: by taking the machine underneath it away and watching the thing above stay up.

---

## Step 9 (optional) — The production answer, and why `open-iscsi` is installed

NFS taught the lesson, but it has one weakness worth naming. The NFS server is a **single point of failure**. Every node depends on that one host. If it dies, all the network storage goes with it. That's fine for a lab, but not for production.

The production answer is **replicated block storage**: storage that keeps copies of your data on several nodes at once, so losing any one node loses nothing. The common k3s-friendly option is **Longhorn**. It's built on iSCSI, which is exactly why Part 2 installed `open-iscsi` in the template. That package has sat unused until now for the same reason `nfs-common` did. It's the client half of a storage system you hadn't set up yet.

Setting up Longhorn in full is beyond this lab, but here's the outline. You install it into the cluster. It turns each node's spare disk into a pool, then hands out volumes that are automatically mirrored across nodes. A pod gets a volume that behaves like a fast local disk but survives any single node dying. It combines local-path's speed with NFS's mobility, and adds redundancy that neither has.

If you want to explore it later, Longhorn installs as a single manifest and gives you its own StorageClass, which you'd use in a PVC just like `nfs-client`. Check the current version on the Longhorn site before installing, since the manifest URL is version-pinned. The concepts you'd carry in are the ones this part built: PVs, PVCs, StorageClasses, and the one question that never changes: *where does the data live, and does it survive the node?*

---

## Step 10 — Save a restore point

You have a cluster that now knows how to store data. Save the state the same careful way as Part 3, with all nodes stopped together so the etcd members stay consistent:

```bash
for n in worker1 worker2 master1 master2 master3; do lxc stop "$n"; done
for n in master1 master2 master3 worker1 worker2; do
  lxc snapshot "$n" post-storage
done
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 30
kubectl get nodes                     # expect: five Ready
```

Two things worth remembering about *this* snapshot versus Part 3's:

- The **NFS server lives on the host**, not in a node, so an LXD node snapshot does *not* capture it. The share directory (`/srv/nfs/k8s`) and the export config are host state. If you ever roll the nodes back, the server is still there, which is fine, because it's separate by design.
- The provisioner and StorageClass *are* in the cluster, so they're in this snapshot. Rolling back to `post-storage` gives you a cluster that already knows about NFS.

---

## Where you should be

| Thing | State |
|---|---|
| Storage classes | Two: `local-path` (default, on-node) and `nfs-client` (network) |
| NFS server | Running on the host, sharing `/srv/nfs/k8s` to the lab network |
| NFS mounting | Proven by hand from a node, then used by the cluster automatically |
| Stateful test | Data written, pod deleted, data read back; persistence proven |
| Node-locking | Seen: local-path strands a pod's data on one node; NFS does not |
| Failure test | Worker killed with a live app; app rescheduled elsewhere, data intact |
| Snapshots | `post-storage` on all five, taken stopped and together |

---

## Things worth carrying forward

- **The only question that matters in cluster storage is where the data lives.** On a node (`local-path`) it's fast but stranded when the node goes away. On the network (NFS, iSCSI) it's reachable from anywhere, so a pod can move and keep its data. Everything else is detail.
- **local-path is RWO and node-locked; NFS is RWX and node-free.** A pod on local-path can only run where its data is. That's fine for stateless apps, but a real limit for databases.
- **NFS mounting inside a container is Part 4's snapshotter**, the one loud failure. If a storage pod hangs in `ContainerCreating`, mount the share by hand from the node to turn the silent stall into a readable error, then fix modules or the apparmor rule.
- **"Running" says nothing about your data.** Test persistence directly: write a value, destroy the thing holding it, read the value back. That's the only honest check.
- **NFS is a single point of failure; replicated block storage (Longhorn, on iSCSI) is the production fix.** That's what `open-iscsi` was installed for, and the concepts transfer unchanged.
- **Snapshot the nodes stopped and together, and remember the NFS server is host state.** It's outside the node snapshots on purpose.

---

## Where this leaves the series

You now have a highly-available cluster (Part 3) that can also keep data safely across node failures (Part 4). That's a genuinely working small Kubernetes platform: it stands up, it heals when a master dies, it runs programs, and it holds onto their data when a worker dies. `post-storage` is the clean cluster you'd return to before running anything real on it.
