# Documentation

The user-facing pages (the tour, self-hosting, formats) are published to the
[wiki](https://github.com/inkadra/inkadra/wiki) by `.github/workflows/wiki.yml` on every merge:
write them here, and add a new page to the list in `scripts/wiki-sync.mjs`.

| Where                                                           | What you find                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [A tour of Inkadra](guide.md)                                   | The main tools, with pictures                                          |
| [Self-hosting](self-hosting)                                    | Installing, configuration, sign-in, reverse proxies, storage, upgrades |
| [Decisions](decisions)                                          | Why the main choices were made, one short record each                  |
| [Review and sharing server](review-sharing-server.md)           | How the server implements team comments, reviews and notifications     |
| [Contributing](../CONTRIBUTING.md)                              | Conventions for every change: contracts, code, pull requests, releases |
| [Clipper](../apps/clipper)                                      | Building and installing the browser extension                          |
| [Collaboration simulation](testing/collaboration-simulation.md) | Gate 0.3 ten-user integration test and 30-minute soak                  |
| [End-to-end tests](../e2e)                                      | Running the Playwright tests and the load tests                        |
| [Report relay](../relay)                                        | The Worker that passes in-app reports to the developers                |
| [Last Train, the demo project](demo-project.md)                 | Story bible of the sample film in every screenshot and in the demo     |

`assets/` holds the logo (`logo-light.svg`, `logo-dark.svg`) and the social preview image;
`screenshots/` holds the pictures of the README (`screenshots/readme`) and of the tour and the
self-hosting guide (`screenshots/guide`), both rebuilt by `pnpm --filter @inkadra/e2e screenshots`,
and older ones from pull requests; `screens/` holds a few more from pull requests. Upgrading an instance? Start from
[Upgrades](self-hosting/upgrades.md): it says what to do before moving to a new version.
