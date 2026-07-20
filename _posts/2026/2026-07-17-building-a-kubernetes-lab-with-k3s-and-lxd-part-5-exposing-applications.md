---
layout: post
title: Building a Kubernetes Lab with k3s and LXD Part 5 Exposing Applications
description: Get traffic from your browser into a pod. Walk the three Service types, route by hostname with Ingress, then swap in MetalLB and ingress-nginx and see what actually changed.
date: 2026-07-17 08:00:00 +0800
published: true
categories: [kubernetes]
tags: [k3s, kubernetes, lxd, ubuntu, metallb, ingress, nginx, traefik]
toc: true
media_subpath: /assets/media/2026/kubernetes-lab-with-k3s-and-lxd-part-5-exposing-applications
image: kubernetes-lab-part5.webp
---

This is **Part 5** of a series on building a Kubernetes lab with k3s and LXD. If you are just arriving, start with [**Part 1, Preparing the Ubuntu Host**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-1-preparing-the-ubuntu-host/), then [**Part 2, Building the Five Nodes**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-2-building-the-five-nodes/), [**Part 3, Installing k3s**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-3-installing-k3s/), and [**Part 4, Adding Persistent Storage**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-4-adding-persistent-storage/). This part picks up where Part 4 left off.

**Where you are.** You have five nodes running one Kubernetes cluster. Three masters share a database and vote. Two workers run programs. The cluster survives a master dying (Part 3) and keeps data when a worker dies (Part 4). Everything you have tested so far, though, you tested from *inside*. Every check ran through `kubectl`, or from a pod, or from the host over the lab network.

Nothing you have built is reachable from a browser.

**What this part does.** It closes that gap. You will get traffic from your own laptop, through your home network, into a pod running on a node, and back again. Then you will do it properly, so that ten applications can share one address instead of needing ten.

**The main point, in one line.** Getting *out* of the cluster is easy. The interesting question is how many applications can share one way out, and the answer to that is Ingress.

**What this part does not do.** No HTTPS yet. Everything here is plain HTTP on purpose, because certificates are a separate idea and mixing them in would hide what the networking is doing. Certificates are Part 7.

**What you need before starting.** The `post-storage` snapshot from Part 4's Step 10, all five nodes Ready, and a router you can log into. Step 1 checks the cluster. Step 5 is the router part, and it is optional if you are happy browsing from the host itself.

---

## Words you'll need

These build on Parts 2, 3 and 4. Here are the new ones.

| Word | What it means |
|---|---|
| **Service** | A stable name and address for a group of pods. Pods come and go and their addresses change. A Service does not, so everything talks to the Service instead of to pods. |
| **ClusterIP** | The default kind of Service. It gets an address that only works *inside* the cluster. Nothing outside can reach it. |
| **NodePort** | A Service that also opens one high-numbered port, the same port, on **every** node. Reach any node on that port and you reach the Service. |
| **LoadBalancer** | A Service that asks the cluster for a real, outside address of its own. What creates that address depends on what you installed. |
| **ServiceLB** | The thing k3s ships that answers `LoadBalancer` requests. Also called Klipper. It uses the nodes' own addresses rather than handing out new ones. |
| **MetalLB** | A replacement for ServiceLB. It owns a pool of spare addresses and hands out a real, separate one per Service. |
| **Ingress** | A rule that says "traffic asking for *this hostname* goes to *that Service*." One address can serve many hostnames. |
| **Ingress controller** | The program that reads your Ingress rules and actually does the routing. k3s ships **Traefik**. The most common alternative is **ingress-nginx**. |
| **IngressClass** | Which controller should handle a given Ingress rule. You name it in the rule. This is what makes swapping controllers a one word change. |
| **reverse proxy** | A program that takes a request meant for somewhere else and forwards it on. An Ingress controller is a reverse proxy with Kubernetes rules. |
| **Host header** | A line every browser sends with a request, saying which hostname it asked for. Ingress reads it to decide where the request goes. This is the whole trick. |
| **ARP** | How a machine on a local network asks "who owns this address?" MetalLB works by answering that question on behalf of an address nobody really owns. |
| **static route** | A rule you add to a router telling it "traffic for *this* network goes to *that* machine." This is how your laptop learns to reach the lab. |

---

## Three things to know before you start

### 1. You already have both pieces, and nobody told you

Most guides about exposing applications start by telling you that bare metal Kubernetes has no load balancer, so a `LoadBalancer` Service sits forever showing `EXTERNAL-IP <pending>`, and that you must install MetalLB to fix it.

**That is not true on k3s.** k3s ships a load balancer called ServiceLB and it is switched on by default. It also ships an Ingress controller, Traefik, and that is on by default too.

You have already seen the proof, back in Part 3. When you first ran `kubectl get pods -A`, the expected output included `traefik` and `svclb-traefik`. Those `svclb` pods are the load balancer. The `traefik` pod is the Ingress controller. Both have been running since your first hour of Part 3, doing nothing, because nothing has asked them for anything yet.

