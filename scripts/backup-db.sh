#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:=./backups}"
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/thunderledger-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump "$DATABASE_URL" --format=custom --file "$file"
echo "created $file"
