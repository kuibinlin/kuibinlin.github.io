---
layout: post
title: Building a Kubernetes Lab with k3s and LXD Part 6 GitOps with Argo CD
description: Put your cluster's configuration in Git, hand it to Argo CD, then delete things on purpose and watch the cluster put them back without you.
date: 2026-07-18 08:00:00 +0800
published: true
categories: [kubernetes]
tags: [k3s, kubernetes, lxd, ubuntu, argocd, gitops, git]
toc: true
media_subpath: /assets/media/2026/kubernetes-lab-with-k3s-and-lxd-part-6-gitops-with-argo-cd
image: kubernetes-lab-part6.webp
---

This is **Part 6** of a series on building a Kubernetes lab with k3s and LXD. If you are just arriving, start with [**Part 1, Preparing the Ubuntu Host**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-1-preparing-the-ubuntu-host/), then [**Part 2, Building the Five Nodes**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-2-building-the-five-nodes/), [**Part 3, Installing k3s**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-3-installing-k3s/), [**Part 4, Adding Persistent Storage**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-4-adding-persistent-storage/), and [**Part 5, Exposing Applications**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-5-exposing-applications/). This part picks up where Part 5 left off.

**Where you are.** You have a five node cluster that survives a master dying, keeps data when a worker dies, and serves applications to your browser through one address. It works. And every single piece of it exists because you typed a command into a terminal at some point over five afternoons.

Try to answer this question about your own lab, right now, without looking: what exactly is in `/etc/rancher/k3s/config.yaml` on master2, and why?

If you had to think about it, you have found the problem this part solves.

**What this part does.** It moves the cluster's configuration out of your terminal history and into a Git repository, then installs **Argo CD**, a program that reads that repository and makes the cluster match it. After that, changing the cluster means changing a file and pushing it. Not running a command.

**The main point, in one line.** Stop telling the cluster what to do, and start telling it what to be.

**What this part does not do.** No TLS, still. The Argo CD web interface will run over plain HTTP, and Step 4 explains exactly why that takes one extra setting and what breaks if you skip it. Certificates are Part 7.

**What you need before starting.** The `post-ingress` snapshot from Part 5's Step 9, all five nodes Ready, ingress-nginx holding a MetalLB address, a GitHub account, and Git installed on the host. Step 1 checks the cluster. Step 2 checks Git.

---

## Words you'll need

These build on Parts 2 to 5. Here are the new ones.

| Word | What it means |
|---|---|
| **GitOps** | A way of running systems where a Git repository holds the description of what should be running, and a program in the cluster continuously makes reality match it. Git is not a backup of the config. Git **is** the config. |
| **declarative vs imperative** | *Imperative* means "do this": `kubectl scale deployment whoami --replicas=5`. *Declarative* means "this is how it should be": a file saying `replicas: 5`. Imperative commands describe a change. Declarative files describe an end state. |
| **desired state** | What you have said should be true. In GitOps, this is whatever is in your Git repository at this moment. |
| **actual state** | What is really running in the cluster right now. These two are usually the same and occasionally are not, and everything in this part is about that gap. |
| **reconciliation** | The act of comparing desired state to actual state and changing actual state to close the gap. Kubernetes already does this internally for Deployments. Argo CD does it for your whole repository. |
| **drift** | The gap itself. Something in the cluster no longer matches Git. Usually because a person changed it by hand, at 2am, and forgot. |
| **self-heal** | An Argo CD setting that says "when you find drift, fix it." With it on, hand edits get undone automatically. |
| **prune** | An Argo CD setting that says "if something is in the cluster but no longer in Git, delete it." This is the setting people are right to think twice about. |
| **manifest** | One YAML file describing one or more Kubernetes objects. Everything you wrote with `cat > something.yaml` in Parts 4 and 5 was a manifest. |
| **repository** | A Git repository. In this part it is a public GitHub repo holding your manifests. Argo CD reads it and needs no permission to write to it, ever. |
| **Argo CD Application** | A Kubernetes object, created by you, that says: "watch *this* folder in *this* repo and apply it to *this* namespace." It is a pointer, not a program. |
| **App of Apps** | A single Argo CD Application whose folder contains nothing but more Application objects. One thing to install by hand, and everything else follows. |
| **sync** | Making the cluster match Git, once. Can be manual (you press a button) or automated (Argo CD does it on its own). |
| **sync wave** | An ordering hint, written as an annotation, for when some objects must be created before others. Lower numbers go first. You will not need one today, but you will meet the word. |
| **idempotent** | Safe to do twice. Applying the same manifest ten times leaves the same result as applying it once. This is what makes reconciliation safe to run every three minutes forever. |

---

## Three things to know before you start

### 1. You have spent five parts doing the opposite of this

Every install in this series so far has been imperative. You piped a script into a shell to install k3s. You ran `helm install` for the NFS provisioner and for ingress-nginx. You wrote a config file into three containers with a `for` loop. You typed `kubectl apply` on manifests that you then deleted with `rm -f`.

All of it worked. None of it is written down anywhere except in this blog and in your shell history. So if the host dies, your only recovery path is to read Parts 1 to 5 again in order. If you want to know whether the MetalLB pool ends at `.249` or `.250`, you have to ask the cluster. And nobody, including you, can look at a change before it happens.

This part converts what you already have rather than starting fresh, and that is deliberate. Step 5 takes MetalLB's configuration, the thing you wrote by hand in Part 5, and puts it under Argo CD's control **without deleting or recreating it**. That conversion is the most useful thing in this post, because it is the situation you will actually meet at work. Nobody gets a clean cluster to start GitOps on. They get one with four years of history in it.

### 2. The one thing likely to stop you is the Argo CD web interface

Every part of this series has one step that can genuinely block you. Part 3 had the ZFS snapshotter, Part 4 had NFS inside a container, Part 5 had router static routes. This part has a smaller one, but it will absolutely catch you if nobody says it first.

**Argo CD's web server speaks HTTPS to itself by default.** It generates its own certificate at startup and, when a request arrives over plain HTTP, it answers with a redirect to HTTPS.

You are about to put it behind ingress-nginx over plain HTTP. So the browser asks for `http://argocd.k3s.linsnotes.com`, ingress-nginx forwards it to Argo CD over HTTP, Argo CD says "go to HTTPS", the browser goes back to the same plain HTTP address, and around it goes. The symptom is `ERR_TOO_MANY_REDIRECTS` in the browser, or a `502` if ingress-nginx gives up on the handshake instead.

