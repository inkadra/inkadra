# Documentation

The pages for users and administrators are also published in the
[wiki](https://github.com/inkadra/inkadra/wiki). They are written here: to change one, open a pull
request. A new wiki page also goes in the list in `scripts/wiki-sync.mjs`.

## Using Inkadra

| Page                                                  | What you find                                         |
| ----------------------------------------------------- | ----------------------------------------------------- |
| [A tour of Inkadra](guide.md)                         | The main tools, with pictures                         |
| [Public demo](demo.md)                                | The rules of demo.inkadra.com, and how to run a demo  |
| [Inkadra Clipper](../apps/clipper)                    | The browser extension: installing, connecting, building |
| [Clipper privacy policy](store/clipper-privacy-policy.md) | What the extension saves and sends                |

## Running your own server

| Page                                                       | What you find                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Self-hosting](self-hosting)                               | Installing, configuration, sign-in, reverse proxies, storage, upgrades |
| [Upgrades](self-hosting/upgrades.md)                       | What to do before moving to a new version                              |
| [Project archive](formats/project-archive.md)              | What a project export holds                                            |
| [Instance backup](formats/instance-backup.md)              | What a nightly backup holds                                            |

## Developing

| Page                                                            | What you find                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Contributing](../CONTRIBUTING.md)                              | Setup and conventions: contracts, code, pull requests, releases        |
| [Decisions](decisions)                                          | Why the main choices were made, one short record each                  |
| [Release notes](releases)                                       | The notes of each release, also shown on the Updates page              |
| [Review and sharing server](review-sharing-server.md)           | How the server implements team comments, reviews and notifications     |
| [Opening large boards](opening-boards.md)                       | How a client opens a board without blocking                            |
| [Reference board](testing/reference-board.md)                  | A realistic board document for performance work                        |
| [Collaboration simulation](testing/collaboration-simulation.md) | The ten-user collaboration test and how to run a long soak             |
| [End-to-end tests](../e2e)                                      | Running the Playwright tests and the load tests                        |
| [Report relay](../relay)                                        | The Worker that passes in-app reports to the developers                |
| [The demo projects](demo-project.md)                            | Story bible of the sample film and photo shoot                         |

`assets/` holds the logo and the social preview image. `screenshots/readme` and
`screenshots/guide` hold the pictures of the README, the tour and the self-hosting guide, rebuilt
by `pnpm --filter @inkadra/e2e screenshots`; a few other folders there are written by end-to-end
tests and scripts.
