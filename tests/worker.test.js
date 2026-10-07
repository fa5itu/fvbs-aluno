import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { enqueue, listPending, processQueue } from "../worker/worker.js";
import { createFVBS } from "../core/fvbs.js";
import { createCommand } from "../core/command.js";

const policies = JSON.parse(
  await readFile(new URL("../data/policies.json", import.meta.url), "utf8")
);

function makeFvbs() {
  return createFVBS({
    policies: structuredClone(policies),
    now: () => "2026-10-05T12:00:00.000Z"
  });
}

async function makeDirs() {
  const root = await mkdtemp(path.join(tmpdir(), "fvbs-worker-"));
  const queueDir = path.join(root, "queue");
  const processedDir = path.join(root, "processed");
  return { root, queueDir, processedDir, ledgerPath: path.join(root, "ledger.json") };
}

function task(overrides = {}) {
  return {
    type: "CASHBACK",
    customer_id: "CLI_001",
    amount: 5,
    origin: "USER",
    ...overrides
  };
}

test("enqueue cria arquivo na fila e listPending devolve em ordem", async () => {
  const { root, queueDir } = await makeDirs();
  try {
    await enqueue(queueDir, task({ idempotency_key: "k-b" }));
    await enqueue(queueDir, task({ idempotency_key: "k-a" }));
    const pending = await listPending(queueDir);
    assert.equal(pending.length, 2);
    assert.deepEqual([...pending].sort(), pending);
    for (const name of pending) assert.match(name, /\.json$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tarefa válida termina REGISTERED, sai da fila e vai para processed/", async () => {
  const { root, queueDir, processedDir, ledgerPath } = await makeDirs();
  try {
    await enqueue(queueDir, task({ idempotency_key: "ok-1" }));
    const summary = await processQueue({
      queueDir, processedDir, ledgerPath,
      fvbs: makeFvbs(),
      catalog: policies.command_catalog
    });
    assert.equal(summary.registered, 1);
    assert.equal(summary.remaining, 0);
    assert.equal((await listPending(queueDir)).length, 0);

    const files = await readdir(processedDir);
    assert.equal(files.length, 1);
    const record = JSON.parse(await readFile(path.join(processedDir, files[0]), "utf8"));
    assert.equal(record.result.result, "REGISTERED");
    assert.equal(record.result.state, "REGISTERED");
    assert.equal(record.task.type, "CASHBACK");

    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    assert.equal(ledger.verify.ok, true);
    assert.ok(ledger.entries.length >= 5);
    assert.equal(ledger.entries[0].event, "COMMAND_RECEIVED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("JSON inválido vira erro E_JSON sem derrubar o restante do lote", async () => {
  const { root, queueDir, processedDir, ledgerPath } = await makeDirs();
  try {
    await mkdir(queueDir, { recursive: true });
    await writeFile(path.join(queueDir, "00-broken.json"), "{ nope", "utf8");
    await enqueue(queueDir, task({ idempotency_key: "ok-2" }));
    const summary = await processQueue({
      queueDir, processedDir, ledgerPath,
      fvbs: makeFvbs(),
      catalog: policies.command_catalog
    });
    assert.equal(summary.errors, 1);
    assert.equal(summary.registered, 1);
    assert.equal(summary.remaining, 0);

    const files = (await readdir(processedDir)).sort();
    const broken = JSON.parse(await readFile(path.join(processedDir, files[0]), "utf8"));
    assert.equal(broken.error_code, "E_JSON");
    assert.equal(broken.result, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("política rejeita cashback acima do teto sem executar efeito", async () => {
  const { root, queueDir, processedDir, ledgerPath } = await makeDirs();
  try {
    await enqueue(queueDir, task({ amount: 999, idempotency_key: "over-1" }));
    const fvbs = makeFvbs();
    const summary = await processQueue({
      queueDir, processedDir, ledgerPath, fvbs, catalog: policies.command_catalog
    });
    assert.equal(summary.rejected, 1);
    assert.equal(summary.registered, 0);
    assert.deepEqual(fvbs.getEffects(), []);

    const files = await readdir(processedDir);
    const record = JSON.parse(await readFile(path.join(processedDir, files[0]), "utf8"));
    assert.equal(record.result.result, "REJECTED");
    assert.equal(record.result.error_code, "E_LIMIT_EXCEEDED");
    assert.equal(record.result.state, "REJECTED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DISCOUNT proibido rejeita com E_PERMISSION e fora do catálogo é E_SCHEMA", async () => {
  const { root, queueDir, processedDir, ledgerPath } = await makeDirs();
  try {
    await enqueue(queueDir, task({ type: "DISCOUNT", idempotency_key: "d-1" }));
    await enqueue(queueDir, task({ type: "TRANSFER_ALL_FUNDS", idempotency_key: "x-1" }));
    const summary = await processQueue({
      queueDir, processedDir, ledgerPath,
      fvbs: makeFvbs(),
      catalog: policies.command_catalog
    });
    assert.equal(summary.rejected, 1);
    assert.equal(summary.errors, 1); // E_SCHEMA no createCommand

    const codes = [];
    for (const name of await readdir(processedDir)) {
      const record = JSON.parse(await readFile(path.join(processedDir, name), "utf8"));
      codes.push(record.error_code ?? record.result?.error_code);
    }
    assert.ok(codes.includes("E_PERMISSION"), `E_PERMISSION ausente em ${codes}`);
    assert.ok(codes.some(c => c && c.startsWith("E_SCHEMA")), `E_SCHEMA ausente em ${codes}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repetição da mesma chave vira DUPLICATE com um único efeito", async () => {
  const { root, queueDir, processedDir, ledgerPath } = await makeDirs();
  try {
    await enqueue(queueDir, task({ idempotency_key: "dup-key" }));
    await enqueue(queueDir, task({ idempotency_key: "dup-key" }));
    const fvbs = makeFvbs();
    const summary = await processQueue({
      queueDir, processedDir, ledgerPath, fvbs, catalog: policies.command_catalog
    });
    assert.equal(summary.registered, 1);
    assert.equal(summary.duplicates, 1);
    assert.equal(fvbs.getEffects().length, 1);

    const events = fvbs.getLedger().map(e => e.event);
    assert.ok(events.includes("DUPLICATE_BLOCKED"));
    assert.equal((await fvbs.verifyLedger()).ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fila vazia: processQueue não escreve ledger e devolve zeros", async () => {
  const { root, queueDir, processedDir, ledgerPath } = await makeDirs();
  try {
    const summary = await processQueue({
      queueDir, processedDir, ledgerPath,
      fvbs: makeFvbs(),
      catalog: policies.command_catalog
    });
    assert.equal(summary.scanned, 0);
    assert.equal(summary.registered, 0);
    assert.equal(existsSync(ledgerPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
