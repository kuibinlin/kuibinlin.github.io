---
layout: post
title: Building a Kubernetes Lab with k3s and LXD Part 7 Securing with TLS and cert manager
description: Put real HTTPS on a private lab. Build your own certificate authority first, then get trusted Let's Encrypt certificates through a Cloudflare DNS-01 challenge.
date: 2026-07-19 08:00:00 +0800
published: true
categories: [kubernetes]
tags: [k3s, kubernetes, lxd, ubuntu, cert-manager, tls, https, letsencrypt, cloudflare]
toc: true
media_subpath: /assets/media/2026/kubernetes-lab-with-k3s-and-lxd-part-7-securing-with-tls-and-cert-manager
image: kubernetes-lab-part7.webp
---

This is **Part 7** of a series on building a Kubernetes lab with k3s and LXD. If you are just arriving, start with [**Part 1, Preparing the Ubuntu Host**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-1-preparing-the-ubuntu-host/), then [**Part 2, Building the Five Nodes**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-2-building-the-five-nodes/), [**Part 3, Installing k3s**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-3-installing-k3s/), [**Part 4, Adding Persistent Storage**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-4-adding-persistent-storage/), [**Part 5, Exposing Applications**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-5-exposing-applications/), and [**Part 6, GitOps with Argo CD**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-6-gitops-with-argo-cd/). This part picks up where Part 6 left off.

**Where you are.** You have a five node cluster that survives a master dying and keeps data when a worker dies. MetalLB hands out addresses, ingress-nginx routes by hostname, and Argo CD keeps the whole thing matching a Git repository. Type a hostname into a browser and an application answers.

It answers over plain HTTP. Every byte, in both directions, travels as readable text, and the browser says so with a "Not secure" label in the address bar.

**What this part does.** It puts real certificates on your lab. First certificates you sign yourself, so you can watch every piece of the machinery with nothing outside your house involved. Then genuinely trusted certificates from Let's Encrypt, on a lab that has no public address and accepts no inbound traffic at all.

**The main point, in one line.** A certificate is trusted because something the browser already trusts signed it, and the only hard part of getting one is proving you own the name.

**What this part does not do.** It does not encrypt traffic between the Ingress and the pods behind it. That is a real thing (people call it mutual TLS, or a service mesh) and it is a much bigger subject. Here, TLS stops at the Ingress, which is where the vast majority of real clusters put it too.

**What you need before starting.** The `post-gitops` snapshot from Part 6, all five nodes Ready, Argo CD healthy, and a domain name whose DNS you control. This guide uses `linsnotes.com` with DNS hosted at Cloudflare. Step 1 checks the cluster. Step 4 is the part that needs the domain, and Step 3 works completely offline if you do not have one.

---

## Words you'll need

These build on Parts 2 to 6. Here are the new ones.

| Word | What it means |
|---|---|
| **TLS** | The thing that makes a connection private. It encrypts the traffic and proves the server is who it claims to be. The `S` in HTTPS. You will still see it called SSL, which is the old name for the same job. |
| **certificate** | A small file saying "this public key belongs to this name," signed by somebody. It is public. You hand it to every visitor. |
| **private key** | The secret half. The certificate is useless to an impostor without it. This never leaves the server. |
| **CA (certificate authority)** | Something that signs certificates for other people. Its own certificate is the one browsers are shipped with. |
| **chain of trust** | Your certificate was signed by an intermediate, which was signed by a root that your browser already trusts. Follow the chain to something known and the certificate is accepted. |
| **self-signed** | A certificate that signed itself, with no CA above it. Nothing trusts it by default, because trusting it means trusting whoever made it, and nobody has agreed to that. |
| **CSR** | Certificate Signing Request. "Here is my public key and the name I want. Please sign it." What you send to a CA. |
| **ACME** | The protocol for getting a certificate automatically, with no human involved. Let's Encrypt invented it. cert-manager speaks it for you. |
| **Let's Encrypt** | A free, public CA that issues certificates over ACME. Its root is in every browser and operating system. |
| **challenge** | The test a CA sets to prove you actually control the name you asked for. No proof, no certificate. |
| **HTTP-01** | A challenge where the CA fetches a file from `http://yourname/.well-known/...`. Needs your server to be reachable from the public internet. |
| **DNS-01** | A challenge where you put a specific TXT record in your domain's DNS. Needs nothing to be reachable, only that you control the domain. |
| **Issuer vs ClusterIssuer** | Both say "here is how to get certificates." An `Issuer` works in one namespace. A `ClusterIssuer` works everywhere. Same fields otherwise. |
| **Certificate (the resource)** | A Kubernetes object saying "I want a certificate for these names, from this issuer, stored in this Secret." cert-manager makes it real and keeps it real. |
| **Secret** | Where the finished certificate and its private key are stored. TLS ones hold two keys: `tls.crt` and `tls.key`. |
| **SAN** | Subject Alternative Name. The list of hostnames a certificate is actually valid for. Browsers read this list and ignore the older common name field. |
| **wildcard certificate** | One certificate covering `*.k3s.linsnotes.com`, so every name under it works. Only obtainable with DNS-01. |
| **staging vs production** | Let's Encrypt runs two systems. Staging is for practice: generous limits, and certificates nothing trusts. Production is the real one, with limits worth respecting. |

---

## Three things to know before you start

### 1. HTTP-01 cannot work in this lab, and that fact is the whole reason DNS-01 exists

This is the single most valuable idea in this part, so it gets the most space.

When you ask a certificate authority for a certificate for `whoami.k3s.linsnotes.com`, it will not just hand one over. It has to know you control that name, or anyone could ask for a certificate for your bank. So it sets a challenge, and there are two common kinds.

**HTTP-01** works like this. Let's Encrypt gives your machine a random string. You put that string at a fixed path on the web server that name points to. Then Let's Encrypt, from its own servers on the public internet, fetches `http://whoami.k3s.linsnotes.com/.well-known/acme-challenge/<random>` and checks it got the right string back. If it did, you clearly control whatever machine that name resolves to, so you get your certificate.

It is elegant, it is the default nearly everywhere, and **it cannot possibly work here.** Look at what it needs and compare it to what you built:

| HTTP-01 needs | Your lab has |
|---|---|
| The name to resolve publicly, for everyone | A line in `/etc/hosts` on one machine, and maybe a laptop |
| A path from the public internet to your Ingress | A private network on `10.99.99.0/24`, behind NAT, with nothing forwarded in |
| Port 80 reachable from outside | Port 80 on a MetalLB address that exists only inside your house |

Let's Encrypt's servers would look up `whoami.k3s.linsnotes.com`, get nothing back, and fail. Even if you added a public DNS record pointing at `10.99.99.240`, that address is private and unroutable, so the fetch would go nowhere. There is no clever workaround. HTTP-01 is out.

**DNS-01 changes the question.** Instead of "can I fetch something from your web server," it asks "can you put a specific value into your domain's DNS?" You prove ownership by writing a TXT record at `_acme-challenge.whoami.k3s.linsnotes.com`, Let's Encrypt looks that record up, and if the value matches, you get your certificate.

Read that again and notice what is missing. **Nothing has to be reachable.** No inbound port. No public address. No DNS record pointing at your lab at all. The only thing that becomes public is one TXT record, and cert-manager deletes it as soon as the challenge is done.

That is why this part goes to the trouble of a Cloudflare API token instead of the two lines that HTTP-01 would need. It is not a preference, it is the only door that opens. It also buys you something HTTP-01 could never give you: **wildcard certificates**, because there is no single web server to fetch a file from for a name that means "all of them."

### 2. A certificate is trusted because something you already trust signed it

