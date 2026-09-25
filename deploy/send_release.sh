#!/usr/bin/env bash
# Upload one app's built files to the release receiver:
#   deploy/send_release.sh <site-dir> <commit-sha>
# Needs PLAY_DEPLOY_URL (https://<site>/internal/releases/<app>) and PLAY_DEPLOY_TOKEN, both from secrets
# so that Actions masks them in logs; the script never prints the URL or curl's error text.
# The same script is copied into every game repo; GitHub Actions uses it, and it works by hand as a fallback.
set -euo pipefail
dir=${1:?site dir}; commit=${2:?commit sha}
: "${PLAY_DEPLOY_URL:?}" "${PLAY_DEPLOY_TOKEN:?}"
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "commit must be a full 40-char sha" >&2; exit 1; }
[ -f "$dir/index.html" ] || { echo "$dir/index.html missing" >&2; exit 1; }
proto==https
if [ "${PLAY_DEPLOY_INSECURE_LOCAL:-}" = 1 ] && [[ $PLAY_DEPLOY_URL =~ ^http://127\.0\.0\.1: ]]; then
  proto==http    # local tests only
elif [[ $PLAY_DEPLOY_URL != https://* ]]; then
  echo "PLAY_DEPLOY_URL must be https" >&2; exit 1
fi

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
COPYFILE_DISABLE=1 tar -C "$dir" -czf "$tmp/site.tar.gz" .     # no macOS ._ metadata files
if command -v sha256sum >/dev/null; then sha=$(sha256sum "$tmp/site.tar.gz" | cut -d' ' -f1)
else sha=$(shasum -a 256 "$tmp/site.tar.gz" | cut -d' ' -f1); fi
( umask 077; printf 'Authorization: Bearer %s\n' "$PLAY_DEPLOY_TOKEN" > "$tmp/auth" )   # keep the token out of argv

# Re-sending the same commit is idempotent, so retrying a POST is safe.
status=$(curl -s -o "$tmp/resp" -w '%{http_code}' --proto "$proto" --max-redirs 0 \
  --retry 4 --retry-all-errors --retry-delay 5 --max-time 120 \
  -H @"$tmp/auth" -H "X-Artifact-SHA256: $sha" -H "Content-Type: application/gzip" \
  --data-binary @"$tmp/site.tar.gz" "${PLAY_DEPLOY_URL%/}/$commit") || true
cat "$tmp/resp" 2>/dev/null; echo
[ "$status" = 200 ] && grep -q '"state": "deployed"' "$tmp/resp" || { echo "deploy failed (HTTP $status)" >&2; exit 1; }
