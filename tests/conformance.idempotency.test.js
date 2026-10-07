import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCommand } from "../core/command.js";
import { createFVBS } from "../core/fvbs.js";
import { commandFingerprint, createIdempotencyStore } from "../core/idempotency.js";

/**
 * Executor de conformidade — CONTRACT-FVBS-CO-01 (Idempotência).
 *
 * Independência: este executor NÃO importa a implementação avaliada por dentro.
 * Ele consome um adaptador de interface ({ createCommand, createFVBS,
 * createIdempotencyStore, commandFingerprint }). Na verificação da referência,
 * o adaptador aponta para ./core; na avaliação do aluno, aponta para o código
 * do aluno. Os vetores e as expectativas vêm de
 * ../data/conformance/idempotency.vectors.json e não pertencem ao aluno.
 */

const vectors = JSON.parse(
  await readFile(new URL("../data/conformance/idempotency.vectors.json", import.meta.url), "utf8")
);
const policies = JSON.parse(
  await readFile(new URL("../data/policies.json", import.meta.url), "utf8")
);

// Adaptador da implementação de referência (únicos pontos acoplados ao core).
const referenceAdapter = { createCommand, createFVBS, createIdempotencyStore, commandFingerprint };

let uuidCounter = 0;
const nextUuid = () => `cf-uuid-${++uuidCounter}`;
const fixedNow = () => "2026-10-02T12:00:00.000Z";

function makeCommand({ key, amount }) {
  return createCommand(
    { type: "CASHBACK", customerId: "CLI_001", amount, origin: "USER", idempotencyKey: key },
    { catalog: policies.command_catalog, uuid: nextUuid, now: fixedNow }
  );
}

/* ------------------------- runner de sistema ------------------------- */

async function runSystemVector(steps) {
  const core = createFVBS({ policies: structuredClone(policies), now: fixedNow });
  const state = { core, first: null, lastReceive: null, ledgerLengthBeforeLast: null };

  for (const step of steps) {
    switch (step.op) {
      case "flow_complete": {
        const command = makeCommand({ key: step.key, amount: step.amount });
        await core.receive(command);
        await core.authorize(command.operation_id);
        await core.execute(command.operation_id);
        await core.register(command.operation_id);
        state.first ??= { operation_id: command.operation_id };
        state.lastReceive = { kind: "flow_complete", response: { result: "REGISTERED" } };
        break;
      }
      case "receive_retry_same":
      case "receive_retry_conflict": {
        state.ledgerLengthBeforeLast = core.getLedger().length;
        const command = makeCommand({ key: step.key, amount: step.amount });
        state.lastReceive = {
          kind: step.op === "receive_retry_conflict" ? "retry_conflict" : "retry_same",
          response: await core.receive(command)
        };
        break;
      }
      case "receive_in_progress_then_retry": {
        const original = makeCommand({ key: step.key, amount: step.amount });
        await core.receive(original); // begin() sem complete(): estado IN_PROGRESS
        state.first ??= { operation_id: original.operation_id };
        const retry = makeCommand({ key: step.key, amount: step.amount });
        state.ledgerLengthBeforeLast = core.getLedger().length;
        state.lastReceive = { kind: "retry_same", response: await core.receive(retry) };
        break;
      }
      default:
        throw new Error(`ação de sistema desconhecida: ${step.op}`);
    }
  }
  return state;
}

function responseKind(response) {
  if (response.result === "DUPLICATE" || response.error_code === "E_DUPLICATE") {
    return "duplicate";
  }
  if (response.result === "VALIDATED" || response.result === "REGISTERED") {
    return "processed";
  }
  return "not_processed";
}

function applySystemExpect(expect, state) {
  if (expect.effects_count !== undefined) {
    assert.equal(
      state.core.getEffects().length,
      expect.effects_count,
      `contador de efeitos: ${state.core.getEffects().length} != ${expect.effects_count}`
    );
  }
  if (expect.ledger_includes) {
    const events = state.core.getLedger().map(entry => entry.event);
    for (const event of expect.ledger_includes) {
      assert.ok(events.includes(event), `evento esperado ausente no ledger: ${event}`);
    }
  }
  if (expect.ledger_length_unchanged_after_last) {
    assert.equal(
      state.core.getLedger().length,
      state.ledgerLengthBeforeLast,
      "ledger registrou evento na última tentativa, mas vetor exige ledger inalterado"
    );
  }
  const last = state.lastReceive?.response;
  if (expect.last_response_kind) {
    assert.ok(last, "vetor exige resposta de receive");
    assert.equal(
      responseKind(last),
      expect.last_response_kind,
      `classe da resposta: ${responseKind(last)} != ${expect.last_response_kind}`
    );
  }
  if (expect.last_response_original_operation_id_is_first) {
    assert.equal(last.original_operation_id, state.first.operation_id);
  }
  if (expect.last_response_original_result_kind !== undefined) {
    assert.equal(last.original_result?.result, expect.last_response_original_result_kind);
  }
  if (expect.last_response_original_result_null) {
    assert.equal(last.original_result ?? null, null, "resultado original deveria estar ausente (IN_PROGRESS)");
  }
}