So Steps 2 to 4 cost you no installation at all. You will learn Services and Ingress with what is already there. Only later, in Steps 6 and 7, do you install anything, and when you do it is a **swap**, not a filling of a hole. Knowing that changes what those steps mean. You are not fixing something broken. You are choosing a different tool and finding out what the choice buys you.

### 2. The one thing likely to stop you is not Kubernetes

Every part of this series has had one step that can genuinely block you. Part 3 had the snapshotter on ZFS. Part 4 had NFS mounting inside a container. This part has routing, and it is worth naming now.

Your nodes live on `10.99.99.0/24`, a private network that exists only on your host (Part 1, Step 7). Your laptop lives on your home network, something like `192.168.1.0/24`. Those two networks have never heard of each other. Your laptop has no idea `10.99.99.0/24` exists, and if you ask it to reach `10.99.99.240` it will hand the request to your router, which will also have no idea, and send it out to the internet where it dies.

**This is not a Kubernetes problem and no amount of Kubernetes will fix it.** It is one line of configuration on your router. Step 5 does it. If your router will not let you, you can still do everything in this part from the host's own browser, because the host is *on* both networks. Nothing is lost, and I say so where it matters.

### 3. A load balancer and an Ingress are not the same thing, and the difference is the point

These two words get used as if they are interchangeable. They are not, and the whole shape of this part depends on the difference.

- A **load balancer** gets you an address. That is all. One address, one Service. Ten applications, ten addresses.
- An **Ingress** sits behind *one* of those addresses and splits traffic by hostname. Ten applications, still one address.

So they stack. You use a load balancer once, to get a front door, then you use Ingress to put ten rooms behind that one door. Steps 2 and 3 build the door and show you why one door per room does not scale. Step 4 puts the rooms behind it.

---

## Step 1 — Check Part 4 is still good

**Why:** the same reason as every part. If something drifted, find out now, while a fault still looks like itself.

**Safe to run:** everything here only reads.

```bash
lxc info | head -3        # wakes LXD if it's asleep, same trick as before
sleep 3
lxc list                  # expect five RUNNING rows, plus the STOPPED template

kubectl get nodes
# Expect: five Ready.

kubectl get all -n default
# Expect ONE line: service/kubernetes. That's the clean baseline from Part 4.

kubectl get storageclass
# Expect two: local-path (default) and nfs-client. Part 4's work is still here.
```

Now look at the two things this part is about, both of which have been running since Part 3 and which you have probably never looked at:

```bash
kubectl get svc -n kube-system traefik
```

Read that line carefully, because it contradicts what most guides told you to expect:

```
NAME      TYPE           CLUSTER-IP     EXTERNAL-IP                                       PORT(S)
traefik   LoadBalancer   10.43.x.x      10.99.99.11,10.99.99.12,10.99.99.13,10.99.99.21,10.99.99.22   80:3xxxx/TCP,443:3xxxx/TCP
```

**`EXTERNAL-IP` is not `<pending>`.** It lists your five node addresses. Something answered the request for an outside address, and that something is ServiceLB. Look at it directly:

```bash
kubectl get pods -n kube-system -l svccontroller.k3s.cattle.io/svcname=traefik -o wide
# Expect: one svclb-traefik pod per node, all Running.
```

One pod per node, and each one holds port 80 and port 443 on the node it runs on. That is the whole mechanism. There is no clever virtual address. ServiceLB just parks a tiny pod on every node that grabs the port and forwards inward.

Keep that in mind, because it is exactly why ServiceLB runs out of room in Step 3.

---

## Step 2 — The three ways out, walked one at a time

**What this does.** It deploys one small application and then changes only its Service type, three times, so you can see what each type gives you and what it costs. Same pods throughout. Only the way in changes.

The application is `traefik/whoami`. It is about 4 MB, it does one thing, and that one thing is perfect here: it answers every request by printing the request back at you, including which pod answered and which hostname you asked for. When you get to Ingress in Step 4, that last detail is what makes the routing visible instead of something you take on faith.

```bash
kubectl create deployment whoami --image=traefik/whoami --replicas=2
kubectl get pods -l app=whoami -o wide
# Expect: two Running pods. Note which nodes they landed on.
```

Two copies, so you can also see requests being spread between them.

### 2a. ClusterIP, the inside only address

```bash
kubectl expose deployment whoami --port=80
# No --type flag, so you get the default: ClusterIP.

kubectl get svc whoami
# Expect: TYPE ClusterIP, an address in 10.43.x.x, EXTERNAL-IP <none>.
```

That `10.43.x.x` is from the service range Part 1 warned you not to collide with. Now try to reach it from the host:

```bash
curl --max-time 5 http://$(kubectl get svc whoami -o jsonpath='{.spec.clusterIP}')
# Expect: it times out. This address does not exist outside the cluster.
```

Now reach it from *inside*, the way one pod talks to another:

