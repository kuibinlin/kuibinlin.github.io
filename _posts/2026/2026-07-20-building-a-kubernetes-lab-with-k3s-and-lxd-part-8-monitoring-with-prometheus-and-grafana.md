---
layout: post
title: Building a Kubernetes Lab with k3s and LXD Part 8 Monitoring with Prometheus and Grafana
description: Install kube-prometheus-stack through Argo CD, put Grafana behind HTTPS, read the numbers that matter for this lab, then stop a node and watch an alert fire.
date: 2026-07-20 08:00:00 +0800
published: true
categories: [kubernetes]
tags: [k3s, kubernetes, lxd, ubuntu, prometheus, grafana, monitoring, observability]
toc: true
media_subpath: /assets/media/2026/kubernetes-lab-with-k3s-and-lxd-part-8-monitoring-with-prometheus-and-grafana
image: kubernetes-lab-part8.webp
---

This is **Part 8** of a series on building a Kubernetes lab with k3s and LXD, and it is the last part of this arc. If you are just arriving, start at the beginning: [**Part 1, Preparing the Ubuntu Host**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-1-preparing-the-ubuntu-host/), [**Part 2, Building the Five Nodes**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-2-building-the-five-nodes/), [**Part 3, Installing k3s**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-3-installing-k3s/), [**Part 4, Adding Persistent Storage**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-4-adding-persistent-storage/), [**Part 5, Exposing Applications**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-5-exposing-applications/), [**Part 6, GitOps with Argo CD**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-6-gitops-with-argo-cd/), and [**Part 7, Securing with TLS and cert-manager**](/posts/building-a-kubernetes-lab-with-k3s-and-lxd-part-7-securing-with-tls-and-cert-manager/).

**Where you are.** You have a five node cluster that heals when a master dies, keeps data when a worker dies, exposes applications by hostname through ingress-nginx on a MetalLB address, deploys itself from a Git repository through Argo CD, and serves real, trusted HTTPS certificates from Let's Encrypt. Argo CD itself is at `https://argocd.k3s.linsnotes.com` with a certificate a browser is happy with.

There is one thing missing, and it is the thing you would need first on any real platform: **you cannot see what your cluster is doing.**

**What this part does.** It installs Prometheus, Grafana, Alertmanager and their friends, through the Git repository from Part 6, puts Grafana behind HTTPS using the ClusterIssuer from Part 7, then teaches you to read the numbers that actually matter for this particular lab. Finally it stops a node and makes an alert fire, so you see the whole chain from a machine going away to a red box on a screen.

**The main point, in one line.** Kubernetes tells you a pod is `Running`. It does not tell you whether that pod is healthy, slow, or about to be killed for using too much memory, and monitoring is the thing that closes that gap.

**What this part does not do.** It does not collect logs. Metrics and logs are different problems with different tools (Loki, or Elasticsearch, or something else), and mixing them in would double the length of this part and halve the clarity. It also does not send alerts anywhere real. Alertmanager will be running and you will watch an alert reach it, but wiring up email or Slack is configuration, not understanding.

**What you need before starting.** The `post-tls` snapshot from Part 7, all five nodes Ready, Argo CD healthy, cert-manager running, and **at least 4 GB of free memory on the host**. Step 1 checks all of it, and the memory point is not decoration. Read the first of the three things below before you install anything.

---

## Words you'll need

These build on Parts 2 to 7. Here are the new ones.

| Word | What it means |
|---|---|
| **metric** | One number that describes one thing at one moment. "This node is using 3.1 GB of memory." That is a metric. |
| **time series** | The same metric, recorded over and over, with a timestamp on each reading. A metric is a number; a time series is that number's history. Prometheus stores time series, which is why it can draw graphs and you cannot get a graph out of `kubectl`. |
| **label** | A name and value attached to a time series to say which thing it describes, for example `node="worker1"`. One metric name plus different labels is many separate time series. |
| **scrape** | How Prometheus collects. It asks each target for its current numbers over HTTP, every so often (15 or 30 seconds is typical), and stores the answer. Nothing pushes to Prometheus; Prometheus pulls. |
| **exporter** | A small program that turns something's internal state into numbers Prometheus can scrape. If a thing does not speak Prometheus itself, you put an exporter in front of it. |
| **node-exporter** | The exporter for a machine. Memory, CPU, disk, network, uptime. One copy runs on every node. |
| **kube-state-metrics** | An exporter for *Kubernetes objects*, not machines. How many pods exist, which are Ready, what each one asked for, how many replicas a Deployment wants versus has. It reads the API server and turns the answers into metrics. |
| **PromQL** | The query language you type into Prometheus or Grafana to ask a question of your time series. |
| **CRD** | Custom Resource Definition. A way to teach Kubernetes a brand new kind of object, so that `kubectl get <newthing>` works as if it had always been built in. Part 5's MetalLB `IPAddressPool` and Part 7's `ClusterIssuer` were both CRDs. |
| **Operator** | A program that runs inside the cluster, watches for custom objects, and does the real work of setting them up. You describe what you want in an object; the Operator makes it exist and keeps it that way. |
| **ServiceMonitor** | A custom object that means "scrape the pods behind this Service." You write one of these instead of editing a Prometheus config file, and the Prometheus Operator rewrites the config for you. |
| **Alertmanager** | The program that receives alerts from Prometheus, groups them, silences the ones you asked it to, and sends them somewhere. Prometheus decides *whether* something is wrong; Alertmanager decides *who hears about it*. |
| **alert rule** | A PromQL query plus a condition plus a waiting period. If the query stays true for that long, the alert fires. |
| **dashboard** | A saved page of graphs in Grafana. The queries are already written; you just pick the cluster or node you want to look at. |
| **retention** | How long Prometheus keeps its history before deleting the old data. Longer history costs disk. |
| **cardinality** | How many separate time series you have. One metric with a label that takes 100,000 different values is 100,000 time series, and that is how people accidentally run Prometheus out of memory. |

---

## Three things to know before you start

### 1. This is the first part that can genuinely run your host out of memory

Every previous part added something small. This one adds a real workload, and it is worth doing the arithmetic before you install rather than after.

Here is what you have. From Part 2's Step 5.3, on a 32 GB host:

| Nodes | Each | Total |
|---|---|---|
| master1, master2, master3 | 4 GiB | 12 GiB |
| worker1, worker2 | 6 GiB | 12 GiB |
| | | **24 GiB schedulable** |

That leaves about 8 GB for the host itself, which also has to feed the ZFS cache.

Here is roughly what kube-prometheus-stack wants, on a five node cluster with nothing much running on it. These are rough shapes rather than promises, because the real numbers depend on how many time series you end up with:

| Piece | Rough memory |
|---|---|
| Prometheus | 1 to 2 GiB |
| Grafana | 150 to 300 MiB |
| Alertmanager | 50 to 150 MiB |
| Prometheus Operator | 50 to 150 MiB |
| kube-state-metrics | 40 to 150 MiB |
| node-exporter, five copies | about 150 MiB in total |
| | **roughly 1.5 to 3 GiB** |

