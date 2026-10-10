#!/usr/bin/env bash
set -Eeuo pipefail

# PostgreSQL backup entrypoint. Use a least-privilege backup user and a chmod-600 PGPASSFILE.
: "${PGHOST:?Set PGHOST from the deployment secret manager}"
: "${PGPORT:=5432}"
: "${PGDATABASE:?Set PGDATABASE}"
: "${PGUSER:?Set PGUSER}"
: "${PGPASSFILE:?Set PGPASSFILE to a protected .pgpass file}"
: "${BACKUP_DIR:=./backups}"
: "${BACKUP_RETENTION_DAYS:=30}"

if [[ ! -r "$PGPASSFILE" ]]; then
  echo "PGPASSFILE is not readable" >&2
  exit 2
fi
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/workbench-$stamp.dump"
umask 077
pg_dump --format=custom --no-owner --no-privileges --file="$target" \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE"
pg_restore --list "$target" >/dev/null
sha256sum "$target" > "$target.sha256"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'workbench-*.dump*' -mtime "+$BACKUP_RETENTION_DAYS" -delete
echo "Backup verified: $target"
echo "Restore testing is required before production acceptance; this script does not prove recoverability."