The fix is one line in a ConfigMap called `argocd-cmd-params-cm`, setting `server.insecure` to `"true"`, then restarting the `argocd-server` deployment. Step 4 does it and explains what you are giving up. Part 7 revisits the whole arrangement once real certificates exist.

### 3. GitOps means `kubectl apply` becomes something you stop doing

This is the part people underestimate, so read it before Step 7 rather than after.

Once an Application has `selfHeal: true`, the cluster will actively undo you. Scale a Deployment by hand and the replica count goes back. Edit an Ingress by hand and your edit disappears. Delete something by hand and it comes back. This is not Argo CD misbehaving. It is Argo CD doing precisely the one job you gave it.

That changes your habits, and it should. Reading is always fine: `kubectl get`, `describe` and `logs` are unaffected. But `apply`, `edit`, `scale`, `patch` and `delete` on anything Argo CD manages become **temporary experiments**, not changes. A real change is a commit.

The awkward moment comes during an outage, when you want to fix something in ten seconds and Git feels slow. Real teams handle that by turning off automated sync for one application while they work, then putting the fix in Git and turning it back on. Step 7 shows you where that switch is, because knowing beforehand is the difference between a controlled decision and a confusing fight with your own tooling.

---

## Step 1 — Check Part 5 is still good

**Why:** the same reason as every part. Argo CD is about to start comparing your cluster to a file. Anything already broken will look like a GitOps problem the moment it surfaces.

**Safe to run:** everything here only reads.

```bash
lxc info | head -3        # wakes LXD if it's asleep, same trick as before
sleep 3
lxc list                  # expect five RUNNING rows, plus the STOPPED template

kubectl get nodes
# Expect: five Ready.

kubectl get all -n default
# Expect ONE line: service/kubernetes. That's Part 5's clean baseline.
```

Now the two pieces of Part 5 that this part depends on. MetalLB first:

```bash
kubectl get pods -n metallb-system
# Expect: one controller pod and one speaker pod per node, all Running.

kubectl get ipaddresspool,l2advertisement -n metallb-system
# Expect: ipaddresspool/lab-pool and l2advertisement/lab-l2.
# These two objects are the ones you are going to hand to Argo CD in Step 5.
```

Then the front door:

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
# Expect: TYPE LoadBalancer, EXTERNAL-IP holding a MetalLB address
# (10.99.99.240 or nearby). If it says <pending>, MetalLB is not handing out
# addresses and Step 4 will fail confusingly. Fix that first, in Part 5 Step 6.

NGINX_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "ingress-nginx is on $NGINX_IP"
# Note this down. Step 4 needs it.
```

> **`NGINX_IP` lives only in this terminal.** Same warning as Part 3's `$TOKEN`. Close the window and it is gone. If a later command produces an empty address, re-run the two lines above.
{: .prompt-tip }

Finally, check the host has what Step 2 needs:

```bash
git --version                 # expect: a version. If not: sudo apt-get install -y git
gh --version 2>/dev/null || echo "gh not installed (optional, Step 2 has a plain git path)"
```

---

## Step 2 — Make the repository that becomes the truth

**What this does.** It creates one public GitHub repository and lays out three folders in it. Nothing is applied to the cluster yet. This step is entirely about deciding where things go before you have anything to put there, which is much easier than deciding afterwards.

### Why the layout matters more than it looks

An Argo CD Application points at a **folder** in a repository, not a file. So the folder structure is not decoration; it is the unit of control. Every folder you create is a thing you can sync, roll back, or turn off on its own.

Three folders is enough for this lab:

```
k3s-lab-gitops/
├── README.md
├── bootstrap/            # applied by hand, on purpose. See the note below.
│   ├── argocd-cmd-params-cm.yaml
│   └── argocd-server-ingress.yaml
├── apps/                 # Argo CD Application objects: WHAT Argo CD manages
│   ├── metallb-config.yaml
│   └── whoami.yaml
└── infra/                # the Kubernetes manifests each Application points at
    ├── metallb-config/
    │   ├── ipaddresspool.yaml
    │   └── l2advertisement.yaml
    └── whoami/
        ├── deployment.yaml
        ├── service.yaml
        └── ingress.yaml
```

Read it as two questions answered separately. **`apps/` answers "what is Argo CD watching?"**, one small file per thing, and those files are pointers. **`infra/` answers "what does each of those things consist of?"**, one folder per thing, with the real YAML inside. Keeping the pointers apart from the manifests means a single `ls apps/` tells you everything the cluster is managed by, without reading a line of Kubernetes YAML.

`bootstrap/` is the honest one. It holds the two files you apply with `kubectl` by hand, because they have to exist before Argo CD can manage anything at all. They live in the repo so that they are written down, not because Argo CD reads them.

> **`whoami` is a demo application, not infrastructure, and it is in `infra/` anyway.** A repo that runs real workloads would grow a fourth folder, something like `workloads/`, and split them. Two levels is enough to follow today, and moving a folder later is a `git mv` and a one line edit to the Application. Do not build the structure you might need in a year.
{: .prompt-info }

### Create it

> **Use your own GitHub username.** Every command and every `repoURL` below says `kuibinlin`. Replace it with yours throughout, including inside the YAML in Steps 5 and 6, or Argo CD will happily sync somebody else's repository into your cluster.
{: .prompt-warning }

On the host:

```bash
mkdir -p ~/k3s-lab-gitops && cd ~/k3s-lab-gitops
git init -b main
mkdir -p bootstrap apps infra/metallb-config infra/whoami

cat > README.md <<'EOF'
# k3s lab, managed by Argo CD

This repository is the desired state of a five node k3s lab.
Anything Argo CD manages is described here. If it is not here, it is not managed.

- bootstrap/ : applied by hand with kubectl, before Argo CD exists
- apps/      : Argo CD Application objects
- infra/     : the manifests each Application points at
EOF

