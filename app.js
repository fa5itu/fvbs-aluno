import { createCommand } from "./core/command.js";
import { createFVBS } from "./core/fvbs.js";
import { createProposal } from "./core/proposer.js";
import { verifyLedger } from "./core/proof.js";

const $ = selector => document.querySelector(selector);
const output = $("#output");
let policies;
let fvbs;
try {
  const response = await fetch("./data/policies.json");
  if (!response.ok) {
    throw new Error(`E_POLICIES: HTTP ${response.status}`);
  }
  policies = await response.json();
  fvbs = createFVBS({ policies });
} catch (error) {
  output.textContent = `Falha ao iniciar o laboratório: ${error.message}`;
  for (const button of document.querySelectorAll("button")) {
    button.disabled = true;
  }
  throw error;
}
let currentOperationId = null;
let lastCommand = null;

function show(value) {
  output.textContent = typeof value === "string"
    ? value
    : JSON.stringify(value, null, 2);
  $("#state").textContent = currentOperationId
    ? fvbs.getOperation(currentOperationId)?.state ?? "—"
    : "—";
  $("#ledger").textContent = JSON.stringify(fvbs.getLedger(), null, 2);
}

function selectedAmount() {
  const amount = Number($("#amount").value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Informe um valor de demonstração maior que zero.");
  }
  return amount;
}

$("#propose").addEventListener("click", () => {
  try {
    const proposal = createProposal($("#utterance").value, {
      minConfidence: policies.proposer_min_confidence
    });
    $("#proposal-output").textContent = JSON.stringify(proposal, null, 2);
    if (proposal.abstained || !proposal.selected) {
      currentOperationId = null;
      lastCommand = null;
      $("#command").textContent = "Nenhum Command emitido.";
      show("O proponente se absteve. Nenhuma operação executável foi criada.");
      return;
    }
    lastCommand = createCommand({
      type: proposal.selected,
      customerId: $("#customer").value,
      amount: selectedAmount(),
      origin: "AI_AGENT"
    }, { catalog: policies.command_catalog });
    $("#command").textContent = JSON.stringify(lastCommand, null, 2);
  } catch (error) {
    show({ error: error.message });
  }
});

$("#receive").addEventListener("click", async () => {
  if (!lastCommand) {
    show("Nenhum Command válido. Faça uma proposta acima.");
    return;
  }
  try {
    const result = await fvbs.receive(lastCommand);
    currentOperationId = result.original_operation_id ?? result.operation_id;
    show(result);
  } catch (error) {
    show({ error: error.message });
  }
});

for (const [selector, action] of [
  ["#authorize", "authorize"],
  ["#execute", "execute"],
  ["#register", "register"]
]) {
  $(selector).addEventListener("click", async () => {
    if (!currentOperationId) {
      show("Nenhuma operação em andamento.");
      return;
    }
    try {
      const result = await fvbs[action](currentOperationId);
      show(result);
    } catch (error) {
      show({ error: error.message });
    }
  });
}

$("#skip").addEventListener("click", async () => {
  if (!currentOperationId) {
    show("Nenhuma operação em andamento.");
    return;
  }
  try {
    await fvbs.execute(currentOperationId);
    show("ERRO: a transição inválida foi aceita.");
  } catch (error) {
    show({ blocked: true, error: error.message });
  }
});

$("#verify").addEventListener("click", async () => {
  try {
    show(await verifyLedger(fvbs.getLedger()));
  } catch (error) {
    show({ error: error.message });
  }
});

$("#export").addEventListener("click", async () => {
  try {
    const blob = new Blob([await fvbs.exportLedgerJson()], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ledger-demo.json";
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    show({ error: error.message });
  }
});

$("#reset").addEventListener("click", () => window.location.reload());
$("#state").textContent = "—";
show("Ambiente didático carregado. Dados fictícios; nenhum pagamento é executado.");
