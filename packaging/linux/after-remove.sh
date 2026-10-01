#!/bin/bash
# After removal, for the .deb, .rpm and pacman packages.
#
# An electron-builder template, which reads a dollar sign and a braced word as
# one of its macros and fails on any it does not know. Shell variables in here
# are written $name, never with braces.

# Also called while upgrading, after the new version's after-install has run:
# the .deb passes "upgrade", the .rpm passes 1 (the number of versions left).
# Removing the command link then would break the upgrade that just made it.
case "$1" in
    upgrade|1) exit 0 ;;
esac

# electron-builder's own after-remove (app-builder-lib 26.8.1), unchanged.

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/usr/bin/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  rm -f "$APPARMOR_PROFILE_DEST"
fi
# The controller was stopped by before-remove.sh, and its unit file is gone
# now. The data in /var/lib/canopy is kept: uninstalling never deletes grow
# history. Remove it by hand, if that is really wanted.
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true
fi
