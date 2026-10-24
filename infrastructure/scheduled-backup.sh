#!/usr/bin/env bash
# Project-scoped nightly snapshot. Stop writers only long enough to copy DB and originals.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
[[ -f .env.production ]] || { echo 'Missing project production environment' >&2; exit 1; }
command -v flock >/dev/null || { echo 'Requires Linux flock' >&2; exit 1; }
mkdir -p output/backups
exec 9>output/backups/.scheduled.lock
flock -n 9 || exit 0
compose=(docker compose --env-file .env.production -f infrastructure/compose.production.yaml)
[[ ! -f infrastructure/compose.shared-server.yaml || "${SUITE_SHARED_SERVER:-1}" != 1 ]] || compose+=(-f infrastructure/compose.shared-server.yaml)
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d output/backups/.snapshot.XXXXXX)"
was_api=0; was_worker=0; result=failed
[[ -z "$("${compose[@]}" ps --status running -q api)" ]] || was_api=1
[[ -z "$("${compose[@]}" ps --status running -q worker)" ]] || was_worker=1
finish() {
  code=$?
  (( was_api == 0 )) || "${compose[@]}" start api >/dev/null || code=1
  (( was_worker == 0 )) || "${compose[@]}" start worker >/dev/null || code=1
  [[ $code == 0 ]] || result=failed
  printf '{"checkedAt":"%s","status":"%s"}\n' "$(date -u +%FT%TZ)" "$result" > output/backup-status.json
  # Only generic outcome is placed in the existing project volume for operator visibility.
  "${compose[@]}" run --rm --no-deps -T --entrypoint sh api -c 'umask 077; cat > /var/lib/suite/knowledge/.backup-status.json' < output/backup-status.json >/dev/null 2>&1 || true
  if [[ $result == failed ]]; then logger -t enterprise-ai-backup 'Backup failed; inspect enterprise-ai-backup.service'; echo 'Backup failed; partial files retained for diagnosis.' >&2; fi
  exit "$code"
}
trap finish EXIT
(( was_api == 0 )) || "${compose[@]}" stop -t 45 api >/dev/null
(( was_worker == 0 )) || "${compose[@]}" stop -t 45 worker >/dev/null
"${compose[@]}" exec -T postgres pg_dump -U suite -d suite --format=custom --no-owner --no-acl > "$work/database.dump"
"${compose[@]}" exec -T postgres pg_restore --list < "$work/database.dump" > /dev/null
"${compose[@]}" run --rm --no-deps -T --entrypoint tar api -C /var/lib/suite/knowledge -cf - . > "$work/knowledge.tar"
tar -tf "$work/knowledge.tar" >/dev/null
(cd "$work"; sha256sum database.dump knowledge.tar > SHA256SUMS)
printf '{"createdAt":"%s","database":"database.dump","originals":"knowledge.tar","consistentWritersStopped":true}\n' "$(date -u +%FT%TZ)" > "$work/manifest.json"
mv "$work" "output/backups/snapshot-$stamp"
result=success
# No automatic deletion. Retention is a separate recovery decision.
echo "Consistent project snapshot: snapshot-$stamp"
