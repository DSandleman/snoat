#!/usr/bin/env bash
# Henter ned referansekoden vi låner arkitektur fra. Se backend/vendor/README.md.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/backend/vendor"

clone_or_update() {
  local name="$1" url="$2"
  local dir="$VENDOR_DIR/$name"

  if [ -d "$dir/.git" ]; then
    echo "==> Oppdaterer $name"
    git -C "$dir" fetch --depth 1 origin HEAD
    git -C "$dir" reset --hard FETCH_HEAD
  else
    echo "==> Kloner $name"
    git clone --depth 1 "$url" "$dir"
  fi
}

mkdir -p "$VENDOR_DIR"
clone_or_update dokploy https://github.com/Dokploy/dokploy.git

echo "Ferdig. Merk: kataloger som heter 'proprietary' er IKKE Apache 2.0 og skal ikke gjenbrukes."
