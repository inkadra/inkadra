# 0077 — Named groups on the moodboard

People asked to sort a moodboard's references under named headings, such as "Luce". The rework of
the moodboard also shows a note on each reference and a palette taken from the pictures.

Document version 21 adds one optional field to images, links and colours: `group`, the name of the
group, up to 60 characters. References with the same name, compared without case, form one group.
There is no list of groups in the document: a group exists while a reference carries its name, so
two people can sort references at the same time without conflicts on a shared list. The price is
that a group cannot be empty and has no order of its own, so the moodboard sorts groups by name.
The migration from version 20 is a no-op: existing references have no group and show as today.

Nothing else is new data. The note is the field each reference already has (`caption` on images,
`title` on links, `label` on colours), and the palette comes from `palette` on the assets.

Guests do not receive `group`: it is how the team sorts its work, like `tags`, and the guest views
have no moodboard. Older clients open version 21 documents read-only until they update, as with any
version bump.
