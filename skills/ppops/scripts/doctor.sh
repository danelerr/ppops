#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
previous=""
for argument in "$@"; do
  if [ "$previous" = "--repo" ]; then repo=$argument; fi
  previous=$argument
done
if [ ! -f "$repo/scripts/doctor.sh" ]; then
  printf 'Usage: doctor.sh --repo PATH [options]\nUse a full PPOps source checkout; see its docs/CLI.md.\n' >&2
  exit 1
fi
exec sh "$repo/scripts/doctor.sh" "$@"
