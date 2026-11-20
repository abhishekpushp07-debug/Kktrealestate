#!/bin/bash
for d in kkt_volume test_database; do /app/memory/qa/phase3i/run_equiv.sh $d; done
echo DONE > /app/memory/qa/phase3i/equiv_done
