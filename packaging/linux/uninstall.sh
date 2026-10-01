#!/bin/sh
# Remove the Canopy controller installed by install.sh.
#
#   sudo /opt/Canopy/uninstall.sh
#
# The data in /var/lib/canopy is kept: uninstalling never deletes grow history.
set -eu

prefix=/opt/Canopy
unit=/etc/systemd/system/canopy.service

fail() { echo "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run it as root: sudo $0"
[ -e "$unit" ] || fail "No controller installed by install.sh here. A desktop package is removed with its package manager."

systemctl disable --now canopy.service || true
rm -f "$unit"
systemctl daemon-reload
rm -rf "$prefix/controller" "$prefix/uninstall.sh"
rmdir "$prefix" 2>/dev/null || true

echo "Canopy controller removed. Its data is still in /var/lib/canopy;"
echo "to delete it too: sudo rm -rf /var/lib/private/canopy /var/lib/canopy"