git add .
git commit -m "Empty layout and README"
# Expect: one file changed. Git does not track empty folders, so only
# README.md is committed right now. The folders fill up in Steps 4 to 6.
```

With the GitHub CLI, the remote and the push are one command:

```bash
gh repo create kuibinlin/k3s-lab-gitops --public --source=. --remote=origin --push
# Expect: a line confirming the repo was created, then a push.
```

Without `gh`, create the repository on github.com first. Make it **public**, and do not let GitHub add a README, a licence or a `.gitignore`, because those create a commit on the remote that your local `main` does not have and the first push will be refused. Then:

```bash
git remote add origin https://github.com/kuibinlin/k3s-lab-gitops.git
git push -u origin main
```

Confirm it landed:

```bash
git remote -v            # expect: origin, pointing at your repo, fetch and push
git log --oneline        # expect: one commit
```

> **Public, on purpose.** A public repository needs no credentials, so Argo CD can read it with no setup at all, and this part stays about GitOps instead of about secrets. That is only acceptable because nothing in this repo is secret: address ranges, replica counts and hostnames for a lab on your own machine. **Never commit a token, a password or a kubeconfig.** For a private repo you would register a read only deploy key or a token with Argo CD, which is a real and well documented thing, and a distraction today.
{: .prompt-warning }

---

## Step 3 — Install Argo CD

**What this does.** It installs Argo CD into its own namespace from the project's official manifest, and gets you the password to log in with.

**What Argo CD actually is**, before you install it: four programs that do four jobs, plus some extras.

| Component | Its job |
|---|---|
| `argocd-repo-server` | Clones your Git repository and turns whatever is in it into plain Kubernetes YAML. |
| `argocd-application-controller` | Compares that YAML to the live cluster, and applies the difference. This is the reconciliation loop. |
| `argocd-server` | The web interface and the API. This one does no reconciling at all. |
| `argocd-redis` | A cache, so the controller does not recompute everything constantly. |

The rest (`dex`, `notifications`, `applicationset`) are optional features you are not using today. They install anyway and sit idle, which is fine.

### Install

```bash
kubectl create namespace argocd

kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.4.5/manifests/install.yaml
# Expect: a long list of "serverside-applied" lines: CRDs, ServiceAccounts,
# ConfigMaps, Deployments, a StatefulSet, Services.
```

> **Check the current release rather than trusting this blog.** `v3.4.5` was current when this was written. Argo CD releases a minor version roughly every three months and supports the last three, so a version pinned in a post ages out. Look at [the Argo CD releases page](https://github.com/argoproj/argo-cd/releases) and use the newest stable tag. The URL shape never changes, only the tag. You can also use `stable` in place of the tag, which always points at the newest stable release, but then you cannot tell later which version you installed, which is a strange thing to accept in a post about writing things down.
{: .prompt-tip }

**Why `--server-side`.** Argo CD's custom resource definitions are large enough that a normal client side `kubectl apply` can exceed the 262144 byte limit on the annotation Kubernetes uses to remember the last applied configuration. Server side apply does not use that annotation, so the limit does not apply, and `--force-conflicts` says you own these fields if anything argues. This is the command the Argo CD documentation gives, and it is worth knowing why rather than copying it.

Wait for it to come up. This pulls several images, so give it time:

```bash
kubectl wait -n argocd --for=condition=available deployment --all --timeout=300s
# Expect: a "condition met" line per deployment.

kubectl get pods -n argocd
# Expect: roughly seven pods, all Running. The four that matter are
# argocd-server, argocd-repo-server, argocd-application-controller
# and argocd-redis. Pod name suffixes are random; the prefixes are not.
```

If a pod sits in `ContainerCreating` for a long while, it is almost certainly still pulling images over your connection, not stuck. `kubectl describe pod -n argocd <name>` says which.

### Get the admin password

Argo CD generates a random password for the `admin` user at first install and stores it in a Secret. It is not printed anywhere, so read it out:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d; echo
# Expect: a line of random characters. It is different on every install,
# so there is no example to compare yours against.
```

The `; echo` at the end just adds a newline, because the decoded value has none and your prompt would otherwise land on the same line as the password.

Keep it somewhere for the next step. Once you have logged in and changed the password, that Secret is no longer needed and you can delete it, which is what the Argo CD documentation suggests and what you would do on anything real:

```bash
# Later, after you have changed the password:
# kubectl -n argocd delete secret argocd-initial-admin-secret
```

---

## Step 4 — Put the Argo CD interface behind your Ingress

**What this does.** It gives Argo CD a hostname on the front door you built in Part 5, and fixes the HTTPS redirect problem from the intro. Everything stays plain HTTP.

### Why Argo CD fights a plain HTTP Ingress

Argo CD's API server is designed to be reachable directly, without anything in front of it, so it does its own TLS. On startup it generates a self signed certificate and serves HTTPS on its container port. When a plain HTTP request arrives, it does the polite web thing and redirects to the HTTPS version of the same URL.

Put that behind ingress-nginx with no TLS and you get a loop:

1. Browser asks ingress-nginx for `http://argocd.k3s.linsnotes.com`.
2. ingress-nginx forwards it to `argocd-server` over plain HTTP.
3. `argocd-server` answers with a redirect to HTTPS.
4. ingress-nginx passes the redirect back to the browser.
5. The browser follows it, arrives at the same plain HTTP front door, and you are at step 1 again.

The browser counts the round trips, gives up, and shows **`ERR_TOO_MANY_REDIRECTS`**. If instead ingress-nginx tries to speak HTTPS to a backend that is expecting it and the handshake fails, you get a **`502 Bad Gateway`** with a TLS error in the ingress-nginx logs. Two different symptoms, one cause.

Notice what is *not* wrong here. Your Ingress rule is fine. MetalLB is fine. DNS is fine. Two programs each have a correct and reasonable opinion about TLS and the opinions disagree.

### The fix, and what it costs

Tell Argo CD to stop doing TLS itself and serve plain HTTP, because something in front of it is responsible for that now:

```bash
cat > ~/k3s-lab-gitops/bootstrap/argocd-cmd-params-cm.yaml <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cmd-params-cm
  namespace: argocd
data:
  server.insecure: "true"     # argocd-server serves plain HTTP, no self-redirect
EOF

kubectl -n argocd patch configmap argocd-cmd-params-cm --type merge \
  -p '{"data":{"server.insecure":"true"}}'
# Expect: configmap/argocd-cmd-params-cm patched.
```

`argocd-cmd-params-cm` is where Argo CD keeps command line style settings for its own components. It ships empty. The `patch` adds one key rather than replacing the whole ConfigMap, which matters because later parts and later versions add other keys to it.

**The setting only takes effect at startup**, so restart the one deployment that reads it:

```bash
kubectl -n argocd rollout restart deployment argocd-server
kubectl -n argocd rollout status deployment argocd-server --timeout=180s
# Expect: "deployment ... successfully rolled out".
```

> **"insecure" means exactly what it says, and here it is contained.** Traffic between ingress-nginx and Argo CD is now unencrypted, and so is traffic between your browser and ingress-nginx, since there is no TLS anywhere yet. On a lab network that only exists on your own machine, that is an acceptable trade for one part of a tutorial. It is **not** acceptable on anything real. Part 7 puts a real certificate on ingress-nginx, at which point the browser side is encrypted and this setting becomes the normal, recommended arrangement: TLS terminates once, at the Ingress, and the backend behind it speaks plain HTTP.
{: .prompt-warning }

