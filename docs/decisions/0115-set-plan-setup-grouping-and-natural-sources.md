# 0115 · Set plan: the schedule groups by setup, natural sources are no kit

Proposed, 2026-11. Supersedes the line of decision 0111 that the schedule does not group by
setup, and refines decision 0104's kit and power. Asked by Matteo after the parity review of the
approved mockup (2026-11-11).

## Context

Decision 0111 gave the shot list "Group by: Setup" and the schedule only the setup chips, since
the schedule had no grouping to choose. On set the order of work follows the setups, so the
schedule needs the same grouping. The kit list and the power counted every icon of the Lights
category, the sun and the moon included: the PDF printed "On no circuit: Sun 0 A".

## Decision

**Group by setup in the schedule.** The queue of shots waiting for a day gets a "Group by:
Scene / Setup" choice beside its filters, shown only when the board's plans give at least one
shot a setup. With Setup, the waiting shots of each scene are listed under their setups, and the
Blocks tab of a day lists its shots under their setups in the day's order. Setups follow the
order of the plans (the base of a family first), named as in the setup tabs (`setupName`); shots
of no setup come last under "No setup". The same helper (`groupBySetup`) groups the shot list, so
both orders agree. A shot of two setups is listed under each; counts and the ids of what is shown
take it once (decision 0111). Frames of omitted scenes stay out (decision 0082). A board without
plans shows neither the choice nor any grouping.

**One grouping, on the account.** Personal choices live on the server (Matteo, 2026-11-11), so
the grouping is `shotGroupBy` in the account's preferences (`scene`, `location`, `status`,
`setup`, `none`; `scene` by default), read and written through `/me/preferences` with the rest:
the shot list's "Group by", which until now lasted for the page, and the schedule's are this
one value, so both views agree and the web and the native apps show the same. The schedule
groups by setup when it is `setup` and by scene otherwise. It is per person, not per person and
board: a grouping is a way of working that holds across a project's boards, a board without
plans simply shows no setups, and a list per board would grow without bound in a record read on
every page. Guests of a share link never see the shot list or the schedule; whoever the server
does not let save it (offline, no account) keeps the choice for the page only.

**Natural sources are no kit.** The sun, the moon, a fire, a candle, a screen's glow, neon,
headlights and a street light (`NOT_KIT_LIGHTS`, canvas-core) are drawn and listed in the legend
like any light, but they are not kit to bring and draw no power: the kit list, the power per
circuit and the project kit leave them out everywhere (editor, call sheet, scene sheets, PDF
sheet, read-only view, the card's counts of lights and watts). Table, ceiling and floor lamps are
practicals the crew brings: kit, with their watts.

**The PDF legend.** A row's glyph is the icon alone: no label, power or lens of its own drawn
over it, since the row prints them beside it. A camera's lens is printed once, at the right of its
row.

**The background on the sheet.** The export dialog and the read-only view's PDF include the
background picture by default when the plan shows one (a setup shows its base's), where it was
placed, at its opacity and in greys when the plan's background is grey (decision 0110's
renderers); it can still be left out in the dialog. This replaces decision 0111's "the background
prints at its opacity, not in grey".

## Consequences

- Plans with a sun with watts typed in show less power than before; nothing stored changes.
- `UserPreferences` gains `shotGroupBy` (additive in API v1); older clients keep ignoring it.
- The shot list's setup groups now follow the order of the plans, with "No setup" last.