Strip away the acronyms and a certificate is a signed statement: "the holder of this public key is allowed to call itself `whoami.k3s.linsnotes.com`." Your browser believes it for exactly one reason: it checks who signed it, and follows that chain upward until it hits one of the few hundred root certificates it was shipped with. Let's Encrypt's root is one of those. That is the entire basis of the padlock.

**Self-signed means you become the thing at the top of the chain.** You create a root CA, you decide what it signs, and then you tell your own machines to trust it. Nobody else's machine will, which is why you would never use it on a public site. But in a lab it is perfect, because every piece is visible and nothing outside your house is involved. You will see a tool reject a certificate, then add one file to your host, then watch the same certificate be accepted.

So Step 3 builds a CA and Step 4 replaces it with a real one. The objects you write barely change between them, and that similarity is the point.

### 3. Let's Encrypt has real rate limits, and hitting one costs you a week

Let's Encrypt is free and public, which means it has to protect itself. The limits that matter to you:

- **50 certificates per registered domain every 7 days.** That is per `linsnotes.com`, across every account, not per subdomain.
- **5 certificates for the exact same set of names every 7 days.** This is the one that catches people learning. Get your `ClusterIssuer` slightly wrong, fix it, retry, get it wrong again, and you can burn through five attempts in an afternoon and then wait a week.
- **5 authorisation failures per name per hour.** A misconfigured Cloudflare token trips this quickly.

These reset on a rolling schedule, not at midnight. There is no support desk you can talk into resetting them.

The answer is **staging.** Let's Encrypt runs a second, identical system at a different address with far higher limits, aimed exactly at people who are still getting it wrong. It issues real certificates from a root nothing trusts, which means everything works end to end and the browser still warns you. That warning is the correct outcome of a successful staging run, not a failure.

**Get it working on staging first. Every time. Including the time you are sure you have it right.** Step 4 does staging in full before it goes anywhere near production, and that ordering is not padding.

---

## Step 1 — Check Part 6 is still good

**Why:** the same reason as every part. If something drifted, find out now.

**Safe to run:** everything here only reads.

```bash
lxc info | head -3        # wakes LXD if it's asleep, same trick as before
sleep 3
lxc list                  # expect five RUNNING rows, plus the STOPPED template

kubectl get nodes
# Expect: five Ready.

kubectl get pods -n metallb-system
# Expect: one controller, five speakers, all Running.

kubectl get svc -n ingress-nginx ingress-nginx-controller
# Expect: TYPE LoadBalancer, EXTERNAL-IP around 10.99.99.240. Note the address.
```

Now the Part 6 machinery, which everything in this part goes through:

```bash
kubectl get pods -n argocd
# Expect: all Running. The server, repo-server, application-controller,
# redis and the dex/notifications pods if you kept them.

kubectl get applications -n argocd
# Expect: your Part 6 Applications, SYNC STATUS Synced, HEALTH STATUS Healthy.
# Anything OutOfSync here is a Part 6 problem. Fix it before continuing.
```

And the application you are about to put a certificate on:

```bash
curl --max-time 5 -s -o /dev/null -w 'whoami over http: %{http_code}\n' \
  http://whoami.k3s.linsnotes.com
# Expect: 200.

curl --max-time 5 -s -o /dev/null -w 'argocd over http: %{http_code}\n' \
  http://argocd.k3s.linsnotes.com
# Expect: 200.
```

Both plain HTTP, both working, both about to change.

> **One thing to have ready before Step 2.** You will be editing your Git repository, not the cluster. Make sure you have `kuibinlin/k3s-lab-gitops` cloned on the host and that you can push to it. Every change from here on goes `edit file, commit, push, watch Argo CD`. If you find yourself typing `kubectl apply`, stop and check whether Argo CD owns that object.
{: .prompt-tip }

---

## Step 2 — Install cert-manager, through Git

**What this does.** It adds cert-manager to the cluster. cert-manager is a controller that watches for `Certificate` objects and does everything needed to make them real: generate a key, build a CSR, talk to a CA, answer the challenge, write the result into a Secret, and renew it before it expires. You describe what you want. It does the work, forever.

### Why this cannot be a `kubectl apply`

Part 6 turned on automated sync with `selfHeal: true` and `prune: true`. Those two settings have a consequence that this part is the first to run into properly.

- **`selfHeal: true`** means Argo CD watches the live cluster and puts back anything that drifts from Git. Change something by hand and it gets reverted, usually within a couple of minutes.
- **`prune: true`** means Argo CD deletes objects that exist in the cluster but not in Git, inside the paths it manages.

So a bare `kubectl apply -f cert-manager.yaml` would be, at best, an object Argo CD does not know about, and at worst something it deletes. More importantly, it would be invisible: in six months the cluster would have a component nobody can point at a source for, which is the exact problem Part 6 was written to solve.

**This is why Part 6 came before Part 7 and not after.** Every component from here on goes into the repository first. The cluster is the output, not the input.

### The CRD problem, honestly

cert-manager does not just install a program. It teaches Kubernetes four new object types: `Issuer`, `ClusterIssuer`, `Certificate`, and `CertificateRequest`, plus `Order` and `Challenge` for ACME. Those definitions are **CustomResourceDefinitions**, or CRDs.

A CRD has to exist before Kubernetes will accept an object of that type. Write a `ClusterIssuer` before the `ClusterIssuer` CRD is installed and the API server rejects it outright: it has never heard of that kind.

That is a plain ordering problem, and with Argo CD there are two ways to handle it.

**Install the CRDs as part of the same Application.** The cert-manager Helm chart can install its own CRDs with one setting, and that is the simplest correct answer. It is what this guide does.

**Or use sync waves.** A sync wave is a number you put in an annotation, and Argo CD applies everything in wave 0, waits for it to be healthy, then does wave 1, then wave 2. Lower numbers, including negative ones, go first. That is the whole idea:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "1"     # applied after wave 0
```

The ordering problem shows up twice here. Inside one Application, the chart's CRDs and its Deployment need ordering, and the chart handles that itself. Across two Applications, `cert-manager-config` cannot be applied until `cert-manager` has installed the CRDs, and that is what the wave annotations below describe.

> **Sync waves only order things that Argo CD is applying.** Part 6 applies each Application by hand with `kubectl apply -f apps/<file>.yaml`, so nothing is reading these annotations yet, and the ordering is down to the order you type the two commands. Put them in anyway: they cost nothing, they record the intent, and they start working the day you build the App of Apps that Part 6's Step 6 described.
>
> There is also a safety net either way. Argo CD retries a failed sync on its own, so `cert-manager-config` applied too early fails once with "no matches for kind ClusterIssuer" and then goes Synced a minute later when the CRDs land. Ugly, but self-correcting.
{: .prompt-info }

### Write the two Applications

In your repo, add `apps/cert-manager.yaml`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cert-manager
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "0"        # first
spec:
  project: default
  source:
    repoURL: https://charts.jetstack.io      # the cert-manager Helm repo
    chart: cert-manager
    targetRevision: v1.20.1                  # PIN IT. See the note below.
    helm:
      parameters:
      - name: crds.enabled                   # install the CRDs with the chart
        value: "true"
  destination:
    server: https://kubernetes.default.svc
    namespace: cert-manager
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
    - CreateNamespace=true                   # make the namespace if it's missing
    - ServerSideApply=true                   # see the note below
```

Then `apps/cert-manager-config.yaml`, which holds the issuers you write in Steps 3 and 4:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cert-manager-config
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "1"        # after cert-manager
spec:
  project: default
  source:
    repoURL: https://github.com/kuibinlin/k3s-lab-gitops.git
    targetRevision: main
    path: infra/cert-manager-config
  destination:
    server: https://kubernetes.default.svc
    namespace: cert-manager
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

