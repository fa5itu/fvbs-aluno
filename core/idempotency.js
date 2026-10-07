import { canonicalJson, sha256 } from "./crypto.js";

export async function commandFingerprint(command) {
  const operation = {
    type: command.type,
    customer_id: command.customer_id,
    origin: command.origin,
    payload: command.payload
  };
  return sha256(canonicalJson(operation));
}

export function createIdempotencyStore() {
  const entries = new Map();

  return {
    begin(key, fingerprint, operationId) {
      const existing = entries.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return { kind: "CONFLICT", operation_id: existing.operation_id };
        }
        return {
          kind: "DUPLICATE",
          operation_id: existing.operation_id,
          result: existing.result
        };
      }

      entries.set(key, {
        fingerprint,
        operation_id: operationId,
        status: "IN_PROGRESS",
        result: null
      });
      return { kind: "NEW", operation_id: operationId };
    },

    complete(key, result) {
      const entry = entries.get(key);
      if (!entry) {
        throw new Error("E_IDEMPOTENCY_STATE: chave não registrada");
      }
      entries.set(key, { ...entry, status: "COMPLETED", result });
    }
  };
}
