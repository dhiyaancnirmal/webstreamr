#!/bin/sh

set -eu

bind_address=$(/usr/bin/tailscale ip -4 | /usr/bin/head -n 1)

if [ -z "$bind_address" ]; then
  echo "Tailscale has no IPv4 address." >&2
  exit 1
fi

export BIND_ADDRESS="$bind_address"
exec /usr/bin/node dist/index.js