Two of those lines deserve an explanation.

> **`targetRevision: v1.20.1` is an example, not advice.** cert-manager releases often, and by the time you read this the current version will be different. Check the [cert-manager releases page](https://cert-manager.io/docs/releases/) and use what is current and supported. Pinning a version is the point; pinning *this* version is not. The same goes for every version number in this series.
{: .prompt-warning }

> **`ServerSideApply=true` is there because cert-manager's CRDs are enormous.** Argo CD's default way of applying an object stores a copy of the whole thing in an annotation, and Kubernetes caps annotations at about 256 kB. Some cert-manager CRDs are bigger than that, so the apply fails with a message about the annotation being too long. Server-side apply does not use that annotation at all, so the problem disappears. If you ever meet "metadata.annotations: Too long" on a big CRD, this is the fix.
{: .prompt-tip }

Commit both files, then create the folder the second one points at. Leave the folder empty for now: Step 3 puts the first issuer in it, and `cert-manager-config` does not get applied until then.

```bash
cd ~/k3s-lab-gitops          # where Part 6 put it
mkdir -p infra/cert-manager-config

git add apps/cert-manager.yaml apps/cert-manager-config.yaml
git commit -m "Add cert-manager and its config Application"
git push
```

### Watch it arrive

Application objects still reach the cluster by hand, exactly as in Part 6. Only `cert-manager` for now:

```bash
kubectl apply -f apps/cert-manager.yaml
# Expect: application.argoproj.io/cert-manager created.
# Do NOT apply cert-manager-config yet. Its folder is empty, and it is
# Step 3's job.
```

Then watch:

```bash
kubectl get applications -n argocd
# Expect: cert-manager appears, and because syncPolicy.automated is in the
# file, it syncs on its own. Give it a minute to reach Synced and Healthy.
# Pulling three container images on first install is most of that minute.

kubectl get pods -n cert-manager
# Expect: three Running pods. Names vary, but the jobs are always the same:
#   cert-manager            the controller that does the work
#   cert-manager-webhook    validates your Certificate and Issuer YAML
#   cert-manager-cainjector wires CA data into the webhook's own config
```

Confirm the new object types exist, which is the real test that the CRDs landed:

```bash
kubectl api-resources | grep cert-manager.io
# Expect: certificates, certificaterequests, issuers, clusterissuers,
# and under acme.cert-manager.io, challenges and orders.
```

Six new kinds of object your cluster understands. Nothing has been issued yet, because nothing has been asked for.

> **The webhook is a real dependency, not decoration.** It checks every `Certificate` and `Issuer` you submit and rejects bad ones with a readable message. If it is not running, your applies fail with a connection error mentioning `webhook.cert-manager.io`, which looks like a networking problem and is not. Give it thirty seconds after install before you apply anything.
{: .prompt-info }

---

## Step 3 — Become your own certificate authority

**What this does.** It creates a root CA inside the cluster, uses it to issue a certificate for `whoami.k3s.linsnotes.com`, puts that certificate on the Ingress, and then walks through exactly why the browser complains and what makes the complaint stop.

**Why do this at all, when Step 4 gets you real certificates?** Because every moving part is visible and none of them can fail for a reason outside your control. No API tokens, no rate limits, no internet. If something goes wrong here it is your YAML, and that is a much better place to learn. It is also genuinely useful on its own: internal services that no browser will ever visit are often signed exactly this way.

### Three objects, and why it takes three

This trips everyone up the first time, so here it is before the YAML. Setting up a CA in cert-manager needs three objects, because there are three genuinely different things happening.

| Object | Kind | What it is for |
|---|---|---|
| `selfsigned` | `ClusterIssuer` with `selfSigned: {}` | An issuer that signs certificates with their own key. It is used exactly once: to sign the CA's own certificate. Nothing else uses it. |
| `lab-root-ca` | `Certificate` with `isCA: true` | The CA's own certificate and private key. `isCA: true` is the flag that says "this certificate is allowed to sign others." Without it, it would be an ordinary certificate that cannot sign anything. |
| `lab-ca` | `ClusterIssuer` with `ca:` | The issuer you actually use. It signs certificates using the key from `lab-root-ca`. |

Read down the table and the chicken-and-egg resolves itself: a root CA has nothing above it to sign it, so it has to sign itself, and `selfSigned` is the thing that performs that one act. After that, `lab-ca` does all the real work.

Create `infra/cert-manager-config/selfsigned-ca.yaml`:

```yaml
# 1. The bootstrap issuer. Signs one thing: the CA below.
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned
spec:
  selfSigned: {}
---
# 2. The CA's own certificate and key, stored in a Secret.
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: lab-root-ca
  namespace: cert-manager          # see the note on namespaces below
spec:
  isCA: true                       # this is what makes it able to sign
  commonName: k3s-lab-root-ca
  secretName: lab-root-ca          # the Secret the key pair lands in
  duration: 87600h                 # 10 years. It is your CA; you decide.
  privateKey:
    algorithm: ECDSA
    size: 256
  issuerRef:
    name: selfsigned
    kind: ClusterIssuer
    group: cert-manager.io
---
# 3. The issuer you will actually name in your Ingress rules.
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: lab-ca
spec:
  ca:
    secretName: lab-root-ca        # signs using the key from step 2
```

> **A `ClusterIssuer` looks for its Secrets in one fixed namespace, and it is not the one you might expect.** A `ClusterIssuer` has no namespace of its own, so cert-manager reads any Secret it references from what it calls the cluster resource namespace, which defaults to `cert-manager`. That is why `lab-root-ca` is created in `cert-manager` above, and it is why the Cloudflare token in Step 4 goes there too. Put the Secret in `default` and the issuer will report that it cannot find it, while the Secret sits there in plain sight.
{: .prompt-warning }

Commit it, and now the folder has something in it, so create the Application that watches it:

```bash
cd ~/k3s-lab-gitops
git add infra/cert-manager-config/selfsigned-ca.yaml
git commit -m "Add a self-signed root CA and a CA ClusterIssuer"
git push

kubectl apply -f apps/cert-manager-config.yaml
# Expect: created. This is the last Application object you create by hand in
# this part. Everything after it is a commit.

kubectl get applications -n argocd cert-manager-config
# Expect: Synced and Healthy within a minute. If it says "no matches for kind
# ClusterIssuer", cert-manager's CRDs are not in yet; wait and look again.
```

Check both issuers:

```bash
kubectl get clusterissuer
# Expect: selfsigned and lab-ca, both READY True.
# lab-ca goes Ready only after lab-root-ca has issued, so it can lag by a few
# seconds. If it stays False, describe it; the message is usually plain.

kubectl get certificate -n cert-manager lab-root-ca
# Expect: READY True.

kubectl get secret -n cert-manager lab-root-ca
# Expect: TYPE kubernetes.io/tls, DATA 3 (tls.crt, tls.key and ca.crt).
```

You now have a certificate authority. Look at what it made:

```bash
kubectl get secret -n cert-manager lab-root-ca \
  -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -text | head -15
# Expect: Issuer and Subject BOTH reading CN=k3s-lab-root-ca. That is what
# self-signed means, visible in one line: it signed itself.
# Look further down for "CA:TRUE" under X509v3 Basic Constraints. That is
# isCA doing its job.
```

### Issue a certificate and put it on the Ingress

You do not have to write a `Certificate` object for this. cert-manager watches Ingress resources, and if it sees the right annotation it creates the `Certificate` for you, using the hostnames from the rule. That shortcut is called the ingress-shim and it is how most people use cert-manager day to day.

Two changes to `infra/whoami/ingress.yaml`, the file Part 6 wrote:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: whoami
  namespace: default
  annotations:
    cert-manager.io/cluster-issuer: lab-ca     # CHANGE 1: which issuer to use
spec:
  ingressClassName: nginx
  tls:                                          # CHANGE 2: the whole tls block
  - hosts:
    - whoami.k3s.linsnotes.com
    secretName: whoami-tls                      # where the result gets stored
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
```

Those two changes work together. The `tls` block tells ingress-nginx "serve HTTPS for this host, using the certificate in the Secret `whoami-tls`." The annotation tells cert-manager "that Secret does not exist yet, go and fill it using `lab-ca`."

```bash
git add infra/whoami/ingress.yaml
git commit -m "Serve whoami over HTTPS with the lab CA"
git push
```

Watch it happen:

```bash
kubectl get certificate -n default -w
# Expect: whoami-tls appears, READY False for a moment, then True.
# Ctrl-C when it goes True. With a CA issuer this takes about a second,
# because no external service is involved.

kubectl get secret -n default whoami-tls
# Expect: TYPE kubernetes.io/tls.
```

Nobody created that `Certificate` object. The ingress-shim did, from your annotation:

```bash
kubectl get certificate -n default whoami-tls -o yaml | grep -A5 ownerReferences
# Expect: an owner reference pointing at the Ingress named whoami.
# That is the link: delete the Ingress and the Certificate goes with it.
```

### Look at it, and understand the warning

```bash
curl --max-time 5 -sI https://whoami.k3s.linsnotes.com
```

Expect that to **fail**, with a message about a self-signed certificate in the chain, or an unknown issuer. This is not a bug. This is the whole lesson.

`curl` received a perfectly valid certificate for the right hostname, signed by `k3s-lab-root-ca`. Then it went looking for `k3s-lab-root-ca` in the list of authorities your system trusts, did not find it, and refused. **It is not saying the certificate is wrong. It is saying it has no reason to believe you.**

Prove that by telling `curl` to skip the check:

```bash
curl --max-time 5 -k -sI https://whoami.k3s.linsnotes.com
# -k means "do not verify". Expect: HTTP/2 200. The encryption was working
# the entire time. Only the trust decision was failing.
```

And look at what it actually served:

```bash
echo | openssl s_client -connect 10.99.99.240:443 \
  -servername whoami.k3s.linsnotes.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
# Expect: subject CN=whoami.k3s.linsnotes.com, issuer CN=k3s-lab-root-ca,
# and dates roughly 90 days apart (cert-manager's default for a leaf).
# Use your own ingress-nginx address if it is not .240.
```

Open `https://whoami.k3s.linsnotes.com` in the host's browser and you get the full page of warning. Same reason, more red.

> **ingress-nginx starts redirecting HTTP to HTTPS the moment an Ingress has a `tls` block.** So `http://whoami.k3s.linsnotes.com` now bounces to `https://`, which you did not ask for and which is almost always what you want. If you need to turn it off for one Ingress, the annotation is `nginx.ingress.kubernetes.io/ssl-redirect: "false"`.
{: .prompt-info }

### Now trust your own CA

Nothing about the certificate needs to change. You need to add `k3s-lab-root-ca` to the host's list of trusted authorities, which is one file and one command.

Pull the CA certificate out of the cluster:

```bash
kubectl get secret -n cert-manager lab-root-ca \
  -o jsonpath='{.data.tls\.crt}' | base64 -d > /tmp/k3s-lab-root-ca.crt

openssl x509 -in /tmp/k3s-lab-root-ca.crt -noout -subject
# Expect: subject=CN = k3s-lab-root-ca. Check before you install it.
```

Install it on the host. On Ubuntu, the trust store is a directory plus a command that rebuilds the bundle from it. The `.crt` extension is required; files with other extensions are silently ignored:

```bash
sudo cp /tmp/k3s-lab-root-ca.crt /usr/local/share/ca-certificates/k3s-lab-root-ca.crt
sudo update-ca-certificates
# Expect: a line saying "1 added". If it says 0 added, check the extension.
```

Try again, with no `-k`:

```bash
curl --max-time 5 -sI https://whoami.k3s.linsnotes.com
# Expect: HTTP/2 200, no error, no flag. The certificate did not change.
# Your machine's opinion of who signed it did.
```

That is the entire mechanism of trust on the internet, done by hand in two commands. Every padlock you have ever seen is this, with the copying step done by whoever built your operating system.

> **Your browser may not agree, and that is not your mistake.** `curl` and most command line tools read the system trust store you just updated. Firefox ships and uses its own store on every platform, so it will keep warning until you import the certificate through its own settings. Chrome and Edge use the system store on Windows and macOS, and on Linux they read a per-user NSS database that `update-ca-certificates` does not touch. So "curl is happy, the browser is not" is normal and means the system store worked. Adding it to each browser is a per-browser chore, and for a lab it is fine to skip and keep using `-k` in the browser.
{: .prompt-warning }

To undo this later, delete the file and rebuild:

```bash
# Not now. This is the undo, for when you are finished with the lab.
#   sudo rm /usr/local/share/ca-certificates/k3s-lab-root-ca.crt
#   sudo update-ca-certificates --fresh
```

---

## Step 4 — Real certificates from Let's Encrypt, over Cloudflare DNS-01

**What this does.** It replaces your own CA with a public one, and gets a certificate that every browser on earth already trusts, for a service running on a private address that nothing outside your house can reach.

That combination is worth pausing on. You are about to get a genuine, publicly trusted certificate for a machine with no public address, no port forwarding, and no inbound path of any kind. That works because of exactly one thing: DNS-01 proves you own the *name*, and never asks about the *machine*.

### 4a. Make a Cloudflare API token

cert-manager needs permission to create and delete TXT records in your zone. Cloudflare offers two ways to do that, and only one of them is acceptable.

- The **Global API Key** is one secret that can do everything to every zone and every setting on your account, including deleting it. Some old guides still use it. Do not.
- An **API token** is scoped: you choose what it may do and which zones it may touch, you can see when it was last used, and you can revoke it on its own without changing anything else.

In the Cloudflare dashboard, go to **My Profile**, then **API Tokens**, then **Create Token**. Choose **Create Custom Token** and set it up like this:

| Field | Value |
|---|---|
| Token name | something you will recognise, for example `cert-manager-k3s-lab` |
| Permissions, row 1 | **Zone**, **DNS**, **Edit** |
| Permissions, row 2 | **Zone**, **Zone**, **Read** |
| Zone Resources | **Include**, **Specific zone**, `linsnotes.com` |
| TTL | leave it, or set an expiry if you like being reminded |

`Zone:DNS:Edit` is the one that writes the challenge record. `Zone:Zone:Read` is there so cert-manager can look up which zone a name belongs to; without it you get an error naming `com.cloudflare.api.account.zone.list`, which reads like a bug and is really a missing permission.

Create it, and **copy the token now.** Cloudflare shows it exactly once.

### 4b. Put the token in the cluster, and be honest about where it is not going

```bash
kubectl create secret generic cloudflare-api-token \
  --namespace cert-manager \
  --from-literal=api-token='PASTE_YOUR_TOKEN_HERE'

kubectl get secret -n cert-manager cloudflare-api-token
# Expect: TYPE Opaque, DATA 1. Never echo the value back.
```

Note the namespace: `cert-manager`, for the cluster resource namespace reason from Step 3.

> **This one thing does not go into Git, and that needs saying plainly.** Part 6 put your whole cluster into a public GitHub repository, which was the right call for everything in it. This is the first object that must not follow. A Kubernetes Secret is base64, not encryption; anyone who reads the file reads the token, and a token with `Zone:DNS:Edit` on your domain is enough to take over your DNS. Public repositories are scraped for exactly this within minutes.
>
> So you created it by hand, outside Git, and your repository now describes 95 percent of your cluster instead of 100. That gap is real and you should feel it, because the grown-up answers to it are a genuine subject:
>
> - **Sealed Secrets** encrypts the Secret with a key only your cluster holds. The encrypted file is safe to commit; nothing else can read it.
> - **External Secrets Operator** leaves the value in a real secret manager (Vault, AWS Secrets Manager, 1Password) and puts only a reference in Git.
> - **SOPS**, usually with age or a KMS, encrypts just the values inside a YAML file so the structure stays readable in diffs.
>
> Any of the three closes the gap. All three are more setup than this part has room for. Doing it by hand and knowing why it is a shortcut beats doing it by hand and not noticing.
{: .prompt-warning }

If you ever think the token leaked, revoke it in the Cloudflare dashboard. That is instant and breaks nothing else.

### 4c. The staging ClusterIssuer

Add `infra/cert-manager-config/letsencrypt-staging.yaml`:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    # The STAGING address. Note "staging" in the hostname. This one line is
    # the whole difference between practice and burning a rate limit.
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: you@example.com            # expiry warnings go here. Use a real one.
    privateKeySecretRef:
      name: letsencrypt-staging-account-key   # cert-manager creates this itself
    solvers:
    - dns01:
        cloudflare:
          apiTokenSecretRef:
            name: cloudflare-api-token        # the Secret from 4b
            key: api-token
      selector:
        dnsZones:
        - linsnotes.com                       # use this solver for this zone
```

Reading the parts that matter:

- **`server`** is what makes this staging. Everything else is identical to production. Check this line twice.
- **`privateKeySecretRef`** is not your certificate's key. It is the key identifying your *account* with Let's Encrypt. cert-manager generates it on first use and reuses it after. You do not create this Secret.
- **`solvers`** is a list, so one issuer can prove different names in different ways. Here there is one, and `selector.dnsZones` restricts it to `linsnotes.com`, which matters the moment you own a second domain.
- **`apiTokenSecretRef`** uses the token form. There is an older `apiKeySecretRef` that needs an `email` field alongside it. That is the Global API Key path. Do not use it.

```bash
git add infra/cert-manager-config/letsencrypt-staging.yaml
git commit -m "Add Let's Encrypt staging ClusterIssuer with Cloudflare DNS-01"
git push
```

```bash
kubectl get clusterissuer letsencrypt-staging
# Expect: READY True within a few seconds. This means cert-manager registered
# an ACME account with staging. It does NOT mean the token works; nothing has
# tried to write a DNS record yet.
```

### 4d. Issue a staging certificate, and watch the whole chain

Switch `whoami` to the staging issuer. In `infra/whoami/ingress.yaml`, change one word:

```yaml
    cert-manager.io/cluster-issuer: letsencrypt-staging     # was lab-ca
```

The old certificate will not be replaced while it is still valid, so delete the Secret at the same time to force a fresh issuance. This is a deliberate exception to the "everything through Git" rule, because a Secret's *contents* are not in Git and never were:

```bash
git add infra/whoami/ingress.yaml
git commit -m "Move whoami to Let's Encrypt staging"
git push

# Wait for Argo CD to sync the Ingress, then:
kubectl delete secret -n default whoami-tls
```

Now watch, because this is where the interesting part is. Six object types are involved and each one has a job:

```bash
kubectl get certificate,certificaterequest,order,challenge -n default
```

| Object | What it means |
|---|---|
| `Certificate` | Your request, as a standing wish. It stays for the life of the service and drives every renewal. |
| `CertificateRequest` | One attempt at getting a certificate. A new one appears at every issuance and renewal. |
| `Order` | The ACME conversation with Let's Encrypt for that attempt. |
| `Challenge` | One name being proved. One `Challenge` per hostname in the certificate. |

Watch the `Challenge` in particular, because that is where the Cloudflare token is used for the first time:

```bash
kubectl get challenge -n default -w
# Expect: one challenge appears, STATE pending, then valid, then it vanishes.
# Ctrl-C once it is gone. Typically 30 to 90 seconds, mostly DNS propagation.
```

While it is pending, look at the record from outside:

```bash
dig +short TXT _acme-challenge.whoami.k3s.linsnotes.com @1.1.1.1
# Expect: a quoted random string, while the challenge is pending.
# Run it again after the challenge disappears and expect nothing:
# cert-manager cleans the record up.
```

**That command is the whole idea made visible.** A public DNS resolver, anywhere in the world, can read a record proving you control `linsnotes.com`. Nothing anywhere can reach `whoami.k3s.linsnotes.com`, and nothing needs to.

Then:

```bash
kubectl get certificate -n default whoami-tls
# Expect: READY True.

echo | openssl s_client -connect 10.99.99.240:443 \
  -servername whoami.k3s.linsnotes.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
# Expect: issuer naming Let's Encrypt's STAGING authority. The exact name
# changes over time; the giveaway is the word for a fake or test authority
# in it. Dates should be about 90 days apart.
```

### 4e. When a challenge sticks, which it will

This is the most useful debugging path in the part, so learn it now while the stakes are a staging certificate.

A challenge that stays `pending` for more than a couple of minutes is stuck. Ask it why:

```bash
kubectl describe challenge -n default
# Read the Events at the bottom. cert-manager writes plain messages here.
```

| Message mentions | What it means | Fix |
|---|---|---|
| `requires permission ... zone.list` | The token lacks `Zone:Zone:Read` | Add the second permission row in Cloudflare |
| `Invalid request headers`, or a 400 or 403 from Cloudflare | Wrong or revoked token, or a stray newline in it | Recreate the Secret. Use `--from-literal`, not a file. |
| `could not find the secret`, `secret not found` | The Secret is in the wrong namespace | It must be in `cert-manager` for a `ClusterIssuer` |
| `Waiting for DNS-01 challenge propagation`, repeatedly | cert-manager wrote the record but cannot see it yet | Usually just wait. If it never clears, see the nameserver note below. |
| `no such host`, or an error naming the zone | cert-manager picked the wrong zone for the name | Check the zone really is `linsnotes.com` in Cloudflare |

If `describe` is not enough, read the controller:

```bash
kubectl logs -n cert-manager deploy/cert-manager --tail=100
# Follow it live with -f while you retry. Cloudflare's own error text
# is passed through here, which is usually the fastest answer.
```

And check the record independently, because that separates "cert-manager could not write it" from "Let's Encrypt could not read it":

```bash
dig +short TXT _acme-challenge.whoami.k3s.linsnotes.com @1.1.1.1
dig +short TXT _acme-challenge.whoami.k3s.linsnotes.com @8.8.8.8
```

- **Nothing from either:** cert-manager did not write the record. Token or permissions.
- **Something from both, still stuck:** the write worked. Wait longer, or check what cert-manager itself is querying.

> **The self-check can be the thing that is stuck.** Before it tells Let's Encrypt to go ahead, cert-manager checks that it can see the TXT record itself, using the DNS servers from its pod's `/etc/resolv.conf`. In this lab that is CoreDNS, forwarding to whatever your host uses. If your host runs something that answers for your own domain differently (a Pi-hole with local records, a split DNS setup), the self-check can fail forever while the world sees the record perfectly. The fix is to tell cert-manager to use public resolvers instead, by adding these to the cert-manager controller's arguments through the Helm values in `apps/cert-manager.yaml`:
>
> `--dns01-recursive-nameservers-only` and `--dns01-recursive-nameservers=1.1.1.1:53,8.8.8.8:53`
>
> Do not add these pre-emptively. Add them only if the two `dig` commands show the record and cert-manager still says it is waiting for propagation.
{: .prompt-tip }

**Where the rate limits bite.** Every one of those failures with the same set of names counts against the 5-per-week duplicate limit if the order actually reached Let's Encrypt. On staging that limit is far higher, which is precisely why you are here and not in production.

### 4f. It worked, and the browser still warns. Good.

```bash
curl --max-time 5 -sI https://whoami.k3s.linsnotes.com
# Expect: an error about an unknown or untrusted issuer, exactly like Step 3
# before you installed the CA.
```

**This is the correct result of a successful staging run.** Let's Encrypt staging issues from a root deliberately kept out of every trust store, precisely so that nobody can accidentally run a production site on practice certificates. The certificate is real, the chain is real, the challenge genuinely proved you own the domain. The only thing missing is the one thing staging is designed never to give you.

So the checklist for "staging worked" is not "the padlock appeared." It is:

```bash
kubectl get certificate -n default whoami-tls
# READY True.

kubectl get challenge -n default
# No resources found. The challenge completed and was cleaned up.

curl --max-time 5 -k -sI https://whoami.k3s.linsnotes.com
# HTTP/2 200 with -k. Serving fine; only trust is missing.
```

Three greens and an expected warning. That is the whole staging run, and everything after it is one word.

### 4g. Production

Add `infra/cert-manager-config/letsencrypt-prod.yaml`. It is the staging file with two names changed:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory   # no "staging"
    email: you@example.com
    privateKeySecretRef:
      name: letsencrypt-prod-account-key      # a SEPARATE account key
    solvers:
    - dns01:
        cloudflare:
          apiTokenSecretRef:
            name: cloudflare-api-token
            key: api-token
      selector:
        dnsZones:
        - linsnotes.com
```

The account key must have a different name from the staging one. Staging and production are separate services with separate accounts; sharing a key Secret between them is asking for a confusing failure later.

Point `whoami` at it, in `infra/whoami/ingress.yaml`:

```yaml
    cert-manager.io/cluster-issuer: letsencrypt-prod
```

```bash
git add infra/cert-manager-config/letsencrypt-prod.yaml infra/whoami/ingress.yaml
git commit -m "Move whoami to Let's Encrypt production"
git push

# After Argo CD syncs:
kubectl delete secret -n default whoami-tls
```

```bash
kubectl get challenge -n default -w
# Same shape as staging. Ctrl-C when it clears.

kubectl get certificate -n default whoami-tls
# Expect: READY True.
```

And now, with no flags:

```bash
curl --max-time 5 -sI https://whoami.k3s.linsnotes.com
# Expect: HTTP/2 200. No warning. No -k.

echo | openssl s_client -connect 10.99.99.240:443 \
  -servername whoami.k3s.linsnotes.com 2>/dev/null \
  | openssl x509 -noout -issuer -dates
# Expect: an issuer naming Let's Encrypt, and about 90 days between the dates.
```

Open it in a browser and you get a padlock, with no exception added, on `10.99.99.240`.

**Stop and look at what that address is.** It is a MetalLB address on a bridge that exists only inside one Ubuntu machine. Your router does not route to it from the internet, your ISP would drop it, and no port is forwarded anywhere. And the padlock is genuine, because Let's Encrypt was never asked whether it could reach your server. It was asked whether you own `linsnotes.com`, you proved it with a TXT record, and that was the end of the conversation.

> **One certificate for the whole lab, if you want it.** DNS-01 can issue wildcards, which HTTP-01 cannot. One `Certificate` covers every name you will ever add, and it takes one ACME order instead of one per service, which is friendly to the rate limits. The ingress-shim annotation cannot do this, because it builds the name list from the Ingress rules, so you write the `Certificate` yourself and then just reference the Secret from the `tls` block with no annotation:
>
> ```yaml
> apiVersion: cert-manager.io/v1
> kind: Certificate
> metadata:
>   name: lab-wildcard
>   namespace: default
> spec:
>   secretName: lab-wildcard-tls
>   issuerRef:
>     name: letsencrypt-prod
>     kind: ClusterIssuer
>   dnsNames:
>   - "*.k3s.linsnotes.com"
>   - "k3s.linsnotes.com"        # the wildcard does NOT cover the bare name
> ```
>
> One catch worth knowing: a Secret is namespaced, so an Ingress in another namespace cannot use it. Either issue the wildcard once per namespace, or use trust-manager or a reflector to copy it around.
{: .prompt-tip }

---

## Step 5 — Put Argo CD behind HTTPS

**What this does.** It closes a loop that Part 6 left open on purpose.

### What `server.insecure` actually did

Part 6 set `server.insecure: "true"` in the `argocd-cmd-params-cm` ConfigMap, and described it as a shortcut. Here is what it really does.

Argo CD's API server, by default, serves HTTPS itself, using a self-signed certificate it generates on startup. It also redirects any plain HTTP request to HTTPS. Put that behind an Ingress that speaks plain HTTP to its backends, and the two disagree: the Ingress sends HTTP, Argo CD answers "go to HTTPS", the Ingress passes that on, the browser comes back to the same Ingress, and you get a redirect loop or a mess of 307s.

`server.insecure: "true"` tells Argo CD to serve plain HTTP and stop redirecting. The Ingress then handles TLS on its own, which is the standard arrangement: **terminate TLS at the edge, speak plain HTTP inside the cluster.**

In Part 6 that was a shortcut, because there was no TLS anywhere, so `insecure` meant genuinely insecure end to end. With a real certificate at the Ingress it stops being a shortcut and becomes the ordinary way to run this. Nothing about the setting changed. What changed is what sits in front of it.

### Do it

This is the one Ingress in the lab that Argo CD does **not** manage. Part 6 put it in `bootstrap/argocd-server-ingress.yaml` and applied it by hand, on purpose: the thing that lets you reach Argo CD should not depend on Argo CD being healthy. So this edit is a file plus a `kubectl apply`, not a commit and a wait.

Rewrite the file with three additions:

```bash
cat > ~/k3s-lab-gitops/bootstrap/argocd-server-ingress.yaml <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: argocd-server
  namespace: argocd
  annotations:
    nginx.ingress.kubernetes.io/backend-protocol: "HTTP"     # unchanged
    cert-manager.io/cluster-issuer: letsencrypt-prod         # NEW: get a cert
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"   # NEW: see below
spec:
  ingressClassName: nginx
  tls:                                                       # NEW: the tls block
  - hosts:
    - argocd.k3s.linsnotes.com
    secretName: argocd-tls
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
              number: 80          # still the HTTP port on the Service
EOF

kubectl apply -f ~/k3s-lab-gitops/bootstrap/argocd-server-ingress.yaml
# Expect: ingress.networking.k8s.io/argocd-server configured.
```

**`force-ssl-redirect` is the annotation Part 6 told you not to add yet.** Back then it would have built a redirect loop, because there was no certificate to redirect *to*. Now there is one, so it does the sensible thing: anyone typing the bare hostname is moved to HTTPS instead of quietly logging in over plain text. This is the promise from Part 6's Step 4, kept.

Commit the file too, so the repo still describes the cluster, even though nothing syncs it:

```bash
cd ~/k3s-lab-gitops
git commit -am "Put the Argo CD Ingress behind TLS"
git push
```

> **You are changing Argo CD's own front door, and that is worth a moment of care.** The `argocd-server` pod is untouched; only the Ingress in front of it changed, so the page you are watching may blink or need a reload. But this is the one object where a mistake locks you out of the web interface. Your escape hatch is `kubectl`, which talks to the API server on `10.99.99.11:6443` and has never gone through the Ingress at all. Nothing here can take that away.
{: .prompt-warning }

```bash
kubectl get certificate -n argocd argocd-tls
# Expect: READY True after a challenge cycle, about a minute.

curl --max-time 5 -sI https://argocd.k3s.linsnotes.com
# Expect: HTTP/2 200. No -k.

curl --max-time 5 -sI http://argocd.k3s.linsnotes.com | head -1
# Expect: a 308 redirect. That is force-ssl-redirect working.
```

Log in at `https://argocd.k3s.linsnotes.com` with a padlock. Your GitOps controller's password no longer travels your home network as readable text.

### Where you would do this differently

TLS now stops at ingress-nginx. Between ingress-nginx and the `argocd-server` pod, traffic is plain HTTP across the cluster network, which in this lab is a flannel vxlan tunnel between LXD containers on one machine.

For a home lab that is fine. In a regulated environment, or on a cluster where you do not trust every workload sharing the network, you would want that last hop encrypted too. Two ways:

- **Let Argo CD serve TLS again.** Remove `server.insecure`, and tell ingress-nginx to speak HTTPS to the backend with `nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"`. Argo CD's own self-signed certificate is fine for that hop, because ingress-nginx is not verifying a public name.
- **Put a service mesh in.** Istio or Linkerd encrypt every pod to pod connection with certificates they manage, without any application knowing. That is the real answer at scale, and a much bigger commitment than one annotation.

Naming the tradeoff is the point. `server.insecure` behind a real certificate is a normal, defensible arrangement, not something to be quietly embarrassed about, as long as you can say where its edge is.

---

## Step 6 — Break it on purpose

Every part of this series ends by taking something away. Part 3 killed a master, Part 4 killed a worker, Part 5 killed the node holding the load balancer address, Part 6 deleted something Argo CD was managing. Here you delete a certificate and find out whether anything is watching.

### 6a. Delete a TLS Secret and watch it come back

**Do this on a CA-issued certificate, not the Let's Encrypt one, and the reason matters.** Deleting the `whoami-tls` Secret would trigger a real ACME order against production, which counts against the "5 certificates for the same set of names per week" limit. Do that four more times out of curiosity and you are locked out until the window rolls. The `lab-ca` issuer has no such limit, costs nothing, and demonstrates exactly the same mechanism.

Add `infra/cert-manager-config/selftest-cert.yaml`, a certificate attached to nothing:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: selftest
  namespace: cert-manager
spec:
  secretName: selftest-tls
  commonName: selftest.k3s.linsnotes.com
  dnsNames:
  - selftest.k3s.linsnotes.com
  issuerRef:
    name: lab-ca                  # your own CA. Free, instant, no limits.
    kind: ClusterIssuer
```

```bash
git add infra/cert-manager-config/selftest-cert.yaml
git commit -m "Add a throwaway certificate for the renewal experiment"
git push
```

```bash
kubectl get certificate -n cert-manager selftest
# Expect: READY True.

kubectl get secret -n cert-manager selftest-tls -o jsonpath='{.metadata.uid}'; echo
# Note this UID. It identifies this exact Secret object.
```

Now destroy it:

```bash
kubectl delete secret -n cert-manager selftest-tls

kubectl get secret -n cert-manager selftest-tls
# Run this immediately. You may catch a "not found", or the Secret may
# already be back. Either is correct.

sleep 5
kubectl get secret -n cert-manager selftest-tls -o jsonpath='{.metadata.uid}'; echo
# Expect: a DIFFERENT UID from before. Not restored. Reissued.
```

**Nobody did anything.** cert-manager watches the Secret named by every `Certificate` it manages. The Secret vanished, so the `Certificate` no longer matched what was asked for, and cert-manager closed the gap by issuing again. Same reconciliation loop as Kubernetes replacing a deleted pod, and the same one Argo CD used in Part 6 to put back the thing you deleted.

Note also that Argo CD was not involved. The `Certificate` object is in Git and Argo CD watches it. The Secret is not in Git and never was, and Argo CD does not care about it. **The Secret is output, not configuration**, which is exactly why it is safe to have a public repository describing a cluster full of private keys.

Watch the paperwork it generated:

```bash
kubectl get certificaterequest -n cert-manager
# Expect: at least two for selftest. One per issuance, kept as a record.
```

### 6b. Find out when it renews, without guessing

The renewal question is the one people actually worry about, and the answer is boring in the best way.

```bash
kubectl get certificate -A -o custom-columns="NS:.metadata.namespace,\
NAME:.metadata.name,\
EXPIRES:.status.notAfter,\
RENEWS:.status.renewalTime"
# Expect: one row per certificate, with two timestamps on each.
```

That prints, for every certificate in the cluster, when it expires and when cert-manager intends to renew it. `-o wide` shows some of this too, but the columns it includes have changed between versions, so the explicit form above is the one that will still work next year.

For a Let's Encrypt certificate you should see roughly 90 days to expiry and roughly 60 days to renewal. That gap is the default: **cert-manager renews at two thirds of the certificate's lifetime**, which for a 90 day certificate means about 30 days of margin. Thirty days is a lot of room to notice something is wrong, which is the whole reason the default is not "the day before."

You can change it per certificate with `renewBefore`:

```yaml
spec:
  renewBefore: 720h        # renew when 30 days remain, stated explicitly
```

But the important thing is what you do not have to do. There is no cron job, no calendar reminder, no script. cert-manager checks continuously and acts when the time comes, and if it fails it retries with a backoff. The reason the 30 day margin exists is that if the Cloudflare token gets revoked in month two, you have a month of failing renewals to notice before anything actually breaks.

### 6c. Actually see a renewal happen, without waiting 60 days

You cannot make time pass, and any demonstration that claims to is faking it. But you can issue a certificate that is deliberately short-lived, and then watch a real, time-triggered renewal in about five minutes.

Change `infra/cert-manager-config/selftest-cert.yaml` to add two lines:

```yaml
spec:
  secretName: selftest-tls
  duration: 1h                  # the shortest cert-manager will accept
  renewBefore: 55m              # so renewal is due 5 minutes after issuance
  commonName: selftest.k3s.linsnotes.com
  dnsNames:
  - selftest.k3s.linsnotes.com
  issuerRef:
    name: lab-ca
    kind: ClusterIssuer
```

```bash
git add infra/cert-manager-config/selftest-cert.yaml
git commit -m "Make the selftest certificate short-lived to watch a renewal"
git push
```

Once Argo CD syncs it, check the schedule and then leave it:

```bash
kubectl get certificate -n cert-manager selftest -o custom-columns=\
'NAME:.metadata.name,EXPIRES:.status.notAfter,RENEWS:.status.renewalTime'
# Expect: EXPIRES about an hour out, RENEWS about five minutes out.

kubectl get certificaterequest -n cert-manager -w
# Leave this running. Within about five minutes a new CertificateRequest
# appears on its own. Ctrl-C once you have seen it.
```

That is a genuine renewal, driven by the clock, with nothing deleted and nothing forced. The only thing that is artificial is the lifetime, and shortening the lifetime is the honest way to compress the experiment rather than fake it.

> **The official way to force a renewal on demand is `cmctl renew <name>`**, a small command line tool cert-manager ships alongside the controller. It sets a condition on the `Certificate` that makes the controller reissue immediately, without deleting anything. Install instructions are in the cert-manager documentation, and they change between releases, so check there rather than trusting a URL from a blog post. It is worth having on a real cluster. It is not worth installing here, because deleting the Secret does the same job for a lab and you have already seen that work.
{: .prompt-info }

Put the certificate back to normal before you finish, or you will have a renewal every hour forever:

```bash
git rm infra/cert-manager-config/selftest-cert.yaml
git commit -m "Remove the throwaway renewal test certificate"
git push
```

```bash
kubectl get certificate -n cert-manager
# Expect: only lab-root-ca. Argo CD pruned selftest, because prune: true
# means removing a file removes the object. Part 6, still working.

kubectl get secret -n cert-manager selftest-tls
# Expect: STILL THERE. Read the note below, then remove it by hand:
kubectl delete secret -n cert-manager selftest-tls
```

> **Deleting a `Certificate` does not delete its Secret, and that surprises people.** By default cert-manager leaves the Secret behind, so removing a `Certificate` by accident does not instantly take your site down. The Secret is orphaned, not destroyed, and you clean it up yourself. There is a controller flag, `--enable-certificate-owner-ref`, that changes this and makes the Secret go with the Certificate, and it is off by default for exactly the reason above. Worth knowing before you go hunting for where all these leftover TLS Secrets came from.
{: .prompt-info }

---

## Step 7 — Clean up and save a restore point

Nothing here needs undoing. Every object you created is either infrastructure the next part uses or already pruned by Argo CD.

Check the state you are leaving:

```bash
kubectl get clusterissuer
# Expect four: selfsigned, lab-ca, letsencrypt-staging, letsencrypt-prod.
# Keeping staging is deliberate: it is where you test the next new hostname.

kubectl get certificate -A
# Expect: lab-root-ca in cert-manager, whoami-tls in default,
# argocd-tls in argocd. No selftest.

kubectl get applications -n argocd
# Expect: all Synced and Healthy, including cert-manager and
# cert-manager-config.

kubectl get challenge,order -A
# Expect: No resources found. Nothing in flight.
```

Snapshot all five, stopped and together, exactly as Parts 3 to 6 taught:

```bash
for n in worker1 worker2 master1 master2 master3; do lxc stop "$n"; done
for n in master1 master2 master3 worker1 worker2; do
  lxc snapshot "$n" post-tls
done
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 45

kubectl get nodes                              # expect: five Ready
kubectl get pods -n cert-manager               # expect: three Running
curl --max-time 5 -sI https://whoami.k3s.linsnotes.com | head -1
# Expect: HTTP/2 200. The certificate survived the restart, because it lives
# in a Secret in etcd, which is part of the snapshot.
```

### What this snapshot does and does not hold

This one is worth reading carefully, because it holds something the earlier snapshots did not.

**Inside the snapshot**, because it is all in etcd on the masters:

- cert-manager, its CRDs, all four `ClusterIssuer` objects.
- Every issued certificate and its private key.
- **The Cloudflare API token.** The Secret is a cluster object like any other, so it is captured. Your `post-tls` snapshot now contains a live credential for your DNS. That is not a problem, but it means the snapshot is no longer just a machine image, and if you ever copy it off this machine you are copying a working token with it. If you revoke the token in Cloudflare later, restoring this snapshot brings back a token string that no longer works, and you will get authentication errors from a Secret that looks perfectly fine.

**Outside the snapshot**, and unchanged by any restore:

| Thing | Where it lives |
|---|---|
| The token's existence at Cloudflare | Cloudflare's side. Revoking it there is not undone by a restore. |
| The GitHub repository | GitHub. Rolling nodes back does not roll back your commits, and Argo CD will re-sync forward to whatever Git says. |
| `/etc/hosts` on the host and your laptop | Host and network state, same as Parts 5 and 6. |
| The CA certificate in `/usr/local/share/ca-certificates/` | The host's trust store. It stays trusted after any node restore, which is what you want. |

That last row has an edge worth knowing. If you ever delete the `lab-root-ca` Secret, cert-manager generates a **new** CA with a new key, and the certificate sitting in your host's trust store will no longer match. Everything signed by the new CA will be rejected until you repeat the copy from Step 3. It looks like trust randomly stopped working, and the cause is that the CA quietly became a different CA.

---

## Where you should be

| Thing | State |
|---|---|
| cert-manager | Installed through Argo CD from a pinned Helm chart, CRDs included, three pods Running |
| Issuers | `selfsigned`, `lab-ca`, `letsencrypt-staging`, `letsencrypt-prod`, all Ready |
| Own CA | Root in `cert-manager/lab-root-ca`, also installed in the host's trust store |
| Challenge type | DNS-01 through Cloudflare, using a scoped `Zone:DNS:Edit` plus `Zone:Zone:Read` token |
| whoami | `https://whoami.k3s.linsnotes.com`, publicly trusted, no browser warning |
| Argo CD | `https://argocd.k3s.linsnotes.com`, TLS terminated at the Ingress |
| The Cloudflare token | A hand-created Secret in `cert-manager`, deliberately not in Git |
| Renewal | Automatic at two thirds of lifetime, seen happening on a short-lived certificate |
| Snapshots | `post-tls` on all five, taken stopped and together |

### Things worth carrying forward

- **HTTP-01 needs to be reachable from the internet. DNS-01 does not.** That single difference is why a lab on a private address behind NAT can hold a genuinely trusted certificate. If a guide tells you that you need port 80 open to get a certificate, it is assuming HTTP-01.
- **Trust is not a property of a certificate. It is a property of the reader.** The same certificate that `curl` rejected was accepted after you copied one file into `/usr/local/share/ca-certificates/`. Nothing about the certificate changed.
- **Use Let's Encrypt staging until it works, then change one line.** The limits are 50 certificates per domain and 5 per identical name set, per week, and there is nobody to appeal to. A staging certificate that a browser rejects is a successful staging run.
- **A `ClusterIssuer` reads its Secrets from the `cert-manager` namespace, not from the namespace you are working in.** This is the single most common reason an issuer sits Ready False with a Secret plainly visible somewhere else.
- **Certificates are output, not configuration.** The `Certificate` object belongs in Git. The Secret it produces does not, which is what makes a public GitOps repository safe. Delete the Secret and it is reissued, not restored.
- **Real credentials need Sealed Secrets, External Secrets or SOPS.** Creating the Cloudflare token by hand leaves a gap between what Git describes and what the cluster runs. Know the gap is there and know the three ways to close it.
- **Renewal is automatic at two thirds of lifetime, with about 30 days of margin on a Let's Encrypt certificate.** The margin exists so that a month of failing renewals is visible before anything breaks. It is not something you will have to remember.

### What Part 8 does

You now have a cluster that stands up, heals, stores data, routes traffic, deploys itself from Git, and serves real HTTPS. There is one thing it still cannot do: tell you how it is.

Right now, every question about the lab is answered by running a command and looking. How much memory is master2 actually using? Which pod restarted at three in the morning? Is that certificate renewal quietly failing? You would only find out by checking, and you only check when you already suspect something.

Part 8 fixes that. You install **Prometheus** to collect measurements from every node, every pod, and the control plane itself, and **Grafana** to draw them. Both go in through Argo CD, because that is how everything goes in now. Then, in the series' usual style, you break something and watch a graph notice before you do.

cert-manager exports metrics about certificate expiry, so one of the first useful alerts you will build is the one that would have caught a renewal failing while you had 30 days of margin left.

Continue with [**Part 8, Monitoring with Prometheus and Grafana**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-8-monitoring-with-prometheus-and-grafana/).