### Write the Ingress rule

Same shape as Part 5's, with one annotation:

```bash
cat > ~/k3s-lab-gitops/bootstrap/argocd-server-ingress.yaml <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: argocd-server
  namespace: argocd
  annotations:
    nginx.ingress.kubernetes.io/backend-protocol: "HTTP"
spec:
  ingressClassName: nginx
  rules:
  - host: argocd.k3s.linsnotes.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: argocd-server
            port:
              number: 80          # the HTTP port on the argocd-server Service
EOF

kubectl apply -f ~/k3s-lab-gitops/bootstrap/argocd-server-ingress.yaml

kubectl get ingress -n argocd argocd-server
# Expect: CLASS nginx, HOSTS argocd.k3s.linsnotes.com, ADDRESS filling in
# with your ingress-nginx address, PORTS 80.
```

Two details worth naming:

- **`backend-protocol: "HTTP"` is already the default** for ingress-nginx. It is written out because it is the line you would change to `HTTPS` if you ever left Argo CD doing its own TLS, and because an explicit setting is easier to reason about than an assumed one.
- **Do not add `force-ssl-redirect`.** You will find that annotation in most Argo CD Ingress examples, and it is correct in those examples because they have a certificate. Add it now, with no TLS anywhere, and you build a redirect loop of your own at the ingress layer instead of at the Argo CD layer. Part 7 adds it, along with the certificate that makes it make sense.

### Make the name resolve, and log in

Part 5 put a line in the host's `/etc/hosts`. Add another for this name:

```bash
echo "$NGINX_IP  argocd.k3s.linsnotes.com" | sudo tee -a /etc/hosts
grep k3s.linsnotes.com /etc/hosts
# Expect: two lines now, both pointing at the same ingress-nginx address.
```

If you did Part 5's Step 5 and want the interface from your laptop, add the same line to your laptop's hosts file too.

Test from the command line before opening a browser, so a browser cache cannot confuse you:

```bash
curl --max-time 5 -s -o /dev/null -w '%{http_code}\n' http://argocd.k3s.linsnotes.com
# Expect: 200.
# If you get 307 or 308, the server.insecure setting did not take: check the
#   ConfigMap and confirm the rollout restart actually finished.
# If you get 502, same cause, different symptom. Same fix.
# If you get 404, the Host header did not match any rule: check the Ingress.
```

Now open `http://argocd.k3s.linsnotes.com` in a browser. Log in with username `admin` and the password from Step 3.

You will land on an empty Applications page. That is correct. Argo CD is installed and knows about nothing at all, which is the honest starting point for the next step.

> **Who bootstraps the bootstrapper?** You just configured Argo CD with two `kubectl` commands, in a post about not doing that. There is no way around it: something has to create the thing that creates everything else, and that something is a human with `kubectl`. Every GitOps setup has this seam. The usual answer is to keep the bootstrap as small and as written down as possible, which is why both files went into `bootstrap/` in the repo even though nothing reads them from there. A more advanced answer is to have Argo CD manage its own installation, which works and is genuinely useful, and also means a bad commit can take down the thing that would fix it. That is a decision for a real cluster, not a lab.
{: .prompt-info }

Commit what you have so far:

```bash
cd ~/k3s-lab-gitops
git add bootstrap/
git commit -m "Record the Argo CD bootstrap: insecure server and its Ingress"
git push
```

---

## Step 5 — Convert what you already built

**What this does.** It takes MetalLB's configuration, the two objects you wrote by hand in Part 5, and puts them under Argo CD's control without deleting or recreating anything. This is the most useful step in the post.

### Why start here and not with something new

Because adopting a live object is the case everyone actually faces and almost no tutorial covers. Starting a repo with a fresh application proves nothing: of course Argo CD can create something that does not exist. The real question is whether you can hand it something already running, right now, and have it take over without an outage.

You can. MetalLB's config is a good first candidate: two small objects, they change almost never, and if something went wrong you would find out immediately, because your lab would stop being reachable.

### Get the real YAML out of the cluster

Do not retype it from Part 5. Read what is actually there, because that is the whole point:

```bash
kubectl get ipaddresspool lab-pool -n metallb-system -o yaml | head -20
kubectl get l2advertisement lab-l2 -n metallb-system -o yaml | head -20
# Expect: your objects, plus a lot of fields Kubernetes added: creationTimestamp,
# resourceVersion, uid, generation, managedFields, status. Those are the
# cluster's own bookkeeping and must NOT go into Git.
```

That last point matters. A live object read back from the cluster is not a manifest. It is the manifest plus everything Kubernetes recorded about it. Committing `resourceVersion` and `uid` into Git would give Argo CD a desired state that can never match reality, because those fields are assigned by the cluster and change on their own.

So write clean manifests by hand, containing only what you meant to say:

```bash
cd ~/k3s-lab-gitops

cat > infra/metallb-config/ipaddresspool.yaml <<'EOF'
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: lab-pool
  namespace: metallb-system
spec:
  addresses:
  - 10.99.99.240-10.99.99.250     # outside LXD's DHCP range, from Part 5 Step 6a
EOF

cat > infra/metallb-config/l2advertisement.yaml <<'EOF'
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: lab-l2
  namespace: metallb-system
spec:
  ipAddressPools:
  - lab-pool
EOF
```

**Check these against the cluster before going further**, because a mismatch here is what turns adoption into an outage:

```bash
kubectl get ipaddresspool lab-pool -n metallb-system -o jsonpath='{.spec.addresses}'; echo
# Expect: the same range that is in your ipaddresspool.yaml. If your Part 5
# pool was a different range, edit the file to match reality, not the tutorial.
```

### Write the Application that adopts them

```bash
cat > apps/metallb-config.yaml <<'EOF'
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: metallb-config
  namespace: argocd                 # Applications live in Argo CD's namespace
spec:
  project: default                  # the built-in project; no restrictions
  source:
    repoURL: https://github.com/kuibinlin/k3s-lab-gitops.git
    targetRevision: main            # which branch to follow
    path: infra/metallb-config      # which FOLDER in that branch
  destination:
    server: https://kubernetes.default.svc   # "this cluster", from inside it
    namespace: metallb-system
  # No syncPolicy yet. Manual sync only, on purpose. Step 7 changes this.
EOF

git add apps/ infra/
git commit -m "Bring MetalLB's configuration under Argo CD"
git push
```

