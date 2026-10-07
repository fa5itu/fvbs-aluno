const CATALOG = Object.freeze(["PEDIDO", "CASHBACK", "DISCOUNT", "NENHUMA_ACAO"]);

export function createProposal(utterance, {
  minConfidence = 0.45,
  forceConfidence = null,
  forceOffCatalog = false
} = {}) {
  if (typeof utterance !== "string" || !utterance.trim()) {
    return {
      selected: null,
      confidence: 0,
      min_confidence: minConfidence,
      abstained: true,
      reason: "E_UTTERANCE"
    };
  }

  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new Error("E_PROPOSER_CONFIG: minConfidence deve estar entre 0 e 1");
  }

  const text = utterance.toLocaleLowerCase("pt-BR");
  let selected = "NENHUMA_ACAO";
  let confidence = 0.55;
  if (text.includes("cashback") || text.includes("cash back")) {
    selected = "CASHBACK";
    confidence = 0.86;
  } else if (text.includes("pedido") || text.includes("comprar") ||
             text.includes("refeição")) {
    selected = "PEDIDO";
    confidence = 0.82;
  } else if (text.includes("desconto")) {
    selected = "DISCOUNT";
    confidence = 0.62;
  }

  if (forceConfidence !== null) {
    confidence = forceConfidence;
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("E_PROPOSER_OUTPUT: confidence inválida");
  }

  if (forceOffCatalog || !CATALOG.includes(selected) || confidence < minConfidence) {
    return {
      selected: null,
      confidence,
      min_confidence: minConfidence,
      abstained: true,
      reason: forceOffCatalog ? "E_OFF_CATALOG" : "E_LOW_CONFIDENCE",
      evidence: { utterance, model: "stub" }
    };
  }

  return {
    selected,
    confidence,
    min_confidence: minConfidence,
    abstained: selected === "NENHUMA_ACAO",
    evidence: { utterance, model: "stub" }
  };
}
