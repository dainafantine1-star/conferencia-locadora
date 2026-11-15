# Atualização: navegação, calendário e autonomia do assistente

**NF-e de produtos/remessa:** módulo em Notas fiscais e atalho NF-e no topo, com permissão específica para operadores, perfis tributários, revisão, emissão/consulta Focus NFe, download DANFE PDF/XML e PDF pelo WhatsApp do CRM (Meta/WAHA). O sistema exige autorização real do provedor; ambiente de teste é identificado. A emissão em produção aguarda cadastro fiscal, credenciais, certificado/credenciamento no provedor, revisão do contador e homologação da empresa. Veja [instruções e limites](NOTAS-FISCAIS.md). A migração preservou as 40 tabelas anteriores e não inseriu notas fictícias no banco principal.


Validação fiscal: **132 verificações automatizadas distintas e 13 no navegador aprovadas**, com provedores controlados e banco de auditoria separado. Não foram emitidas notas nem enviadas mensagens reais nos testes. Evidências: [resumo](erp/fiscal-validation-summary.json), [navegador](erp/fiscal-browser-validation.json), [build](erp/fiscal-build-validation.json) e [preservação do banco principal](erp/fiscal-data-preservation.json).

Menu superior com WhatsApp, Calendário, Orçamentos, Eventos e atalho para automações. Atendimento e agentes tem categoria lateral própria; o assistente usa o D laranja. Calendário mensal completo, com nomes, cores, datas locais, feriados e principais comemorações verificadas. Cadastros e consultas por IA usam serviços reais, respeitando permissões; exclusões ficam bloqueadas. Operações com impacto financeiro, reserva ou envio dependem de confirmação na conversa.

Navegação também aprovada em [18 verificações no navegador](erp/navigation-browser-validation.json), com perfil gestor/operador e telas de 1440 e 390 px. [Compilação final aprovada](erp/navigation-build-validation.json); [endereço principal e login verificados](erp/navigation-local-ready.json).

Validação automática desta atualização: [101 testes distintos aprovados](erp/navigation-validation-summary.json). Detalhes e limites: [Assistente e atendimento](ASSISTENTE-E-ATENDIMENTO.md). IA, WhatsApp e Supabase exigem configuração externa; não houve ativação fictícia.

---

# Verificação funcional — Detali

**Atualização de 14/11/2026:** foram acrescentados assistente interno, central de atendimento WhatsApp, agentes, base de conhecimento, automações e preparação para Supabase. Foram aprovadas **86 verificações automatizadas distintas em quatro arquivos**, contando a suíte geral e a repetição direcionada, e **18 verificações no navegador**. Evidências: [resumo dos testes](erp/assistant-validation-summary.json), [navegador](erp/assistant-browser-validation.json) e [build](erp/assistant-build-validation.json). Os registros das 30 tabelas anteriores foram [preservados](erp/assistant-data-preservation.json); o novo backup foi [restaurado e conferido](erp/assistant-backup-validation.json) em destino separado, com 38 tabelas, 224 registros e cinco fotos com hashes iguais.

Consulte o [guia dos novos módulos](ASSISTENTE-E-ATENDIMENTO.md) para escopo, configuração e limites. Conexões e homologação com contas reais continuam pendentes; o banco local foi mantido. O [teste do servidor principal](erp/assistant-local-ready.json) confirmou login e APIs sem inserir os dados de auditoria no banco de uso.

O relatório abaixo registra a entrega anterior, de 13/11/2026.

Estado do código em 13/11/2026. A identidade visual foi aplicada e o sistema foi ampliado além da conferência original. As operações usam banco persistente; configurações e credenciais externas precisam ser fornecidas pela locadora.

## Como foi verificado

A suíte possui 53 testes aprovados, em três arquivos. Os testes funcionais usam PGlite real com todas as migrações e dados exclusivos de teste. A autenticação é substituída na suíte de integração; a verificação de navegador usa login real de gestor e operador em banco separado do banco de uso. O teste do contrato HTTP de rejeição do PagBank usa resposta controlada; isso não equivale à homologação de uma conta real.

