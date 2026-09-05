#!/bin/sh
set -eu
usage() {
  printf '%s\n' 'Usage: verify-install.sh [--repo PATH] [--skip-install] [--quick] [--with-payer]' \
    'Verifies the merchant source checkout. --with-payer also verifies the separate payer package.' \
    'No wallet secrets are read. --quick is for local iteration, not release acceptance.'
}
repo=""
skip_install=0
quick=0
with_payer=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; repo=$2; shift 2 ;;
    --skip-install) skip_install=1; shift ;;
    --quick) quick=1; shift ;;
    --with-payer) with_payer=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option. Run --help.\n' >&2; exit 2 ;;
  esac
done
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -n "$repo" ] || repo=$(CDPATH= cd -- "$script_dir/.." && pwd)
cd "$repo"
[ -f package-lock.json ] || { printf 'Not a PPOps source checkout.\n' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { printf 'Install Node 24 or use Docker.\n' >&2; exit 1; }
if [ "$skip_install" -eq 0 ]; then npm ci; fi
if [ "$quick" -eq 1 ]; then npm run typecheck && npm run build; else npm run verify; fi
if [ "$with_payer" -eq 1 ]; then
  if [ "$skip_install" -eq 0 ]; then npm run payer:install; fi
  if [ "$quick" -eq 1 ]; then
    npm --prefix tools/ppops-payer run typecheck
    npm --prefix tools/ppops-payer run build
  else npm run payer:verify; fi
fi
printf 'Installation verified. Next: npm run demo, or follow docs/QUICKSTART.md.\n'
