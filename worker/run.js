/**
 * run.js — loop contínuo da fila FVBS (simula cron).
 *
 *   node worker/run.js            # intervalo padrão 3s
 *   node worker/run.js 10         # intervalo em segundos
 *
 * Em cada ciclo: processa queue/ inteira, grava processed/ e
 * regrava ledger.json (snapshot). Ctrl+C encerra com o resumo.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createFVBS } from "../core/fvbs.js";
import { processQueue } from "./worker.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INTERVAL_S = Math.max(1, Number(process.argv[2]) || 3);

const policies = JSON.parse(
  await readFile(path.join(ROOT, "data", "policies.json"), "utf8")
);

const fvbs = createFVBS({ policies: structuredClone(policies) });
const dirs = {
  queueDir: path.join(ROOT, "queue"),
  processedDir: path.join(ROOT, "processed"),
  ledgerPath: path.join(ROOT, "ledger.json"),
  catalog: policies.command_catalog
};

const totals = { cycles: 0, registered: 0, rejected: 0, duplicates: 0, errors: 0 };
let running = true;

function stop() {
  running = false;
  console.log(
    `\n[worker] parado | ciclos=${totals.cycles} registered=${totals.registered} ` +
    `rejected=${totals.rejected} duplicates=${totals.duplicates} errors=${totals.errors}`
  );
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`[worker] fila contínua em ${ROOT}/queue (intervalo ${INTERVAL_S}s)`);
console.log("[worker] Ctrl+C para parar");

while (running) {
  const summary = await processQueue({ ...dirs, fvbs });
  totals.cycles += 1;
  totals.registered += summary.registered;
  totals.rejected += summary.rejected;
  totals.duplicates += summary.duplicates;
  totals.errors += summary.errors;

  if (summary.scanned > 0) {
    console.log(
      `[worker] ciclo ${totals.cycles}: ${summary.scanned} tarefa(s) | ` +
      `registered=${summary.registered} rejected=${summary.rejected} ` +
      `duplicates=${summary.duplicates} errors=${summary.errors}`
    );
  }

  await new Promise((resolve) => setTimeout(resolve, INTERVAL_S * 1000));
}
