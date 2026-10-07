export const STATES = Object.freeze({
  CREATED: "CREATED",
  VALIDATED: "VALIDATED",
  AUTHORIZED: "AUTHORIZED",
  PENDING_RECONCILIATION: "PENDING_RECONCILIATION",
  EXECUTED: "EXECUTED",
  REGISTERED: "REGISTERED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  REVERSED: "REVERSED"
});

export const TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(["VALIDATED", "REJECTED"]),
  VALIDATED: Object.freeze(["AUTHORIZED", "REJECTED"]),
  AUTHORIZED: Object.freeze(["EXECUTED", "CANCELLED", "PENDING_RECONCILIATION"]),
  PENDING_RECONCILIATION: Object.freeze(["EXECUTED", "CANCELLED", "MANUAL_REVIEW"]),
  EXECUTED: Object.freeze(["REGISTERED", "REVERSED"]),
  REGISTERED: Object.freeze(["REVERSED"]),
  MANUAL_REVIEW: Object.freeze([]),
  REJECTED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  REVERSED: Object.freeze([])
});

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transition(from, to) {
  if (!canTransition(from, to)) {
    const err = new Error(`E_STATE: transição ${from} -> ${to} não permitida`);
    err.code = "E_STATE";
    err.from = from;
    err.to = to;
    throw err;
  }
  return to;
}
