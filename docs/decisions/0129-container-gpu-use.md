# 0129 — Container GPU use in the CPU chart

## Context

Hardware video encoding moves work from CPU to GPU. Decision 0079 excluded GPU use, leaving
administrators without a measure of that work.

## Decision

Amends 0079: read DRM fdinfo of processes visible in the container PID namespace, without extra
privileges. Deduplicate clients per PCI device and client id. Between samples sum surviving
clients per engine, divide by engine capacity, and show the busiest engine. Time counters use
wall time; xe busy cycles use total cycles. Exited clients contribute no negative deltas.
Container values count once across roles, as network traffic does. No process holding the GPU
open reads as an idle GPU, 0 %, not as unknown.

With Quick Sync or VAAPI (Intel, AMD) and a current reading, the CPU card gains a second series, current
GPU percentage and peak; the 2×2 layout stays. Historical and live API fields are optional and
nullable, so installed clients remain compatible.

## Consequences

This measures the container's work, not host GPU use. Drivers without DRM fdinfo (usually
proprietary NVIDIA) would read a flat 0 %, so NVENC shows no GPU; no nvidia-smi dependency. Short-lived clients that
start and finish between samples cannot be measured. Multiple containers' percentages add,
capped at 100 percent. No new privileges, dependency or monitoring service.
