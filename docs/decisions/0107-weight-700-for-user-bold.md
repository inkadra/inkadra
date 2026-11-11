# 0107 — Inter 700 only for bold the user writes

Status: accepted. Amends [0006](0006-design-tokens.md).

## Context

0006 says the interface uses Inter 400, 500 and 600, "never 700". The web app still loaded
Inter 700 and a dozen interface rules asked for 700 (or 650, which draws as 700): file badges,
the call sheet's badges and block notes, the tutorial's headings and step numbers, a few small
counters. Browsers also draw `b`, `strong`, `th` and headings at 700 by default. Yet some text
needs 700: what the user marks bold.

## Decision

The interface never goes above 600. Inter 700 stays loaded for one use only, bold the user
writes:

- the bold mark in a note (`.note-text b, strong`);
- a text or section card set to bold (`bold: true`), on the board and in its exports;
- the PDF and image exports of both.

`b`, `strong`, `th` and `h1`–`h6` default to 600 in `packages/ui`. Exports of interface text,
such as the call sheet's block notes, follow the screen and use 600.
`packages/ui/src/font-weight.test.ts` fails on any other weight above 600 in the CSS and inline
styles of `packages/ui` and `apps/web`.

## Consequences

Badges, counters and tutorial headings that used 700 or 650 draw slightly lighter. A new
place for user bold has to be added to the test's list and to this decision.
