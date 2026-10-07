function normalize(value, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError("E_CANONICAL: estrutura cíclica");
    }
    ancestors.add(value);
    const result = value.map(item => normalize(item, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("E_CANONICAL: objeto deve ser JSON simples");
    }
    if (ancestors.has(value)) {
      throw new TypeError("E_CANONICAL: estrutura cíclica");
    }
    ancestors.add(value);
    const result = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === "function" || typeof item === "bigint") {
        throw new TypeError(`E_CANONICAL: valor não serializável em ${key}`);
      }
      result[key] = normalize(item, ancestors);
    }
    ancestors.delete(value);
    return result;
  }
  throw new TypeError("E_CANONICAL: valor não serializável");
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value, new WeakSet()));
}

export async function sha256(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("E_CRYPTO_UNAVAILABLE: Web Crypto API indisponível");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
