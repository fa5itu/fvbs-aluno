import { ORIGINS } from "./command.js";
import { evaluatePolicy } from "./policy.js";

export function validatePolicyConfiguration(policies) {
  if (!policies || typeof policies !== "object") {
    return { valid: false, error_code: "E_POLICY_CONFIG" };
  }
  if (!Array.isArray(policies.command_catalog) ||
      policies.command_catalog.length === 0 ||
      !Array.isArray(policies.identity_whitelist) ||
      typeof policies.discounts_allowed !== "boolean" ||
      typeof policies.campaign_active !== "boolean" ||
      !Number.isFinite(policies.cashback_limit) ||
      policies.cashback_limit < 0 ||
      !policies.balances ||
      typeof policies.balances !== "object" ||
      Array.isArray(policies.balances)) {
    return { valid: false, error_code: "E_POLICY_CONFIG" };
  }
  return { valid: true, error_code: null };
}

export function validateCommand(command, policies) {
  const config = validatePolicyConfiguration(policies);
  if (!config.valid) {
    return {
      result: "REJECTED",
      error_code: config.error_code,
      rules_evaluated: []
    };
  }

  if (!command || typeof command !== "object" ||
      !command.operation_id || typeof command.operation_id !== "string" ||
      !command.idempotency_key || typeof command.idempotency_key !== "string" ||
      !command.customer_id || typeof command.customer_id !== "string" ||
      !policies.command_catalog.includes(command.type) ||
      !ORIGINS.includes(command.origin) ||
      !Number.isFinite(Date.parse(command.timestamp)) ||
      !command.payload || typeof command.payload !== "object" ||
      !Number.isFinite(command.payload.amount) ||
      command.payload.amount <= 0 ||
      Object.hasOwn(command, "confidence")) {
    return {
      result: "REJECTED",
      error_code: "E_SCHEMA",
      rules_evaluated: [{ rule: "command_schema", passed: false }]
    };
  }

  if (!policies.identity_whitelist.includes(command.customer_id)) {
    return {
      result: "REJECTED",
      error_code: "E_IDENTITY",
      rules_evaluated: [{ rule: "known_identity", passed: false }]
    };
  }

  return evaluatePolicy(command, policies);
}
