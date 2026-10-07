import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../core/crypto.js";
import { createCommand } from "../core/command.js";
import { createFVBS } from "../core/fvbs.js";
import { createProposal } from "../core/proposer.js";
import { verifyLedger } from "../core/proof.js";
import { transition } from "../core/stateMachine.js";
import { validateCommand } from "../core/validator.js";

const policies = JSON.parse(
  await readFile(new URL("../data/policies.json", import.meta.url), "utf8")
);
let nextId = 0;

function makeCommand(overrides = {}) {
  return createCommand({
    type: "CASHBACK",
    customerId: "CLI_001",
    amount: 5,
    origin: "USER",
    ...overrides
  }, {
    catalog: policies.command_catalog,
    uuid: () => `test-id-${++nextId}`,
    now: () => "2026-10-02T12:00:00.000Z"
  });
}

function makeCore() {
  return createFVBS({
    policies: structuredClone(policies),
    now: () => "2026-10-02T12:00:00.000Z"
  });
}

test("serialização canônica ordena chaves e rejeita valores ambíguos", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.throws(() => canonicalJson({ amount: Number.NaN }), /E_CANONICAL/);
});

test("Command contém esquema válido e não carrega confidence", () => {
  const command = makeCommand();
  assert.equal(command.type, "CASHBACK");
  assert.equal("confidence" in command, false);
  assert.equal(validateCommand(command, policies).result, "AUTHORIZED");
});

test("bloqueia qualquer salto sobre AUTORIZADO", () => {
  assert.throws(() => transition("VALIDATED", "EXECUTED"), /E_STATE/);
  assert.equal(transition("VALIDATED", "AUTHORIZED"), "AUTHORIZED");
});

test("rejeita configuração de política malformada", () => {
  const result = validateCommand(makeCommand(), { ...policies, cashback_limit: "20" });
  assert.equal(result.error_code, "E_POLICY_CONFIG");
});

test("rejeita desconto não permitido e registra a recusa", async () => {
  const core = makeCore();
  const result = await core.receive(makeCommand({ type: "DISCOUNT" }));
  assert.equal(result.state, "REJECTED");
  assert.equal(result.policyResult.error_code, "E_PERMISSION");
  assert.deepEqual(core.getLedger().map(entry => entry.event), [
    "COMMAND_RECEIVED",
    "POLICY_REJECTED"
  ]);
  assert.equal(core.getEffects().length, 0);
});

test("rejeita cashback acima do teto sem criar efeito", async () => {
  const core = makeCore();
  const result = await core.receive(makeCommand({ amount: 999 }));
  assert.equal(result.policyResult.error_code, "E_LIMIT_EXCEEDED");
  assert.equal(core.getEffects().length, 0);
});

test("rejeita identidade desconhecida", async () => {
  const result = await makeCore().receive(
    makeCommand({ customerId: "CLI_UNKNOWN" })
  );
  assert.equal(result.policyResult.error_code, "E_IDENTITY");
});

test("fluxo autorizado percorre os cinco estados e verifica o ledger", async () => {
  const core = makeCore();
  const command = makeCommand();
  assert.equal((await core.receive(command)).state, "VALIDATED");
  assert.equal((await core.authorize(command.operation_id)).state, "AUTHORIZED");
  assert.equal((await core.execute(command.operation_id)).state, "EXECUTED");
  assert.equal((await core.register(command.operation_id)).state, "REGISTERED");
  assert.deepEqual(
    (await core.verifyLedger()).ok,
    true
  );
  assert.deepEqual(
    core.getLedger().map(entry => entry.state),
    ["CREATED", "VALIDATED", "AUTHORIZED", "EXECUTED", "REGISTERED"]
  );
  assert.equal(core.getEffects().length, 1);
});

test("não executa antes da autorização", async () => {
  const core = makeCore();
  const { operation_id } = await core.receive(makeCommand());
  await assert.rejects(core.execute(operation_id), /E_STATE/);
  assert.equal(core.getEffects().length, 0);
});

test("retry com mesma chave retorna operação original; payload diferente conflita", async () => {
  const core = makeCore();
  const first = makeCommand({ idempotencyKey: "same-key" });
  await core.receive(first);
  await core.authorize(first.operation_id);
  await core.execute(first.operation_id);
  await core.register(first.operation_id);

  const retry = makeCommand({ idempotencyKey: "same-key" });
  const duplicate = await core.receive(retry);
  assert.equal(duplicate.result, "DUPLICATE");
  assert.equal(duplicate.original_operation_id, first.operation_id);
  assert.equal(core.getEffects().length, 1);

  const conflict = await core.receive(
    makeCommand({ amount: 10, idempotencyKey: "same-key" })
  );
  assert.equal(conflict.error_code, "E_IDEMPOTENCY_CONFLICT");
  assert.equal(core.getEffects().length, 1);
});

test("abstenção abaixo do limiar não gera Command", () => {
  const proposal = createProposal("quero cashback", { forceConfidence: 0.1 });
  assert.equal(proposal.abstained, true);
  assert.equal(proposal.selected, null);
});

test("verificador detecta alteração em cópia do ledger", async () => {
  const core = makeCore();
  const command = makeCommand();
  await core.receive(command);
  await core.authorize(command.operation_id);
  const copy = core.getLedger();
  copy[0].event = "TAMPERED";
  const verification = await verifyLedger(copy);
  assert.equal(verification.ok, false);
  assert.equal(verification.at, 1);
});

test("exportação do ledger não expõe referências internas mutáveis", async () => {
  const core = makeCore();
  const command = makeCommand();
  await core.receive(command);
  const exported = core.getLedger();
  exported[1].details.rules_evaluated[0].passed = false;
  assert.equal((await core.verifyLedger()).ok, true);
});

test("Command com metadado confidence é rejeitado", () => {
  const command = { ...makeCommand(), confidence: 1 };
  assert.equal(validateCommand(command, policies).error_code, "E_SCHEMA");
});
