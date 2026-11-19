#!/bin/bash
# 3I REQ-379: the full suite once on a single-node replica set (transactions available). Data under /tmp.
L=/app/memory/qa/phase3i/replset.log
P=27018
D=/tmp/kkt_rs0
echo "=== replset $(date -u +%T)" > $L
mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1; sleep 2
rm -rf $D; mkdir -p $D
mongod --replSet rs0 --port $P --dbpath $D --bind_ip 127.0.0.1 --fork --logpath $D/mongod.log >> $L 2>&1 || { echo "MONGOD FAILED" >> $L; exit 1; }
mongosh --port $P --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:'$P'"}]})' >> $L 2>&1
for i in $(seq 1 30); do mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break; sleep 1; done
mongodump --uri=mongodb://localhost:27017 --db=test_database --archive --quiet | mongorestore --uri="mongodb://127.0.0.1:$P/?replicaSet=rs0" --archive --quiet >> $L 2>&1 || echo "RESTORE FAILED" >> $L
echo "restored $(date -u +%T)" >> $L
cd /app/backend
MONGO_URL="mongodb://127.0.0.1:$P/?replicaSet=rs0" KKT_TEST_PORT=8031 python -c "
import asyncio,os; from motor.motor_asyncio import AsyncIOMotorClient
async def m():
    h=await AsyncIOMotorClient(os.environ['MONGO_URL']).admin.command('hello'); print('setName', h.get('setName'))
asyncio.run(m())" >> $L 2>&1
KKT_TXN_STRICT=1 MONGO_URL="mongodb://127.0.0.1:$P/?replicaSet=rs0" KKT_TEST_PORT=8031 timeout 3600 python -m pytest tests -q -p no:cacheprovider --tb=line -rfE > /app/memory/qa/phase3i/pytest_replset.log 2>&1
echo "pytest replset exit $?" >> $L
pkill -f "port 80[34]1" ; sleep 2  # the suite's own backend must not outlive the run
mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' >/dev/null 2>&1
rm -rf $D
echo "REPLSET DONE $(date -u +%T)" >> $L
