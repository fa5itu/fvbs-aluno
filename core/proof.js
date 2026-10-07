import { canonicalJson, sha256 } from "./crypto.js";

export async function verifyLedger(records) {
  if (!Array.isArray(records)) {
    throw new TypeError("E_PROOF_INPUT: ledger deve ser um array");
  }

  let previousHash = "0";
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
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
        expected,
        found: current_hash,
        error_code: "E_LEDGER_INTEGRITY"
      };
    }
    previousHash = current_hash;
  }
  return { ok: true, count: records.length };
}
