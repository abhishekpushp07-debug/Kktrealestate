#!/bin/sh
# Generates the secret files docker-compose.prod.yml mounts (./infra/secrets/*: directory 0700, files 0644 — see the end of the
# script). Existing files are never overwritten, so the script is safe to re-run after adding a new secret. Values are hex (URL-safe:
# they are embedded in connection strings).
#
#   sh infra/scripts/gen-secrets.sh [secrets-dir]        # default ./infra/secrets (git-ignored)
#
# Back the directory up somewhere safe (a password manager / vault): FIELD_ENCRYPTION_KEY and HASH_KEY cannot be regenerated without
# losing access to encrypted KYC fields and duplicate checks (docs/SECURITY.md key rotation).
set -eu
DIR="${1:-./infra/secrets}"
mkdir -p "$DIR"
chmod 700 "$DIR"
umask 077

rand() { openssl rand -hex "$1"; }
put() { # name value
  if [ -e "$DIR/$1" ]; then echo "keep     $DIR/$1"; else printf '%s' "$2" > "$DIR/$1"; echo "created  $DIR/$1"; fi
}
get() { cat "$DIR/$1"; }

put postgres_password "$(rand 24)"
put kkt_owner_db_password "$(rand 24)"
put kkt_app_db_password "$(rand 24)"
put redis_password "$(rand 24)"
put jwt_secret "$(rand 48)"
put field_encryption_key "$(openssl rand -base64 32)"
put hash_key "$(rand 32)"
put metrics_token "$(rand 24)"
put bootstrap_admin_password "$(rand 12)Aa1!"
put grafana_admin_password "$(rand 16)"

# derived connection strings (the API/worker go through PgBouncer as kkt_app; the migrate job talks to Postgres as kkt_owner)
put database_url "postgres://kkt_app:$(get kkt_app_db_password)@pgbouncer:6432/kkt"
put database_owner_url "postgres://kkt_owner:$(get kkt_owner_db_password)@postgres:5432/kkt"
put redis_url "redis://:$(get redis_password)@redis:6379/0"
put redis_security_url "redis://:$(get redis_password)@redis-security:6379/0"
put redis_password_map "{\"redis://redis:6379\":\"$(get redis_password)\"}"
put pgbouncer_userlist "\"kkt_app\" \"$(get kkt_app_db_password)\""

# S3 keys: fill in when STORAGE_DRIVER=s3 uses static keys (set KKT_S3_ACCESS_KEY_FILE / KKT_S3_SECRET_KEY_FILE in .env)
put s3_access_key "unused"
put s3_secret_key "unused"
# Slack-compatible webhook for 5xx and failed jobs: put the URL here and set KKT_ERROR_WEBHOOK_URL_FILE=/run/secrets/error_webhook_url
put error_webhook_url "unused"

# Docker Compose (outside Swarm) bind-mounts secret files with their host owner and mode, and the containers read them as non-root
# users (api/worker/migrate uid 10001, Postgres init scripts and PgBouncer uid 70). A 0600 file owned by the operator is unreadable
# there (EACCES: the API refuses to boot, 02-passwords.sh cannot set the role passwords). The files are therefore world-readable and
# the DIRECTORY is the access boundary on the host (0700, owned by the operator).
chmod 700 "$DIR"
chmod 0644 "$DIR"/*

echo
echo "First Super Admin password (change it at first login): $(get bootstrap_admin_password)"