```bash
kubectl run probe --image=busybox --rm -it --restart=Never -- \
  wget -qO- --timeout=5 http://whoami
# Expect: a block of text starting with "Hostname: whoami-xxxxx".
# Run it two or three times and the Hostname changes between your two pods.
```

**That is a ClusterIP doing its job.** Inside the cluster it is a name that always works. Outside, it does not exist at all. This is the right default: most Services in a real cluster are one program talking to another, and those have no business being reachable from the internet.

### 2b. NodePort, a door on every node

```bash
kubectl patch svc whoami -p '{"spec":{"type":"NodePort"}}'
kubectl get svc whoami
# Expect: PORT(S) now reads something like 80:31234/TCP.
```

That second number is the NodePort. Kubernetes picked it from the range 30000 to 32767. It is now open on **all five nodes**, whether or not a `whoami` pod is running there:

```bash
NODEPORT=$(kubectl get svc whoami -o jsonpath='{.spec.ports[0].nodePort}')
echo "NodePort is $NODEPORT"

curl --max-time 5 http://10.99.99.21:$NODEPORT   # a worker
curl --max-time 5 http://10.99.99.11:$NODEPORT   # a master, with no whoami pod on it
# Expect: both work, and both answer with a whoami pod's details.
```

The master works even though no `whoami` pod runs there. The node took the request and forwarded it across the cluster network, the same vxlan path you proved in Part 3.

**So NodePort works. Here is why nobody uses it directly.**

- The port is a random high number, and `http://10.99.99.21:31234` is not an address you give anyone.
- You have to know a node address, and you have to pick one. Pick the wrong one and you are down when that node is.
- Every application needs its own port, and you have to keep track of which is which.

NodePort is a building block, not an answer. Almost every load balancer, ServiceLB included, is quietly built on top of it.

### 2c. LoadBalancer, an address of its own

```bash
kubectl patch svc whoami -p '{"spec":{"type":"LoadBalancer","ports":[{"port":8080,"targetPort":80}]}}'
kubectl get svc whoami
```

Note the port. The Service now listens on **8080**, not 80, and that is deliberate. Traefik already holds port 80 on every node, and Step 3 is about what happens when two things want the same one. For now, stay out of its way.

Expect `EXTERNAL-IP` to fill in with your five node addresses, the same as Traefik's. Then:

```bash
curl --max-time 5 http://10.99.99.21:8080
# Expect: whoami answers.
```

A sensible port, and an address list you did not have to invent. Check what appeared to serve it:

```bash
kubectl get pods -n kube-system -l svccontroller.k3s.cattle.io/svcname=whoami -o wide
# Expect: a new svclb-whoami pod on every node, Running.
```

**ServiceLB made a second set of pods, one per node, holding port 8080.** That is the same trick as Traefik's, on a different port. It is honest and it works, and its limit is now obvious enough to walk into on purpose.

---

## Step 3 — Where one address per application stops working

**What this does.** It adds a second application that wants the same port, and watches the wheels come off. This is not a bug. It is arithmetic, and it is the reason Ingress exists.

Add a second application, and ask for a `LoadBalancer` on port 8080 as well:

```bash
kubectl create deployment web --image=nginx --replicas=2
kubectl expose deployment web --port=8080 --target-port=80 --type=LoadBalancer

kubectl get svc web
# Expect: EXTERNAL-IP stays <pending>. This is the famous pending, and now
# you know it is not "bare metal has no load balancer". It is a port clash.
```

Find out why, from the thing that could not start:

```bash
kubectl get pods -n kube-system -l svccontroller.k3s.cattle.io/svcname=web
# Expect: svclb-web pods Pending, not Running.

kubectl describe pod -n kube-system -l svccontroller.k3s.cattle.io/svcname=web | grep -A5 Events
# Expect: a message about not having free ports for the requested pod ports.
```

**There it is, in plain words.** ServiceLB works by parking a pod on each node that grabs a port on that node. `whoami` already took 8080 on all five. There is no sixth node to put `web` on, and there is only one port 8080 per machine, so `web` waits forever.

You have three bad options and one good one:

| Option | Why it is bad |
|---|---|
| Give `web` a different port | Now you are back to remembering which application is on which port. This is NodePort with extra steps. |
| Add more nodes | The clash is per node, so every node still has one port 8080. More nodes does not help at all. |
| Install MetalLB so each Service gets its **own** address | Better, and Step 6 does it. But ten applications still means ten addresses to remember, and each still needs a DNS name eventually. |
| Put **one** thing on port 80 and let it split traffic by hostname | This is Ingress. One address, one port, as many applications as you like. |

Clean up the failed attempt before moving on. Both applications stay, but they go back to being plain ClusterIP Services, which is what Ingress expects behind it:

