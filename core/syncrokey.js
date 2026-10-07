import crypto from 'node:crypto';
import { canonicalJson } from './crypto.js';

export class VectorClock {
  constructor(clockMap = {}) {
    this.clocks = { ...clockMap };
  }

  increment(nodeId) {
    this.clocks[nodeId] = (this.clocks[nodeId] || 0) + 1;
    return this;
  }

  get(nodeId) {
    return this.clocks[nodeId] || 0;
  }

  compare(other) {
    const keys = new Set([...Object.keys(this.clocks), ...Object.keys(other.clocks)]);
    let greater = false;
    let smaller = false;

    for (const key of keys) {
      const v1 = this.get(key);
      const v2 = other.get(key);
      if (v1 > v2) greater = true;
      if (v1 < v2) smaller = true;
    }

    if (greater && !smaller) return 1; // this dominates other
    if (!greater && smaller) return -1; // other dominates this
    if (!greater && !smaller) return 0; // identical
    return null; // concurrent (divergent)
  }

  static reconcile(vcA, vcB, actorA, actorB) {
    const rel = vcA.compare(vcB);
    if (rel === 1) return { winner: 'A', vector: vcA, tieBroken: false };
    if (rel === -1) return { winner: 'B', vector: vcB, tieBroken: false };
    
    // Concurrent tie-break via canonical SHA-256 hash comparison of actor IDs
    const mergedMap = {};
    const keys = new Set([...Object.keys(vcA.clocks), ...Object.keys(vcB.clocks)]);
    for (const k of keys) {
      mergedMap[k] = Math.max(vcA.get(k), vcB.get(k));
    }
    
    const hashA = crypto.createHash('sha256').update(actorA).digest('hex');
    const hashB = crypto.createHash('sha256').update(actorB).digest('hex');
    const winner = hashA <= hashB ? 'A' : 'B';
    
    return { winner, vector: new VectorClock(mergedMap), tieBroken: true };
  }
}

export function generateEd25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { publicKey, privateKey };
}

export function signPayloadEd25519(payload, privateKeyPem) {
  const canonical = typeof payload === 'string' ? payload : canonicalJson(payload);
  const signature = crypto.sign(null, Buffer.from(canonical), privateKeyPem);
  return signature.toString('hex');
}

export function verifySignatureEd25519(payload, signatureHex, publicKeyPem) {
  const canonical = typeof payload === 'string' ? payload : canonicalJson(payload);
  return crypto.verify(
    null,
    Buffer.from(canonical),
    publicKeyPem,
    Buffer.from(signatureHex, 'hex')
  );
}

export function verifyByzantineQuorum(n, f, validSignaturesCount) {
  if (n < 3 * f + 1) {
    return { status: 'INVALID_TOPOLOGY', message: `Rede requer n >= 3f + 1 (${3*f+1}), fornecido n=${n}` };
  }
  const minQuorum = Math.ceil((2 * n) / 3);
  const isQuorumReached = validSignaturesCount >= minQuorum;
  return {
    status: isQuorumReached ? 'QUORUM_REACHED' : 'QUORUM_FAILED',
    required: minQuorum,
    provided: validSignaturesCount,
    maxMaliciousTolerated: f
  };
}