Two to three gigabytes out of twenty four is comfortable. **It is comfortable only because your masters are not tainted.** Part 3's Step 6 offered you an optional taint that stops ordinary workloads landing on the three masters, and said plainly that taking it cuts your schedulable nodes from five to two. In memory terms, taking that taint drops you from 24 GiB to 12 GiB, and now a stack that wants up to 3 GiB is a quarter of everything you have.

> **If you took Part 3's optional master taint, read this before you install.** Prometheus is the single biggest thing you have ever asked this cluster to run. With only the two workers schedulable, install it with explicit limits and a shorter history, or it will be the thing that teaches you what an out of memory kill looks like. The trimmed values are in Step 3.
{: .prompt-warning }

Even with untainted masters, do two things. Give Prometheus an explicit memory **request** so the scheduler knows to reserve room for it, and give it an explicit **limit** so a runaway query cannot eat a whole node. A pod with no request looks free to the scheduler, which is how you overbook a node that then kills something at random.

### 2. Prometheus must not store its data on NFS

This is the most important sentence in Part 8, and it directly reuses Part 4.

Prometheus' own storage documentation says its local storage is not compatible with non-POSIX filesystems, and names NFS specifically as not supported, because many NFS implementations do not do file locking properly and there is no reliable way to detect that from inside Prometheus. The failure mode is not a clean error. It is database corruption.

So Part 4 gave you two StorageClasses, and for once the network one is the wrong answer:

| StorageClass | From | Use it for Prometheus? |
|---|---|---|
| `nfs-client` | Part 4, Step 6 | **No.** Network filesystem, not supported, can corrupt the database. |
| `local-path` | k3s built in, Part 4 Step 2 | **Yes.** A real directory on a real node's real disk. |

Now be honest about what that costs, because Part 4 spent an entire step on exactly this weakness. `local-path` is node-locked. The PersistentVolume it creates has a node affinity rule pinning it to one machine, and any pod that wants it can only run on that machine. So:

- **Your Prometheus pod is now pinned to one node.** It cannot move.
- **If that node dies, Prometheus stays `Pending` until the node comes back**, exactly like `reader2` did in Part 4's Step 3.
- **If that node is destroyed, the history is gone.**

That is a real trade, not a technicality, and it is the correct trade here. Losing a week of lab metrics is annoying. A silently corrupted metrics database that reports plausible but wrong numbers is much worse, because you will believe it. The production answer is the one Part 4 already named at the end: replicated block storage such as Longhorn, which gives you a POSIX filesystem that survives a node dying. You do not have that, so you accept a pinned Prometheus and you know why.

Remember this in Step 6, when you stop a node on purpose. **Check which node Prometheus landed on first, and stop a different one**, or your monitoring goes down at exactly the moment you wanted to watch it work.

### 3. `Running` does not mean healthy, and that gap is the whole point

Part 4 made the same shape of argument about data: "the pod is Running" and "the data is safe" are two separate claims, and Kubernetes reports the first loudly while saying nothing about the second.

Monitoring is that argument again, aimed at behaviour instead of storage. `kubectl get pods` shows `Running`, and `Running` only means the container's main process has not exited. It says nothing about whether:

- the program is answering requests, or answering them slowly
- it is at 95 percent of its memory limit and one request away from being killed
- it has restarted eleven times in the last hour and happens to be up right now
- the node underneath it is out of disk
- it has been quietly failing one request in twenty for three days

None of that is visible in `kubectl`. All of it is visible in a graph. That is what you are installing.

---

## Step 1 — Check Part 7 is still good

**Why:** the same reason as every part. If something drifted, find out now, while a fault still looks like itself.

**Safe to run:** everything here only reads.

```bash
lxc info | head -3        # wakes LXD if it's asleep, same trick as before
sleep 3
lxc list                  # expect five RUNNING rows, plus the STOPPED template

kubectl get nodes
# Expect: five Ready.

kubectl get storageclass
# Expect two: local-path (default) and nfs-client. You want local-path today.

kubectl get pods -n ingress-nginx
# Expect: one controller pod, Running. This is Part 5's front door.

kubectl get pods -n cert-manager
# Expect: three pods Running (controller, webhook, cainjector). Part 7's work.

kubectl get clusterissuer
# Expect: your self-signed CA issuer and your Let's Encrypt production issuer,
# both READY True. Note the exact NAME of the Let's Encrypt one; you need it
# in Step 4. This guide calls it letsencrypt-prod.
```

Now check Argo CD, because everything in this part goes through it:

```bash
kubectl get pods -n argocd
# Expect: all Running.

kubectl get applications -n argocd
# Expect: your existing Applications, every one Synced and Healthy.
```

**If anything is already `OutOfSync` or `Degraded`, fix that before adding a ninth thing on top.** An Application that was unhappy before you started will look like it was caused by monitoring, and you will spend an hour on the wrong problem.

Finally, prove HTTPS still works end to end, which is the one check that exercises Parts 5, 6 and 7 in a single line:

```bash
curl --max-time 10 -sI https://argocd.k3s.linsnotes.com | head -1
# Expect: HTTP/2 200. No -k flag, no certificate warning. If this needs -k,
# your certificate is not trusted and Step 4 will inherit that problem.
```

And check the host has room, since Step 3 is the first thing in this series that can genuinely fill it:

```bash
free -h
# Expect: several GB available. If the host is already close to full, shrink
# something before installing, not after.

sudo zpool list default
df -h /
```

---

## Step 2 — Understand what you are about to install, before you install it

`kube-prometheus-stack` is a Helm chart, but calling it "a chart" undersells it. It is a **bundle** of six separate programs plus a large pile of pre-written alert rules and Grafana dashboards, wired together so they find each other. Installing the pieces one at a time is a genuinely miserable afternoon, which is why this bundle exists and why almost everyone uses it.

Here is every piece and what it does. Read this table before you run anything, because in Step 5 you will be querying numbers and it matters that you know which program produced them.

| Piece | What it is | What it does here |
|---|---|---|
| **Prometheus Operator** | A controller | Watches for `Prometheus`, `Alertmanager` and `ServiceMonitor` objects and builds the real configuration from them. You never edit a Prometheus config file by hand. |
| **Prometheus** | The metrics database | Scrapes every target every 30 seconds, stores the history, evaluates alert rules. This is the piece that needs memory and disk. |
| **Alertmanager** | The notifier | Receives firing alerts from Prometheus, groups related ones, applies silences, and would send them onward if you configured a destination. |
| **Grafana** | The screen | Draws graphs from Prometheus. Ships with dozens of ready-made Kubernetes dashboards so you do not start from a blank page. |
| **node-exporter** | A DaemonSet | One pod per node, reporting that machine's memory, CPU, disk and network. Machine level, not Kubernetes level. |
| **kube-state-metrics** | A Deployment | Reads the Kubernetes API and reports the state of *objects*: how many pods, which are Ready, what each asked for. Kubernetes level, not machine level. |

**The last two are the pair people mix up, and the difference is worth ten seconds now.** `node-exporter` answers "how much memory is worker1 using?" `kube-state-metrics` answers "how many pods on worker1 are in `CrashLoopBackOff`?" One looks at the machine, one looks at Kubernetes' records of the machine. You need both, and in Step 5 you will use both.

