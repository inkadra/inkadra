# Security policy

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on https://github.com/inkadra/inkadra.
Do not open public issues for security problems.

You will get an answer within a week. Until 1.0 only the latest release receives fixes.

## What edit rights allow on a board

People who can edit a board (members with the editor role or above, and holders of a share link
that allows editing) are trusted with that board's content: they can already change or delete any
card on it. The server checks what their edits may not do (who can be assigned a task, due dates,
the schema of what it stores), refuses updates of a shape no Yjs client writes that would stop a
board from being stored or opened, and keeps one person from writing under the server's own
identity (decision [0139](docs/decisions/0139-collaborative-update-checks.md)). It does not
otherwise check that an editor's updates are ones a normal client would produce: a crafted update
from someone with edit rights can damage that board's content, or make what the server holds in
memory differ from what it stores until the board is reloaded. A conditional restore (decision
[0142](docs/decisions/0142-conditional-card-restore.md)) writes only cards the editor could
write themselves, with the same checks as their own edits. People who cannot edit a board
(viewers, commenters, guests without an editing link) cannot write to it at all.
