#!/bin/bash
# Install a Canopy package for real, check the controller service end to end,
# then remove it. Needs sudo, systemd, and nothing else on ports 7001 and 1883.
#
#   packaging/linux/test-install.sh dist-build/canopy_0.1.0_amd64.deb
#   packaging/linux/test-install.sh dist-build/canopy-0.1.0.pacman
#   packaging/linux/test-install.sh release/canopy-controller-0.1.0-linux-x64.tar.gz
#
# CI runs it on the .deb and the tarball (.github/workflows/package.yml). The
# grow data it creates in /var/lib/canopy is left behind, as an uninstall
# would leave it; the last line says how to remove it.
set -euo pipefail

pkg=$(realpath "$1")
health=http://127.0.0.1:7001

step() { printf '\n== %s\n' "$*"; }
pass() { printf '   ok   %s\n' "$*"; }
fail() { printf '   FAIL %s\n' "$*" >&2; sudo journalctl -u canopy -n 40 --no-pager >&2 || true; exit 1; }

case "$pkg" in
  *.deb)    kind=deb ;;
  *.pacman) kind=pacman ;;
  *.tar.gz) kind=tarball ;;
  *) echo "Not a .deb, .pacman or controller .tar.gz: $pkg" >&2; exit 2 ;;
esac

install_pkg() {
  case $kind in
    deb)     sudo apt-get install -y --reinstall "$pkg" >/dev/null ;;
    pacman)  sudo pacman -U --noconfirm "$pkg" >/dev/null ;;
    tarball) local dir; dir=$(mktemp -d); tar -xzf "$pkg" -C "$dir"; sudo "$dir"/*/install.sh; rm -rf "$dir" ;;
  esac
}

remove_pkg() {
  case $kind in
    deb)     sudo apt-get remove -y canopy >/dev/null ;;
    pacman)  sudo pacman -R --noconfirm canopy >/dev/null ;;
    tarball) sudo /opt/Canopy/uninstall.sh ;;
  esac
}

# Polls until the controller answers, or fails after $1 seconds.
wait_healthy() {
  for _ in $(seq 1 "$(( $1 * 2 ))"); do
    curl -sf "$health/health" >/dev/null && return 0
    sleep 0.5
  done
  return 1
}

main_pid() { systemctl show -p MainPID --value canopy; }

step "install ($kind)"
install_pkg
wait_healthy 30 || fail "the controller did not answer within 30 s of installing"
pass "answers on $health"
[ "$(systemctl is-active canopy)" = active ] || fail "canopy.service is not active"
[ "$(systemctl is-enabled canopy)" = enabled ] || fail "canopy.service is not enabled, so it would not start at boot"
pass "service active and enabled"

status=$(curl -sf "$health/controller/status")
grep -q '"installed":true' <<<"$status" || fail "the controller does not report itself installed: $status"
grep -q '"dataDir":"/var/lib/canopy"' <<<"$status" || fail "the data directory is not /var/lib/canopy: $status"
pass "reports installed, data in /var/lib/canopy"

user=$(ps -o user= -p "$(main_pid)")
[ "$user" != root ] || fail "the controller runs as root"
pass "runs as '$user', not root (DynamicUser)"

step "stop and start"
since=$(date '+%Y-%m-%d %H:%M:%S')
sudo systemctl stop canopy
# Only this stop's lines: an earlier run's would pass the check falsely.
sudo journalctl -u canopy --since "$since" --no-pager | grep -q "stopped cleanly" || fail "no clean shutdown in the journal"
pass "a stop shuts down cleanly"
sudo systemctl start canopy
wait_healthy 30 || fail "did not come back after start"
pass "starts again"

step "crash"
before=$(main_pid)
sudo kill -9 "$before"
wait_healthy 30 || fail "not restarted within 30 s of being killed"
[ "$(main_pid)" != "$before" ] || fail "the same process is still running"
pass "restarted after kill -9"

step "upgrade (reinstall)"
before=$(main_pid)
install_pkg
wait_healthy 30 || fail "not answering after the upgrade"
[ "$(main_pid)" != "$before" ] || fail "an upgrade did not restart the controller onto the new files"
pass "an upgrade restarts a running controller"

sudo systemctl stop canopy
install_pkg
[ "$(systemctl is-active canopy || true)" != active ] || fail "an upgrade started a controller that had been stopped on purpose"
pass "an upgrade leaves a stopped controller stopped"
sudo systemctl start canopy
wait_healthy 30 || fail "did not start again"

step "remove"
remove_pkg
! systemctl cat canopy >/dev/null 2>&1 || fail "canopy.service is still installed"
! curl -sf "$health/health" >/dev/null || fail "the controller still answers after removal"
pass "service removed and stopped"
sudo test -f /var/lib/private/canopy/canopy.db || fail "the grow data was deleted"
pass "grow data kept in /var/lib/canopy"

printf '\nAll checks passed for %s.\nTo remove the test data too: sudo rm -rf /var/lib/private/canopy /var/lib/canopy\n' "$(basename "$pkg")"
