#!/bin/bash
# 3I: standalone THEN replica-set (never side by side); resumable; every chunk stamped with its commit
cd /app/memory/qa/phase3i
bash run_chunks.sh sa
bash run_chunks.sh rs
echo "SEQ DONE $(date -u +%T)" >> chunks_rs/driver.log