```bash
kubectl patch svc web    -p '{"spec":{"type":"ClusterIP","ports":[{"port":80,"targetPort":80}]}}'
kubectl patch svc whoami -p '{"spec":{"type":"ClusterIP","ports":[{"port":80,"targetPort":80}]}}'

kubectl get svc whoami web
# Expect: both ClusterIP, both on port 80, EXTERNAL-IP <none> for both.

kubectl get pods -n kube-system | grep svclb
# Expect: only svclb-traefik pods left. The svclb-whoami and svclb-web
# pods are gone, because ServiceLB cleans up when the Service stops
# asking for an address.
```

**Notice what you just did.** You took the outside address away from both applications. They are now unreachable from outside again, exactly like Step 2a. That is correct, and it is the setup for the next step: from here on, only *one* thing in the whole cluster has an outside address, and everything else hides behind it.

---

## Step 4 — Route by hostname with the Ingress you already have

**What this does.** It puts both applications behind Traefik, which already holds port 80 on every node, and tells Traefik which one to use based on the hostname the browser asked for. No installation. Traefik has been sitting there since Part 3 waiting to be given a rule.

### The idea, before the YAML

When your browser fetches `http://whoami.k3s.linsnotes.com`, it does two separate things that are easy to blur together:

1. It looks up the **name** to get an address, and connects to that address.
2. It sends the **name itself** along in the request, in a line called the `Host` header.

Step 1 is DNS, and every one of your lab hostnames will resolve to the *same* address. Step 2 is what Ingress reads. So all your applications share one address, and the controller behind that address opens each request, reads the `Host` line, and decides where to send it.

That is the whole mechanism. It is a receptionist at one front desk reading the name on the envelope.

### Write the rule

One Ingress object, two rules, one per hostname:

```bash
cat > lab-ingress.yaml <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: lab
spec:
  ingressClassName: traefik          # which controller handles this. See Step 7.
  rules:
  - host: whoami.k3s.linsnotes.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: whoami             # the ClusterIP Service from Step 2
            port:
              number: 80
  - host: web.k3s.linsnotes.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web
            port:
              number: 80
EOF

kubectl apply -f lab-ingress.yaml
```

Check it registered:

```bash
kubectl get ingress lab
# Expect: CLASS traefik, HOSTS listing both names, ADDRESS filling in with
# your node addresses, PORTS 80.
```

The `ADDRESS` column is Traefik's own `LoadBalancer` address from Step 1, borrowed. Your Ingress does not get an address of its own. It rides on the controller's.

### Test it without touching DNS

You do not need any DNS set up to test this, and you should test it before you do, so that a DNS mistake later cannot be confused with a routing mistake. `curl` will send whatever `Host` header you tell it to:

```bash
curl --max-time 5 -H "Host: whoami.k3s.linsnotes.com" http://10.99.99.11
# Expect: the whoami text block.

curl --max-time 5 -H "Host: web.k3s.linsnotes.com" http://10.99.99.11
# Expect: the nginx welcome page HTML.

curl --max-time 5 -H "Host: nothing.k3s.linsnotes.com" http://10.99.99.11
# Expect: 404 page not found. No rule matches, so Traefik refuses.
```

**Read those three results together, because they are the point of this whole part.** Same address. Same port. Three different answers, decided entirely by one line of text in the request. That third one matters as much as the first two: a hostname with no rule gets nothing, which is what makes it safe to point many names at one address.

Look at the `whoami` output once more. Near the top it prints the `Host:` line it received. That is not `curl` echoing back at you, it is the application reporting what actually arrived, having passed through Traefik untouched.

### Now make the names work in a browser

Nothing in DNS knows about `whoami.k3s.linsnotes.com` yet, so a browser cannot find it. The quickest honest fix is your host's own hosts file, which every machine checks before it asks DNS:

```bash
echo '10.99.99.11  whoami.k3s.linsnotes.com web.k3s.linsnotes.com' | sudo tee -a /etc/hosts
```

Then, on the host:

```bash
curl --max-time 5 http://whoami.k3s.linsnotes.com
# Expect: whoami answers. No -H flag this time; the browser-style path works.
```

Open `http://whoami.k3s.linsnotes.com` in the host's browser and you will see the whoami page. Refresh a few times and the `Hostname` line alternates between your two pods, which is the Service spreading requests without being asked.

> **Why `10.99.99.11` and not something nicer?** Because right now, with ServiceLB, Traefik's address really is "any of the five nodes", so you have to pick one, and if you pick `master1` and stop `master1`, your name stops working. That is a genuine weakness and it is what MetalLB fixes in Step 6. Do not fix it now. Feel it first.
{: .prompt-info }

---

## Step 5 — Reach the lab from the rest of your network

**What this does.** It teaches your home network that `10.99.99.0/24` exists and lives behind your Ubuntu host. After this, your laptop and your phone can reach the lab.

**This step is optional.** Everything in Parts 5 to 8 works from the host's own browser. Skip it if your router will not cooperate, and go to Step 6.

### Why nothing works right now

Your host sits on two networks at once. You saw both back in Part 1:

```bash
ip -brief addr
# Expect two addresses that matter: your real LAN one on something like
# enp5s0, and 10.99.99.1 on lxdbr0.
```

