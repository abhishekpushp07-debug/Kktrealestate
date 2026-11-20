#!/bin/bash
# 3I REQ-379: remaining replica-set (strict) drill stages, one at a time, each logged; races (no Redis) already in drills_3i_rs.log
P=27019; D=/tmp/kkt_rs_drill; Q=/app/memory/qa/phase3i; L=$Q/drills_rs2.log
exec >> $L 2>&1
echo "=== rs drills part 2 $(date -u +%T) df=$(df --output=avail -h /app | tail -1) commit=$(git -C /app rev-parse --short HEAD)"
if ! mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true; then
  rm -rf $D; mkdir -p $D
  mongod --replSet rsd --port $P --dbpath $D --bind_ip 127.0.0.1 --fork --logpath $D/mongod.log || { echo MONGOD FAILED; exit 1; }
  mongosh --port $P --quiet --eval 'rs.initiate({_id:"rsd",members:[{_id:0,host:"127.0.0.1:'$P'"}]})'
  for i in $(seq 1 30); do mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break; sleep 1; done
  mongodump --uri=mongodb://localhost:27017 --db=kkt_volume --archive --quiet | mongorestore --uri="mongodb://127.0.0.1:$P/?replicaSet=rsd" --archive --quiet || echo RESTORE FAILED
  echo "restored $(date -u +%T)"
fi
export MONGO_URL="mongodb://127.0.0.1:$P/?replicaSet=rsd" KKT_TXN_STRICT=1 TAG=3i_rs
cd /app/backend
export LD_LIBRARY_PATH=/app/.eqtmp/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}  # redis libs kept under /app (pod restarts drop system libs)
REDIS=$(command -v redis-server || echo /app/.eqtmp/bin/redis-server)
CLI=$(command -v redis-cli || echo /app/.eqtmp/bin/redis-cli)
$REDIS --port 6390 --save "" --appendonly no --daemonize yes
stage() {
  echo "--- stage $1 start $(date -u +%T)"
  pkill -f "port 810[12]"; sleep 1
  python -m tools.db_audit_drills setup || { echo "SETUP FAILED ($1)"; return; }
  shift; python -m tools.db_audit_drills "$@"; echo "--- exit $? $(date -u +%T)"
}
stage races_redis races --label $TAG --reps 20 --redis redis://127.0.0.1:6390/0
stage stale stale --label $TAG --reps 10
$CLI -p 6390 flushall
stage stale_redis stale --label $TAG --reps 10 --redis redis://127.0.0.1:6390/0
python -m tools.db_audit_drills teardown
$CLI -p 6390 shutdown nosave
pkill -f "port 810[12]"
mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1; sleep 2; rm -rf $D
echo "RS DRILLS PART 2 DONE $(date -u +%T)"
