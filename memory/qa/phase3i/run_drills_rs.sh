#!/bin/bash
# 3I REQ-379: the 3G race drills + 2-process stale drill in replica-set (transaction) mode, strict session checks on.
P=27019
D=/tmp/kkt_rs_drill
L=/app/memory/qa/phase3i/drills_rs.log
echo "=== drills on replica set $(date -u +%T) df=$(df --output=avail -h /app | tail -1)" > $L
mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1; sleep 2
rm -rf $D; mkdir -p $D
mongod --replSet rsd --port $P --dbpath $D --bind_ip 127.0.0.1 --fork --logpath $D/mongod.log >> $L 2>&1 || { echo "MONGOD FAILED" >> $L; exit 1; }
mongosh --port $P --quiet --eval 'rs.initiate({_id:"rsd",members:[{_id:0,host:"127.0.0.1:'$P'"}]})' >> $L 2>&1
for i in $(seq 1 30); do mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break; sleep 1; done
mongodump --uri=mongodb://localhost:27017 --db=kkt_volume --archive --quiet | mongorestore --uri="mongodb://127.0.0.1:$P/?replicaSet=rsd" --archive --quiet >> $L 2>&1 || echo "RESTORE FAILED" >> $L
echo "restored $(date -u +%T)" >> $L
export MONGO_URL="mongodb://127.0.0.1:$P/?replicaSet=rsd" KKT_TXN_STRICT=1
bash /app/memory/qa/phase3i/run_drills.sh 3i_rs
cat /app/memory/qa/phase3i/drills_3i_rs.log >> $L
mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1; sleep 2
rm -rf $D
echo "DRILLS RS DONE $(date -u +%T)" >> $L
