#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ ! -f .env.production ]]; then
  echo 'Missing .env.production' >&2
  exit 1
fi

backup_dir="${1:-output/backups}"
mkdir -p "$backup_dir"
umask 077
backup_file="$backup_dir/suite-$(date -u +%Y%m%dT%H%M%SZ).dump"
if [[ -e "$backup_file" ]]; then
  echo "Backup already exists: $backup_file" >&2
  exit 1
fi
temp_file="$(mktemp "$backup_dir/.suite-backup.XXXXXX")"
trap 'rm -f "$temp_file"' EXIT

docker compose --env-file .env.production -f infrastructure/compose.production.yaml exec -T postgres \
  pg_dump -U suite -d suite --format=custom --no-owner --no-acl > "$temp_file"
docker compose --env-file .env.production -f infrastructure/compose.production.yaml exec -T postgres \
  pg_restore --list < "$temp_file" > /dev/null
mv "$temp_file" "$backup_file"
trap - EXIT
echo "Backup created: $backup_file"
if command -v sha256sum > /dev/null 2>&1; then
  sha256sum "$backup_file"
else
  shasum -a 256 "$backup_file"
fi