### The Operator pattern, and why `ServiceMonitor` makes everything else make sense

Plain Prometheus is configured with a YAML file listing what to scrape. That works fine when your targets are fixed servers. It works badly in Kubernetes, where pods appear and disappear constantly and nobody wants to edit a config file each time.

The Operator pattern solves this by turning configuration into objects:

```
You create:              A ServiceMonitor object saying
                         "scrape the pods behind Service X, on port Y, every 30s"
                                      |
The Prometheus Operator: notices it, regenerates Prometheus' real config,
                         and reloads Prometheus
                                      |
Prometheus:              starts scraping. You never touched a config file.
```

That single indirection is why the whole stack is manageable. When you install something new later, you do not reconfigure Prometheus. You ship a `ServiceMonitor` next to your application, and monitoring turns itself on. Most well-behaved Helm charts have a `serviceMonitor.enabled` value that does exactly that.

`ServiceMonitor` is a **CRD**, the same mechanism as Part 5's `IPAddressPool` and Part 7's `ClusterIssuer`. By now you have met this pattern three times, which is the point: a Kubernetes platform is mostly Operators watching custom objects.

---

## Step 3 — Install it through Git, not through Helm

Part 6 turned deployment into a Git problem, and turned on automated sync with `selfHeal: true` and `prune: true`. That decision has a consequence you need to respect from here on:

> **Do not run `helm install` for this.** With self-heal on, anything you create by hand that Argo CD does not know about is unmanaged, and anything you edit by hand inside a managed Application gets reverted within minutes. This is Part 6 working correctly, not Argo CD being difficult. The repository is the only way in now.
{: .prompt-warning }

So the install is: write one file, commit it, push it, and watch.

### 3a. Pick a chart version, and do not trust this page for it

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm search repo prometheus-community/kube-prometheus-stack --versions | head -5
# Shows the newest chart versions available right now.
```

This guide was written against chart version **87.17.0**. That number will be out of date by the time you read it. Use whatever the command above shows you, and pin it explicitly in the Application rather than tracking whatever is newest, so that a chart release six months from now cannot change your cluster while you are not looking. This is the same reasoning Part 5 gave for the MetalLB manifest URL.

While you are here, look at the values file, because you are about to set eight of its keys and there are several thousand:

```bash
helm show values prometheus-community/kube-prometheus-stack --version 87.17.0 > /tmp/kps-values.yaml
wc -l /tmp/kps-values.yaml
# Expect: several thousand lines. This is the file to grep when a key name
# in this post does not match your chart version.
```

That file is the honest answer to any "is this key still called that?" question. Chart values do get renamed between major versions, and grepping the real file beats trusting a blog post, including this one.

### 3b. The k3s problem nobody warns you about

Before you write the values, know what you are about to see, because otherwise you will think you broke something.

On a normal Kubernetes cluster built with kubeadm, the control plane is four separate programs running as four separate pods: `kube-apiserver`, `kube-controller-manager`, `kube-scheduler` and `kube-proxy`, plus `etcd`. The chart ships scrape configuration for all of them, because on a kubeadm cluster they are all there and all reachable.

**k3s does not work that way.** k3s runs the control plane inside a single process, as Part 3's Step 8 already told you when it explained that k3s embeds etcd rather than running it as a pod. There are no `kube-controller-manager` pods to find. There are no `kube-scheduler` pods to find. The metrics for those components do exist, but they are served by the one k3s process, and by default they are bound to `127.0.0.1`, which means nothing outside that node can scrape them.

So if you install the chart with its defaults, you get this:

| Component | What the chart expects | What k3s gives you |
|---|---|---|
| kube-apiserver | Reachable via the `kubernetes` Service | Works. Scrapes fine. |
| kubelet and cAdvisor | Port 10250 on every node | Works. Scrapes fine. This is where your container metrics come from. |
| kube-controller-manager | A pod labelled `component=kube-controller-manager` | No such pod. Metrics on `127.0.0.1:10257`. |
| kube-scheduler | A pod labelled `component=kube-scheduler` | No such pod. Metrics on `127.0.0.1:10259`. |
| kube-proxy | A pod labelled `k8s-app=kube-proxy` | Embedded. Metrics on `127.0.0.1:10249`. |
| etcd | A pod labelled `component=etcd` | Embedded in k3s. Metrics off by default. |

The visible result is scrape jobs with no targets, or targets that will not connect, and a handful of alerts firing with names like `KubeControllerManagerDown`, `KubeSchedulerDown`, `KubeProxyDown` and `etcdMembersDown`.

**Nothing is broken.** This is Part 2's "suspect the check before you suspect your machine" in its most expensive form yet, because here the check is not one command, it is a whole set of alert rules written for a cluster shaped differently from yours.

You have two honest options.

**Option A, turn those scrape jobs and their alert rules off.** This is what this guide does. It is the right default for a lab, because scheduler and controller-manager internals are not what you are here to learn, and an alert that fires forever trains you to ignore alerts, which is worse than having none.

**Option B, expose the metrics properly.** k3s can bind those endpoints to all addresses instead of just localhost, and can expose etcd's metrics. You would add flags to `/etc/rancher/k3s/config.yaml` on the three masters, the same file Part 5 used to disable ServiceLB and Traefik. Remember Part 5's warning: **rewrite that file whole, never append a second `disable:` key**, or k3s will refuse to start on invalid YAML.

```bash
# OPTION B ONLY. Skip this if you are taking Option A.
# Rewrite the file whole, keeping the disable list from Part 5.
for n in master1 master2 master3; do
  lxc exec "$n" -- bash -c 'mkdir -p /etc/rancher/k3s && cat > /etc/rancher/k3s/config.yaml <<EOF
disable:
  - servicelb
  - traefik
etcd-expose-metrics: true
kube-controller-manager-arg:
  - "bind-address=0.0.0.0"
kube-scheduler-arg:
  - "bind-address=0.0.0.0"
kube-proxy-arg:
  - "metrics-bind-address=0.0.0.0"
EOF'
done

# Restart one at a time, waiting for each, so quorum is never at risk.
for n in master1 master2 master3; do
  echo "== restarting k3s on $n"
  lxc exec "$n" -- systemctl restart k3s
  sleep 30
  kubectl get nodes
