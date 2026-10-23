# Inkadra Clipper

Browser extension (Chrome, Edge, Brave, Arc) that saves images, text and links to an Inkadra
board. Development starts in wave 2, against the mock API (`pnpm mock`) and then a real server.
It talks only to `POST /api/v1/clip` and the read endpoints of `@inkadra/shared`.
