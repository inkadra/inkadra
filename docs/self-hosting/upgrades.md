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

## Upgrading to Valkey 9

`compose.yaml` now runs Valkey 9 instead of 8. Valkey 9 reads the data written by 8, but 8
cannot read data written by 9, so the step is one-way: back up the `valkey-data` volume (or
your `VALKEY_DATA` folder) before upgrading, and there is no downgrade. If the volume is lost,
the queues are rebuilt when the server starts; only jobs that were waiting to run are lost.

## Data folder owner

Inkadra runs as uid 1000. Versions after 0.1 write to `/data` as soon as they start, so a host
folder in `INKADRA_DATA` that belongs to another user, for example one created with `mkdir` as
root, stops them with "cannot write to /data".

The `compose.yaml` of the release handles this by itself: the container starts as root, gives
the folder to uid 1000 if the folder or one of its entries belongs to someone else, and then
runs as uid 1000 with no capabilities. The change of owner happens once, on the first start
that needs it. Take the new `compose.yaml` (it adds `user` and `cap_add` to the `inkadra`
service) and run `docker compose up -d`.

If you keep an older `compose.yaml`, or run the container as uid 1000 on purpose, give the
folder to uid 1000 yourself before upgrading:

```sh
sudo chown -R 1000:1000 /path/to/inkadra/data
```

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

Every push to `main` publishes `edge` and `sha-<commit>`. For a release, a maintainer runs the
Release workflow, which tags `vX.Y.Z` on `main`, opens the GitHub release and starts CI on the
tag. CI runs in full (tests, end-to-end, the reverse proxy examples, a vulnerability scan of
the image), builds amd64 and arm64 on native runners without build cache, publishes `X.Y.Z`,
`X.Y` and `latest`, and attaches the deployment files to the release. Versions with a suffix
(`0.3.0-rc.1`) are pre-releases: they never move `latest` or `X.Y`.