done
```

Two things to be clear about with Option B. First, `bind-address=0.0.0.0` on a lab network behind your own host is fine, and on anything real it is a decision you would think much harder about, because you have just made internal control plane metrics reachable from anywhere that can route to the node. Second, even with the metrics exposed, you still have to tell the chart where to find them, because the default scrape configuration looks for pods that do not exist on k3s. You would set the `endpoints` list under each component to your three master addresses. That is more moving parts than a lab needs, which is why the rest of this guide takes Option A.

### 3c. Write the Argo CD Application

Part 6 set up the repository with `apps/` for Argo CD `Application` manifests and `infra/<component>/` for the things they point at. This install is a Helm chart from a public chart repository rather than files in your Git repo, so the whole thing fits in one Application file with the values inline.

In your clone of `kuibinlin/k3s-lab-gitops`, create `apps/kube-prometheus-stack.yaml`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: kube-prometheus-stack
  namespace: argocd
spec:
  project: default

  source:
    repoURL: https://prometheus-community.github.io/helm-charts
    chart: kube-prometheus-stack
    targetRevision: 87.17.0        # pin it. Check the current release yourself.
    helm:
      values: |
        # ------------------------------------------------------------
        # k3s: these control plane components are not separate pods, so
        # the chart's default scrape jobs find nothing and their alert
        # rules fire forever. Turn off both the scraping and the rules.
        # See Step 3b for why. This is not a workaround for a fault.
        # ------------------------------------------------------------
        kubeControllerManager:
          enabled: false
        kubeScheduler:
          enabled: false
        kubeProxy:
          enabled: false
        kubeEtcd:
          enabled: false

        defaultRules:
          rules:
            kubeControllerManager: false
            kubeSchedulerAlerting: false
            kubeSchedulerRecording: false
            kubeProxy: false
            etcd: false

        # ------------------------------------------------------------
        # Prometheus. Storage is local-path ON PURPOSE, never nfs-client.
        # See "Three things to know", point 2.
        # ------------------------------------------------------------
        prometheus:
          prometheusSpec:
            retention: 7d
            retentionSize: 15GB
            resources:
              requests:
                memory: 1Gi
                cpu: 200m
              limits:
                memory: 2Gi
            storageSpec:
              volumeClaimTemplate:
                spec:
                  storageClassName: local-path
                  accessModes: ["ReadWriteOnce"]
                  resources:
                    requests:
                      storage: 20Gi

        # ------------------------------------------------------------
        # Alertmanager. Deliberately NOT persisted: in this lab it holds
        # only silences and notification state, and losing those on a
        # restart costs nothing. Persist it later if that stops being true.
        # ------------------------------------------------------------
        alertmanager:
          alertmanagerSpec:
            resources:
              requests:
                memory: 100Mi
                cpu: 50m
              limits:
                memory: 256Mi

        # ------------------------------------------------------------
        # Grafana. Ingress is Step 4; the two TLS lines are all it takes,
        # because Part 7 already did the hard part.
        # ------------------------------------------------------------
        grafana:
          persistence:
            enabled: true
            type: pvc
            storageClassName: local-path
            accessModes: ["ReadWriteOnce"]
            size: 5Gi
          resources:
            requests:
              memory: 200Mi
              cpu: 100m
            limits:
              memory: 512Mi
          ingress:
            enabled: true
            ingressClassName: nginx
            annotations:
              cert-manager.io/cluster-issuer: letsencrypt-prod
            hosts:
              - grafana.k3s.linsnotes.com
            path: /
            pathType: Prefix
            tls:
              - secretName: grafana-tls
                hosts:
                  - grafana.k3s.linsnotes.com

        kube-state-metrics:
          resources:
            requests:
              memory: 64Mi
              cpu: 20m
            limits:
              memory: 256Mi

        prometheus-node-exporter:
          resources:
            requests:
              memory: 32Mi
              cpu: 20m
            limits:
              memory: 128Mi

  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring

  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true      # REQUIRED. See 3d.
```

Then, the Part 6 way:

```bash
git add apps/kube-prometheus-stack.yaml
git commit -m "Add kube-prometheus-stack"
git push
```

That is the whole install. Nothing else runs on your machine.

### 3d. `ServerSideApply=true` is not optional here, and here is why

The Prometheus Operator's CRDs are enormous. The `Prometheus` CRD alone is several hundred kilobytes of YAML, because it describes every field of every option Prometheus has.

Kubernetes' ordinary `kubectl apply` records the full object you applied in an annotation called `last-applied-configuration`, so it can work out later what you changed. Annotations have a hard size limit of 262144 bytes. A 500 KB CRD does not fit in a 256 KB annotation, so the apply fails with a message like:

```
metadata.annotations: Too long: must have at most 262144 bytes
```

**Server side apply does not write that annotation.** The API server tracks field ownership itself, so there is nothing to stuff into an annotation and nothing to overflow. Setting `ServerSideApply=true` in the Application's `syncOptions` is the fix, and it is the reason that line is in the manifest above.

If you meet this error on an Argo CD older than v2.5, which has no server side apply, the older workaround is `Replace=true`. Prefer the newer one if your Argo CD supports it.

### 3e. Watch it arrive

Argo CD polls the repository, so this takes a couple of minutes on its own. Push it along if you are impatient, from the Argo CD UI or the CLI, or just watch:

```bash
kubectl get application -n argocd kube-prometheus-stack
# Expect, after a few minutes: SYNC STATUS Synced, HEALTH STATUS Healthy.

kubectl get pods -n monitoring -w
# Expect, over two to five minutes:
#   prometheus-operator                 Running
#   kube-state-metrics                  Running
#   node-exporter, five of them         Running (one per node)
#   alertmanager-...-0                  Running
#   prometheus-...-0                    Running
#   grafana                             Running
# Ctrl-C when they settle.
```

The two StatefulSet pods, `prometheus-...-0` and `alertmanager-...-0`, take the longest, because Prometheus has to get a volume first. Check that volume, since it is the thing Part 4 taught you to be suspicious of:

```bash
kubectl get pvc -n monitoring
# Expect: two Bound claims, one for Prometheus and one for Grafana,
# both with STORAGECLASS local-path. If either says nfs-client, stop and
# fix the values; see point 2 of "Three things to know".

kubectl get pod -n monitoring -l app.kubernetes.io/name=prometheus -o wide
# Note WHICH NODE this landed on. Write it down. Step 6 needs it, and
# local-path means this pod cannot move off that node.
```

> **`local-path` does not enforce the size you asked for.** The `20Gi` in the values is a request Kubernetes records, but the local-path provisioner just creates a directory on the node's disk; there is no quota behind it. So Prometheus can grow past 20 GB and fill the node. That is what `retentionSize: 15GB` is for: Prometheus policing its own disk use because the storage layer will not. It is a lab-grade answer, and it is honest about being one.
{: .prompt-info }

### If the Application will not go Healthy

Three things account for almost all of it:

- **`Too long: must have at most 262144 bytes`.** You missed `ServerSideApply=true`. Add it, commit, push.
- **Prometheus stuck `Pending`.** Read `kubectl describe pod -n monitoring prometheus-...-0`. Either no node has 1 GiB free (the memory arithmetic from point 1), or the PVC never bound.
- **Permanently `OutOfSync` while everything is Running.** Usually the Operator or an admission webhook writing to a field Argo CD then sees as drift. Use `kubectl get application -n argocd kube-prometheus-stack -o yaml` or the UI's diff view to see which field, then either accept it with an `ignoreDifferences` entry or leave it. A cosmetically OutOfSync app with everything Healthy is not urgent, but do find out which field it is rather than shrugging.

---

## Step 4 — Reach Grafana over HTTPS

This is the shortest step in the whole series, and that is the point of it.

### The two lines that used to be a whole part

Look again at the `grafana.ingress` block from Step 3c. Strip out the hostname and the class, and here is everything that makes it HTTPS:

