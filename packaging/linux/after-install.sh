#!/bin/bash
# After install and after upgrade, for the .deb, .rpm and pacman packages.
#
# An electron-builder template, which reads a dollar sign and a braced word as
# one of its macros and fails on any it does not know. Shell variables in here
# are written $name, never with braces.
#
# The first part is electron-builder's own after-install (app-builder-lib
# 26.8.1, templates/linux/after-install.tpl), copied unchanged because giving a
# script replaces it. Re-copy it when upgrading electron-builder.


if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# ── The controller service ───────────────────────────────────────────────────
#
# The arguments tell a first install from an upgrade:
#   .deb     postinst      "configure" and the old version, empty on a first install
#   .rpm     %post         1 on a first install, 2 or more on an upgrade
#   pacman   post_install  only on a first install (upgrades run after-upgrade.sh)
#
# A first install enables and starts the controller. An upgrade only restarts
# it if it is running, so a grower who stopped or disabled it keeps it that way.
#
# `enable` works without a running systemd (a chroot or an image build), so it
# is not behind the check; reloading and starting need a live one.

if { [ "$1" = configure ] && [ -n "$2" ]; } || [ "$1" -ge 2 ] 2>/dev/null; then
    if [ -d /run/systemd/system ]; then
        systemctl daemon-reload || true
        # The running controller is on files that have just been replaced.
        systemctl try-restart canopy.service || true
    fi
else
    systemctl enable canopy.service >/dev/null 2>&1 || true
    if [ -d /run/systemd/system ]; then
        systemctl daemon-reload || true
        systemctl start canopy.service \
            || echo "Canopy: the controller service did not start. See: journalctl -u canopy"
    fi
fi
