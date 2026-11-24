#!/usr/bin/env bash
# k6 load tests against the running end-to-end stack (pnpm e2e:up), from a container in its
# network; k6 itself needs no installation.
#   scripts/load.sh capacity [smoke]     throughput and latency of the services
#   scripts/load.sh rate-limit           429 at the gateway
# The k6 summary is written to reports/load/<script>.json.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="${1:-}"
if [ ! -f "$root/tests/load/$script.js" ]; then
  echo "usage: scripts/load.sh capacity [smoke] | rate-limit" >&2
  exit 2
fi
mkdir -p "$root/reports/load"
smoke=0
if [ "${2:-}" = smoke ]; then smoke=1; fi
docker run --rm --network heatmap-e2e_default --user "$(id -u):$(id -g)" -e SMOKE="$smoke" \
  -v "$root/tests/load:/tests:ro" -v "$root/reports/load:/out" \
  grafana/k6:2.3.0 run --quiet --summary-export "/out/$script.json" "/tests/$script.js"
