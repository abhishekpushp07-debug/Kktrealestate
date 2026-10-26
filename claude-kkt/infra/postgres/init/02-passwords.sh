#!/bin/sh
# Sets the kkt_owner / kkt_app passwords from secret files (docker-compose.prod.yml mounts them under /run/secrets) or, when no file is
# mounted, from KKT_OWNER_DB_PASSWORD / KKT_APP_DB_PASSWORD (docker-compose.yml quick start).
# Runs after 01-roles.sql on the first start of the postgres container; re-run by hand to rotate:
#   docker compose -f docker-compose.prod.yml exec postgres sh /docker-entrypoint-initdb.d/02-passwords.sh
set -eu

OWNER_FILE="${KKT_OWNER_PASSWORD_FILE:-/run/secrets/kkt_owner_db_password}"
APP_FILE="${KKT_APP_PASSWORD_FILE:-/run/secrets/kkt_app_db_password}"

set_password() {
  role="$1"; file="$2"; value="$3"
  if [ -s "$file" ]; then value="$(tr -d '\r\n' < "$file")"; fi
  if [ -z "$value" ]; then
    echo "02-passwords.sh: no password for $role ($file missing and no environment value); it cannot log in over the network" >&2
    return 0
  fi
  # psql variables are quoted with :'var', so the password never needs escaping.
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" \
    -v role="$role" -v pw="$value" <<'SQL'
SELECT format('ALTER ROLE %I PASSWORD %L', :'role', :'pw') \gexec
SQL
  echo "02-passwords.sh: password set for $role"
}

# secret files (docker-compose.prod.yml, Kubernetes) win; KKT_*_DB_PASSWORD environment values serve the single-VM quick start
set_password kkt_owner "$OWNER_FILE" "${KKT_OWNER_DB_PASSWORD:-}"
set_password kkt_app "$APP_FILE" "${KKT_APP_DB_PASSWORD:-}"