```yaml
annotations:
  cert-manager.io/cluster-issuer: letsencrypt-prod
tls:
  - secretName: grafana-tls
    hosts:
      - grafana.k3s.linsnotes.com
```

**One annotation and one `tls:` block.** That is it. There is no certificate to request, no key to generate, no file to copy anywhere, and no renewal to remember.

Here is what those five lines set in motion, and it is worth spelling out because it is three parts of this series firing at once:

1. ingress-nginx (Part 5) claims the Ingress and starts listening for the hostname.
2. cert-manager (Part 7) sees the annotation, creates a `Certificate` object, and asks Let's Encrypt for a certificate for `grafana.k3s.linsnotes.com`.
3. Let's Encrypt asks it to prove it controls the name. cert-manager answers with the DNS-01 challenge through Cloudflare, writes a TXT record, waits for it to propagate, and cleans it up afterwards.
4. cert-manager stores the signed certificate in a Secret called `grafana-tls`.
5. ingress-nginx picks up the Secret and serves HTTPS.
6. In about sixty days, cert-manager renews it, and nobody notices.

Parts 5, 6 and 7 each cost you a long afternoon. The whole payoff is that the eighth thing you deploy costs you five lines, and the ninth will too. That is what a platform is: the third application is cheap because the first one was expensive.

### Watch the certificate arrive

```bash
kubectl get certificate -n monitoring
# Expect: grafana-tls, READY True. DNS-01 through Cloudflare usually takes
# one to three minutes because it waits for the TXT record to propagate.
# READY False for the first couple of minutes is normal, not a fault.

kubectl describe certificate -n monitoring grafana-tls | tail -20
# If it is still False after five minutes, the Events at the bottom name the
# reason: a Cloudflare API token problem, or a DNS propagation wait.

kubectl get ingress -n monitoring
# Expect: CLASS nginx, HOSTS grafana.k3s.linsnotes.com, ADDRESS filling in
# with your ingress-nginx address from Part 5, PORTS 80, 443.
```

### Add the name

Same pattern as every hostname since Part 5. Find the ingress-nginx address and add the name to the host's hosts file:

```bash
NGINX_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "ingress-nginx is on $NGINX_IP"

echo "$NGINX_IP  grafana.k3s.linsnotes.com" | sudo tee -a /etc/hosts

curl --max-time 10 -sI https://grafana.k3s.linsnotes.com | head -1
# Expect: HTTP/2 200 or HTTP/2 302. No -k flag. If this needs -k, the
# certificate is not the Let's Encrypt one; check the ClusterIssuer name
# in your annotation matches the one from Step 1.
```

Add the same line to your laptop's hosts file if you did Part 5's Step 5.

### Get in

Grafana's admin password is generated into a Secret. Read it out:

```bash
kubectl get secret -n monitoring kube-prometheus-stack-grafana \
  -o jsonpath='{.data.admin-user}' | base64 -d; echo
# Expect: admin

kubectl get secret -n monitoring kube-prometheus-stack-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d; echo
# Prints the password. Do not print it into a screenshot or a blog post.
```

Some chart versions use a fixed default password rather than a generated one. Reading the Secret works either way, which is why the guide reads it instead of telling you a value.

> **Do not change the password in Grafana's own UI and expect it to stick.** Part 6's `selfHeal: true` is watching. If you want a password you chose, set `grafana.adminPassword` in the values file, or better, point `grafana.admin.existingSecret` at a Secret you created separately so a real credential never sits in a public Git repository. This is the first time in the series where the GitOps decision from Part 6 makes you think about secrets, and the honest answer is that this lab has no secrets management. That gap is named again in the wrap-up.
{: .prompt-warning }

Open `https://grafana.k3s.linsnotes.com` and log in.

### Three dashboards worth opening first

The chart ships a large collection of dashboards under **Dashboards**, and the first look is overwhelming. Open these three, in this order.

**1. `Kubernetes / Compute Resources / Cluster`.** The whole cluster on one page: CPU and memory used against what is available, broken down by namespace. This is the "am I about to run out" screen, and after installing this stack it is the one you should actually check. You will see `monitoring` sitting near the top of the memory list, which is a fair reflection of point 1 of "Three things to know".

**2. `Kubernetes / Compute Resources / Node (Pods)`.** Pick a node from the dropdown and see every pod on it, with its CPU and memory. This is where you find out that master2 is doing more work than you thought, or that one pod is using nine tenths of a node.

**3. `Node Exporter / Nodes`.** The machine level view: memory, CPU, disk, network per node. **Read this one with the suspicion Part 2 taught you**, because your nodes are LXD containers sharing one kernel, and the numbers here may be the host's rather than the node's. There is a check for exactly that in Step 5.

One more, so it is not a surprise: **the `etcd` dashboard will be empty.** That is Step 3b, not a fault. You turned that scrape job off because k3s does not expose those metrics by default. If you took Option B, it may have data.

---

## Step 5 — Read the numbers that matter for THIS lab

Dashboards are somebody else's questions. Writing your own queries is how you ask yours, and this lab has some very specific ones, because a five node cluster inside LXD containers on one host is not the cluster those dashboards were designed for.

Use Grafana's **Explore** page (the compass icon), pick the Prometheus data source, and paste these in one at a time. Everything below only reads.

### 5a. Did Part 2's memory limits actually reach Kubernetes?

Part 2's Step 5.3 set `limits.memory=4GiB` on the masters and `6GiB` on the workers, and warned at length that if those limits do not reach kubelet, Kubernetes will believe every node has the host's full 32 GB and cheerfully overbook a machine five times over. Part 3's Step 1 made you check it with `free -h`.

Now you can check the same thing from Kubernetes' own point of view, which is the number the scheduler actually uses:

```promql
kube_node_status_capacity{resource="memory"} / 1024 / 1024 / 1024
```

**Expect: about 4 on the three masters, about 6 on the two workers.** Five results, one per node.

If any node comes back at about 31, that node has no LXD memory limit and Kubernetes is being lied to. Go back to Part 2's Step 5.3 and set it. This is the same fault Part 2 predicted and Part 3 re-checked, now visible as a graph you can leave on a screen instead of a command you have to remember to run.

That metric comes from **kube-state-metrics**, which reads Kubernetes' own records. That is exactly why it is trustworthy for this question: it tells you what the scheduler believes, which is the thing that decides where pods go.

### 5b. How close are you to filling a node?

Two different questions here, and people confuse them constantly.

**What has been promised** (this is what the scheduler cares about):

```promql
100 *
sum by (node) (kube_pod_container_resource_requests{resource="memory"})
/ on (node)
sum by (node) (kube_node_status_allocatable{resource="memory"})
```

This is the percentage of each node's memory that has been **requested** by the pods on it. When this reaches 100 on every node, new pods stay `Pending` no matter how much memory is actually free, because the scheduler books by request, not by use. If you took Part 3's master taint, watch this number on the two workers.

**What is actually being used** (this is what the kernel cares about):

```promql
sum by (node) (container_memory_working_set_bytes{container!=""}) / 1024 / 1024 / 1024
```

This comes from cAdvisor inside kubelet, and it reads cgroups, which is the same accounting the kernel uses to decide what to kill. It is the number to trust in this lab.