/* -------------------------- runner de loja --------------------------- */

async function runStoreVector(steps) {
  const store = createIdempotencyStore();
  const state = { store, lastBegin: null, completeThrew: null, fingerprint: null };

  for (const step of steps) {
    switch (step.op) {
      case "begin": {
        state.lastBegin = store.begin(step.key, step.fingerprint, step.operation_id);
        break;
      }
      case "complete": {
        store.complete(step.key, step.result ?? { result: "REGISTERED" });
        break;
      }
      case "complete_unknown": {
        try {
          store.complete(step.key, { result: "ANY" });
          state.completeThrew = null;
        } catch (error) {
          state.completeThrew = String(error.message);
        }
        break;
      }
      case "fingerprint_stability": {
        const a = makeCommand({ key: "K", amount: 5 });
        const b = makeCommand({ key: "K", amount: 5 });
        const modified = { ...b, payload: { amount: 9 } };
        const sameLogic = (await commandFingerprint(a)) === (await commandFingerprint(b));
        const changedPayload = (await commandFingerprint(a)) !== (await commandFingerprint(modified));
        const excludesVolatile =
          (await commandFingerprint({
            type: a.type,
            customer_id: a.customer_id,
            origin: a.origin,
            payload: a.payload
          })) === (await commandFingerprint(a));
        state.fingerprint = { sameLogic, changedPayload, excludesVolatile };
        break;
      }
      default:
        throw new Error(`ação de loja desconhecida: ${step.op}`);
    }
  }
  return state;
}

function applyStoreExpect(expect, state) {
  if (expect.last_begin_kind) {
    assert.ok(state.lastBegin, "vetor exige chamada begin");
    assert.equal(state.lastBegin.kind, expect.last_begin_kind);
  }
  if (expect.last_begin_kind_not) {
    assert.ok(state.lastBegin, "vetor exige chamada begin");
    assert.notEqual(state.lastBegin.kind, expect.last_begin_kind_not);
  }
  if (expect.last_begin_operation_id_is) {
    assert.equal(state.lastBegin.operation_id, expect.last_begin_operation_id_is);
  }
  if (expect.last_begin_original_result_kind !== undefined) {
    assert.equal(state.lastBegin.result?.result, expect.last_begin_original_result_kind);
  }
  if (expect.last_begin_original_result_null) {
    assert.equal(state.lastBegin.result ?? null, null);
  }
  if (expect.complete_throws) {
    assert.ok(state.completeThrew, "complete deveria lançar erro");
    assert.ok(
      state.completeThrew.includes(expect.complete_throws),
      `erro "${state.completeThrew}" não contém ${expect.complete_throws}`
    );
  }
  if (expect.fingerprint_stability) {
    assert.deepEqual(state.fingerprint, {
      sameLogic: true,
      changedPayload: true,
      excludesVolatile: true
    });
  }
}

/* ------------------------- runner de emissor ------------------------- */

function runEmitterVector() {
  const withoutKey = createCommand(
    { type: "CASHBACK", customerId: "CLI_001", amount: 5 },
    { catalog: policies.command_catalog, uuid: nextUuid, now: fixedNow }
  );
  const withKey = createCommand(
    { type: "CASHBACK", customerId: "CLI_001", amount: 5, idempotencyKey: "given-key" },
    { catalog: policies.command_catalog, uuid: nextUuid, now: fixedNow }
  );
  return {
    generated: typeof withoutKey.idempotency_key === "string" && withoutKey.idempotency_key.length > 0,
    preserved: withKey.idempotency_key === "given-key"
  };
}

function applyEmitterExpect(expect, observed) {
  if (expect.generated !== undefined) assert.equal(observed.generated, expect.generated);
  if (expect.preserved !== undefined) assert.equal(observed.preserved, expect.preserved);
}

/* ------------------------------ suíte -------------------------------- */

for (const vector of vectors.vectors) {
  const label = `${vector.id} · ${vector.class}${vector.approval ? `/${vector.approval}` : ""} · ${vector.title}`;
  test(label, async () => {
    if (vector.level === "system") {
      applySystemExpect(vector.expect, await runSystemVector(vector.steps));
    } else if (vector.level === "store") {
      applyStoreExpect(vector.expect, await runStoreVector(vector.steps));
    } else if (vector.level === "emitter") {
      applyEmitterExpect(vector.expect, runEmitterVector());
    } else {
      throw new Error(`nível desconhecido: ${vector.level}`);
    }
  });
}

test("governança: vetores obrigatórios cobrem a invariante I3 (unicidade de efeito)", () => {
  const mandatory = vectors.vectors.filter(v => v.approval === "mandatory");
  assert.ok(mandatory.length >= 5, "contrato deve ter ao menos 5 vetores obrigatórios");
  assert.ok(
    mandatory.some(v => /I3/.test(v.basis)),
    "a invariante I3 deve ter ao menos um vetor obrigatório"
  );
  assert.ok(
    vectors.vectors.filter(v => v.class === "characterization").length >= 1,
    "contrato deve distinguir caracterizações de normas"
  );
});
