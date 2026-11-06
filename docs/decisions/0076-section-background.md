# 0076 — A background on section headings

Section headings had a rule under the text. People wanted a stronger way to mark a heading, and
found the rule added nothing.

Document version 20 adds an optional `background` from the section palette, drawn as that colour's
tag tint behind the text. Omitting it means no background. The migration from version 19 is a no-op,
and guests see the field because it is part of how the heading looks.

Headings stop drawing the rule. `line` stays optional in the schema so documents that set it still
validate, but nothing reads it any more. This supersedes the rule described in decision 0068.

Older clients open version 20 documents read-only until they update, as with any version bump.