Run both and compare. Requested is usually far higher than used, because most charts request more than they need. That gap is normal, and understanding that it is normal is most of what capacity planning is.

> **If `node` comes back empty on the cAdvisor query, your chart version labels those series differently.** Type `container_memory_working_set_bytes` on its own in Explore, look at the labels on a returned series, and use whichever one names the machine (often `instance`). This is a five second check, and it beats copying a query from a blog post that assumed a different chart. Suspect the query before you suspect the cluster.
{: .prompt-tip }

### 5c. Does node-exporter agree, or is it seeing the host?

Here is a question specific to running Kubernetes inside LXD, and one worth answering yourself rather than trusting anyone about.

Your nodes share the host's kernel. Part 2's Step 5.3 explained that LXD uses lxcfs to make each container see its own limits when it reads `/proc/meminfo`, which is why `free -h` inside master1 says 4 GiB rather than 32 GB. `node-exporter` reads that same `/proc`, but it reads it through a mount from inside a pod, and whether the lxcfs view survives that trip is not something to assume.

So check:

```promql
node_memory_MemTotal_bytes / 1024 / 1024 / 1024
```

Compare each result against 5a's answer for the same node.

- **If they agree** (about 4 on masters, about 6 on workers), lxcfs's view reached node-exporter and the `Node Exporter / Nodes` dashboard is telling you the truth about your nodes.
- **If node-exporter reports about 31 on every node**, it is seeing straight through to the host. The dashboard is then showing you five copies of one machine's memory, which is real information about the host but not about the node. In that case, prefer 5a and 5b, which come from kube-state-metrics and cAdvisor and are cgroup-based, and read the node-exporter dashboard as a host dashboard.

Either answer is fine. The failure would be not knowing which one you have, and then making a capacity decision from a number that means something other than you think. This is the shared-kernel trade-off from Part 1 showing up one last time, in the monitoring layer.

### 5d. CPU

```promql
sum by (node) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))
```

The result is in **cores**. A value of `0.4` means that node is using four tenths of one core, averaged over the last five minutes. Compare against Part 2's `limits.cpu` of 2 on masters and 4 on workers.

`rate(...[5m])` is the PromQL idea worth taking away from this part. `container_cpu_usage_seconds_total` only ever counts upwards, forever, which is useless to look at directly. `rate` converts that ever-rising counter into "how fast is it rising per second", which is the thing you actually wanted. Almost any metric whose name ends in `_total` needs `rate` wrapped around it.

### 5e. Pods per node, against the ceiling nobody mentions

```promql
count by (node) (kube_pod_info)
```

and the limit it is heading towards:

```promql
kube_node_status_capacity{resource="pods"}
```

**Expect 110 per node**, which is Kubernetes' default maximum and has nothing to do with your memory. It is a separate ceiling, and on a small lab you will hit memory long before you hit it. Worth knowing it exists, because "the node has plenty of memory and pods still will not schedule" is otherwise a genuinely confusing hour.

### 5f. etcd health across the three masters

Part 3 spent a long time on quorum, leader election, and what happens when a majority is lost. The natural next question is whether you can watch that on a graph.

**Honest answer: only if you took Option B in Step 3b.** k3s does not expose etcd's metrics by default, and this guide turned that scrape job off, so `etcd_*` metrics do not exist in your Prometheus. Confirm it for yourself rather than taking my word:

```promql
etcd_server_has_leader
```

Empty result means the metrics are not there, which is the expected outcome of Option A.

If you did take Option B, these are the three to know:

| Query | What it answers |
|---|---|
| `etcd_server_has_leader` | 1 means this member can see a leader. A 0 on any master is Part 3's quorum failure, live. |
| `increase(etcd_server_leader_changes_seen_total[1h])` | How many elections happened in the last hour. Occasional is normal, constant is a sign of a struggling member. |
| `histogram_quantile(0.99, rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m]))` | How long etcd waits for the disk. This is the number that goes bad first when etcd is unhappy, and on a lab sharing one ZFS pool between five members it is a genuinely interesting thing to watch. |

What you **can** see with Option A is the cluster's view of its own masters, which is most of what Part 3 was actually about:

```promql
kube_node_status_condition{condition="Ready", status="true"}
```

One line per node, 1 for Ready and 0 for not. Keep this one; Step 6 uses it.

### 5g. Is anything restarting behind your back?

The single most useful query on this page, and the clearest example of "Running does not mean healthy":

```promql
sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total[1h]))
```

Any pod with a number above zero has restarted in the last hour. A pod that crashes every four minutes and restarts successfully shows `Running` in `kubectl` almost every time you look. This query is how you find it. On a healthy lab, everything here should be zero.

---

## Step 6 — Break it on purpose

Every part of this series ends by taking something away. Part 3 killed a master to watch quorum protect itself. Part 4 killed a worker to watch data survive. Part 5 killed the node holding the MetalLB address to watch it move. Here you kill a worker and watch the whole monitoring chain react, from a machine disappearing to a red box on a screen.

### First, do not kill the node Prometheus is on

This is point 2 of "Three things to know", collecting its debt.

```bash
kubectl get pods -n monitoring -o wide | grep -E 'prometheus-|grafana'
# Note which node Prometheus is on. Because of local-path, it CANNOT move.
```

If Prometheus is on `worker1`, stop `worker2` instead, and swap the names throughout this step. If you stop the node Prometheus is pinned to, Prometheus goes down, stays `Pending` until the node returns, and you have no monitoring with which to watch your monitoring experiment. That would be an instructive mistake, but you would rather choose it than trip over it.

### Set up the watch

Open two things before you break anything:

- **Grafana**, on the `Kubernetes / Compute Resources / Cluster` dashboard, or on Explore running `kube_node_status_condition{condition="Ready", status="true"}`.
- **Prometheus' own UI.** It has no Ingress, so port-forward to it:

```bash
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
# Leave this running. Open http://127.0.0.1:9090 in the host's browser.
# The Alerts tab is what you want. The Status > Targets tab is worth a look
# too: this is where you SEE the k3s scrape jobs from Step 3b, or rather
# see that they are absent because you turned them off.
```

On the Alerts tab you will notice one alert already firing, called **`Watchdog`**. That is deliberate and it ships that way. It is an alert designed to fire always, so that a monitoring system that has quietly died is detectable: if you ever stop receiving `Watchdog`, the thing that sends alerts is broken. An always-firing alert is the only honest way to monitor the monitor.

### Stop the node

```bash
lxc stop worker2        # or whichever worker is NOT running Prometheus
```

Now watch, in this order. The timings matter and they are the lesson.

**Within seconds:** `lxc list` shows the container `STOPPED`. This is the truth, and it is the only source that is instant. Everything else lags, exactly as Parts 3 and 4 warned.

**After about a minute:** `kubectl get nodes` shows `NotReady`. Your Grafana query flips that node's line from 1 to 0. This is the control plane deciding the node has missed enough heartbeats.

**After a few minutes:** the pods on that node are evicted and recreated on the surviving nodes, exactly as Part 4's Step 8 showed. Watch it:

