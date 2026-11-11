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
take it once (decision 0111). Frames of omitted scenes stay out (decision 0082). The choice is a
personal view preference of this person on this device (local storage, as the canvas choices of
#302): it changes nothing in the board or for anyone else, and a board without plans shows
neither the choice nor any grouping.

**Natural sources are no kit.** The sun, the moon, a fire, a candle, a screen's glow, neon,
headlights and a street light (`NOT_KIT_LIGHTS`, canvas-core) are drawn and listed in the legend
like any light, but they are not kit to bring and draw no power: the kit list, the power per
circuit and the project kit leave them out everywhere (editor, call sheet, scene sheets, PDF
sheet, read-only view, the card's watts). Table, ceiling and floor lamps are practicals the crew
brings: kit, with their watts.

**The PDF legend.** A row's glyph is the icon alone: no label, power or lens of its own drawn
over it, since the row prints them beside it. A camera's lens is printed once, at the right of its
row.

## Consequences

- Plans with a sun with watts typed in show less power than before; nothing stored changes.
- The shot list's setup groups now follow the order of the plans, with "No setup" last.
