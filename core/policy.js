export function evaluatePolicy(command, policies) {
  const rules = [];
  const reject = (errorCode, rule) => {
    rules.push({ rule, passed: false });
    return {
      result: "REJECTED",
      error_code: errorCode,
      rules_evaluated: rules
    };
  };
  const pass = rule => rules.push({ rule, passed: true });

  if (command.type === "DISCOUNT") {
    if (!policies.discounts_allowed) {
      return reject("E_PERMISSION", "discounts_allowed");
    }
    pass("discounts_allowed");
  }

  if (command.type === "CASHBACK") {
    if (!policies.campaign_active) {
      return reject("E_PERMISSION", "campaign_active");
    }
    pass("campaign_active");

    if (command.payload.amount > policies.cashback_limit) {
      return reject("E_LIMIT_EXCEEDED", "cashback_limit");
    }
    pass("cashback_limit");

    if ((policies.balances[command.customer_id] ?? 0) < command.payload.amount) {
      return reject("E_INSUFFICIENT_FUNDS", "available_balance");
    }
    pass("available_balance");
  }

  pass("operation_allowed");
  return { result: "AUTHORIZED", error_code: null, rules_evaluated: rules };
}