Read those seven meaningful lines once more, because every Application you ever write is this shape: **which repo, which branch, which folder, which cluster, which namespace.** That is all an Application is.

Now create it. This is a `kubectl apply`, and it is the last kind you will keep doing: applying a pointer, not a workload.

```bash
kubectl apply -f apps/metallb-config.yaml
# Expect: application.argoproj.io/metallb-config created
```

### Watch it adopt, not fight

```bash
kubectl get applications -n argocd
# Expect, within a few seconds:
# NAME             SYNC STATUS   HEALTH STATUS
# metallb-config   Synced        Healthy
```

**`Synced`, on the first look, with nothing having been applied.** That is the whole point of this step, and it is worth sitting with for a second. Argo CD cloned your repository, rendered the two manifests, compared them field by field with the two objects already running in `metallb-system`, found no difference, and reported the truth: reality already matches Git.

Nothing was deleted. Nothing was recreated. No address moved. Check:

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
# Expect: the SAME EXTERNAL-IP as in Step 1. Adoption is not a restart.
```

Open the Argo CD interface and click into `metallb-config`. You get a diagram of the two objects with a green tick on each. That view is the point of the web interface: it is a live answer to "what does Git say should exist, and does it?"

> **If yours shows `OutOfSync` at first, that is fine and not a failure.** Argo CD marks the resources it owns, and the exact marking method has changed between major versions: older versions used a label, current versions use an annotation. If your version wants to add a mark the live objects do not have yet, it reports the difference honestly. Press **Sync** once. Argo CD applies the same YAML plus its own tracking mark. Nothing is deleted or recreated, and it goes green. What you must **not** see is Argo CD proposing to change `spec.addresses`. If it does, your file does not match the cluster; fix the file, not the cluster.
{: .prompt-info }

### See it notice a difference, without acting on one

Change the pool in Git to something wrong, and watch what a manually synced Application does about it:

```bash
sed -i 's/10.99.99.240-10.99.99.250/10.99.99.240-10.99.99.249/' infra/metallb-config/ipaddresspool.yaml
git commit -am "Deliberate mistake, to see drift reported"
git push

# Argo CD polls Git about every three minutes. Ask it to look now instead:
kubectl -n argocd patch app metallb-config --type merge \
  -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'

kubectl get applications -n argocd
# Expect: metallb-config now reads OutOfSync.
```

Click the application in the interface, then **App Diff**, and you get a red and green diff of exactly one line. Nothing has been applied. **Argo CD noticed and did not act**, which is what manual sync means and why it is a reasonable default while you are learning. Put it back:

```bash
git revert --no-edit HEAD
git push
kubectl -n argocd patch app metallb-config --type merge \
  -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'

kubectl get applications -n argocd
# Expect: Synced again. The cluster never changed; only your description of it did.
```

---

## Step 6 — Add an application through Git only

**What this does.** It runs `traefik/whoami` again, the same small program from Part 5, with one rule: you will not type `kubectl apply` for any of its manifests. Not once. The only thing you apply is the pointer.

### Write the manifests

```bash
cd ~/k3s-lab-gitops

cat > infra/whoami/deployment.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: whoami
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: whoami
  template:
    metadata:
      labels:
        app: whoami
    spec:
      containers:
      - name: whoami
        image: traefik/whoami
        ports:
        - containerPort: 80
EOF

cat > infra/whoami/service.yaml <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: whoami
  namespace: default
spec:
  selector:
    app: whoami
  ports:
  - port: 80
    targetPort: 80
EOF

cat > infra/whoami/ingress.yaml <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: whoami
  namespace: default
spec:
  ingressClassName: nginx           # the controller from Part 5 Step 7
  rules:
  - host: whoami.k3s.linsnotes.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: whoami
            port:
              number: 80
EOF
```

Three files instead of one, split by object. Argo CD applies every YAML file in the folder, so one file with `---` separators would work identically. One object per file is easier to review in a pull request and easier to find in six months, and those are the only two reasons that matter.

> **`image: traefik/whoami` has no tag, which means `latest`, which is not a version.** It is fine for a lab where you want the point rather than the practice. In a repository that is supposed to be the truth about what is running, an untagged image is a hole in that truth: two syncs a month apart can pull two different programs from the identical commit. Pin an exact tag on anything you care about, and treat bumping the tag as a commit like any other. That is most of what people mean when they say GitOps gives you an audit trail.
{: .prompt-tip }

### Write the pointer and push

```bash
cat > apps/whoami.yaml <<'EOF'
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: whoami
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/kuibinlin/k3s-lab-gitops.git
    targetRevision: main
    path: infra/whoami
  destination:
    server: https://kubernetes.default.svc
    namespace: default
EOF

git add apps/whoami.yaml infra/whoami/
git commit -m "Run whoami from Git"
git push
```

Check the cluster first, so you can see the before clearly:

```bash
kubectl get all -n default
# Expect: still ONE line, service/kubernetes. Nothing exists yet.
```

Create the pointer:

```bash
kubectl apply -f apps/whoami.yaml

kubectl get applications -n argocd
# Expect: whoami appears, SYNC STATUS OutOfSync, HEALTH STATUS Missing.
```

**`OutOfSync` and `Missing` together mean "Git says these three things should exist, and none of them do."** Which is exactly right. There is no automated sync on this Application yet, so Argo CD has reported the gap and stopped.

### Sync it

Three ways, and they are equivalent. Pick one.

**In the browser.** Click the `whoami` card, then the **Sync** button, then **Synchronize** in the panel. Watch the tiles turn green in order. This is the most useful one the first time, because you see what is happening.

**With `kubectl`**, no extra tools:

```bash
kubectl -n argocd patch app whoami --type merge \
  -p '{"operation":{"sync":{"revision":"main"}}}'
# Writing to the "operation" field is how a sync is requested. The controller
# picks it up and runs it. This is what the Sync button does underneath.
```

**With the `argocd` command line tool**, if you would rather have it. Note the port-forward: the CLI speaks gRPC, which needs extra ingress-nginx annotations to survive the trip through your Ingress, and that is a detour you do not need today.

```bash
# Check the releases page for the current version before running this.
sudo curl -sSL -o /usr/local/bin/argocd \
  https://github.com/argoproj/argo-cd/releases/download/v3.4.5/argocd-linux-amd64
sudo chmod +x /usr/local/bin/argocd

