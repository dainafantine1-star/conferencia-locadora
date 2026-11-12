# Conferência Locadora

MVP de conferência de **saída e devolução** de materiais para locadoras de festas. A equipe confere pelo celular; o gestor responde três perguntas antes de encerrar o pedido: **o que ainda está com o cliente, o que voltou danificado e quanto ficou pendente de reposição?**

## Stack

| Camada | Escolha |
| --- | --- |
| Frontend / API | Next.js 15 (App Router) + TypeScript + Tailwind CSS 4 |
| Banco | **PGlite embutido** em desenvolvimento local (sem Docker); **Postgres** via `DATABASE_URL` em produção (Neon/Vercel) |
| ORM / migrações | Drizzle ORM + Drizzle Kit (SQL versionado em `drizzle/`) |
| Auth | NextAuth (Auth.js v5) com JWT, perfis `gestor` e `operador`, multi-empresa (tenant) |
| Testes | Vitest |
| Fotos | Volume local privado (`STORAGE_DIR`), servidas por rota autenticada com validação de tenant |

## Instalação (local, sem Docker)

```bash
npm install
cp .env.example .env.local
npm run db:setup             # aplica migrações + dados de demonstração
npm run dev                  # http://localhost:3000
```

Sem `DATABASE_URL`, o app usa PGlite em `.data/pglite/` (criado automaticamente).

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | produção | Postgres (ex.: Neon). Vazio/local → PGlite |
| `AUTH_SECRET` | produção | Segredo do Auth.js (`openssl rand -base64 32`) |
| `AUTH_URL` | produção | URL base (`https://seu-app.vercel.app`) |
| `STORAGE_DIR` | não | Pasta das fotos (padrão `./storage`) |
| `DEFAULT_TIMEZONE` | não | Fuso das empresas (padrão `America/Bahia`) |

### Comandos

```bash
npm run db:generate   # gera nova migração SQL em drizzle/
npm run db:migrate    # aplica migrações no banco local
npm run db:seed       # dados fictícios (idempotente)
npm run db:setup      # migrate + seed
npm run lint
npm test
npx tsc --noEmit
npm run build
```

## Dados de demonstração

Senha de todos: **`demo1234`**

| E-mail | Perfil | Empresa |
| --- | --- | --- |
| `gestor@louca.demo` | Gestor | Louça & Festas Bahia |
| `operador@louca.demo` | Operador | Louça & Festas Bahia |
| `gestor@outra.demo` | Gestor | Festas Imperial |
| `operador@outra.demo` | Operador | Festas Imperial |

O seed cria o cenário das taças (pedido **#1001**: 120 previstas / 118 saídas), um pedido com retorno **hoje** (painel) e um pedido em outra locadora (isolamento de tenant).

## Fluxo do MVP

1. **Pedido** — cliente, evento, datas e itens previstos (catálogo).
2. **Saída** — confirma quantidade *efetivamente* entregue; copia valores de reposição/avaria para o pedido.
3. **Retorno** — uma ou mais etapas; botão “Voltou tudo em bom estado”; fotos; saldo antes de salvar; idempotência e trava por item no servidor.
4. **Fechamento** (gestor) — confirmação explícita da falta; cálculo em centavos (falta × reposição + avaria × avaria).
5. **Cobrança** — ajuste com justificativa, resumo copiável + WhatsApp (`wa.me`), baixa manual (pendente/recebida/dispensada).
6. **Reabertura** (gestor) — motiva, preserva fechamento anterior e sinaliza diferença se já houve recebimento.
7. **Painel** — hoje, atrasados, em conferência, cobrança pendente (fuso da empresa).

## Bipagem (etiquetas)

Duas formas de contagem automática pela câmera do celular (ou digitação do código):

| Tipo | O que é | Quanto conta por bipagem |
| --- | --- | --- |
| **Unidade** | 1 código por peça física (ex.: cada taça) | **1** unidade |
| **Caixa/kit** | 1 código por caixa (ex.: caixa com 12 taças) | **N** unidades (definido ao gerar) |

- **Gerar:** no **Catálogo** → “Etiquetas para bipagem” → escolher item, tipo e quantidade → *Gerar etiquetas* → *Imprimir* (recortar e colar).
- **Bipar:** nas telas de **saída** e **retorno**, abrir a câmera (Chrome/Android lê QR/código de barras sozinho) ou digitar o código. Cada leitura soma no item correspondente e mostra o progresso (ex.: 170/182).
- Códigos demo: `LOC-TACA-0001`…`0003` (unidade), `LOC-CX-TA-12` (caixa +12), `LOC-PRAT-0001`.
- Etiquetas ficam na tabela `scan_labels`, validadas no servidor contra o tenant do pedido.

## Roteiro de apresentação (~10 min)

1. Login como **operador** → painel (pedido com retorno hoje).
2. Abrir **#1001** → conferência de saída 120 → 118.
3. Registrar devolução: 100 bons + 2 avariadas → saldo em aberto reduz.
4. Segunda devolução: 10 bons → saldo 6 em aberto.
5. Login **gestor** → fechamento → confirmar 6 faltantes → **R$ 96,00**.
6. Ajuste de R$ 12 com justificativa → **R$ 84,00** → copiar resumo / abrir WhatsApp (não enviar).
7. Trocar para **Festas Imperial** (`gestor@outra.demo`) → não vê os pedidos da outra locadora.

## Permissões (resumo)

- **Operador**: cria pedidos, confirma saída, registra devolução e fotos, bipa etiquetas.
- **Gestor**: tudo do operador + catálogo/clientes/equipe/**geração de etiquetas**, fechamento, ajuste de cobrança, baixa e reabertura.
- Validação **no servidor** em todas as rotas; fotos só da própria empresa (mesmo com o ID conhecido).

## Deploy (Vercel)

1. Criar projeto no Vercel e banco **Neon** (ou Postgres compatível).
2. Variáveis: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`.
3. Aplicar migrações: `DATABASE_URL=... npx drizzle-kit push` (ou executar os `.sql` de `drizzle/`).
4. **Fotos**: o filesystem da Vercel é efêmero — em produção use armazenamento externo (S3/R2) — ver roadmap.
5. Seed de produção: os scripts atuais usam PGlite local; em produção aplique dados iniciais via SQL (roadmap: seed com `DATABASE_URL`).

## Roadmap (fora do MVP)

- Comprovantes de saída/devolução com aceite do cliente
- Estoque e reservas por data, kits, conflitos de evento
- QR por caixa, offline com sincronização, rotas *(unidade e caixa já no MVP; falta offline e impressão com QR gráfico)*
- Orçamento → pedido, caução, Pix, conciliação, notificações WhatsApp
- Multi-unidade, permissões detalhadas, relatórios
- Storage de fotos em nuvem (Vercel/S3)
- Integração oficial WhatsApp / gateway de pagamento

## Decisões que afetam instalação/publicação

- **Sem Docker**: banco local embutido (PGlite) → zero setup; produção = Postgres gerenciado.
- Migrações SQL versionadas em `drizzle/`; banco local rastreia o que foi aplicado.
- Segredos fora do repositório (`.env.local` no `.gitignore`).
- Cálculos de dinheiro sempre em **centavos inteiros**.
