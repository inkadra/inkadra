# 0064 — Read PDF screenplays in a disposable browser worker

Supersedes the exclusion of PDF in decision 0040. Accepted for #294.

## Context

Scripts dropped on the board commonly arrive as PDF. Import already uses Fountain and
Final Draft parsers and a preview plan. pdfjs-dist (Apache-2.0) is already locked for e2e.

## Decision

Lazy-load that same pdf.js version in a dedicated browser worker. Accept at most 5 MiB,
300 pages and 5 MiB of extracted text, with a 10-second deadline that terminates the worker.
Only inline bytes are parsed: no remote font/CMap resources, evaluation or PDF actions.
Reconstruct lines from text positions and paragraph gaps, then use the Fountain parser and
existing plan limits (500 scenes / 1500 frames). Image-only PDFs produce a specific error;
there is no OCR. Detection runs once per local upload and keeps the parsed result for preview.
The text is cleaned before it is parsed (`pdf-text.ts`): a first page with a credit or draft line
and no scene heading becomes the Fountain title page, not a scene; page numbers, footers
("Created using Celtx"), MORE / CONTINUED markers and lines repeated at the top or bottom of at
least half of the pages are dropped; wrapped action lines are one paragraph; paragraphs, speeches
and parentheticals that a page break cuts are joined; right-aligned CUT TO lines are transitions.
Offer the hint only for at least five actual scene headings. Confirmation remains mandatory.

## Consequences

No API, database or board document changes. Existing file cards and import entry points remain.
The hint and card menu use session-local detection results; reloading does not reread uploads.
PDF layout is heuristic: unusual columns, rotated text and custom typography need preview.
A browser worker bounds time and output but cannot impose a portable hard memory limit.
