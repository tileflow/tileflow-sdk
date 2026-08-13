#!/usr/bin/env bash
set -euo pipefail

expected_root="$HOME/.cache/ms-playwright/chromium_headless_shell-1223"
chromium_path="$expected_root/chrome-headless-shell-linux64/chrome-headless-shell"

if [[ "$(uname -m)" != x86_64 ]]
then
  echo "The pinned CI sandbox profile only supports Linux x86_64." >&2
  exit 1
fi

if [[ ! -x "$chromium_path" ]]
then
  echo "Pinned Chromium executable is missing: $chromium_path" >&2
  exit 1
fi

# Prevent later unprivileged steps from replacing the exact binary authorized below.
sudo chown -R root:root "$HOME/.cache/ms-playwright"
sudo chmod -R go-w "$HOME/.cache/ms-playwright"

profile_path=/etc/apparmor.d/tileflow-playwright-chromium
{
  echo 'abi <abi/4.0>,'
  echo 'include <tunables/global>'
  echo
  printf 'profile tileflow-playwright-chromium "%s" flags=(unconfined) {\n' "$chromium_path"
  echo '  userns,'
  echo '}'
} | sudo tee "$profile_path" >/dev/null

sudo apparmor_parser -r "$profile_path"
echo "Authorized user namespaces only for $chromium_path"
