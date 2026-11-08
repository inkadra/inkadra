# 0079 — A Server page for administrators, without a monitoring stack

## Context

Administrators had no place to see whether their instance is healthy: Diagnostics checked the
configuration once, and everything else (resources, jobs, failures) was in container logs that
non-technical people do not read (#514). Running Prometheus and Grafana next to Inkadra is more
than a small studio's server should carry.

## Decision

- **Where.** Settings → Instance → Server, administrators only. A simple view in plain words by
  default and an advanced view with charts, remembered per administrator (`serverView`, decision
  0055). The configuration checks of Diagnostics are a row of "Services" and a failing check is a
  problem; `/diagnostics` stays public before setup for the setup flow.
- **Samples.** Every role (web, collab, worker, or `all`) samples its own container every 10 s:
  CPU and memory from cgroup v2, traffic from `/proc/net/dev` of its network namespace (the
  Inkadra containers only, never the host), its own process, and in the web role the p95 of JSON
  API answers and the share of 500s. Two roles in one container count it once; containers without
  limits of their own see the whole machine, so its cores and memory count once per machine (its
  boot id) and only real cgroup limits add up. Raw samples are kept
  for an hour, minute averages for 24 hours and ten-minute averages for 7 days, in Valkey lists;
  without Valkey (a web role alone) in memory. No new dependency, no Prometheus.
- **Heartbeats.** The same tick writes a heartbeat per process: no signal for 30 s is late, 90 s is
  down. The collab heartbeat carries who is on which board, as ids; the web role names boards,
  projects and people only for projects the administrator is a member of. The page reads Valkey
  through a connection that gives up after 2 s, so Valkey down shows as the queue down.
- **Problems.** A job that failed for good, a 500, a stopped service, a full disk (under 10 % or
  5 GB), a failed backup. The technical line goes through the feedback redaction and loses quoted
  text, paths and file names, so it holds no board content or personal data; file and board names
  are added when the page is read, for administrators who can see them. Problems last 7 days, can
  be marked seen until they happen again, and failed jobs can run again.
- **Alerts.** On by default, in the Inbox of every administrator, at most once an hour per kind.
  Email is optional and only for serious problems (stopped service, full disk, failed backup), at
  most one an hour in all; a full disk is told once a day while it lasts; an error that keeps
  happening (5 times within the last hour) is an Inbox alert.

## Consequences

- Charts are approximate by design: the coarser tiers keep the slowest p95 of each slice, and the
  network meter is the traffic of the containers, uploads and downloads alike.
- S3 storage shows the space used only: providers do not report a total, so there is no "months
  left".
- GPU use, disk I/O, temperatures and host traffic are out of scope.
