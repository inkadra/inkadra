#!/usr/bin/env bash
# Loads Ubuntu's bwrap-userns-restrict AppArmor profile where the host restricts unprivileged user
# namespaces (kernel.apparmor_restrict_unprivileged_userns=1) and no profile named bwrap is loaded.
# Without it, bubblewrap in the Office worker has no capabilities in its namespaces and stops at
# "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted" (docs/self-hosting/office.md).
# The host keeps its restriction: the profile lets only /usr/bin/bwrap use user namespaces, and
# takes the capabilities away from what bwrap starts. The sysctl is never changed.
#
#   scripts/bwrap-apparmor.sh
#
# Needs sudo, apparmor_parser and, where the distribution does not ship the profile (Ubuntu
# 24.04), curl and dpkg-deb: the profile then comes from Ubuntu 25.04's apparmor package, pinned
# by checksum (its `abi <abi/4.0>` loads on 24.04's parser), and is installed where Ubuntu puts
# it, so it is loaded again after a reboot.
set -euo pipefail

restrict=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo absent)
echo "kernel.apparmor_restrict_unprivileged_userns=$restrict"
if [ "$restrict" != 1 ]; then
  echo "No restriction of unprivileged user namespaces here: nothing to load"
  exit 0
fi

loaded() { sudo grep -qE '^bwrap \(' /sys/kernel/security/apparmor/profiles; }
# shortcut: looks for a profile named bwrap, the name Ubuntu's has; a profile under another name
# that attaches to /usr/bin/bwrap is not seen, and this one is loaded next to it.
if loaded; then
  echo "An AppArmor profile named bwrap is already loaded: nothing to do"
  exit 0
fi

profile=/etc/apparmor.d/bwrap-userns-restrict
if [ -e "$profile" ]; then
  echo "Loading $profile, already on this host"
else
  deb=apparmor_4.1.0~beta5-0ubuntu14.2_amd64.deb
  sum=3d23c163e85e7785c79922f34c12d34710e61c86b4ae3960dd703dd8b3576031
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  echo "No $profile here: taking it from Ubuntu's $deb"
  curl -sSfL --retry 6 --retry-all-errors --retry-delay 10 -o "$work/apparmor.deb" \
    "https://launchpad.net/ubuntu/+archive/primary/+files/$deb"
  echo "$sum  $work/apparmor.deb" | sha256sum -c -
  dpkg-deb -x "$work/apparmor.deb" "$work/x"
  sudo install -m 644 "$work/x/etc/apparmor.d/bwrap-userns-restrict" "$profile"
  echo "Installed $profile"
fi

sudo apparmor_parser -r "$profile"
if ! loaded; then
  echo "apparmor_parser ran, but no profile named bwrap is loaded" >&2
  exit 1
fi
echo "Loaded: bwrap may use user namespaces, the processes it starts get no capabilities"