Your laptop only knows about the first one. When it wants `10.99.99.240`, it checks its own network, does not find it, and hands the packet to the router, which is the standard "I do not know, you deal with it" move. The router does the same thing and sends it to your internet provider, where it is dropped, because `10.99.99.0/24` is private and nobody outside your house should ever route it.

Nothing is broken. Nobody has ever been told where that network lives.

### Tell the router

Find your host's address on the real network:

```bash
ip -brief addr | grep -v lxdbr0 | grep -v LOOPBACK
# Note the address on your physical interface, for example 192.168.1.20.
```

Now log into your router and add a **static route**. Every router calls this something slightly different, usually under Advanced, Routing, or Static Routes. The three values are always the same:

| Field | Value |
|---|---|
| Destination network | `10.99.99.0` |
| Subnet mask | `255.255.255.0` (this is what `/24` means) |
| Gateway, or Next hop | your host's LAN address, for example `192.168.1.20` |

In plain words, you are telling the router: *anything for `10.99.99.x`, hand it to that Ubuntu machine, it knows what to do.*

Test from your laptop:

```bash
ping -c3 10.99.99.11
curl --max-time 5 -H "Host: whoami.k3s.linsnotes.com" http://10.99.99.11
```

Then add the same hosts line on your laptop and browse to it. On macOS and Linux the file is `/etc/hosts`. On Windows it is `C:\Windows\System32\drivers\etc\hosts`, and you need to open the editor as Administrator.

### If your router cannot do static routes

Plenty of provider supplied routers cannot. You can add the route on each client instead. It only helps that one machine, but that is often all you need:

```bash
# macOS
sudo route -n add 10.99.99.0/24 192.168.1.20

# Linux
sudo ip route add 10.99.99.0/24 via 192.168.1.20

# Windows, in an Administrator command prompt
route add 10.99.99.0 mask 255.255.255.0 192.168.1.20
```

Those are temporary and disappear at the next reboot, which is fine for a lab and easy to undo if you get it wrong.

### Two things that make this work, which you already did

This step is one line on a router, but it only works because of two decisions made much earlier, and they are worth connecting up.

**Your host is willing to forward.** Part 2's Step 3 set `net.ipv4.ip_forward = 1`. Without it, the host would receive your laptop's packet, see it was addressed to someone else, and drop it. It was set for the containers' own internet access, and it happens to be exactly what is needed here too.

**The reply does not get rewritten on the way back, and it easily could have.** Part 1's Step 7 set up NAT, so traffic leaving `10.99.99.0/24` for anywhere else gets its sender address rewritten to the host's. Read that rule on its own and you would expect this step to fail: a reply from `10.99.99.240` heading to `192.168.1.50` matches the description, and if it were rewritten, your laptop would receive an answer from an address it never asked, and drop it.

It works because Linux only decides about address rewriting on the **first** packet of a connection. After that the connection is remembered, and every later packet is handled to match. Your laptop started this connection, and no rewriting was done on that first packet, so nothing is rewritten on the replies either. The NAT rule is for connections started from *inside*, and it stays out of the way of connections started from outside.

You do not need to memorise that. It is here because "reaching in worked, and I half expected NAT to eat it" is a reasonable thing to wonder, and the answer is a real mechanism rather than luck.

---

## Step 6 — Swap ServiceLB for MetalLB

**What this does.** It replaces the load balancer k3s gave you with the one you would meet on real bare metal, and gives Traefik a single stable address instead of "any of five nodes".

**Be clear about why.** Everything works right now. This is not a fix. You are trading a simple thing that works for a more capable thing that is also what almost every bare metal cluster in the world actually runs. Three things you get:

- **One address, not five.** Your hosts file stops naming a specific node, so stopping that node stops nothing.
- **Addresses that are not node addresses.** Ten Services can each have their own port 80, because each has its own address.
- **A pool you control.** In Step 7 you install a second Ingress controller, and it needs its own address. With ServiceLB it would clash on port 80. With MetalLB it just takes the next free address.

### 6a. Keep MetalLB's addresses away from LXD's

MetalLB is about to start handing out addresses from `10.99.99.0/24`. LXD's own DHCP server is also handing out addresses from `10.99.99.0/24` to any container without a fixed one, which is how `template` ended up on `10.99.99.105` back in Part 2.

Nothing stops those two from picking the same address, and if they ever do, the result is two machines answering to one address and traffic going to whichever replied last. It would be intermittent, it would look like a Kubernetes fault, and it would be miserable to trace. So do the ten seconds of work that makes it impossible:

```bash
lxc network set lxdbr0 ipv4.dhcp.ranges 10.99.99.100-10.99.99.200
lxc network get lxdbr0 ipv4.dhcp.ranges
# Expect: 10.99.99.100-10.99.99.200
```

