import { canonicalJson, sha256 } from "./crypto.js";

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    freezeDeep(nested);
  }
  return Object.freeze(value);
}

export class Ledger {
  constructor({ now = () => new Date().toISOString() } = {}) {
    this.entries = [];
    this.now = now;
  }

  async append(event, operation_id, details = null, state = "REGISTERED") {
    const previous_hash = this.entries.at(-1)?.current_hash ?? "0";
    const record = {
      seq: this.entries.length + 1,
      operation_id: operation_id || "op-unknown",
      event: typeof event === "string" ? event : event?.event || "STATE_TRANSITION",
      state: state || event?.state || "REGISTERED",
      details: details === null ? (event?.details || null) : structuredClone(details),
      timestamp: this.now(),
      previous_hash
    };
    record.current_hash = await sha256(
      canonicalJson({ ...record, previous_hash })
    );
    this.entries.push(freezeDeep(record));
    return structuredClone(record);
  }

  list() {
    return structuredClone(this.entries);
  }

  async verify() {
    let previousHash = "0";
    for (let index = 0; index < this.entries.length; index += 1) {
      const record = this.entries[index];
      const { current_hash, ...body } = record;
      const expected = await sha256(
        canonicalJson({ ...body, previous_hash: previousHash })
      );
      if (record.seq !== index + 1 ||
          record.previous_hash !== previousHash ||
          current_hash !== expected) {
        return {
          ok: false,
          at: record.seq,
          error_code: "E_LEDGER_INTEGRITY"
        };
      }
      previousHash = current_hash;
    }
    return { ok: true, count: this.entries.length };
  }
}

export function createLedger(opts) {
  const ledgerInstance = new Ledger(opts);
  return {
    async append(args) {
      if (typeof args === "object" && args.operation_id && args.event && args.state) {
        return ledgerInstance.append(args.event, args.operation_id, args.details, args.state);
      }
      return ledgerInstance.append(...arguments);
    },
    list() {
      return ledgerInstance.list();
    },
    verify() {
      return ledgerInstance.verify();
    }
  };
}
