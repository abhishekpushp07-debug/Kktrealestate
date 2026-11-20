#!/bin/bash
# 3I: the full suite in resumable chunks (pod restarts kill long runs). MODE=sa (standalone) | rs (replica set, strict).
# A chunk whose log ends with pytest's summary line is done and skipped on the next launch.
MODE=$1; Q=/app/memory/qa/phase3i/chunks_$MODE; mkdir -p $Q; L=$Q/driver.log
cd /app/backend
mapfile -t FILES < <(ls tests/test_*.py | sort)
N=14
rs_up() {
  P=27018; D=/tmp/kkt_rs0
  mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && \
    mongosh --port $P --quiet --eval 'db.getSiblingDB("test_database").users.countDocuments({})' 2>/dev/null | grep -qv '^0$' && return 0
  mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1; sleep 2
  rm -rf $D; mkdir -p $D
  mongod --replSet rs0 --port $P --dbpath $D --bind_ip 127.0.0.1 --fork --logpath $D/mongod.log >> $L 2>&1
  mongosh --port $P --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:'$P'"}]})' >> $L 2>&1
  for i in $(seq 1 30); do mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break; sleep 1; done
  mongodump --uri=mongodb://localhost:27017 --db=test_database --archive --quiet | \
    mongorestore --uri="mongodb://127.0.0.1:$P/?replicaSet=rs0" --archive --quiet >> $L 2>&1
  echo "rs up + restored $(date -u +%T)" >> $L
}
for ((i = 0; i < ${#FILES[@]}; i += N)); do
  c=$((i / N)); out=$Q/c$c.log
  HEAD=$(git -C /app rev-parse --short HEAD)
  head -1 $out 2>/dev/null | grep -q "^COMMIT $HEAD" && tail -1 $out | grep -qE "(passed|failed|error).* in [0-9.]+s" && continue
  echo "COMMIT $HEAD files: ${FILES[*]:i:N}" > $out
  echo "chunk $c start $(date -u +%T) $(git -C /app rev-parse --short HEAD)" >> $L
  if [ "$MODE" = rs ]; then
    rs_up
    KKT_TXN_STRICT=1 MONGO_URL="mongodb://127.0.0.1:27018/?replicaSet=rs0" KKT_TEST_PORT=8031 timeout 1500 \
      python -m pytest "${FILES[@]:i:N}" -v -p no:cacheprovider --tb=line -rfE >> $out 2>&1
    pkill -f "port 8031"
  else
    timeout 1500 python -m pytest "${FILES[@]:i:N}" -v -p no:cacheprovider --tb=line -rfE >> $out 2>&1
    pkill -f "port 8021"
  fi
  echo "chunk $c: $(tail -1 $out)" >> $L
  sleep 2
done
echo "ALL CHUNKS DONE $(date -u +%T)" >> $L