LXD now only gives out `.100` to `.200`. Your fixed node addresses (`.11` to `.13`, `.21`, `.22`) are outside that range and are unaffected, because they are assigned by name, not from the pool. MetalLB will use `.240` to `.250`, which LXD can no longer touch.

### 6b. Turn ServiceLB off

Two load balancers both trying to answer `LoadBalancer` Services is a fight you do not want to referee. Switch ServiceLB off first.

The tidy way to change k3s settings is `/etc/rancher/k3s/config.yaml`, which k3s reads at startup. It does the same job as adding flags to the install command, but you can edit it later without reinstalling anything:

```bash
for n in master1 master2 master3; do
  lxc exec "$n" -- bash -c 'mkdir -p /etc/rancher/k3s && cat > /etc/rancher/k3s/config.yaml <<EOF
disable:
  - servicelb
EOF'
done
```

> **Write the whole file, do not append to it.** If you add a second `disable:` block later instead of editing the existing one, the file has the same key twice, which is invalid YAML, and k3s will refuse to start. Step 7 edits this file again, and it rewrites it whole for exactly this reason.
{: .prompt-warning }

Restart the masters one at a time, waiting for each, so quorum is never at risk. This is the same care Part 3 asked for when joining them:

```bash
for n in master1 master2 master3; do
  echo "== restarting k3s on $n"
  lxc exec "$n" -- systemctl restart k3s
  sleep 30
  kubectl get nodes
done
```

Confirm ServiceLB is gone:

```bash
kubectl get pods -n kube-system | grep svclb
# Expect: no output. The svclb-traefik pods are gone.

kubectl get svc -n kube-system traefik
# Expect: EXTERNAL-IP is now <pending>. NOW you have the pending everyone
# warned you about, and it is because you asked for it.
```

Your lab is unreachable from outside at this moment. That is expected, and MetalLB is about to fix it.

### 6c. Install MetalLB

MetalLB installs from one manifest. The URL is version pinned, so check the current release on the MetalLB site rather than trusting a version number in a blog post, including this one:

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.9/config/manifests/metallb-native.yaml

kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app=metallb \
  --timeout=180s
# Expect: pods condition met. This waits rather than making you poll.

kubectl get pods -n metallb-system
# Expect: one controller pod, and one speaker pod per node (five).
```

Two kinds of pod, doing two different jobs:

- The **controller** hands out addresses. One per cluster.
- The **speaker** claims an address on the network. One per node, because the claim has to be made from a machine actually on that network.

Nothing has been given an address yet. MetalLB will not invent a pool for you, and that is deliberate, because guessing at a range on someone else's network is how you take out a printer.

### 6d. Give it a pool

```bash
cat > metallb-pool.yaml <<'EOF'
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: lab-pool
  namespace: metallb-system
spec:
  addresses:
  - 10.99.99.240-10.99.99.250     # outside LXD's DHCP range from 6a
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: lab-l2
  namespace: metallb-system
spec:
  ipAddressPools:
  - lab-pool
EOF

kubectl apply -f metallb-pool.yaml
```

Two objects, and both are needed:

- **`IPAddressPool`** is the list of addresses MetalLB is allowed to give out. On its own it does nothing except reserve them on paper.
- **`L2Advertisement`** is what makes an address real. It tells the speakers to answer ARP for these addresses, which is how a machine on a local network claims one. Without it, a Service gets an address that nothing on the network has ever heard of, and every request for it goes nowhere. This is the most common MetalLB mistake, and the symptom is an `EXTERNAL-IP` that looks perfectly healthy and does not answer.

Now watch Traefik pick up an address on its own:

```bash
kubectl get svc -n kube-system traefik
# Expect: EXTERNAL-IP is now a single address, 10.99.99.240.
```

**One address, not five.** Nobody edited the Traefik Service. It has been asking for a `LoadBalancer` address since Part 3, ServiceLB used to answer with node addresses, and now MetalLB answers with a real one from the pool.

Point your names at it and test:

```bash
sudo sed -i 's/^10\.99\.99\.11  whoami/10.99.99.240  whoami/' /etc/hosts
grep k3s.linsnotes.com /etc/hosts
# Expect: 10.99.99.240  whoami.k3s.linsnotes.com web.k3s.linsnotes.com

curl --max-time 5 http://whoami.k3s.linsnotes.com
curl --max-time 5 http://web.k3s.linsnotes.com
# Expect: both answer, same as before, through a single address now.
```

Update the same line on your laptop if you did Step 5.

---

## Step 7 — Swap Traefik for ingress-nginx

**What this does.** It replaces the Ingress controller with the one you are most likely to meet at work, and shows that your Ingress rules barely change.

**Why bother, when Traefik works?** Two honest reasons and one that is not.

- **ingress-nginx is what most workplaces and most documentation assume.** If a job description says Ingress, this is usually the one behind it. Knowing both, and knowing they are interchangeable, is worth more than knowing either.
- **It proves the Ingress object is portable.** You will change one word and everything keeps working. That is the actual lesson here, and you cannot learn it with only one controller installed.
- It is **not** because Traefik is worse. It is not. This is a swap, not an upgrade.

### 7a. Turn Traefik off

Rewrite the config file whole, with both entries in one `disable:` list:

```bash
for n in master1 master2 master3; do
  lxc exec "$n" -- bash -c 'mkdir -p /etc/rancher/k3s && cat > /etc/rancher/k3s/config.yaml <<EOF
