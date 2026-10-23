# Upgrades

Inkadra follows [semantic versioning](https://semver.org). Before 1.0, a minor version (0.2 →
0.3) can change things you need to act on; the release notes say what. From 1.0 on, only a
major version does.

## Updating

Pin a version in `.env`, so an upgrade happens when you decide:

```sh
INKADRA_TAG=0.2.0
```

To move to a new version, read its [release notes](https://github.com/inkadra/inkadra/releases),
back up (see [Backups](README.md#backups)), change `INKADRA_TAG` and run

```sh
docker compose pull
docker compose up -d
```

Database migrations run when the new version starts, before it accepts requests. Compare your
`compose.yaml` and `deploy/` files with the ones attached to the release: new settings arrive
there.

Going back to an older version after its migrations ran is not supported: restore the backup
taken before the upgrade instead.

## Verifying the image

Every published image comes with a signed build provenance attestation, made by GitHub Actions
in this repository, and a software bill of materials. To check that an image was built from this
repository by its CI and nothing else:

```sh
gh attestation verify oci://ghcr.io/inkadra/inkadra:0.2.0 --repo inkadra/inkadra
```

To list the packages inside it:

```sh
docker buildx imagetools inspect ghcr.io/inkadra/inkadra:0.2.0 --format '{{ json .SBOM }}'
```

## How releases are made

Every push to `main` publishes `edge` and `sha-<commit>`. A version tag `vX.Y.Z` on `main` runs
the whole CI (tests, end-to-end, the reverse proxy examples, a vulnerability scan of the image),
then builds amd64 and arm64 on native runners without build cache, publishes `X.Y.Z`, `X.Y`
and `latest`, and creates the GitHub release with the deployment files. Tags with a suffix
(`v0.3.0-rc.1`) are pre-releases: they never move `latest` or `X.Y`.
