#!/bin/bash
# Report utilizzo disco — eseguilo con: bash disk_report.sh
OUT="$(dirname "$0")/disk_report.txt"
{
echo "=== SPAZIO DISCO COMPLESSIVO ==="
df -h /

echo; echo "=== DOCKER: RIEPILOGO SPAZIO (immagini/container/volumi/cache) ==="
docker system df -v 2>/dev/null | head -60

echo; echo "=== DIMENSIONE FILE DISCO VIRTUALE DOCKER DESKTOP ==="
du -sh ~/Library/Containers/com.docker.docker/Data/vms/0/data/* 2>/dev/null
du -sh ~/Library/Containers/com.docker.docker 2>/dev/null

echo; echo "=== MODELLI OLLAMA ==="
ollama list 2>/dev/null
du -sh ~/.ollama/models 2>/dev/null

echo; echo "=== CACHE VARIE (huggingface/pip/npm sul Mac host) ==="
du -sh ~/.cache/huggingface 2>/dev/null
du -sh ~/Library/Caches/pip 2>/dev/null
du -sh ~/.npm 2>/dev/null

echo; echo "=== TOP 15 CARTELLE PIU' GRANDI NELLA HOME (può richiedere 1-2 min) ==="
du -sh ~/*/ 2>/dev/null | sort -rh | head -15
} > "$OUT" 2>&1
echo "Report salvato in: $OUT"