disable:
  - servicelb
  - traefik
EOF'
done

for n in master1 master2 master3; do
  echo "== restarting k3s on $n"
  lxc exec "$n" -- systemctl restart k3s
  sleep 30
  kubectl get nodes
done
```

Check that Traefik actually went away:

```bash
kubectl get pods -n kube-system | grep -i traefik
# Expect: no output.

kubectl get svc -n kube-system | grep -i traefik
# Expect: no output.
```

If either still shows something after a few minutes, k3s did not finish removing it. Remove the chart by hand and it will go:

```bash
kubectl delete helmchart traefik -n kube-system --ignore-not-found
```

Your applications are unreachable again, because the thing that was routing to them is gone. The Ingress rule is still there, doing nothing, waiting for a controller that claims it:

```bash
kubectl get ingress lab
# Expect: still listed, but ADDRESS is now empty. A rule with nobody to enforce it.
```

### 7b. Install ingress-nginx

Helm is already on the host from Part 4's Step 6:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer
```

```bash
kubectl get pods -n ingress-nginx
# Expect: one controller pod, Running.

kubectl get svc -n ingress-nginx ingress-nginx-controller
# Expect: TYPE LoadBalancer, EXTERNAL-IP 10.99.99.240 or 10.99.99.241.
```

**MetalLB gave it an address without being asked.** That is Step 6 paying off immediately. With ServiceLB this would have failed exactly like Step 3's `web` did, because Traefik's replacement wants port 80 and there is one of those per node. With MetalLB, a second address means a second port 80, and there is no clash to have.

Note which address it got, because your hosts file needs to match:

```bash
NGINX_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "ingress-nginx is on $NGINX_IP"
```

### 7c. Change one word

```bash
sed -i 's/ingressClassName: traefik/ingressClassName: nginx/' lab-ingress.yaml
kubectl apply -f lab-ingress.yaml

kubectl get ingress lab
# Expect: CLASS nginx, and ADDRESS filling in with the ingress-nginx address.
```

That is the entire migration. Two hostnames, two backends, both untouched. The only thing that changed is which controller claims the rule.

Point your hosts file at the new address and test:

```bash
sudo sed -i "s/^10\.99\.99\.[0-9]*  whoami/$NGINX_IP  whoami/" /etc/hosts
grep k3s.linsnotes.com /etc/hosts

curl --max-time 5 http://whoami.k3s.linsnotes.com
curl --max-time 5 http://web.k3s.linsnotes.com
curl --max-time 5 http://nothing.k3s.linsnotes.com
# Expect: whoami answers, nginx answers, and the third is a 404 from
# ingress-nginx rather than from Traefik. Same behaviour, different program.
```

> **`ingressClassName` is the whole reason this was easy.** An Ingress does not name a program, it names a class, and a controller claims the classes it owns. That indirection is why a rule written for Traefik works on ingress-nginx untouched. Where they differ is the extra features each one adds through annotations, and those are not portable. Keep the plain rules plain and you keep the choice.
{: .prompt-tip }

---

## Step 8 — Break it on purpose

Every part of this series ends by taking something away to see what the design was for. Part 3 killed a master to watch quorum protect itself. Part 4 killed a worker to watch data survive. Here you kill the node holding your one address, and find out something about MetalLB that its name actively hides.

### What "layer 2 mode" really does

You configured MetalLB in L2 mode, and it is easy to assume that spreads traffic across all five nodes. It does not.

**In L2 mode, exactly one node holds a given address at a time.** One speaker answers ARP for `10.99.99.240` and all traffic for it arrives at that one node, which then forwards it into the cluster like any other. The other four speakers stay quiet and watch.

So MetalLB in this mode gives you **failover**, not load spreading. If the holder dies, another speaker takes over the address in a few seconds. That is a real and useful guarantee, and it is a different one from what most people assume when they hear "load balancer". Worth knowing before you build a mental model on the name.

Find out which node holds it:

```bash
kubectl logs -n metallb-system -l component=speaker --tail=200 | grep -i announc | tail -20
# Look for a line mentioning your address and a node name. That node is
# the current holder.
```

### Take that node away

```bash
# Replace <holder> with the node name from above.
lxc stop <holder>
```

Watch what happens from the host, in a loop, so you can see the gap rather than guess at it:

```bash
for i in $(seq 1 30); do
  printf '%s ' "$i"
  curl --max-time 2 -s -o /dev/null -w '%{http_code}\n' http://whoami.k3s.linsnotes.com || echo "FAILED"
  sleep 2
done
```

