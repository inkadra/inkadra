# Storage

Inkadra keeps three kinds of data:

| What                                 | Where                                 | Back it up |
| ------------------------------------ | ------------------------------------- | ---------- |
| Accounts, projects, boards, comments | Postgres (`postgres-data`)            | Yes        |
| Uploaded files and their previews    | `/data/files` in Inkadra, or a bucket | Yes        |
| Jobs waiting to run                  | Valkey (`valkey-data`)                | Not needed |

Files never change once uploaded: a new version is a new file. That makes them easy to copy
and to back up incrementally.

## A Docker volume (default)

Nothing to set. Compose creates the `inkadra-data` volume and keeps it across upgrades.
`docker volume inspect inkadra_inkadra-data` shows where Docker stores it.

## A folder on the host

To keep files on a disk, an array or a NAS dataset of your choice, set the folders in `.env`:

```sh
INKADRA_DATA=/mnt/tank/inkadra/data
POSTGRES_DATA=/mnt/tank/inkadra/postgres
```

The containers run as fixed, unprivileged users, so the folders must belong to them:

```sh
mkdir -p /mnt/tank/inkadra/data /mnt/tank/inkadra/postgres
chown -R 1000:1000 /mnt/tank/inkadra/data      # Inkadra runs as uid 1000
chown -R 70:70 /mnt/tank/inkadra/postgres      # postgres:16-alpine runs as uid 70
```

On TrueNAS SCALE, create a dataset per folder (for example `apps/inkadra/data` and
`apps/inkadra/postgres`), use the paths under `/mnt/<pool>/…`, and set the owners as above
from the shell or in the dataset permissions (user and group with those numeric ids). Keep
the database on a dataset with `sync=standard`, the default, never `disabled`.

Avoid network shares (NFS, SMB) for `POSTGRES_DATA`: Postgres needs local disk semantics. For
`INKADRA_DATA` a share works if it maps the owner to uid 1000.

## An S3-compatible bucket

Add [`deploy/compose.s3.yaml`](../../deploy/compose.s3.yaml) and fill in the bucket in `.env`:

```sh
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # empty for AWS
S3_REGION=auto                                           # us-east-1 if unsure
S3_BUCKET=inkadra
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_FORCE_PATH_STYLE=false                                # true for self-hosted stores
```

```sh
docker compose -f compose.yaml -f deploy/compose.s3.yaml up -d
```

The bucket must exist and stay private: Inkadra checks permissions before handing out any file.
The key needs to read, write, list and delete objects in that bucket only. The data volume stays
mounted: Inkadra writes upload parts and temporary files there before they move to the bucket,
so give it some free space (a few times your largest upload).

CI tests the S3 driver against RustFS. Other S3-compatible services (AWS, Cloudflare R2,
Backblaze B2, Garage, SeaweedFS, a MinIO server) speak the same API; self-hosted ones usually
need `S3_FORCE_PATH_STYLE=true`.

## A bundled S3 store (RustFS)

If you want object storage on the same machine, [`deploy/compose.rustfs.yaml`](../../deploy/compose.rustfs.yaml) runs
[RustFS](https://github.com/rustfs/rustfs) (Apache-2.0) next to Inkadra and creates the bucket.
Set two random values in `.env`:

```sh
S3_ACCESS_KEY_ID=$(openssl rand -hex 12)
S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
```

```sh
docker compose -f compose.yaml -f deploy/compose.rustfs.yaml up -d
```

RustFS is not published on the host: only Inkadra talks to it. Its data is in the
`rustfs-data` volume, or in `RUSTFS_DATA` (owned by uid 10001). MinIO's own server would work
the same way, but MinIO no longer publishes container images.

## Moving between local and S3

Switching `STORAGE_DRIVER` does not move the files already uploaded, so pick the storage before
you start real work. A command that moves files between drivers is planned with the backup
tools of 1.0.
