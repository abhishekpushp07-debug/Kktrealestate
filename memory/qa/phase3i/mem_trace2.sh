#!/bin/bash
# 3I: cgroup memory trace (anon = what can OOM the pod; current includes reclaimable page cache), every 2 s while suites run.
O=/app/memory/qa/phase3i/mem_trace2.log
while pgrep -f run_suites2.sh > /dev/null; do
  a=$(awk '$1=="anon"{print int($2/1048576)}' /sys/fs/cgroup/memory.stat)
  f=$(awk '$1=="file"{print int($2/1048576)}' /sys/fs/cgroup/memory.stat)
  echo "$(date -u +%T) anon=${a} file=${f} current=$(( $(cat /sys/fs/cgroup/memory.current) / 1048576 )) oom_kill=$(awk '$1=="oom_kill"{print $2}' /sys/fs/cgroup/memory.events)" >> $O
  sleep 2
done
