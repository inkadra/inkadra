# 0129 — Container GPU use in the CPU chart

## Context

Hardware video encoding moves work from CPU to GPU. Decision 0079 excluded GPU use, leaving
administrators without a measure of that work.

## Decision

Amends 0079: read DRM fdinfo of processes visible in the container PID namespace, without extra
privileges. Deduplicate clients per PCI device and client id. Over a 20 s window, refreshed every
5 s sample, sum clients per engine (a client opened in between counts from zero; an exited one
is lost), divide by engine capacity, and show the busiest engine. Time counters use
wall time; xe busy cycles use total cycles. Exited clients contribute no negative deltas.
Container values count once across roles, as network traffic does. No process holding the GPU
open reads as an idle GPU, 0 %, not as unknown.

With Quick Sync or VAAPI (Intel, AMD) and a current reading, the CPU card gains a second series, current
GPU percentage and peak; the 2×2 layout stays. Historical and live API fields are optional and
nullable, so installed clients remain compatible.

## Consequences

This measures the container's work, not host GPU use. Drivers without DRM fdinfo (usually
proprietary NVIDIA) would read a flat 0 %, so NVENC shows no GPU; no nvidia-smi dependency. Clients that exit before a
reading lose their last window. The window exists because on a real N100 (QSV, HEVC 4K)
a saturated video engine read about 97 % and 3 % in turns between 5 s samples, while an unsaturated
one read steadily; likely i915 with GuC submission, which adds a context's time when it leaves
the engine. GPU readings therefore trail the
CPU line by up to 20 s. Multiple containers' percentages add,
capped at 100 percent. No new privileges, dependency or monitoring service.