```bash
kubectl get pods -A -o wide -w | grep -v Running
# Ctrl-C when it settles.
```

The `node-exporter` pod for the stopped node does **not** get rescheduled, and that is correct. It is a DaemonSet, meaning "one copy per node", so with the node gone there is nowhere for it to go. It comes back when the node does.

**Now go to the Alerts tab in Prometheus and watch what does not happen for a while.**

### The `for:` duration, which is the single most confusing thing here

You stopped a node. Kubernetes knows within a minute. And the `KubeNodeNotReady` alert does not fire.

**Nothing is broken.** Look at the alert's state. It will be **Pending**, not **Firing**, and Pending is a real state with a specific meaning.

Every alert rule has three parts:

```yaml
- alert: KubeNodeNotReady
  expr: kube_node_status_condition{condition="Ready",status="true"} == 0
  for: 15m                    # THIS is the part people miss
```

- **`expr`** is the condition. It is true right now.
- **`for`** is how long the condition must stay true before the alert fires.
- Between the condition becoming true and the `for` elapsing, the alert is **Pending**.

So the sequence is: condition true, alert Pending, fifteen minutes pass, alert Firing, Alertmanager notified.

**Why wait at all?** Because without the wait, every alert would be useless. A node that is `NotReady` for twenty seconds during a restart is not an incident, it is a Tuesday. A node that is `NotReady` for fifteen minutes is an incident. The `for:` duration is the entire difference between an alerting system people act on and one people mute.

Check the real duration on your chart version rather than trusting this page, because the shipped rules do change:

```bash
kubectl get prometheusrule -n monitoring -o yaml | grep -B2 -A6 'alert: KubeNodeNotReady'
# Expect: the expr, and a "for:" line. 15m at time of writing.
```

Fifteen minutes is a long time to sit and stare. Two options:

**Option 1: wait it out** and use the time productively. Watch the pods reschedule. Watch `TargetDown` go Pending too, because Prometheus can no longer scrape the kubelet on that node. Look at the Cluster dashboard and see the memory of the surviving nodes go up as they take on the evicted pods.

**Option 2: add your own fast alert rule**, which is a better use of the time because you learn how to write one. Add a file to the Git repository, because Part 6 means that is now the only way in. Create `infra/monitoring/lab-alerts.yaml`:

{% raw %}
```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: lab-alerts
  namespace: monitoring
  labels:
    release: kube-prometheus-stack   # this label is how Prometheus finds it
spec:
  groups:
    - name: lab
      rules:
        - alert: LabNodeDownFast
          expr: kube_node_status_condition{condition="Ready", status="true"} == 0
          for: 1m
          labels:
            severity: warning
          annotations:
            summary: "Node {{ $labels.node }} has been NotReady for 1 minute"
```
{% endraw %}

**That `release:` label is the whole trick, and it is worth understanding.** The Prometheus Operator does not pick up every `PrometheusRule` in the cluster. It picks up the ones matching a label selector, and the chart sets that selector to `release: <your release name>`. Get the label wrong and your rule is applied to the cluster successfully, sits there looking perfectly healthy, and is never loaded. That is a silent failure of exactly the shape Part 2 warned about, so check rather than assume:

```bash
# Confirm the Operator actually loaded it, in the Prometheus UI:
#   Status > Rules, and look for the "lab" group.
# Or from the command line:
kubectl get prometheusrule -n monitoring
```

If your rule does not appear in Prometheus' Rules page after a minute or two, read the selector the chart used and match it:

```bash
kubectl get prometheus -n monitoring -o jsonpath='{.items[0].spec.ruleSelector}'; echo
```

Commit and push it, and you will need a second Argo CD Application pointing at `infra/monitoring/` if Part 6's setup does not already sync that directory. With the rule loaded, stop the node again and the alert goes Pending immediately and Firing one minute later, which is short enough to actually watch.

### Watch it reach Alertmanager

Once something is Firing, it leaves Prometheus and arrives at Alertmanager. Look at it there:

```bash
kubectl port-forward -n monitoring svc/kube-prometheus-stack-alertmanager 9093:9093
# Open http://127.0.0.1:9093 in the host's browser.
```

You will see the firing alert, grouped with any others that share its labels. This is the division of labour from Step 2 made concrete: **Prometheus decided something is wrong; Alertmanager decides who hears about it and how often.** With no receivers configured, "who hears about it" is nobody, which is why this is a lab and not a pager.

Try the **Silence** button on the alert. A silence is how you say "yes, I know, I am doing maintenance, stop telling me until Tuesday." It is the single most used feature of Alertmanager in real life, and it costs nothing to try once.

### Bring the node back

```bash
lxc start worker2
sleep 30
kubectl get nodes
# Expect: five Ready again within a minute or two.
```

Watch the alert **resolve**. It does not vanish instantly. The `expr` becomes false as soon as the node reports Ready, the alert leaves the Firing state in Prometheus, and Alertmanager marks it resolved after its own short delay. In Grafana, the line goes back to 1.

**That is the whole chain, seen once, end to end:** a machine went away, kubelet stopped reporting, kube-state-metrics recorded the change, Prometheus scraped it, an alert rule matched, a timer ran, an alert fired, Alertmanager received it, the machine came back, and everything unwound in the same order. Nothing in that chain is magic, and now you have watched every link of it.

---

## Step 7 — Clean up and save a restore point

Remove the experiment, keep the platform. Same rule as every part: test things go, infrastructure stays.

```bash
# If you added the fast alert rule and want it gone, remove it from Git.
# Argo CD's prune: true will delete it from the cluster on the next sync.
#   git rm infra/monitoring/lab-alerts.yaml && git commit && git push
# Or keep it. It is small, correct, and occasionally useful.

# Stop any port-forwards you left running (Ctrl-C in their terminals).

kubectl get all -n default
# Expect ONE line: service/kubernetes. The familiar clean baseline.

kubectl get pods -n monitoring
# Expect: everything Running. This is infrastructure now, and it stays.

kubectl get application -n argocd
# Expect: every Application Synced and Healthy, including the new one.
```

Snapshot all five, stopped and together, exactly as Parts 3 to 7 taught:

```bash
for n in worker1 worker2 master1 master2 master3; do lxc stop "$n"; done
for n in master1 master2 master3 worker1 worker2; do
  lxc snapshot "$n" post-monitoring
done
for n in master1 master2 master3 worker1 worker2; do lxc start "$n"; done
sleep 30

kubectl get nodes                    # expect: five Ready
kubectl get pods -n monitoring       # expect: everything back Running
```

Give Prometheus a minute after the restart. It replays its write-ahead log on startup, so the pod can sit in `Running` but not `Ready` for a short while, which is correct behaviour and not a fault.

### What is not in this snapshot

The list keeps growing, and it is worth keeping straight, because a snapshot that you think holds more than it does is worse than no snapshot:

| Not in the node snapshots | Where it actually lives |
|---|---|
| The NFS server and its share | The host, `/srv/nfs/k8s` (Part 4) |
| Your `/etc/hosts` entries | The host, and your laptop (Part 5) |
| The router's static route | Your router (Part 5) |
| **The Git repository** | GitHub (Part 6). This is now the real source of truth for what runs. |
| Your Cloudflare API token and DNS records | Cloudflare (Part 7) |

