#!/bin/bash
while true; do echo "$(date -u +%T) cg=$(( $(cat /sys/fs/cgroup/memory.current)/1048576 ))MB $(ps -eo rss,args --sort=-rss | sed -n 2,3p | awk '{printf "[%dMB %s %s %s %s] ",$1/1024,$2,$3,$4,$5}')"; sleep 5; done
