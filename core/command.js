export const ORIGINS = Object.freeze(["USER", "AI_AGENT", "API", "SYSTEM"]);

export function createCommand(
  { type, customerId, amount, origin = "USER", idempotencyKey } = {},
  { catalog, uuid = () => globalThis.crypto.randomUUID(), now = () => new Date().toISOString() } = {}
) {
  if (!Array.isArray(catalog) || !catalog.includes(type)) {
    throw new Error("E_SCHEMA: tipo fora do catálogo");
  }
  if (!ORIGINS.includes(origin)) {
    throw new Error("E_SCHEMA: origem inválida");
  }
  if (typeof customerId !== "string" || !customerId.trim()) {
    throw new Error("E_SCHEMA: customer_id obrigatório");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("E_SCHEMA: amount deve ser finito e maior que zero");
  }

  const timestamp = now();
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("E_SCHEMA: timestamp inválido");
  }

  return {
    operation_id: uuid(),
    type,
    customer_id: customerId.trim(),
    origin,
    payload: { amount },
    timestamp,
    idempotency_key: idempotencyKey ?? uuid()
  };
}
