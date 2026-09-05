#!/bin/sh
set -eu
usage() { printf '%s\n' 'Usage: doctor.sh [--repo PATH] [--config PATH] [--offline]' 'Compatibility wrapper for the built ppops doctor command.'; }
repo=""
config=""
offline=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) [ "$#" -ge 2 ] || exit 2; repo=$2; shift 2 ;;
    --config) [ "$#" -ge 2 ] || exit 2; config=$2; shift 2 ;;
    --offline) offline=--offline; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -n "$repo" ] || repo=$(CDPATH= cd -- "$script_dir/.." && pwd)
[ -n "$config" ] || config="$repo/ppops.config.json"
[ -f "$repo/dist/cli.js" ] || { printf 'Build missing. Run npm ci and npm run build in the source checkout.\n' >&2; exit 1; }
if [ -n "$offline" ]; then exec node "$repo/dist/cli.js" doctor --config "$config" --offline; fi
exec node "$repo/dist/cli.js" doctor --config "$config"