That fourth row deserves a moment. Since Part 6, an LXD snapshot is no longer the most important backup you have. **Roll the nodes back to `post-monitoring` and Argo CD will immediately reconcile them against whatever is in Git right now, not whatever was in Git when you took the snapshot.** That is GitOps working exactly as designed, and it means the repository, not the snapshot, is the thing you would be sad to lose.

---

## Where you should be

| Thing | State |
|---|---|
| Monitoring stack | kube-prometheus-stack in namespace `monitoring`, deployed by Argo CD from Git |
| Prometheus | Running, 7 day retention, on `local-path`, pinned to one node and you know which |
| Grafana | `https://grafana.k3s.linsnotes.com`, real Let's Encrypt certificate, five lines of config |
| Alertmanager | Running, receiving alerts, no receivers configured |
| Exporters | node-exporter on all five nodes, kube-state-metrics in the cluster |
| k3s control plane targets | Deliberately disabled, with their alert rules, and you know why |
| Alerting | Seen going Pending, then Firing, then resolving, with the `for:` delay understood |
| Snapshots | `post-monitoring` on all five, taken stopped and together |

### Things worth carrying forward

- **Prometheus must not go on NFS.** Prometheus' own documentation says so, and the failure is corruption rather than an error. Use block or local storage, and accept that on `local-path` your Prometheus is pinned to one node and loses its history if that node is destroyed. Replicated block storage (Longhorn) is the fix, and it is the same fix Part 4 named.
- **A default scrape configuration assumes a cluster shaped like the author's, not yours.** On k3s, the control plane is one process, so the chart's controller-manager, scheduler, kube-proxy and etcd targets find nothing and their alert rules fire forever. Turning them off is the correct action, not a workaround. Suspect the check before the machine, one last time.
- **`for:` is why your alert is not firing.** An alert with a condition that is true but a timer that has not elapsed sits in Pending, and Pending is normal. Read the `for:` before you conclude that alerting is broken.
- **An always-firing alert (`Watchdog`) is the only way to monitor the monitor.** If it ever stops arriving, the alerting path itself has failed.
- **kube-state-metrics and node-exporter answer different questions.** One is about Kubernetes objects, one is about machines. In LXD, check whether node-exporter is seeing your node or your host, and prefer the cgroup-based numbers when they disagree.
- **Wrap `rate()` around anything ending in `_total`.** Counters only rise; the useful number is how fast.
- **Size it before you install it.** This is the first workload in the series big enough to matter. Set requests so the scheduler reserves room, and limits so one query cannot take a node down.
- **Once Argo CD has self-heal on, the repository is the only way in.** Everything in this part arrived through a commit, including a change of password you have to think about differently now.

---

## The series, wrapped up

Eight parts ago you had one Ubuntu machine and no plan. Here is what you have now, said plainly.

**What you built.**

- **A highly available cluster.** Three masters share an etcd database with a quorum of two. You killed one and it shrugged. You killed two and watched it refuse to accept writes rather than risk disagreeing with itself, which is the feature and not the bug.
- **Storage that survives a node dying.** Two StorageClasses, and more importantly the knowledge of which to reach for. You watched a pod get stranded by local storage and then watched the same test pass on network storage.
- **A front door.** MetalLB gives out real addresses, ingress-nginx splits one address between many hostnames, and you watched the address move to another node in seconds when its holder died.
- **A deployment process you did not have to remember.** Argo CD keeps the cluster matching a Git repository, and it puts things back when you delete them.
- **Real HTTPS, automatically.** cert-manager gets certificates from Let's Encrypt through a DNS-01 challenge and renews them without being asked. By Part 8, adding HTTPS to a new service was five lines.
- **A cluster that reports on its own health.** Prometheus scrapes, Grafana draws, Alertmanager receives, and you have watched an alert travel the entire path.

That is a genuinely working small Kubernetes platform, and every piece of it is one you would meet in a real job.

**What it is not.** This matters as much, and most tutorials stop before saying it.

- **No replicated block storage.** NFS is a single point of failure and `local-path` is node-locked. A production platform runs Longhorn, Ceph, or a cloud provider's disks. Part 4 named this and Part 8 paid for it with a pinned Prometheus.
- **No CI.** You commit to Git and Argo CD deploys it. Nothing tests your manifests, nothing builds an image, nothing stops you pushing something broken. Real platforms have a pipeline between the commit and the cluster.
- **No secrets management.** Every secret in this lab was created by hand with `kubectl` or lives in a values file. Nothing is encrypted at rest in Git, nothing is rotated, and the Grafana password problem in Step 4 was the first time it pinched. The usual answers are Sealed Secrets, External Secrets Operator, or Vault.
- **No logging.** You can see that a pod restarted eleven times. You cannot see *why* without `kubectl logs`, and that is gone the moment the pod is. A logging stack (Loki is the natural partner to this one) is the missing half of observability.
- **No backups leaving the host.** k3s takes etcd snapshots and you take LXD snapshots, and both live on the same disk as the thing they protect. That is not a backup, it is a convenience.
- **One host, which is one point of failure.** The whole reason this lab is affordable is the whole reason it is fragile. Three masters protect you from a master failing. Nothing protects you from the machine underneath all five failing, and that machine is also the NFS server. Be honest about this when you talk about it: you built a real HA control plane on top of a single point of failure, on purpose, because the alternative was five computers.

Knowing where the edges are is worth more than pretending there are none. Every gap above is a thing a real platform team spends real time on, and now you know what each one is for.

---

## Where this goes next

I am working towards an MLOps role, and the point of building this platform was never Kubernetes for its own sake. It was to have somewhere real to run machine learning workloads, on infrastructure I understand all the way down, so that when something breaks I know whether the problem is the model, the pipeline, or the cluster.

The next arc, if I write it, builds on this exact platform rather than starting over. Everything below plugs into what Parts 1 to 8 already produced: it deploys through Argo CD from the same repository, it gets a hostname and HTTPS from the same ingress and the same ClusterIssuer, and it reports into the same Grafana.

- **MinIO** for artifact storage, giving the cluster an S3-compatible bucket without an S3 bill. Datasets, model files, and anything else too big to belong in Git.
- **MLflow** for experiment tracking, with Postgres behind it for metadata and MinIO behind it for artifacts. This is where "which run produced this model, and with what parameters" stops being a folder of filenames.
- **Training runs as Kubernetes Jobs**, so a training run is a scheduled workload with requests, limits, retries and logs, rather than a script somebody ran on a laptop and then closed.
- **Model serving behind the same Ingress**, so a trained model becomes an HTTPS endpoint at a hostname, using the five lines from Part 8's Step 4.
- **Model metrics on the same Grafana**, because a served model exports latency and error rate like anything else, and prediction drift is just another time series.

That is the shape. Whether it becomes Part 9 depends on how the first attempt goes, and I would rather write it after building it than before.

If you have followed all eight parts: you built a Kubernetes cluster from an empty machine, broke it eight different ways on purpose, and understood why each recovery worked. That is a better foundation than most people get.
