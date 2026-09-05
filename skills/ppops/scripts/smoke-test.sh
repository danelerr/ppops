#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: smoke-test.sh --api-token-file PATH [--base-url URL]

Performs read-only liveness, readiness, authenticated runtime, and metrics
checks against a running PPOps daemon. It creates no intent and sends no funds.
EOF
}

token_file=""
base_url="http://127.0.0.1:8787"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --api-token-file) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; token_file=$2; shift 2 ;;
    --base-url) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; base_url=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$token_file" ] || { usage >&2; exit 2; }
[ -f "$token_file" ] || { printf 'API token file not found\n' >&2; exit 1; }
[ ! -L "$token_file" ] || { printf 'API token file must not be a symlink\n' >&2; exit 1; }
mode=$(stat -c '%a' "$token_file" 2>/dev/null || stat -f '%Lp' "$token_file" 2>/dev/null || true)
[ "$mode" = "600" ] || { printf 'API token file must be owner-only (0600)\n' >&2; exit 1; }
owner=$(stat -c '%u' "$token_file" 2>/dev/null || stat -f '%u' "$token_file" 2>/dev/null || true)
[ -n "$owner" ] && [ "$owner" = "$(id -u)" ] || { printf 'API token file must be owned by the current user\n' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { printf 'curl is required\n' >&2; exit 1; }

api_token=$(tr -d '\r\n' < "$token_file")
[ -n "$api_token" ] || { printf 'API token file is empty\n' >&2; exit 1; }

authenticated_curl() {
  printf 'header = "Authorization: Bearer %s"\n' "$api_token" |
    curl --config - "$@"
}

curl -fsS --max-time 5 "$base_url/v1/live" >/dev/null
printf 'PASS  liveness\n'
curl -fsS --max-time 5 "$base_url/v1/ready" >/dev/null
printf 'PASS  reconciliation readiness\n'
authenticated_curl -fsS --max-time 5 "$base_url/v1/runtime" >/dev/null
printf 'PASS  authenticated runtime\n'
metrics=$(authenticated_curl -fsS --max-time 5 "$base_url/v1/metrics")
printf '%s\n' "$metrics" | grep -q '^ppops_ready 1$'
printf 'PASS  authenticated metrics report ready\n'
printf '\nSMOKE TEST PASS (read-only; no intent or payment submitted)\n'
