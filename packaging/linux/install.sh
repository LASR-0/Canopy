#!/bin/sh
# Install the Canopy controller as a systemd service, without the desktop app:
# for a headless box by the tent, or a distro without a Canopy package.
#
#   sudo ./install.sh
#
# Run it again from a newer tarball to upgrade. It needs systemd and glibc;
# the controller brings its own Node.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
prefix=/opt/Canopy
unit=/etc/systemd/system/canopy.service

fail() { echo "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run it as root: sudo $0"
[ -d /run/systemd/system ] || fail "This system is not running systemd, which the Canopy controller needs."
if [ -e /usr/lib/systemd/system/canopy.service ] || [ -e /lib/systemd/system/canopy.service ]; then
    fail "The Canopy desktop package is installed, and it already includes the controller."
fi
# Catches the wrong architecture, and musl distros such as Alpine, before
# anything is changed.
"$here/controller/node" --version >/dev/null 2>&1 \
    || fail "The controller's Node does not run on this system (wrong architecture, or not glibc)."

upgrade=no
[ -e "$unit" ] && upgrade=yes

# Copied beside the live install, then swapped in, so a failed copy never
# leaves half an install. A running controller keeps its open files until it
# is restarted below.
mkdir -p "$prefix"
rm -rf "$prefix/controller.new" "$prefix/controller.old"
cp -R "$here/controller" "$prefix/controller.new"
[ -d "$prefix/controller" ] && mv "$prefix/controller" "$prefix/controller.old"
mv "$prefix/controller.new" "$prefix/controller"
rm -rf "$prefix/controller.old"
install -m 0755 "$here/uninstall.sh" "$prefix/uninstall.sh"
install -m 0644 "$here/canopy.service" "$unit"
systemctl daemon-reload

if [ "$upgrade" = yes ]; then
    # Respects a controller that was stopped or disabled on purpose.
    systemctl try-restart canopy.service
    echo "Canopy controller upgraded."
else
    systemctl enable --now canopy.service
    echo "Canopy controller installed and started."
fi
echo "Status: systemctl status canopy    Logs: journalctl -u canopy"
echo "Remove: sudo $prefix/uninstall.sh"
