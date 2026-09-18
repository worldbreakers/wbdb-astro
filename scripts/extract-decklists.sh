#!/usr/bin/env bash
# Extracts public decklists from wbdb-final-backup.sql into astro/src/data/decklists.json.
#
# Loads the dump into a scratch database on the already-running
# worldbreakersdb-mysql-1 container, runs a single query producing a JSON
# array of public decklists (moderation_status IN (0,1,2): PUBLISHED,
# RESTORED, TRASHED -- excluding DELETED=3, per SocialController::viewAction),
# and writes the result to astro/src/data/decklists.json.
#
# Re-run whenever wbdb-final-backup.sql is refreshed; commit the resulting
# JSON file. This script is never invoked by the Astro build itself.
set -euo pipefail

CONTAINER="worldbreakersdb-mysql-1"
DB_USER="root"
DB_PASS="netrunnerdb"
SCRATCH_DB="netrunnerdb_astro_extract"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DUMP_FILE="$REPO_ROOT/wbdb-final-backup.sql"
OUT_FILE="$REPO_ROOT/astro/src/data/decklists.json"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER is not running; start it with: docker compose up -d mysql" >&2
  exit 1
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "Dump file not found: $DUMP_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"

echo "Creating scratch database $SCRATCH_DB..." >&2
docker exec -i "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASS" -e "DROP DATABASE IF EXISTS $SCRATCH_DB; CREATE DATABASE $SCRATCH_DB"

echo "Loading dump into $SCRATCH_DB..." >&2
docker exec -i "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASS" "$SCRATCH_DB" < "$DUMP_FILE"

echo "Extracting public decklists..." >&2
QUERY="SELECT JSON_ARRAYAGG(JSON_OBJECT(
  'uuid', d.uuid,
  'name', d.name,
  'description', d.description,
  'date_creation', d.date_creation,
  'author', u.username,
  'identity_code', ic.code,
  'cards', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT('code', c.code, 'quantity', s.quantity))
    FROM decklistslot s JOIN card c ON c.id = s.card_id
    WHERE s.decklist_id = d.id
  )
))
FROM decklist d
JOIN user u ON u.id = d.user_id
JOIN card ic ON ic.id = d.identity_id
WHERE d.moderation_status IN (0,1,2)
ORDER BY d.date_creation DESC"

# --raw is required: mysql's default batch-mode output double-escapes
# embedded newlines/backslashes inside long text columns (e.g.
# description), corrupting the embedded JSON string content. --raw
# disables that extra escaping layer so MySQL's own JSON_OBJECT escaping
# is the only escaping applied.
docker exec "$CONTAINER" mysql --raw --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$SCRATCH_DB" -N -e "$QUERY" > "$OUT_FILE"

echo "Cleaning up scratch database $SCRATCH_DB..." >&2
docker exec -i "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASS" -e "DROP DATABASE $SCRATCH_DB"

echo "Wrote $OUT_FILE" >&2
