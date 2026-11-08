# Storage

Inkadra keeps three kinds of data:

| What                                 | Where                                 | Back it up                              |
| ------------------------------------ | ------------------------------------- | --------------------------------------- |
| Accounts, projects, boards, comments | Postgres (`postgres-data`)            | Yes                                     |
| Uploaded files and their previews    | `/data/files` in Inkadra, or a bucket | Yes                                     |
| Jobs waiting to run, sign-in limits  | Valkey (`valkey-data`)                | With the rest, though it can be rebuilt |

If Valkey's data is lost, the queues are rebuilt when the server starts: only jobs that were
waiting to run are lost, and the sign-in counters start again.

Files never change once uploaded: a new version is a new file. That makes them easy to copy
and to back up incrementally.

## A Docker volume (default)

Nothing to set. Compose creates the `inkadra-data` volume and keeps it across upgrades.
`docker volume inspect inkadra_inkadra-data` shows where Docker stores it.

## A folder on the host

To keep files on a disk, an array or a NAS dataset of your choice, set the folders in `.env`
(for each kind of data on a different disk, see
[Data on different disks](#data-on-different-disks)):

```sh
INKADRA_DATA=/mnt/tank/inkadra/data
POSTGRES_DATA=/mnt/tank/inkadra/postgres
```

The containers run as fixed, unprivileged users. Inkadra runs as uid 1000 and, with
`compose.yaml`, gives its data folder to that user when it starts. The Postgres folder must
belong to uid 70 beforehand:

```sh
mkdir -p /mnt/tank/inkadra/data /mnt/tank/inkadra/postgres
chown -R 70:70 /mnt/tank/inkadra/postgres      # postgres:18-alpine runs as uid 70
chown -R 1000:1000 /mnt/tank/inkadra/data      # optional with compose.yaml, needed without it
```

On TrueNAS SCALE, create a dataset per folder (for example `apps/inkadra/data` and
`apps/inkadra/postgres`), use the paths under `/mnt/<pool>/…`, and set the owners as above
from the shell or in the dataset permissions (user and group with those numeric ids). Keep
the database on a dataset with `sync=standard`, the default, never `disabled`.

PostgreSQL 18 keeps its files in `18/docker` inside that folder, so the folder is meant for
this one purpose; a folder that holds the files of PostgreSQL 16 directly (`PG_VERSION`,
`base/`) is refused, see [Upgrades](upgrades.md#upgrading-to-postgresql-18).

Avoid network shares (NFS, SMB) for `POSTGRES_DATA`: Postgres needs local disk semantics. For
`INKADRA_DATA` a share works if it maps the owner to uid 1000.

## Data on different disks

Files want a large disk, the database wants a fast one. Each kind of data can live on its own disk
by giving it its own folder in `.env`, for example files on large hard disks and the rest on an SSD:

```sh
INKADRA_DATA=/mnt/hdd/inkadra/data          # uploads, previews, nightly backups, upload parts
POSTGRES_DATA=/mnt/ssd/inkadra/postgres     # the database: this is what makes the app feel fast
VALKEY_DATA=/mnt/ssd/inkadra/valkey         # job queues and sign-in limits
```

Make the folders and give them to the right users before the first start:

```sh
sudo mkdir -p /mnt/hdd/inkadra/data /mnt/ssd/inkadra/postgres /mnt/ssd/inkadra/valkey
sudo chown -R 1000:1000 /mnt/hdd/inkadra/data       # Inkadra runs as uid 1000
sudo chown -R 70:70 /mnt/ssd/inkadra/postgres       # postgres:18-alpine runs as uid 70
docker compose up -d --wait
```

| Folder          | Owner                 | Who sets it                                                          |
| --------------- | --------------------- | -------------------------------------------------------------------- |
| `INKADRA_DATA`  | uid 1000              | You, or `compose.yaml`, which gives it to uid 1000 at startup        |
| `POSTGRES_DATA` | uid 70                | You, beforehand. PostgreSQL keeps its files in `18/docker` inside it |
| `VALKEY_DATA`   | uid 999, in the image | The Valkey image, at startup: leave it as it is                      |

The owners are numbers: on the host they may show up as other names, or as no name at all. Keep
`tmp` and `backups` inside `INKADRA_DATA`, as they come: do not mount them on a disk of their own.

### Backing up the folders

**All three folders belong in your backups,** together with `.env`. `INKADRA_DATA` holds your files
and the nightly zips of the database, which are the safest way to get the database back on
[another server or a newer version](README.md#backups). A copy of `POSTGRES_DATA` is only good with
the same major version of PostgreSQL and only if it was made with the containers stopped: copied
while Postgres writes, it can be damaged without any error. Keep the owners when you copy:

```sh
docker compose stop
sudo tar czf inkadra-folders.tgz --numeric-owner /mnt/hdd/inkadra/data /mnt/ssd/inkadra/postgres /mnt/ssd/inkadra/valkey
docker compose up -d --wait
```

To restore, stop the containers, unpack the archive with
`sudo tar xzf inkadra-folders.tgz --numeric-owner -C /`, and start them again.

### Moving an existing install to folders

Stop everything, copy each volume with its owners, add the three lines to `.env`, and start.
`docker compose down` keeps the volumes, so they remain as your way back until you remove them.
This copies the default volumes of `compose.yaml` to the folders above:

```sh
docker compose down
docker run --rm -v inkadra_inkadra-data:/from -v /mnt/hdd/inkadra/data:/to alpine cp -a /from/. /to/
docker run --rm -v inkadra_postgres-data:/from -v /mnt/ssd/inkadra/postgres:/to alpine cp -a /from/. /to/
docker run --rm -v inkadra_valkey-data:/from -v /mnt/ssd/inkadra/valkey:/to alpine cp -a /from/. /to/
# add INKADRA_DATA, POSTGRES_DATA and VALKEY_DATA to .env
docker compose up -d --wait
```

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
you start real work. A command that moves files between drivers is planned for 1.0; meanwhile
exporting projects and importing them on an instance with the other driver moves them one by
one.

## Space limits

Off by default. In **Settings → Storage** an administrator can set the space of the whole
instance, a default space for each person and, from **Members**, a limit of one's own for a
person. They count originals and the copies and previews Inkadra makes of them; past a limit only
new files are refused, nothing is deleted. To fix them for an instance you host for someone
else, set `STORAGE_LIMIT` and `STORAGE_LIMIT_PER_USER` (see [Configuration](configuration.md)):
the fields are then read-only in Settings. See
[decision 0081](../decisions/0081-storage-limits.md).
