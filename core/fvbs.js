import { canonicalJson } from "./crypto.js";
import { commandFingerprint, createIdempotencyStore } from "./idempotency.js";
import { createLedger } from "./ledger.js";
import { transition } from "./stateMachine.js";
import { validateCommand } from "./validator.js";

export function createFVBS({ policies, now } = {}) {
  const ledger = createLedger({ now });
  const idempotency = createIdempotencyStore();
  const operations = new Map();
  const effects = [];

  async function record(operation, event, details = null) {
    return ledger.append({
      operation_id: operation.command.operation_id,
      event,
      state: operation.state,
      details
    });
  }

  return {
    async receive(command) {
      const result = validateCommand(command, policies);
      if (result.error_code === "E_SCHEMA" ||
          result.error_code === "E_POLICY_CONFIG") {
        return { operation_id: command?.operation_id ?? null, ...result };
      }

      const fingerprint = await commandFingerprint(command);
      const idem = idempotency.begin(
        command.idempotency_key,
        fingerprint,
        command.operation_id
      );
      if (idem.kind === "CONFLICT") {
        return {
          operation_id: command.operation_id,
          result: "REJECTED",
          error_code: "E_IDEMPOTENCY_CONFLICT"
        };
      }
      if (idem.kind === "DUPLICATE") {
        await ledger.append({
          operation_id: command.operation_id,
          event: "DUPLICATE_BLOCKED",
          state: "—",
          details: { original_operation_id: idem.operation_id }
        });
        return {
          operation_id: command.operation_id,
          result: "DUPLICATE",
          original_operation_id: idem.operation_id,
          original_result: idem.result
        };
      }

      const operation = {
        command: structuredClone(command),
        state: "CREATED",
        policyResult: result
      };
      operations.set(command.operation_id, operation);
      await record(operation, "COMMAND_RECEIVED");

      if (result.result === "REJECTED") {
        operation.state = transition(operation.state, "REJECTED");
        await record(operation, "POLICY_REJECTED", result);
        const rejection = {
          result: "REJECTED",
          error_code: result.error_code
        };
        idempotency.complete(command.idempotency_key, rejection);
        return {
          operation_id: command.operation_id,
          ...rejection,
          state: operation.state,
          policyResult: result
        };
      }

      operation.state = transition(operation.state, "VALIDATED");
      await record(operation, "POLICY_VALIDATED", result);
      return {
        operation_id: command.operation_id,
        result: "VALIDATED",
        state: operation.state,
        policyResult: result
      };
    },

    async authorize(operationId) {
      const operation = operations.get(operationId);
      if (!operation) throw new Error("E_OPERATION_NOT_FOUND");
      operation.state = transition(operation.state, "AUTHORIZED");
      await record(operation, "OPERATION_AUTHORIZED");
      return { operation_id: operationId, state: operation.state };
    },

    async execute(operationId) {
      const operation = operations.get(operationId);
      if (!operation) throw new Error("E_OPERATION_NOT_FOUND");
      operation.state = transition(operation.state, "EXECUTED");
      effects.push({
        operation_id: operationId,
        type: operation.command.type,
        amount: operation.command.payload.amount
      });
      await record(operation, "OPERATION_EXECUTED", { effect: "SIMULATED" });
      return { operation_id: operationId, state: operation.state };
    },

    async register(operationId) {
      const operation = operations.get(operationId);
      if (!operation) throw new Error("E_OPERATION_NOT_FOUND");
      operation.state = transition(operation.state, "REGISTERED");
      await record(operation, "OPERATION_REGISTERED");
      const result = {
        result: "REGISTERED",
        state: operation.state,
        operation_id: operationId
      };
      idempotency.complete(operation.command.idempotency_key, result);
      return result;
    },

    getOperation(operationId) {
      const operation = operations.get(operationId);
      if (!operation) return null;
      return {
        operation_id: operationId,
        state: operation.state,
        command: structuredClone(operation.command),
        policyResult: structuredClone(operation.policyResult)
      };
    },

    getEffects() {
      return effects.map(effect => ({ ...effect }));
    },

    getLedger() {
      return ledger.list();
    },

    verifyLedger() {
      return ledger.verify();
    },

    async exportLedgerJson() {
      return canonicalJson(ledger.list());
    }
  };
}
