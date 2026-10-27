# syntax=docker/dockerfile:1.7
# kkt-backup: PostgreSQL 16 (alpine) + age, used by docker-compose.prod.yml for BOTH the postgres service (archive_command encrypts every
# WAL segment through backup.sh wal-push) and the backup service (encrypted nightly dumps and base backups). Same server binaries and data
# directory layout as postgres:16-alpine, so switching an existing volume to this image needs no migration.
#   docker build -t kkt-backup:16 infra/backup
FROM postgres:16-alpine
# age: authenticated streaming encryption (X25519 + ChaCha20-Poly1305); openssl for the fallback mode and key generation
RUN apk add --no-cache age openssl
COPY --chmod=0755 backup.sh /opt/kkt/backup.sh
