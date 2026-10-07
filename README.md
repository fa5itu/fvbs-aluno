# Protocolo FVBS — Laboratório do Aluno

Repositório público de apoio à **Edição do Aluno — Volume 1** do Protocolo FVBS:
Mini-Core executável, suíte de testes e worker da fila de operações.

## Requisitos

- Node.js 18 ou superior (os testes usam `node --test`)
- Python 3 (apenas para servir a interface estática)
- Navegador moderno

## Executar os testes

```bash
npm test
```

São **67 testes** cobrindo Command, política, estados, idempotência, verificação
de ledger, conformance e o worker da fila.

## Abrir a demonstração

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8000`. Para encerrar, interrompa o servidor no terminal.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `index.html` / `app.js` | Mini-Core didático no navegador (propor → validar → autorizar → executar → registrar) |
| `core/` | Command, validador, máquina de estados, idempotência, ledger, prova e criptografia |
| `tests/` | Suíte de 67 testes (`node --test`) |
| `worker/` | Fila de operações com ledger verificável |
| `data/policies.json` | Catálogo e políticas de exemplo |
| `run_fila_loop.sh` | Loop da fila (encerra limpo no `SIGINT`) |

## Percurso didático

1. Clique **Propor**. O proponente local escolhe uma categoria fechada ou se abstém.
2. Inspecione a saída e o Command. A confiança fica na proposta, não no Command.
3. Clique **Receber e validar**. Propostas fora da política terminam em `REJEITADO`.
4. Tente executar antes de autorizar; o botão **Tentar pular AUTORIZADO** deve falhar com `E_STATE`.
5. Percorra **Autorizar → Executar efeito simulado → Registrar**.
6. Verifique e exporte o ledger.
7. Troque cliente, valor e texto para testar identidade desconhecida, limite e abstenção.

## Limites intencionais

- O proponente é um stub determinístico, não um modelo generativo.
- O efeito é uma entrada em memória; não há pagamento, carteira ou mutação de valor real.
- Políticas e ledger vivem no cliente. Não use PII nem dados de produção.
- `Map` e arrays não são armazenamento transacional ou compartilhado.
- O encadeamento SHA-256 ajuda a detectar adulteração simples; não autentica autoria nem impede reescrita por quem controla todos os dados.
- Servir em `127.0.0.1` resolve carregamento de módulos e JSON, não segurança de produção.

## Sobre o curso

A Edição do Aluno — *Protocolo FVBS: Rasgando o Véu da Raiz — Volume 1* —
acompanha este laboratório com 50 aulas, experimentos "ver quebrar" e gabaritos.
Este repositório é público para estudo e referência.

## Licença

MIT — ver [LICENSE](./LICENSE).
