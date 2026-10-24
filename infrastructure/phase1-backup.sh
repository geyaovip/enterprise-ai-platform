#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
# A DB dump and an original-file archive must refer to the same write-frozen state.
if [[ -n "$(docker compose --env-file .env.production -f infrastructure/compose.production.yaml ps --status running -q api worker)" ]]; then
  echo 'Stop API and Worker in the release window before taking a joint backup.' >&2
  exit 1
fi
./infrastructure/backup.sh
mkdir -p output/backups
knowledge_backup="output/backups/knowledge-$(date -u +%Y%m%dT%H%M%SZ).tar"
docker compose --env-file .env.production -f infrastructure/compose.production.yaml run --rm --no-deps -T --entrypoint tar api \
  -C /var/lib/suite/knowledge -cf - . > "$knowledge_backup"
tar -tf "$knowledge_backup" > /dev/null
shasum -a 256 "$knowledge_backup"
