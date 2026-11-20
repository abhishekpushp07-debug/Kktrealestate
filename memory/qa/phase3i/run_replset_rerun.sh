#!/bin/bash
# 3I REQ-379 re-run: the replica-set failures after the session fix (pinned away from the perf cores).
L=/app/memory/qa/phase3i/replset_rerun.log
P=27019; D=/tmp/kkt_rs1
echo "=== rerun $(date -u +%T)" > $L
rm -rf $D; mkdir -p $D
mongod --replSet rs1 --port $P --dbpath $D --bind_ip 127.0.0.1 --fork --logpath $D/mongod.log >> $L 2>&1
mongosh --port $P --quiet --eval 'rs.initiate({_id:"rs1",members:[{_id:0,host:"127.0.0.1:'$P'"}]})' >> $L 2>&1
for i in $(seq 1 30); do mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break; sleep 1; done
mongodump --uri=mongodb://localhost:27017 --db=test_database --archive --quiet | mongorestore --uri="mongodb://127.0.0.1:$P/?replicaSet=rs1" --archive --quiet >> $L 2>&1
cd /app/backend
MONGO_URL="mongodb://127.0.0.1:$P/?replicaSet=rs1" KKT_TEST_PORT=8041 taskset -c 8-15 timeout 2400 python -m pytest $(cat /app/.eqtmp/rs_failed.txt) -q -p no:cacheprovider > /app/memory/qa/phase3i/pytest_replset_rerun.log 2>&1
echo "rerun exit $?" >> $L
pkill -f "port 80[34]1" ; sleep 2  # the suite's own backend must not outlive the run
mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1
rm -rf $D
echo "RERUN DONE $(date -u +%T)" >> $L