kubectl port-forward -n argocd svc/argocd-server 8080:80 >/dev/null 2>&1 &
argocd login localhost:8080 --username admin --plaintext   # asks for the Step 3 password
argocd app sync whoami
```

Whichever you used:

```bash
kubectl get applications -n argocd
# Expect: whoami   Synced   Healthy

kubectl get all -n default
# Expect: two whoami pods, one deployment, one replicaset, one service,
# plus the permanent service/kubernetes.

kubectl get ingress -n default whoami
# Expect: CLASS nginx, HOST whoami.k3s.linsnotes.com, your ingress-nginx ADDRESS.

curl --max-time 5 http://whoami.k3s.linsnotes.com
# Expect: the whoami text block. The hostname already resolves, because
# Part 5 put it in /etc/hosts and Step 9 of Part 5 left the line alone.
```

**A Deployment, a Service and an Ingress exist, are serving traffic, and you never applied any of them.** You wrote three files, pushed them, and told Argo CD once that the folder was its problem now.

> **You did still run one `kubectl apply`, for the Application itself.** That is the seam again, one level up. The usual way to close it is the **App of Apps** pattern: make one Application whose `path` is `apps/`, so its content is nothing but other Application objects. Apply that one, and every application in the folder appears on its own. Adding a new application then becomes a single new file in `apps/` and a push, with no `kubectl` at all. It is four lines different from the Application above, and it is the natural next thing to build once you have more than two of them.
{: .prompt-info }

---

## Step 7 — Turn on automated sync

**What this does.** It changes both Applications from "tell me about differences" to "close them". Two settings, and they do genuinely different things.

### The two settings, precisely

| Setting | What it does | What it does NOT do |
|---|---|---|
| `automated: {}` on its own | When Git changes, apply the change. New objects get created, changed objects get updated. | It does not react to changes made *in the cluster*, and it does not delete anything. |
| `selfHeal: true` | When the **cluster** drifts from Git, put it back. A hand edit, a `kubectl scale`, a deleted object: all reverted. | It does not delete objects that Git no longer mentions. Those are a different problem. |
| `prune: true` | When something is removed from **Git**, delete it from the cluster. | It does not touch anything Argo CD never created, and it does not touch other applications' objects. |

The distinction that trips people up is between `selfHeal` and `prune`, so say it in one line each:

- **`selfHeal` fixes the cluster when the cluster is wrong.**
- **`prune` fixes the cluster when Git has become shorter.**

Without `prune`, deleting a file from Git does nothing at all. The object stays in the cluster forever, unmanaged and unmentioned, which over a year is how a cluster fills up with things nobody can explain. With `prune`, deleting a file deletes the thing. That is the correct behaviour and it is also the reason people are nervous, and they are right to be: **`prune` means a bad `git rm`, or a merge that drops a folder, or a mistyped `path`, removes real objects from a real cluster.**

The mitigations are ordinary software ones, not Kubernetes ones: require review on `main`, keep `path` values boring, and know that Argo CD's diff view shows you what a sync would delete before you let it. In a lab, turn it on and go and see what it does, which is Step 8.

### Turn it on

Edit both Application files in Git. This is a change to how the cluster is managed, so of course it is a commit:

```bash
cd ~/k3s-lab-gitops

cat >> apps/whoami.yaml <<'EOF'
  syncPolicy:
    automated:
      prune: true       # delete things removed from Git
      selfHeal: true    # undo changes made in the cluster
EOF

cat >> apps/metallb-config.yaml <<'EOF'
  syncPolicy:
    automated:
      prune: false      # deliberately NOT pruning the network config. See below.
      selfHeal: true
EOF

git commit -am "Automate sync for both applications"
git push
```

Careful with those `>>` appends: `syncPolicy` must line up under `spec`, at two spaces of indentation, and the block above assumes the files end exactly as Steps 5 and 6 wrote them. Check before applying:

```bash
tail -6 apps/whoami.yaml
# Expect: syncPolicy indented two spaces, automated four, prune and selfHeal six.
```

Apply the updated pointers by hand, which is still how Application objects themselves reach the cluster:

```bash
kubectl apply -f apps/whoami.yaml -f apps/metallb-config.yaml
# Expect: two "configured" lines.

kubectl get applications -n argocd
# Expect: both Synced and Healthy, and now they will stay that way by themselves.
```

> **`prune: false` on `metallb-config` is a deliberate choice, not an oversight.** Think through what pruning that folder would mean. Delete `ipaddresspool.yaml`, push, and MetalLB has no addresses to hand out. The ingress-nginx Service loses its address, every hostname in your lab stops resolving to anything that answers, and the Argo CD interface you would use to fix it goes down with everything else. That is not a reason to fear `prune` in general. It is a reason to think about **blast radius per application**, which is one of the real arguments for splitting a repository into several small Applications rather than one big one. Fast moving workloads get `prune: true`. The network's foundations do not.
{: .prompt-warning }

### Where the off switch is

You will want this at some point, so find it now while nothing is on fire. To take one application out of automated control temporarily:

```bash
# Suspend automation on whoami:
kubectl -n argocd patch app whoami --type merge -p '{"spec":{"syncPolicy":null}}'

# Put it back:
kubectl apply -f ~/k3s-lab-gitops/apps/whoami.yaml
```

The first command is drift you are creating on purpose, and the second is the fix you push through Git afterwards. Doing it in that order, deliberately, is fine. Doing it by accident and forgetting is how a cluster ends up half managed.

---

## Step 8 — Break it on purpose

Every part of this series ends by taking something away to see what the design was for. Part 3 killed a master to watch quorum protect itself. Part 4 killed a worker to watch data survive. Part 5 killed the node holding the load balancer address. Here you attack the deployment process itself, and the interesting result is that it fights back.

### First, understand the two different clocks

This is the thing that will confuse you if nobody says it, and it explains why some of these experiments finish in seconds and one takes minutes.

**Argo CD watches the cluster continuously.** The application controller has open watches on the objects it manages, so when something in the cluster changes or disappears, it usually knows within seconds. `selfHeal` acts on that. Experiments (a) and (b) below are therefore fast.

**Argo CD polls Git on a timer.** The default is `timeout.reconciliation: 180s` in the `argocd-cm` ConfigMap, so about three minutes. A commit you push right now might sit unnoticed for up to three minutes. Experiment (c) is therefore slow, and if you do not expect that you will conclude something is broken when it is merely waiting.

Confirm the setting on your own install rather than trusting the number:

```bash
kubectl -n argocd get configmap argocd-cm -o jsonpath='{.data.timeout\.reconciliation}'; echo
# Expect: 180s, or blank. Blank means "unset", which means the built-in
# default, which is also 180s.
```

To stop waiting at any point, ask for an immediate look:

```bash
kubectl -n argocd patch app whoami --type merge \
  -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'
