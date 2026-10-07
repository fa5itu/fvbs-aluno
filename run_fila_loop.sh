#!/bin/bash
# ================================================================
# run_fila_loop.sh — Worker de fila contínua do Mini-Core FVBS
# ---------------------------------------------------------------
# Processa queue/ -> processed/ + ledger.json em ciclo contínuo.
#
# USO:
#   ./run_fila_loop.sh        # intervalo padrão 3s
#   ./run_fila_loop.sh 10     # intervalo em segundos
#
# Parar: Ctrl+C
# ================================================================
set -e
cd "$(dirname "$0")"

INTERVAL="${1:-3}"

if [ ! -f package.json ]; then
  echo "X  Execute a partir de fvbs-aluno/ (package.json ausente)."
  exit 1
fi

mkdir -p queue processed

echo "=== Worker Fila FVBS — intervalo ${INTERVAL}s ==="
exec node worker/run.js "$INTERVAL"
