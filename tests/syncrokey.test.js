import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VectorClock,
  generateEd25519KeyPair,
  signPayloadEd25519,
  verifySignatureEd25519,
  verifyByzantineQuorum
} from '../core/syncrokey.js';

test('SYNCROKEY-01: Vector Clocks — Ordenação Causal e Domínio', () => {
  const vc1 = new VectorClock({ nodeA: 1, nodeB: 0 });
  const vc2 = new VectorClock({ nodeA: 1, nodeB: 1 });

  assert.equal(vc1.compare(vc2), -1, 'vc1 deve ser dominado por vc2');
  assert.equal(vc2.compare(vc1), 1, 'vc2 deve dominar vc1');
});

test('SYNCROKEY-02: Vector Clocks — Reconciliação Determinística de Concorrência (Tie-Break)', () => {
  const vcA = new VectorClock({ nodeA: 2, nodeB: 1 });
  const vcB = new VectorClock({ nodeA: 1, nodeB: 2 });

  assert.equal(vcA.compare(vcB), null, 'Vetores divergentes são concorrentes');

  const recon = VectorClock.reconcile(vcA, vcB, 'nodeA_actor_id', 'nodeB_actor_id');
  assert.equal(recon.tieBroken, true, 'Tie-break determinístico deve ter sido aplicado');
  assert.ok(['A', 'B'].includes(recon.winner), 'Deve eleger um vencedor determinístico');
  assert.equal(recon.vector.get('nodeA'), 2);
  assert.equal(recon.vector.get('nodeB'), 2);
});

test('SYNCROKEY-03: Ed25519 — Assinatura Não-Repudiável e Verificação de Autoria', () => {
  const { publicKey, privateKey } = generateEd25519KeyPair();
  const payload = { intent_ref: 'int_123', amount: 50.00, actor_id: 'usr_ituverava_01' };

  const signature = signPayloadEd25519(payload, privateKey);
  assert.ok(signature.length > 0, 'Assinatura Ed25519 gerada');

  const isValid = verifySignatureEd25519(payload, signature, publicKey);
  assert.equal(isValid, true, 'Assinatura Ed25519 válida');

  const tamperedPayload = { ...payload, amount: 500.00 };
  const isTamperedValid = verifySignatureEd25519(tamperedPayload, signature, publicKey);
  assert.equal(isTamperedValid, false, 'Payload adulterado deve falhar na verificação');
});

test('SYNCROKEY-04: Modelo Bizantino — Validação de Quórum (f < n/3)', () => {
  // Para n=4, f=1: Quórum mínimo = ceil(2*4/3) = 3
  const q1 = verifyByzantineQuorum(4, 1, 3);
  assert.equal(q1.status, 'QUORUM_REACHED');
  assert.equal(q1.required, 3);

  const q2 = verifyByzantineQuorum(4, 1, 2);
  assert.equal(q2.status, 'QUORUM_FAILED');

  // Topologia inválida (n=3 com f=1 viola n >= 3f + 1)
  const q3 = verifyByzantineQuorum(3, 1, 2);
  assert.equal(q3.status, 'INVALID_TOPOLOGY');
});
