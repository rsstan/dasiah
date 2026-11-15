#!/usr/bin/env bash
# Prepares OSRM car-routing data for a city (MLD pipeline, docs/05-algorithms.md#7):
#   1. download the regional OpenStreetMap extract from Geofabrik (ODbL);
#   2. osrm-extract with the car profile, osrm-partition, osrm-customize.
# The result goes to infra/osrm/data/<city>/ (ignored by Git) and is served by the Compose
# services osrm-<city> (profile `osrm`).
#
#   infra/osrm/build.sh vno      # Lithuania, about 225 MB download
#   infra/osrm/build.sh waw      # Mazowieckie, about 300 MB download
#
# Needs Docker and several GB of free memory for the extract step.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v26.4.0}"
city="${1:?usage: infra/osrm/build.sh vno|waw}"
case "$city" in
  vno) region=lithuania; url=https://download.geofabrik.de/europe/lithuania-latest.osm.pbf ;;
  waw) region=mazowieckie; url=https://download.geofabrik.de/europe/poland/mazowieckie-latest.osm.pbf ;;
  *) echo "unknown city $city" >&2; exit 1 ;;
esac
dir="$root/infra/osrm/data/$city"
mkdir -p "$dir"

if [ ! -f "$dir/$region.osm.pbf" ]; then
  echo "downloading $url"
  curl -fL --retry 3 -o "$dir/$region.osm.pbf.part" "$url"
  mv "$dir/$region.osm.pbf.part" "$dir/$region.osm.pbf"
fi

run() { docker run --rm -v "$dir:/data" "$image" "$@"; }
start=$(date +%s)
run osrm-extract -p /opt/car.lua "/data/$region.osm.pbf"
run osrm-partition "/data/$region.osrm"
run osrm-customize "/data/$region.osrm"
touch "$dir/.ready"   # tells automation (infra/terraform/vps) that the data is complete
echo "OSRM data for $city ready in $dir ($(( $(date +%s) - start )) s); start: pnpm compose --profile osrm up -d osrm-$city"
