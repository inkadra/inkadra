# 0131 — compose.yaml hands .env to the container

## Context

`compose.yaml` listed about 50 settings one by one, each as `${NAME:-default}` with a copy of the
server's default. About 40 documented settings were not listed (`TZ`, `IMPORT_MAX_SIZE`,
`OFFICE_PREVIEWS`, the video quality ones…): written in `.env` they did nothing until the compose
file was edited too, and every new setting needed a compose change.

## Decision

The `inkadra` service reads `${INKADRA_ENV_FILE:-.env}` with `env_file`, which is required, so a
missing file stops Compose with its own error. `environment` keeps only the `:?` checks of
`PUBLIC_URL` and `AUTH_SECRET` and the computed `DATABASE_URL` and `REDIS_URL`, which win over the
same names in the file. Variants keep fixed values, required checks and other services' settings,
and drop what only repeated `.env`. The server reads an empty variable as unset, once, before
validation, except `FEEDBACK_RELAY_URL`, where empty turns the relay off.

## Consequences

`.env.example` is the one list of settings, and `.env` alone is enough for any of them. Every line
of `.env` reaches the container, so the demo blanks `CLOUDFLARE_TUNNEL_TOKEN` for it. People who
use `--env-file` set `INKADRA_ENV_FILE` to the same file; variables set only in the shell no longer
reach the container. The new `compose.yaml` needs a server that reads empty values as unset.
