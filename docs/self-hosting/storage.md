# Storage

Inkadra keeps three kinds of data:

| What                                 | Where                                 | Back it up                              |
| ------------------------------------ | ------------------------------------- | --------------------------------------- |
| Accounts, projects, boards, comments | Postgres (`postgres-data`)            | Yes                                     |
| Uploaded files and their previews    | `/data/files` in Inkadra, or a bucket | Yes                                     |
| Jobs waiting to run, sign-in limits  | Valkey (`valkey-data`)                | With the rest, though it can be rebuilt |

If Valkey's data is lost, the queues are rebuilt: only jobs that were waiting to run are lost,
and the sign-in counters start again. The worker registers the recurring jobs (nightly backup,
emails, clean-ups) again within five minutes, and the Server page alerts administrators when no
backup has succeeded for two days while backups are on.

Uploaded files are immutable; back them up incrementally.

## A Docker volume (default)

Compose creates the `inkadra-data` volume and keeps it across upgrades.
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

Set a separate host folder for each kind of data in `.env`:

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

An upload that never finishes is an open multipart upload in the bucket. Inkadra aborts it when
it removes the upload, a day later. As a safety net for uploads it cannot abort (the bucket
refused, or the file was removed by hand), add a lifecycle rule that aborts incomplete multipart
uploads after two days, if your service supports one (AWS, R2 and B2 do):

```json
{
  "Rules": [
    {
      "ID": "abort-incomplete-uploads",
      "Status": "Enabled",
      "Filter": {},
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 2 }
    }
  ]
}
```

### Browsers fetch from the bucket

By default every file goes through Inkadra: the bucket never needs to be reachable from outside,
but each byte crosses the server twice. With `S3_PUBLIC_REDIRECT=true`, Inkadra still checks who
may see a file, then answers with a redirect to a signed link of the bucket, and the browser
downloads or plays it from there: originals and playable copies (links valid for four hours, as
a video keeps playing from the address it was sent to) and video segments (ten minutes, asked
again for every segment). Thumbnails, files of guests' downloads and the videos of guests who
may not download still go through the server, and so do the app and anything else that signs
in with a token.

Turn it on only when browsers can reach the bucket:

- `S3_PUBLIC_ENDPOINT`: the bucket's address as browsers see it, when the server uses another
  one (for example `S3_ENDPOINT=http://rustfs:9000` inside Docker,
  `S3_PUBLIC_ENDPOINT=https://files.example.com` behind your proxy). The page's security policy
  allows that address.
- A CORS rule on the bucket for your `PUBLIC_URL`, since the video player fetches segments with
  script:

```json
[
  {
    "AllowedOrigins": ["https://inkadra.example.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The bucket stays private: a signed link opens one file, for a limited time. It is a bearer link
until then: whoever has it can fetch that file, and taking away someone's access, or a share
link, does not end the links they already received (up to four hours for an original or a
playable copy, ten minutes for a video segment). Leave the redirect off if that matters more
than the server's bandwidth.

Redirected files are not kept by the browser as unchanging (each link is new), so watching the
same video again downloads it again from the bucket: count on more egress from it.

Inkadra warns at startup when `S3_PUBLIC_REDIRECT` points browsers at plain http under an https
`PUBLIC_URL`, or at an address that looks internal (no `S3_PUBLIC_ENDPOINT`, a host name without
a dot such as `rustfs`).

CI tests the S3 driver against RustFS. Other S3-compatible services (AWS, Cloudflare R2,
Backblaze B2, Garage, SeaweedFS, a MinIO server) speak the same API; self-hosted ones usually
need `S3_FORCE_PATH_STYLE=true`.

## A bundled S3 store (RustFS)

If you want object storage on the same machine, [`deploy/compose.rustfs.yaml`](../../deploy/compose.rustfs.yaml) runs
[RustFS](https://github.com/rustfs/rustfs) (Apache-2.0) next to Inkadra and creates the bucket.
Set two random values in `.env`:

```sh
printf 'S3_ACCESS_KEY_ID=%s\nS3_SECRET_ACCESS_KEY=%s\n' \
  "$(openssl rand -hex 12)" "$(openssl rand -hex 32)" >> .env
```

```sh
docker compose -f compose.yaml -f deploy/compose.rustfs.yaml up -d
```

RustFS is not published on the host: only Inkadra talks to it. Its data is in the
`rustfs-data` volume, or in `RUSTFS_DATA` (owned by uid 10001).

## Moving between local and S3

Switching `STORAGE_DRIVER` does not move the files already uploaded, so pick the storage before
you start real work. Exporting projects and importing them on an instance with the other driver moves them one by
one.

## Space limits

Off by default. In **Settings → Storage** an administrator can set the space of the whole
instance, a default space for each person and, from **Members**, a limit of one's own for a
person. They count originals and the copies and previews Inkadra makes of them; past a limit only
new files are refused, nothing is deleted. To fix them for an instance you host for someone
else, set `STORAGE_LIMIT` and `STORAGE_LIMIT_PER_USER` (see [Configuration](configuration.md)):
the fields are then read-only in Settings. See
[decision 0081](../decisions/0081-storage-limits.md).
