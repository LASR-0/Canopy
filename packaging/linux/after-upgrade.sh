#!/bin/sh
# After upgrade, for the pacman package only (post_upgrade). Passed to fpm
# directly, so it is not a template.
#
# The .deb and .rpm run after-install.sh on upgrade and tell the two apart by
# its arguments. Giving them this script too would switch fpm to wrapping every
# script in /bin/sh, and electron-builder's part of after-install.sh is bash.
#
# Keep in step with the upgrade branch of after-install.sh.
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true
    systemctl try-restart canopy.service || true
fi
