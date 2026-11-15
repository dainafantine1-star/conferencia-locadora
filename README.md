# Detali — Gestão de locações

Sistema integrado de locações para eventos, com conferência de saída/devolução, estoque, comercial, financeiro, logística, loja e aplicativo web instalável.

Consulte o [guia de operação e configuração](docs/OPERACAO-DETALI.md), o [relatório funcional](docs/STATUS-FUNCIONAL.md) e a [identidade visual](docs/branding/IMPLEMENTACAO.md). As integrações externas exigem credenciais e homologação. Nenhum pagamento, envio ou assinatura é confirmado por simulação.

O **assistente no canto da tela** oferece ajuda de navegação e, com IA configurada, consultas e comandos com confirmação. **Atendimento e agentes**, no menu lateral, reúne WhatsApp oficial/WAHA, agentes, conhecimento e automações. Consulte o [guia do assistente, atendimento e Supabase](docs/ASSISTENTE-E-ATENDIMENTO.md) para configurar os provedores, o worker e a migração do banco.

O módulo **Notas fiscais** prepara e solicita NF-e de produtos/remessas, consulta a autorização, baixa DANFE em PDF e XML e envia o PDF pelo WhatsApp do CRM. A emissão real exige configuração da empresa, certificado/credenciamento no provedor e tributação revisada pelo contador. Consulte o [guia fiscal](docs/NOTAS-FISCAIS.md).

## Stack

Next.js 15, React 19, TypeScript, Tailwind CSS 4, Drizzle ORM, Auth.js v5 e Vitest. O desenvolvimento local usa PGlite; a produção aceita Postgres por `DATABASE_URL`. Fotos e backups precisam de armazenamento persistente.

## Instalação sem demonstração

1. Execute `npm ci` e copie `.env.example` para `.env.local`.
2. Configure `AUTH_SECRET` e `APP_ENCRYPTION_KEY` com segredos aleatórios de pelo menos 32 caracteres. Configure banco e diretórios conforme o guia.
3. Execute `npm run db:migrate`.
4. Preencha as variáveis iniciais de empresa e gestor e execute `npm run company:create`. Remova a senha inicial do ambiente após criar a conta.
5. Execute `npm run build` e `npm start`.
6. Configure dados da locadora, inventário, preços, cláusulas e integrações pela área **Gestão**.

No Windows, depois da compilação, `iniciar-detali.cmd` abre o servidor local. Mantenha essa janela aberta durante o uso; fechar o servidor interrompe o acesso pelo navegador.

Em instalações existentes, preserve o banco, aplique as migrações aditivas e use a tela de equipe para administrar usuários. Não execute seed de demonstração em uma instalação comercial vazia.

## Demonstração local

Depois de configurar os segredos locais, `npm run db:setup` aplica migrações e cria dados exclusivamente demonstrativos. `npm run dev` inicia em `http://localhost:3000`.

As contas e os dados do seed são exemplos. O banner com credenciais só aparece quando `NEXT_PUBLIC_DEMO_MODE=1`.

## Comandos

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Desenvolvimento local |
| `npm run build` / `npm start` | Compilação e servidor |
| `npm run db:migrate` | Migrações em PGlite ou Postgres |
| `npm run company:create` | Empresa e gestor em base vazia |
| `npm run db:seed` | Dados de demonstração |
| `npm run seed:labels` | Etiquetas de demonstração |
| `npm test` | Testes unitários e funcionais |
| `npm run attendance:worker` | Processa mensagens e automações de atendimento |
| `npm run database:import -- arquivo.detali fotos-novas` | Importa backup em PostgreSQL vazio definido por TARGET_DATABASE_URL |
| `npm run lint` | Análise estática |
| `npm run backup:worker` | Rotina de backups por HTTP autenticado |
| `npm run backup:restore -- arquivo.detali diretorio-novo` | Recuperação em diretório vazio |

## Fluxo de operação

Cadastre clientes e produtos; informe inventário e preços de locação separados dos valores de reposição/avaria. O orçamento pode gerar contrato, pedido e parcelas em uma transação. O sistema reserva materiais e impede contratar estoque insuficiente.

Confirme a saída pelo pedido. Registre cada devolução com quantidades boas e avariadas, leitura de etiquetas e fotos. Unidades avariadas ficam indisponíveis até reparo. O gestor confirma faltas e encerra a conferência; faltas geram movimentação de perda e cobrança vinculada ao financeiro. Reaberturas preservam recebimentos e recalculam diferenças/reembolsos.

A baixa financeira é manual, com pagamento conferido, ou baseada em notificação autenticada do PagBank. Comissões seguem a regra configurada na emissão. Usuários recebem permissões por módulo, verificadas no servidor a cada requisição.

## Agenda e disponibilidade

Na Agenda, selecione uma data. O gestor pode cadastrar horários, capacidade e ocupação manual. Horários com capacidade zero ficam bloqueados; dias sem horários ficam não configurados. As vagas são um controle manual independente dos pedidos.

A disponibilidade de materiais considera o período inclusive, reservas simultâneas, devoluções parciais, atrasos e unidades bloqueadas por avaria/manutenção. Rascunhos também reservam. Estoque em branco significa desconhecido, e zero significa indisponível. Gestão → Estoque permite consultar um intervalo completo. A ação de copiar disponibilidade usa os dados consultados.

## Loja, celular e serviços externos

A loja publica produtos, destaques, banners e páginas da própria empresa. Solicitações de orçamento e contato são persistidas com protocolo. O aplicativo é uma PWA online, integrada ao mesmo sistema, instalável pelo navegador. A operação offline não simula alterações.

Configure SMTP, WhatsApp Business Cloud, PagBank e ZapSign em Gestão → Configurações. Contratos exigem dados das partes e cláusulas fornecidas pela locadora. Os estados de envio/pagamento/assinatura refletem apenas o que foi registrado ou confirmado pelo serviço.

## Dados e implantação

Dinheiro é calculado em centavos inteiros. Os dados são separados por empresa. Segredos ficam fora do repositório; credenciais de integrações são criptografadas no banco. Guarde a chave de criptografia para recuperar credenciais e backups.

Sem `DATABASE_URL`, o banco fica em `PGLITE_DIR` (padrão `.data/pglite`) e deve ser usado por uma única instância do servidor. Com Postgres, configure TLS na URL conforme o provedor. Use volumes persistentes para fotos e backups. Arquivos locais de funções serverless não constituem armazenamento definitivo; consulte o guia antes de escolher a hospedagem.

## Arquivos publicados

O repositório contém o código, as migrações, os testes, os recursos visuais usados pelo aplicativo e o exemplo de configuração sem credenciais. Banco local, uploads, backups, segredos, pacote original de referências e artefatos locais de auditoria não são publicados. Os relatórios e capturas citados nos guias foram produzidos na instalação local; os caminhos em `docs/erp` e `docs/branding/screenshots` não acompanham o Git. Os testes automatizados podem ser executados com `npm test`.