Expect a short run of failures and then `200` again. The gap is the other speakers noticing and one of them claiming the address. It is usually a few seconds, not minutes.

```bash
kubectl logs -n metallb-system -l component=speaker --tail=100 | grep -i announc | tail -5
# Expect: a different node announcing your address now.
```

**Nothing was reconfigured and nothing was restarted.** The address moved, and your hostname kept working, because the name points at the address and not at a machine. Compare that to Step 4, where your hosts file named `10.99.99.11` and stopping `master1` would have taken your lab down with it. That is the difference this step bought, made visible.

Bring the node back:

```bash
lxc start <holder>
sleep 30
kubectl get nodes            # expect: five Ready
curl --max-time 5 http://whoami.k3s.linsnotes.com
```

The address usually stays where it moved to. It has no reason to move back, and MetalLB does not shuffle things without cause.

---

## Step 9 — Clean up and save a restore point

Remove the two demo applications, and keep the plumbing. Same rule as Part 4's NFS provisioner: the test applications go, the infrastructure stays, because the next parts build on it.

```bash
kubectl delete ingress lab
kubectl delete deployment whoami web
kubectl delete service whoami web
kubectl delete pod probe --ignore-not-found

rm -f lab-ingress.yaml metallb-pool.yaml

kubectl get all -n default
# Expect ONE line: service/kubernetes. The familiar clean baseline.
```

What stays, on purpose:

```bash
kubectl get pods -n metallb-system      # MetalLB, still running
kubectl get pods -n ingress-nginx       # ingress-nginx, still running
kubectl get svc -n ingress-nginx ingress-nginx-controller
# Expect: still holding its address. This is the front door Parts 6, 7
# and 8 will put things behind.
```

Leave the hosts file entry too. You will add more names to it in the parts ahead.

Snapshot all five, stopped and together, exactly as Parts 3 and 4 taught:

```bash
for n in worker1 worker2 master1 master2 master3; do lxc stop "$n"; done
for n in master1 master2 master3 worker1 worker2; do
  lxc snapshot "$n" post-ingress
done
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 30

kubectl get nodes                        # expect: five Ready
kubectl get svc -n ingress-nginx ingress-nginx-controller
# Expect: same address as before the restart. MetalLB re-claims it on startup.
```

One thing this snapshot does not hold, for the same reason Part 4's did not hold the NFS server: **your hosts file and your router's static route are host and network state, not cluster state.** Roll the nodes back and both are still there, which is what you want.

---

## Where you should be

| Thing | State |
|---|---|
| Load balancer | MetalLB, L2 mode, pool `10.99.99.240-250`. ServiceLB disabled. |
| LXD DHCP | Narrowed to `.100` to `.200`, so it can never collide with the pool |
| Ingress controller | ingress-nginx, on a MetalLB address. Traefik disabled. |
| k3s config | `/etc/rancher/k3s/config.yaml` on all three masters, disabling `servicelb` and `traefik` |
| Name resolution | `/etc/hosts` on the host, and on your laptop if you did Step 5 |
| Reachability | Host always. Rest of your network, if you added the static route. |
| Failover | Seen: the address moved to another node in seconds when its holder died |
| Snapshots | `post-ingress` on all five, taken stopped and together |

### Things worth carrying forward

- **k3s already gave you a load balancer and an Ingress controller.** ServiceLB and Traefik have been running since Part 3. If a guide tells you bare metal Kubernetes leaves `EXTERNAL-IP` pending, it is not describing k3s. Check `kubectl get svc -n kube-system` before you install anything.
- **A load balancer gets you an address. Ingress splits one address between many applications.** They stack, and you need both. Ten applications is one load balancer address and ten Ingress rules, not ten addresses.
- **Ingress routes on the `Host` header, which means DNS and routing are separate problems.** You can test every rule with `curl -H "Host: ..."` before any name resolves anywhere. Do that first, and a DNS mistake can never look like a routing mistake.
- **`ingressClassName` is what makes controllers swappable.** Plain Ingress rules move between Traefik and ingress-nginx untouched. Controller specific annotations do not. Prefer plain rules.
- **MetalLB in L2 mode is failover, not load spreading.** One node holds each address. Losing it costs you a few seconds, not the service.
- **Reaching a lab network from your laptop is a routing problem, not a Kubernetes one.** One static route on the router, and `ip_forward` on the host, which Part 2 already set.

### What Part 6 does

Everything you installed in this part, you installed by hand: a manifest here, a Helm command there, a config file edited on three masters. It works, and in six months you will not remember any of it.

Part 6 fixes that. You put all of it in a Git repository, hand the repository to **Argo CD**, and let the cluster keep itself matching what the repository says. Then you delete something important on purpose and watch it come back on its own, which is the same break it and see trick this series always ends on, aimed at the deployment process itself.

Argo CD also has a web interface, and you already have everything needed to put it behind a hostname.

Continue with [**Part 6, GitOps with Argo CD**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-6-gitops-with-argo-cd/).
