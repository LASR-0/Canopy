#!/bin/sh
# Before removal, for the .deb, .rpm and pacman packages: stop the controller
# while its files still exist. Passed to fpm directly, so it is not a template.
#
# Also called while upgrading, where it must leave the service alone, because
# after-install.sh restarts it on the new files:
#   .deb     prerm      "remove" | "upgrade" | "failed-upgrade" | "deconfigure"
#   .rpm     %preun     0 on removal, 1 on upgrade
#   pacman   pre_remove only on removal
case "$1" in
    upgrade|failed-upgrade|1) exit 0 ;;
esac

systemctl disable canopy.service >/dev/null 2>&1 || true
if [ -d /run/systemd/system ]; then
    systemctl stop canopy.service || true
fi
