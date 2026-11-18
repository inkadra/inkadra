#!/bin/sh
# Starts the server as the node user with a data folder it can write to.
#
# Started as root (compose.yaml does this), it gives DATA_DIR to node when the folder or one of
# its entries belongs to someone else, for example a host folder created by root, and BACKUP_DIR
# itself (never its contents) when node cannot write to it, then drops to node. Started as any other user, it checks that DATA_DIR is writable and explains what to do
# when it is not. See docs/self-hosting/upgrades.md.
set -eu

data=${DATA_DIR:-/data}
uid=$(id -u node)
gid=$(id -g node)

die() {
  echo "inkadra: $*" >&2
  exit 1
}

# Capability bits from linux/capability.h.
CAP_CHOWN=0
CAP_SETGID=6
CAP_SETUID=7
has_cap() {
  eff=$(sed -n 's/^CapEff:[[:space:]]*//p' /proc/self/status)
  [ $(((0x$eff >> $1) & 1)) -eq 1 ]
}

if [ "$(id -u)" = 0 ]; then
  has_cap $CAP_SETUID && has_cap $CAP_SETGID ||
    die "started as root without the SETUID and SETGID capabilities, so it cannot switch to" \
      "the node user. Use the compose.yaml of this release (it adds them with cap_add), or" \
      "run the container as uid $uid."
  # Switching from root to another user clears every capability. node keeps its own groups and
  # those compose adds with group_add (the render group of /dev/dri for hardware encoding), but
  # never the root group.
  groups=$({ id -G node; id -G; } | tr ' ' '\n' | grep -vx 0 | sort -un | paste -sd, -)
  mkdir -p "$data"
  # Only the folder and its direct entries: a full scan on every start would be slow on large
  # libraries, and a folder that changed hands is wrong at the top too.
  if [ -n "$(find "$data" -maxdepth 1 ! -user "$uid" -print -quit)" ]; then
    has_cap $CAP_CHOWN || die "$data is not owned by uid $uid and the CHOWN capability is missing."
    echo "inkadra: giving $data to uid $uid:$gid (once, it belonged to another user)" >&2
    chown -R "$uid:$gid" "$data"
  fi
  # BACKUP_DIR, when backups live on a mount of their own (#899), often a NAS share: never a
  # recursive chown there (slow, and not ours to rewrite). When node cannot write to it, only
  # the folder itself is given to node, and a failure never stops the start: the server's own
  # check (checkBackupDir) then names the folder and what to do.
  if [ -n "${BACKUP_DIR:-}" ]; then
    mkdir -p "$BACKUP_DIR" 2>/dev/null || true
    if ! setpriv --reuid="$uid" --regid="$gid" --groups="$groups" -- \
      sh -c 'test -w "$1" && test -x "$1"' sh "$BACKUP_DIR" 2>/dev/null; then
      if has_cap $CAP_CHOWN && chown "$uid:$gid" "$BACKUP_DIR" 2>/dev/null; then
        echo "inkadra: gave the folder $BACKUP_DIR (not its contents) to uid $uid:$gid" >&2
      else
        echo "inkadra: uid $uid cannot write to $BACKUP_DIR and its owner could not be changed" >&2
      fi
    fi
  fi
  exec setpriv --reuid="$uid" --regid="$gid" --groups="$groups" -- "$0" "$@"
fi

if ! mkdir -p "${TMPDIR:-$data/tmp}" 2>/dev/null || [ ! -w "$data" ]; then
  owner=$(stat -c '%u:%g' "$data" 2>/dev/null || echo unknown)
  die "cannot write to $data (owned by $owner, running as uid $(id -u))." \
    "Give the folder to uid $uid on the host, for example" \
    "'sudo chown -R $uid:$gid /path/to/the/folder', or use the compose.yaml of this release," \
    "which fixes the owner at startup."
fi

# tini (reaps the worker's ffmpeg, forwards signals) runs as node too: as root without CAP_KILL
# (compose.yaml drops every capability) it could not pass SIGTERM on, the container died at once
# and the server skipped its shutdown: boards unsaved, the lease held for its whole TTL (#926).
exec tini -- node /app/dist/main.js "$@"