Foram aprovados 36 checks no navegador: orçamento, contrato, reserva, baixa parcial, comissão, PDF de contrato/recibo, foto, estoque, logística, QR Codes, fornecedores, reativação de produto, exportação, permissões, loja pública com protocolo persistido, páginas, documentos compartilhados e backup com fotos. A navegação móvel foi verificada em 390 px. Não foram encontrados erros JavaScript nas telas verificadas. A evidência está em `docs/erp/browser-validation.json`.

O arquivo de backup gerado pela aplicação foi recuperado pelo comando de restauração em um diretório separado: 28 tabelas, 207 registros e cinco fotos. Os hashes SHA-256 das fotos recuperadas coincidiram com os arquivos de origem. O banco anterior à expansão também foi copiado e as quantidades de registros foram preservadas nas 15 tabelas preexistentes.

## Cada função solicitada

| Função | Situação | Comportamento e limite |
| --- | --- | --- |
| Gestão de estoque | Implementada e testada | Inventário, entradas/baixas, manutenção/reparo, bloqueio de avarias e perda no fechamento; histórico de movimentações. Estoque desconhecido permanece desconhecido. |
| Clientes e fornecedores | Implementada | Cadastro completo, contato, documento, endereço, observações e ativação. Clientes de outra empresa não podem ser associados às operações. |
| Entrega e devolução / logística | Implementada e testada | Agenda, endereço, responsável, veículo e situação. Entrega exige saída conferida; coleta exige devoluções ou fechamento das faltas. |
| Parcelas dos contratos | Implementada e testada | Vencimentos e valores explícitos; a soma precisa fechar com o contrato. Baixas parciais preservam saldo e histórico. |
| Contas a pagar | Implementada e testada | Contas manuais, pagamentos, comissões pagas e reembolsos vinculados à conferência. |
| Contas a receber | Implementada e testada | Parcelas, cobranças de reposição, baixas e saldo. Cobranças antigas exigem conciliação antes de entrar no novo financeiro. |
| Relatórios gerenciais | Implementada e testada | Contratos por data do evento, contas por vencimento e caixa por data das baixas; CSV exportável. Reposição não é apresentada como preço de locação. |
| Permissões de usuários | Implementada e testada | Gestor/operador e permissões por módulo, verificados no servidor. Mudança de acesso é relida; troca de senha/desativação revoga sessões. |
| Comissão de atendentes/vendedores | Implementada e testada | Percentual por usuário/padrão, base configurável e geração por contrato ou recebimento proporcional. Pagamento gera saída real no financeiro. |
| Aplicativo integrado | PWA implementada | Instalação pelo navegador e acesso ao mesmo sistema. Operações precisam de internet. Não foi criado aplicativo nativo para lojas Android/iOS. |
| Disponibilidade por período | Implementada e testada | Pico das reservas simultâneas, datas inclusivas, devoluções parciais, atrasos e manutenção. Contratos não reservam estoque insuficiente. |
| Orçamentos e contratos online | Implementada e testada | Criação/revisão, conversão transacional, PDF, parcelas e link com validade. Cláusulas e dados da locadora devem ser configurados. |
| Envio de documentos por e-mail | Código integrado; configuração pendente | SMTP real com PDF anexado e histórico. Sem configuração, retorna pendência; aceitação SMTP não é confirmação de entrega. |
| Envio de documentos por WhatsApp | Código integrado; configuração pendente | API oficial com número, token, versão e template aprovado. O link usa URL pública HTTPS. Não foi enviado WhatsApp real nesta auditoria. |
| Envio de recibos por e-mail | Código integrado; configuração pendente | Recibo deriva de baixa persistida. Requer e-mail do destinatário e SMTP configurado. |
| Visualização de agenda | Implementada | Calendário dos pedidos e consulta de materiais. Capacidade/ocupação de horários é manual e independente dos pedidos. |
| Contrato com assinatura digital / impressão | Integração preparada; homologação pendente | ZapSign com PDF real, hash, autenticação configurável e consulta do documento assinado. Não há assinatura fictícia em tela. |
| Calendário de feriados | Implementado | Cadastro local e importação da BrasilAPI com fonte registrada. Datas locais e pontos facultativos devem ser conferidos pela locadora. |
| Gráficos | Implementados e testados | Dados de pedidos, devoluções e caixa; contagens e fuso corrigidos. Não usam números aleatórios para preencher as telas. |
| Backups automáticos | Rotina implementada; ativação pendente | Backup criptografado, checksum, recuperação em banco vazio e histórico. O automático exige CRON_SECRET e worker/agendador ativo; opção marcada não comprova execução. |
| Sistema multiusuário | Implementado | Contas individuais, perfis, permissões e dados separados por empresa. Produção com Postgres; PGlite local em uma instância do servidor. |
| Loja virtual / catálogo | Implementada | Produtos publicados do mesmo catálogo, preço cadastrado ou sob consulta e solicitação de locação. Não confirma reserva automaticamente. |
| Produtos em destaque | Implementada | Flag por produto, exibida e ordenada na loja. |
| Solicitação de orçamento pelo cliente | Implementada | Formulário público com itens/datas, validação, protocolo e persistência no painel. Pode gerar orçamento para revisão. |
| Aparência da loja | Implementada | Nome, descrição, cor de destaque e contatos configuráveis. |
| Banners promocionais | Implementada | Até oito banners com imagem HTTPS, texto e link opcional. |
| PagSeguro / PagBank | Código integrado; homologação pendente | Checkout do saldo, callback autenticado, referência/moeda/valor verificados e idempotência. Retorno do navegador não dá baixa. Cobranças incertas exigem conciliação. |
| Formulário de contato | Implementado | Mensagem e contatos persistidos com protocolo e status de atendimento. Não afirma envio de e-mail automático. |
| Páginas dinâmicas | Implementada | Criação, edição e publicação de páginas de texto na própria loja, sem executar HTML fornecido como conteúdo. |

