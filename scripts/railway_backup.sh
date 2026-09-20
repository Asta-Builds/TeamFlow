#!/bin/bash
set -euo pipefail

# TeamFlow Railway database backup script.
# Dumps the production PostgreSQL database through the Railway CLI,
# compresses the output with gzip, verifies integrity, and manages retention.
#
# Volume snapshot note:
# Railway persistent volumes (such as 'generated_projects' attached to teamflow-celery)
# have no built-in snapshot mechanism in this configuration. Agent workspaces inside
# generated_projects/ are transient Git checkouts designed to be cloned and recreated
# from GitHub repositories rather than restored from backups.
# To inspect volumes, use:
#   railway volume list

BACKUP_DIR="./backups"
KEEP_COUNT=7
SERVICE_NAME="teamflow-db"

show_help() {
    cat << 'EOF'
Usage: ./scripts/railway_backup.sh [OPTIONS] [BACKUP_DIR] [KEEP_COUNT]

Takes a timestamped, gzipped pg_dump of the production database via Railway CLI.

Arguments:
  BACKUP_DIR         Directory to store backups (default: ./backups)
  KEEP_COUNT         Number of latest backups to retain (default: 7)

Options:
  -d, --dir DIR      Directory to store backups (default: ./backups)
  -k, --keep N       Number of latest backups to retain (default: 7)
  -s, --service NAME Railway database service name (default: teamflow-db)
  -h, --help         Show this help message and exit
EOF
}

# Parse named options or positional arguments
POSITIONAL_ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        -d|--dir)
            BACKUP_DIR="$2"
            shift 2
            ;;
        -k|--keep)
            KEEP_COUNT="$2"
            shift 2
            ;;
        -s|--service)
            SERVICE_NAME="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -*)
            echo "Error: Unknown option: $1" >&2
            show_help >&2
            exit 1
            ;;
        *)
            POSITIONAL_ARGS+=("$1")
            shift
            ;;
    esac
done

if [ ${#POSITIONAL_ARGS[@]} -ge 1 ]; then
    BACKUP_DIR="${POSITIONAL_ARGS[0]}"
fi
if [ ${#POSITIONAL_ARGS[@]} -ge 2 ]; then
    KEEP_COUNT="${POSITIONAL_ARGS[1]}"
fi
if [ ${#POSITIONAL_ARGS[@]} -ge 3 ]; then
    SERVICE_NAME="${POSITIONAL_ARGS[2]}"
fi

echo "Checking prerequisites..."

if ! command -v railway >/dev/null 2>&1; then
    echo "Error: Railway CLI ('railway') is not installed or not in PATH." >&2
    echo "Install it via npm ('npm install -g @railway/cli') or see https://docs.railway.com/guides/cli" >&2
    exit 1
fi

if ! railway whoami >/dev/null 2>&1; then
    echo "Error: Not authenticated with Railway." >&2
    echo "Run 'railway login' to authenticate before backing up." >&2
    exit 1
fi

if ! railway status >/dev/null 2>&1; then
    echo "Error: Directory is not linked to a Railway project." >&2
    echo "Run 'railway link' to link this directory to the target project." >&2
    exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
    echo "Error: 'pg_dump' is not installed or not in PATH." >&2
    echo "Install PostgreSQL client tools (e.g. postgresql-client) to take database dumps." >&2
    exit 1
fi

if ! command -v gzip >/dev/null 2>&1; then
    echo "Error: 'gzip' is not installed or not in PATH." >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="teamflow_db_${TIMESTAMP}.sql.gz"
BACKUP_FILE="${BACKUP_DIR}/${FILENAME}"
TEMP_SQL="${BACKUP_DIR}/.tmp_dump_${TIMESTAMP}.sql"

echo "Dumping database from Railway service '${SERVICE_NAME}'..."

# Execute pg_dump through railway run. Credentials are read from injected env vars without printing.
if ! railway run --service "$SERVICE_NAME" -- pg_dump --clean --if-exists --no-owner --no-privileges -f "$TEMP_SQL"; then
    echo "Error: Database dump failed." >&2
    rm -f "$TEMP_SQL"
    exit 1
fi

if [ ! -f "$TEMP_SQL" ] || [ ! -s "$TEMP_SQL" ]; then
    echo "Error: pg_dump produced an empty file." >&2
    rm -f "$TEMP_SQL"
    exit 1
fi

echo "Compressing dump with gzip..."
if ! gzip -c "$TEMP_SQL" > "$BACKUP_FILE"; then
    echo "Error: Compression failed." >&2
    rm -f "$TEMP_SQL" "$BACKUP_FILE"
    exit 1
fi
rm -f "$TEMP_SQL"

FILE_SIZE=$(wc -c < "$BACKUP_FILE" | tr -d ' ')
if [ "$FILE_SIZE" -le 0 ]; then
    echo "Error: Compressed backup file is empty (0 bytes)." >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi

if [ "$FILE_SIZE" -ge 1048576 ]; then
    SIZE_FORMATTED="$(awk -v s="$FILE_SIZE" 'BEGIN { printf "%.2f MB", s/1048576 }')"
elif [ "$FILE_SIZE" -ge 1024 ]; then
    SIZE_FORMATTED="$(awk -v s="$FILE_SIZE" 'BEGIN { printf "%.2f KB", s/1024 }')"
else
    SIZE_FORMATTED="${FILE_SIZE} bytes"
fi

echo "Backup successful: ${BACKUP_FILE} (${SIZE_FORMATTED}, ${FILE_SIZE} bytes)"

# Retention: keep the latest KEEP_COUNT dumps matching teamflow_db_*.sql.gz
BACKUP_FILES=()
while IFS= read -r f; do
    [ -n "$f" ] && BACKUP_FILES+=("$f")
done < <(find "$BACKUP_DIR" -maxdepth 1 -name "teamflow_db_*.sql.gz" -type f | sort -r)

TOTAL_COUNT=${#BACKUP_FILES[@]}
if [ "$TOTAL_COUNT" -gt "$KEEP_COUNT" ]; then
    echo "Applying retention policy: keeping latest $KEEP_COUNT dumps (found $TOTAL_COUNT)..."
    for (( i=KEEP_COUNT; i<TOTAL_COUNT; i++ )); do
        old_file="${BACKUP_FILES[$i]}"
        echo "Removing old backup: $(basename "$old_file")"
        rm -f "$old_file"
    done
else
    echo "Existing backups ($TOTAL_COUNT) within retention limit ($KEEP_COUNT)."
fi
