/**
 * worker.js — fila contínua do Mini-Core FVBS.
 *
 * fluxo: queue/*.json → processQueue (createCommand → receive → authorize
 *        → execute → register) → processed/*.json + ledger.json
 *
 * O ledger do FVBS vive em memória durante o ciclo; ledger.json é o
 * snapshot persistido a cada passe (não é banco transacional).
 */

import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createCommand } from "../core/command.js";

export async function enqueue(queueDir, task) {
  await mkdir(queueDir, { recursive: true });
  const stamp = String(Date.now()).padStart(15, "0");
  const name = `${stamp}-${randomUUID().slice(0, 8)}.json`;
  await writeFile(path.join(queueDir, name), JSON.stringify(task, null, 2), "utf8");
  return name;
}

export async function listPending(queueDir) {
  try {
    const names = await readdir(queueDir);
    return names.filter((n) => n.endsWith(".json")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function runPipeline(fvbs, command) {
  const received = await fvbs.receive(command);
  if (received.result !== "VALIDATED") return received;
  await fvbs.authorize(received.operation_id);
  await fvbs.execute(received.operation_id);
  return fvbs.register(received.operation_id);
}

async function runTask(fvbs, catalog, task) {
  try {
    const command = createCommand(
      {
        type: task.type,
        customerId: task.customer_id,
        amount: task.amount,
        origin: task.origin ?? "USER",
        idempotencyKey: task.idempotency_key
      },
      { catalog }
    );
    return { task, result: await runPipeline(fvbs, command) };
  } catch (error) {
    const message = String(error.message ?? error);
    return {
      task,
      result: null,
      error_code: message.split(":")[0],
      error: message
    };
  }
}

function summarize(summary, record) {
  if (record.error_code) {
    summary.errors += 1;
  } else if (record.result.result === "REGISTERED") {
    summary.registered += 1;
  } else if (record.result.result === "DUPLICATE") {
    summary.duplicates += 1;
  } else {
    summary.rejected += 1;
  }
}

export async function processQueue({ queueDir, processedDir, ledgerPath, fvbs, catalog }) {
  const names = await listPending(queueDir);
  const summary = {
    scanned: names.length,
    registered: 0,
    rejected: 0,
    duplicates: 0,
    errors: 0,
    remaining: 0,
    results: []
  };

  if (names.length > 0) await mkdir(processedDir, { recursive: true });

  for (const name of names) {
    const source = path.join(queueDir, name);
    let record;

    try {
      const task = JSON.parse(await readFile(source, "utf8"));
      record = await runTask(fvbs, catalog, task);
    } catch (error) {
      record = {
        task: null,
        result: null,
        error_code: "E_JSON",
        error: String(error.message ?? error)
      };
    }

    record.processed_at = new Date().toISOString();
    record.source_file = name;
    summarize(summary, record);

    const target = path.join(processedDir, name);
    await writeFile(target, JSON.stringify(record, null, 2), "utf8");
    await unlink(source);
    summary.results.push(record);
  }

  summary.remaining = (await listPending(queueDir)).length;

  if (names.length > 0 && ledgerPath) {
    const entries = fvbs.getLedger();
    await writeFile(
      ledgerPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          count: entries.length,
          verify: await fvbs.verifyLedger(),
          entries
        },
        null,
        2
      ),
      "utf8"
    );
  }

  return summary;
}