## O que depende de configuração

- Dados legais/contatos da locadora, cláusulas do contrato, inventário, preços e regras de comissão.
- SMTP e remetente autorizado; WhatsApp Business Cloud com template aprovado; conta/token e homologação PagBank; conta/token e método de assinatura ZapSign.
- URL pública HTTPS, Postgres e armazenamento persistente para operação em produção.
- Segredos de aplicação, cópia segura da chave de criptografia e rotina externa/worker para agendamento de backups.
- Conciliação de cobranças antigas com os comprovantes reais. Valores históricos não foram inventados para completar o novo financeiro.

## O que não foi incluído ou executado

- Aplicativos nativos publicados na App Store/Google Play: o aplicativo entregue é uma PWA.
- Alterações comerciais offline com sincronização posterior.
- Envio real de e-mail/WhatsApp, cobrança ou assinatura em contas de produção sem credenciais e homologação.
- Publicação do sistema, contratação de serviços ou configuração da infraestrutura externa.

## Evidências e operação

- [Guia de configuração, operação e recuperação](OPERACAO-DETALI.md).
- [Resultado dos testes](erp/test-validation.json).
- [Verificação pelo navegador](erp/browser-validation.json).
- [Restauração do backup com fotos](erp/backup-restore-validation.json) e [preservação dos registros existentes](erp/data-preservation.json).
- [Tela de gestão](erp/gestao-desktop.png) e [visualização no celular](erp/gestao-mobile.png).

Os testes demonstram os fluxos descritos nas condições verificadas. A homologação dos provedores e da instalação de produção continua necessária; não há afirmação de ausência absoluta de defeitos.