```

Or press **Refresh** in the web interface, which is the same request.

> **The real answer to the three minute delay is a webhook, and you cannot have one here.** In a normal setup GitHub sends Argo CD a request the instant you push, and the sync happens in a second or two. That needs GitHub to be able to reach your Argo CD server, and yours lives on `10.99.99.x` behind your home router, which is exactly the kind of address the whole internet is built not to reach. Polling is the honest fallback and it is what this lab uses. If you ever put this cluster behind a real name, the webhook is a five minute job and worth doing.
{: .prompt-info }

Open a second terminal and leave this running through all three experiments, so you see the states change rather than catch them afterwards:

```bash
kubectl get applications -n argocd -w
# Ctrl-C when you are done.
```

### (a) Delete an object and watch it come back

```bash
kubectl get ingress -n default whoami
# Expect: it exists. Note the ADDRESS.

kubectl delete ingress -n default whoami
# Expect: ingress.networking.k8s.io "whoami" deleted

curl --max-time 5 -s -o /dev/null -w '%{http_code}\n' http://whoami.k3s.linsnotes.com
# Expect: 404. Run this quickly. The rule is gone, so ingress-nginx has no
# reason to route that hostname anywhere.
```

Now watch the other terminal, and check back:

```bash
kubectl get ingress -n default whoami
# Expect, usually within a few seconds: it exists again. You did not do that.

curl --max-time 5 http://whoami.k3s.linsnotes.com
# Expect: the whoami text block. Back to normal, with no action from you.
```

In the watch terminal you will have seen `whoami` flick from `Synced` to `OutOfSync` and straight back to `Synced`. That is the entire mechanism in four seconds: the controller saw the object vanish, compared with Git, found something missing, and applied it.

If nothing has happened after a minute, force a refresh with the patch command above and look at the application in the browser. The most common cause is that the `syncPolicy` append in Step 7 was indented wrong, in which case `kubectl get app whoami -n argocd -o jsonpath='{.spec.syncPolicy}'` prints nothing.

### (b) Change something and watch it get changed back

Deleting is dramatic. Editing is the one that actually happens to people, so do that too:

```bash
kubectl scale deployment -n default whoami --replicas=5
kubectl get deployment -n default whoami
# Expect, immediately: READY climbing toward 5/5. Kubernetes obeyed you.
```

For a few seconds you have five copies running, exactly as you asked. Then:

```bash
kubectl get deployment -n default whoami
# Expect, shortly after: back to 2/2. Argo CD reverted your change, because
# infra/whoami/deployment.yaml says replicas: 2 and that file is the truth.
```

The same happens to a `kubectl edit` of any field the manifest names. See who did it:

```bash
kubectl get events -n argocd --sort-by=.lastTimestamp | tail -15
# Expect: events on the whoami Application, with reasons like OperationStarted
# and OperationCompleted, timed to when your change disappeared.

kubectl describe application -n argocd whoami | grep -A20 'Status:'
# Expect: sync status Synced, and a history entry with the Git revision that
# was applied.
```

The Argo CD interface tells the same story more clearly. Click `whoami`, then the **History and Rollback** tab: every sync is listed with the commit it applied. That list, not your shell history, is now the record of what happened to this application.

**This is the moment to feel the trade rather than just read about it.** `kubectl scale` did nothing lasting. If that annoys you, the answer is not to turn `selfHeal` off. It is to notice that you were about to make an undocumented change to a running system, and that something just stopped you.

### (c) Delete something in Git, and watch prune do the same thing in reverse

The two experiments above make Argo CD look purely protective. It is not. It is symmetric, and here is the direction that cuts the other way:

```bash
cd ~/k3s-lab-gitops
git rm infra/whoami/ingress.yaml
git commit -m "Remove the whoami Ingress"
git push
```

Now wait. This is the slow clock: up to three minutes before Argo CD looks at Git again. Watch the terminal running `kubectl get applications -n argocd -w`, or force it:

```bash
kubectl -n argocd patch app whoami --type merge \
  -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'

kubectl get ingress -n default whoami
# Expect: "not found". Argo CD deleted it, because Git no longer asks for it.

curl --max-time 5 -s -o /dev/null -w '%{http_code}\n' http://whoami.k3s.linsnotes.com
# Expect: 404. The application is down, and it is down entirely correctly.
```

**Nothing went wrong.** One `git rm` and a push removed a live routing rule from a running cluster, in under three minutes, with no `kubectl delete` anywhere. That is the same mechanism that put the Ingress back in experiment (a), pointed the other way, and it is exactly what `prune: true` promises.

Sit with that for a second before undoing it. The mechanism has no opinion about whether a deletion was intended. It only knows what the repository says. Everything that makes this safe in practice happens **before** the push: review, a protected branch, someone reading the diff. Argo CD is not the safety net. The pull request is.

Put it back the way you now put everything back:

```bash
git revert --no-edit HEAD
git push

kubectl -n argocd patch app whoami --type merge \
  -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'

sleep 20
kubectl get ingress -n default whoami
# Expect: it exists again.

curl --max-time 5 http://whoami.k3s.linsnotes.com
# Expect: the whoami text block.
```

`git revert` rather than editing the file back by hand, on purpose. It records that the removal happened and then was undone, which is a more honest history than a repository that quietly forgets.

---

## Step 9 — Clean up and save a restore point

Less to remove than usual, and that is itself the result. Almost everything this part created is either infrastructure you are keeping or a file in a repository that does not live in the cluster at all.

### Tidy up

```bash
# The port-forward from Step 6, if you started one and it is still running:
pkill -f "port-forward.*argocd-server" 2>/dev/null || true

# Confirm the repository is clean and pushed:
cd ~/k3s-lab-gitops
git status --short          # expect: no output
git log --oneline | head -8 # expect: your commits, including the revert
```

Check what is actually in the cluster:

```bash
kubectl get applications -n argocd
# Expect: metallb-config and whoami, both Synced and Healthy.

