#!/usr/bin/env bash
# Executed by the official Postgres image only when initializing a brand-new data directory.
set -Eeuo pipefail
: "${BACKUP_DB_PASSWORD:?BACKUP_DB_PASSWORD is required to provision the read-only backup role}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=backup_password="$BACKUP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE workbench_backup LOGIN PASSWORD %L', :'backup_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workbench_backup')
\gexec

ALTER ROLE workbench_backup WITH LOGIN PASSWORD :'backup_password';
GRANT CONNECT ON DATABASE workbench TO workbench_backup;
GRANT USAGE ON SCHEMA public TO workbench_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO workbench_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO workbench_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE workbench IN SCHEMA public
    GRANT SELECT ON TABLES TO workbench_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE workbench IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO workbench_backup;
SQL
