#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Intended to run as the Compose "backup" one-off service. The backup account is read-only.
: "${PGHOST:?Set PGHOST}"
: "${PGPORT:=5432}"
: "${PGDATABASE:?Set PGDATABASE}"
: "${PGUSER:?Set PGUSER}"
: "${PGPASSWORD:?Set PGPASSWORD from the secret manager}"
: "${BACKUP_DIR:=/app/backups}"
: "${BACKUP_RETENTION_DAYS:=30}"
: "${UPLOAD_DIR:=/app/data/uploads}"

# Restrict credentials accepted by the generated .pgpass line; deployment passwords should be URL-safe.
if [[ ! "$PGPASSWORD" =~ ^[A-Za-z0-9._-]{24,}$ ]]; then
  echo "Backup password must be at least 24 chars from A-Z, a-z, 0-9, dot, underscore or hyphen." >&2
  exit 2
fi
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
if [[ ! -d "$UPLOAD_DIR" ]]; then
  echo "Upload directory is missing: $UPLOAD_DIR" >&2
  exit 2
fi

pgpass_file="$(mktemp)"
cleanup() { rm -f "$pgpass_file"; }
trap cleanup EXIT
printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$PGDATABASE" "$PGUSER" "$PGPASSWORD" > "$pgpass_file"
chmod 600 "$pgpass_file"
export PGPASSFILE="$pgpass_file"
unset PGPASSWORD

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
db_target="$BACKUP_DIR/workbench-db-$stamp.dump"
uploads_target="$BACKUP_DIR/workbench-uploads-$stamp.tar.gz"

pg_dump --format=custom --no-owner --no-privileges --file="$db_target" \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE"
pg_restore --list "$db_target" >/dev/null

# Upload blobs are in the shared persistent volume. Back up them beside the DB dump.
tar -czf "$uploads_target" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
tar -tzf "$uploads_target" >/dev/null
sha256sum "$db_target" "$uploads_target" > "$BACKUP_DIR/workbench-$stamp.sha256"

# Retain DB dumps, upload archives and checksums for the configured number of days.
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'workbench-db-*.dump' -o -name 'workbench-uploads-*.tar.gz' -o -name 'workbench-*.sha256' \) \
  -mtime "+$BACKUP_RETENTION_DAYS" -delete

echo "Database dump verified: $db_target"
echo "Upload archive verified: $uploads_target"
echo "Checksums: $BACKUP_DIR/workbench-$stamp.sha256"
echo "These archives are not proof of recoverability. Run and record an isolated full restore test."