kubectl get all -n default
# Expect: the whoami deployment, replicaset, two pods, its service, and
# service/kubernetes. NOT the usual one line baseline, and that is on purpose.
```

**`whoami` stays**, unlike Parts 3, 4 and 5 where the demo application always went. Two reasons. It costs nothing to keep now, because it is fully described in Git rather than being residue nobody can account for. And Part 7 needs a hostname to put a certificate on, so it is a head start rather than a mess.

If you would rather end this part with an empty `default` namespace, do it the new way, which is also the last exercise:

```bash
# Optional. The GitOps way to delete an application: delete the pointer.
# kubectl delete application whoami -n argocd
# Deleting an Application does NOT delete its objects by default. To have
# them go too, the Application needs a deletion finalizer, which is a
# separate setting worth reading about before you use it.
```

Leave `metallb-config`, Argo CD, MetalLB and ingress-nginx exactly as they are.

### Snapshot

Same careful pattern as Parts 3, 4 and 5. All five stopped together, so the three etcd members are captured at one consistent instant:

```bash
for n in worker1 worker2 master1 master2 master3; do lxc stop "$n"; done
for n in master1 master2 master3 worker1 worker2; do
  lxc snapshot "$n" post-gitops
done
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 45

kubectl get nodes
# Expect: five Ready. Give this one a little longer than usual; Argo CD's
# pods take a moment to settle after a cold start.

kubectl get applications -n argocd
# Expect: both Synced and Healthy again, with nobody having done anything.
# Argo CD reconciled on startup, exactly as it does every three minutes.

curl --max-time 5 http://whoami.k3s.linsnotes.com
curl --max-time 5 -s -o /dev/null -w '%{http_code}\n' http://argocd.k3s.linsnotes.com
# Expect: the whoami block, then 200.
```

### What this snapshot does not contain

Three things, and each for a good reason:

| Not in the snapshot | Where it lives | What that means |
|---|---|---|
| The GitHub repository | github.com | Rolling nodes back does not roll Git back. Read the warning below. |
| `/etc/hosts` on the host and your laptop | Those machines | Same as Part 5. Roll back and your names still resolve, which is what you want. |
| The router's static route | Your router | Also unchanged by any rollback, also on purpose. |

> **Rolling back to `post-gitops` does not roll back your repository, and Argo CD will notice.** This is new, and it is the one genuinely surprising consequence of running GitOps in a lab with snapshots. Restore all five nodes to `post-gitops` a month from now, after twenty commits, and within about three minutes Argo CD will have pulled the cluster **forward** to whatever `main` says today. The snapshot restores the machines; Argo CD restores the intent, and the intent has moved on. That is correct behaviour and it is also the opposite of what "restore a snapshot" usually feels like. If you genuinely want the cluster as it was on this date, roll Git back too, by checking out the commit you were on and pushing, or by pointing `targetRevision` at a tag. That the two now have to be rolled back together is the price of Git being the truth. It is a fair price, and it is better to meet it here than during an incident.
{: .prompt-warning }

---

## Where you should be

| Thing | State |
|---|---|
| Argo CD | Installed in namespace `argocd`, version pinned, admin password changed |
| Argo CD interface | `http://argocd.k3s.linsnotes.com`, HTTP only, `server.insecure: "true"` |
| Repository | Public GitHub repo, folders `bootstrap/`, `apps/`, `infra/` |
| Applications | `metallb-config` (adopted from Part 5) and `whoami` (created from Git) |
| Sync policy | Automated on both; `selfHeal` on both; `prune` on `whoami` only |
| Sync interval | About three minutes for Git, seconds for cluster drift |
| Adoption | Proven: live MetalLB objects taken over with no restart and no outage |
| Failure test | Object deleted and restored; a hand edit reverted; a Git deletion pruned |
| Snapshots | `post-gitops` on all five, taken stopped and together |
| Still no TLS | Everything is plain HTTP. That is Part 7. |

### Things worth carrying forward

- **GitOps is not "keep your YAML in Git". It is "the cluster follows Git".** Storing manifests in a repository and then applying them by hand gives you a nice archive and none of the benefits. The difference is entirely in whether a program is continuously closing the gap.
- **Adopting live objects is normal and undramatic.** Argo CD compares, it does not recreate. If the YAML in Git matches what is running, the application goes `Synced` immediately and nothing restarts. That is what makes it usable on a cluster that already exists, which is every real cluster.
- **Never commit `kubectl get -o yaml` output straight into Git.** It carries `uid`, `resourceVersion`, `creationTimestamp` and `managedFields`, which the cluster assigns and changes on its own. A desired state containing them can never match reality. Write clean manifests and check them against the cluster.
- **`selfHeal` and `prune` are opposite directions of the same idea.** `selfHeal` fixes the cluster when the cluster is wrong. `prune` fixes the cluster when Git is shorter than it was. Turning on the first and not the second is a perfectly reasonable place to stop.
- **Think about blast radius per application, not per cluster.** `prune: true` on a demo application is nothing. On the object that gives your load balancer its addresses, it can take out the interface you would use to fix it. Split applications along the lines of what you can afford to lose.
- **Argo CD's server does its own TLS and will fight a plain HTTP Ingress.** `ERR_TOO_MANY_REDIRECTS` or a `502`, fixed by `server.insecure: "true"` in `argocd-cmd-params-cm` and a restart of `argocd-server`. This is not a lab quirk. It is the standard arrangement whenever something else terminates TLS.
- **Two clocks: seconds for cluster drift, about three minutes for Git.** Knowing which one you are waiting on is the difference between patience and debugging.
- **Something always bootstraps the bootstrapper.** Argo CD itself, its ConfigMap and its Ingress went in with `kubectl`. Keep that seam small, write it down, and stop pretending it does not exist.

### What Part 7 does

Everything you have built is reachable and none of it is private. Your Argo CD password crosses the network in the clear. Your browser shows "Not secure" on every lab hostname. And the one setting that made the Argo CD interface work at all, `server.insecure`, is currently doing exactly what its name warns about, because there is no TLS anywhere for it to hand off to.

Part 7 fixes all of that at once. You install **cert-manager**, which is a program that obtains and renews certificates for you, then point it at Let's Encrypt and issue real certificates for your lab hostnames. Along the way it deals with the awkward part of certificates on a private network: proving you own a name that only exists inside your house. Then `https://argocd.k3s.linsnotes.com` gets a padlock, `server.insecure` becomes the correct setting rather than a shortcut, and the break it on purpose step is a certificate expiring, on purpose, to watch renewal happen.

There is a pleasing detail waiting for you. Once cert-manager is installed, adding a certificate to a hostname is a few lines in a manifest, in a folder Argo CD already watches. Which means Part 7's real work will be a commit.

Continue with [**Part 7, Securing with TLS and cert-manager**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-7-securing-with-tls-and-cert-manager/).
</content>
</invoke>
