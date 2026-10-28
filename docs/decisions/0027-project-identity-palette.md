# 0027 · Extend project identity without changing existing defaults

Project identity needs more visually distinct choices. Extend the v1 project icon contract
with hexagon, star, pentagon and cross, plus teal, yellow, red and pink. Identity red is a
separate token from semantic danger. Both themes provide contrasting strokes and soft tile
backgrounds through the shared token generator.

The database stores shape and colour as unconstrained text, so this enum extension needs no
SQL migration. Keep the deterministic four-shape/four-colour seed and migration 0008 intact:
existing projects must retain their identity. API writes remain validated; the shared web
glyph renders unknown runtime values as circle/neutral. The clipper consumes typed JSON
without enum parsing, and mobile currently has no implementation.

Installed clients cannot gain new drawings retroactively; deploy updated clients with this
additive contract. No endpoints or board document schemas change.
