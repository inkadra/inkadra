# 0117 · Set plan: setups share the base's circuits, title and a renamable first setup

Proposed, 2026-11. Extends decisions 0104 (set plan v2) and 0114 after the parity audit of the
editor's panels against the approved mockup.

## Context

A new setup (`addVariant`) started with an empty `circuits` list, while its lights kept the circuit
ids of the base they were copied from, and `variantView` did not carry circuits or voltage. Every
light of setups 2 and 3 was "On no circuit" in the Kit tab, on the card, in the view, in the PDF and
on the call sheet. The title field of a setup showed the placeholder, since a setup has no title
of its own once the base is renamed. The first setup was always "1 · Base" and could not be
renamed, where the mockup calls it "1 · Master". The Kit tab added the kit of every setup to give
"All setups: 62 items", counting the same lamp once per setup.

## Decision

**Circuits and voltage belong to the base**, shared by its setups, as its walls, scale and Set
are: the circuits are those of the location's electrics, and a lamp moved between setups stays on
the same circuit. `variantView` gives a setup its base's circuits and voltage, then any circuit the
setup holds itself (an earlier build let a setup add its own), so no light loses its circuit. One
place repairs every existing setup: the Kit tab, the card, the view, the PDF sheet and the call
sheet all read through `variantView`; nothing in the documents is rewritten and the schema does not
change. Editing from a setup writes the base: a new circuit and the voltage go to the base, a
circuit is edited where it is stored. Copying circuits on creation was rejected: copies drift, and
the lights of existing setups would still point at the base's ids.

**The title is the base's**, its one owner. A new setup gets no title; every setup shows the
base's title and writes it there (`variantView` carries it, so the card, the board export, the
view and the sheet read the same), never a copy a setup kept from an earlier build, even when the
base has none.

**A setup left alone** (its base deleted, or the setup pasted on a board without it) takes what it
read from its base: the Set, walls, openings and scale as before (decision 0062), and now the
base's circuits first, with their ids so its lights stay on them, then any circuit it held; the
voltage, background picture, location, north and scenes where it has none of its own; and the
base's title, which replaces a stale copy (none if the base had none). The sun's time and date are
each setup's own and stay. Pasted elsewhere, the location and scenes then follow the usual rules
(kept when their cards are there or pasted along).

**A circuit removed** leaves its id on the lights of the base and its setups: an undo brings the
circuit back with its lights on it, and two people do not fight over the lights. Everything that
shows a light's circuit reads it through `circuitOf`, which treats an id that no longer resolves
as no circuit: the power counts the light "On no circuit" and its Circuit field says so.

**The first setup is renamed like the others**, with the `variant` field every plan already has:
its tab reads "1 · Base" until it is renamed. A tab is renamed on a double click, a right click or
`F2`; on a phone, from the setup menu. Only a setup (`variantOf`) adds its name to the card's
title; the base's name stays on its tab.

**"All setups" counts distinct items**: per line of the kit, the most any one setup needs.

**Lists as the mockup draws them.** Elements and the read-only view fold identical icons (type,
name, power, base, tag, links) into one row with "×n"; stands and supports with something on them
are listed with what they carry ("A cam · 32 mm · Dolly on 4 m track"), and also as an indented
row under it, so a base covered on the plan can be picked, locked and deleted from the list and
the keyboard; the Set is one line of counts. The kit puts a light's modifiers on one line and all gels on one, and lists video and
sound under Camera and movement. A table lamp with only its watts is not a project kit entry.
Watts of 1000 and more read "2K".

## Consequences

- A setup cannot have circuits the base lacks; a circuit added from a setup is everyone's.
- A base renamed "Master" prints "Setup 1 · Master" on the sheet; its card keeps the plan's name.
- Library tiles keep the mockup's 56 px: a name takes one line, or two broken between words, never
  inside one. Names longer than a tile have a shorter tile name in the catalogues
  (`board.plan.tileNames`): the mockup's "Beam proj.", "Diffusion" and "Bounce" in English, and
  German compounds written with their hyphen ("Profil-Scheinwerfer"). The soft hyphens of the
  earlier `tileName` are gone.
