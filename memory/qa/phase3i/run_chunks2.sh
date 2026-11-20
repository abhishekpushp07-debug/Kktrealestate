#!/bin/bash
# 3I close-out v2: full suite in small resumable chunks, memory-bounded. MODE=sa | rs (replica set, KKT_TXN_STRICT=1).
# Per chunk: cgroup memory peak sampled every 1 s (mem.log + top processes at peak), scratch RS capped
# (--wiredTigerCacheSizeGB 1), HEAVY files run with -n 1, kkt_test + /tmp pytest dirs dropped between chunks.
# A chunk whose log ends with pytest's summary line on the same commit is skipped on relaunch.
MODE=$1; Q=/app/memory/qa/phase3i/chunks2_$MODE; mkdir -p $Q; L=$Q/driver.log; ML=$Q/mem.log
cd /app/backend
HEAD=$(git -C /app rev-parse --short HEAD):$(git -C /app rev-parse --short HEAD:backend)  # backend tree id: doc-only commits do not redo chunks
M=/app/memory/qa/phase3i/chunks2_manifest_${HEAD#*:}.txt
[ -s $M ] || ls tests/test_*.py | sort > $M
mapfile -t FILES < $M
N=7
HEAVY=" tests/test_phase_l.py tests/test_phase_z1_backup.py tests/test_reseed_counters.py tests/test_demo_refresh.py tests/test_refresh_frozen_clock.py tests/test_refresh_keeps_setup.py tests/test_memory_scale.py "
P=27018; D=/app/.eqtmp/kkt_rs0
rs_up() {
  mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && \
    mongosh --port $P --quiet --eval 'db.getSiblingDB("test_database").users.countDocuments({})' 2>/dev/null | grep -qv '^0$' && return 0
  mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1; sleep 2
  rm -rf $D; mkdir -p $D
  mongod --replSet rs0 --port $P --dbpath $D --bind_ip 127.0.0.1 --wiredTigerCacheSizeGB 1 --fork --logpath $D/mongod.log >> $L 2>&1
  mongosh --port $P --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:'$P'"}]})' >> $L 2>&1
  for i in $(seq 1 30); do mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break; sleep 1; done
  mongodump --uri=mongodb://localhost:27017 --db=test_database --archive --quiet | \
    mongorestore --uri="mongodb://127.0.0.1:$P/?replicaSet=rs0" --archive --quiet >> $L 2>&1
  echo "rs up + restored $(date -u +%T)" >> $L
}
sampler() {  # sampler <chunk>: peak cgroup memory while the chunk runs
  local c=$1 pk=0 cur
  while [ -f $Q/.running ]; do
    cur=$(cat /sys/fs/cgroup/memory.current)
    if [ $cur -gt $pk ]; then pk=$cur; echo $pk > $Q/.peak
      ps -eo rss,comm,args --sort=-rss | head -8 | cut -c1-140 > $Q/.peak_top; fi
    sleep 1
  done
}
run() {  # run <out> <xdist-n> <files…>
  local out=$1 n=$2; shift 2
  if [ "$MODE" = rs ]; then
    KKT_TXN_STRICT=1 MONGO_URL="mongodb://127.0.0.1:$P/?replicaSet=rs0" KKT_TEST_PORT=8031 timeout 1500 \
      python -m pytest "$@" -n $n -v -p no:cacheprovider --tb=line -rfE >> $out 2>&1
    pkill -f "port 8031"
  else
    timeout 1500 python -m pytest "$@" -n $n -v -p no:cacheprovider --tb=line -rfE >> $out 2>&1
    pkill -f "port 8021"
  fi
}
for ((i = 0; i < ${#FILES[@]}; i += N)); do
  c=$((i / N)); out=$Q/c$c.log
  head -1 $out 2>/dev/null | grep -qE "^COMMIT [0-9a-f]+:${HEAD#*:} files: " && head -1 $out | grep -qF " files: ${FILES[*]:i:N}" && \
    tail -1 $out | grep -qE "(passed|failed|error).* in [0-9.]+s" && continue
  echo "COMMIT $HEAD files: ${FILES[*]:i:N}" > $out
  echo "chunk $c start $(date -u +%T) $HEAD" >> $L
  [ "$MODE" = rs ] && rs_up
  light=(); heavy=()
  for f in "${FILES[@]:i:N}"; do [[ "$HEAVY" == *" $f "* ]] && heavy+=("$f") || light+=("$f"); done
  touch $Q/.running; echo 0 > $Q/.peak; sampler $c & SP=$!
  [ ${#light[@]} -gt 0 ] && run $out 2 "${light[@]}"
  for f in "${heavy[@]}"; do run $out 1 "$f"; done
  rm -f $Q/.running; wait $SP
  echo "chunk $c peak $(( $(cat $Q/.peak) / 1048576 )) MB · heavy: ${heavy[*]:-none}" >> $ML; cat $Q/.peak_top >> $ML 2>/dev/null
  echo "chunk $c: $(grep -E '^=+ .* in [0-9.]+s' $out | tr '\n' ' ')" >> $L
  echo "$(grep -E '^=+ .* in [0-9.]+s' $out | tail -1)" >> $out  # resume marker = last summary line
  if [ "$MODE" = rs ]; then mongosh --port $P --quiet --eval 'db.getSiblingDB("kkt_test").dropDatabase()' >/dev/null 2>&1
  else mongosh --quiet --eval 'db.getSiblingDB("kkt_test").dropDatabase()' >/dev/null 2>&1; fi
  rm -rf /tmp/pytest-of-root /tmp/tmp*.zip 2>/dev/null
  sleep 2
done
if [ "$MODE" = rs ]; then mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1; sleep 2; rm -rf $D; fi
echo "ALL CHUNKS DONE $(date -u +%T)" >> $L
