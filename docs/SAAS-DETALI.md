# Detali SaaS — contas, planos e operação

A estrutura reaproveita Next.js, Auth.js, Drizzle e o banco atual. O cadastro público está em `/cadastro`; o primeiro usuário cria a empresa e recebe o perfil de proprietário. Em **Conta e plano** (`/conta`), ele cria outra empresa, troca de conta, convida pessoas e administra os vínculos. Uma conta pode participar de várias empresas. Desativar um vínculo não desativa a pessoa nas outras empresas.

## Administração da plataforma

O painel `/admin-detali` é exclusivo de usuários cadastrados em `platform_admins`. Ser proprietário ou administrador de uma locadora não concede esse acesso. Não existe senha padrão de administrador da plataforma.

Para preparar a primeira conta, defina `PLATFORM_ADMIN_EMAIL` no ambiente do servidor e execute `npm run platform:setup`. Se a conta não existir, o comando cria uma área separada **Administração Detali**, com usuário inicialmente inativo, e devolve um link de ativação válido por 24 horas. O token original não é guardado no banco. A pessoa define uma senha de pelo menos 12 caracteres; só então o perfil administrativo é habilitado. O link é de uso único e não deve ser publicado no Git. Para uma conta ativa cuja identidade já tenha sido conferida, `npm run platform:admin` concede o perfil. Remova a variável após o uso.

No painel da Detali, edite:

- Preço mensal: Essencial inicia em **R$ 50,00**; Plus inicia com **preço a definir**. Campo vazio mantém preço pendente.
- Matriz de recursos: os dois planos começam com os mesmos 26 recursos habilitados. Habilitado no plano não significa que uma integração externa já esteja configurada ou que um módulo parcial esteja completo.
- Limites: usuários ativos mais convites pendentes, participantes processados no mês e locais ativos. Campo vazio significa limite em aberto; zero impede novos registros daquele tipo. Nenhum limite comercial numérico foi inventado.
- Suporte: canais, SLA em horas e indicação de telefone mediante agendamento. Preencher um SLA não cria uma equipe de atendimento.
- Assinatura: plano por empresa, situação, ciclo e datas. Atribuição é manual e fica no histórico administrativo; não executa cobrança.

O PagBank existente atende parcelas dos contratos de locação. Não foi reaproveitado como se já oferecesse cobrança recorrente das assinaturas SaaS. A cobrança recorrente da plataforma continua pendente de definição e implementação do serviço contratado.

## Convites e permissões

Convites duram sete dias, são vinculados ao e-mail e podem ser revogados. A aplicação devolve o link para compartilhamento; gerar um convite não afirma ter enviado um e-mail. Quem já tem conta precisa informar sua senha atual; aceitar um convite nunca redefine a senha de uma conta existente.

Perfis: proprietário, administrador e membro. O proprietário administra outros proprietários, mantendo ao menos um ativo. Administradores não alteram proprietários. A matriz individual permite visualizar, criar, editar, arquivar/excluir e acessar dados financeiros por recurso. Sem matriz individual, valem os padrões do perfil e as permissões legadas por módulo. Os vínculos e permissões são recarregados no servidor antes de executar comandos, inclusive os preparados pelo assistente.

A troca de empresa atualiza a sessão pelo Auth.js e consulta o vínculo no banco. O navegador não escolhe empresa, usuário ou perfil sem validação. Assinatura suspensa, cancelada, em atraso, expirada ou ainda não iniciada permite consulta dos recursos habilitados e bloqueia novas operações. Desabilitar um recurso mantém suas tabelas e histórico. Funções associadas podem exigir recursos relacionados: por exemplo, contratar envolve propostas, estoque e financeiro.

## Proposta, reserva e contrato

Em **Orçamentos e contratos**, crie a proposta e use **Reservar estoque desta proposta** para bloquear o período antes de contratar. A reserva cria um pedido em rascunho, verifica o estoque e é idempotente. Contratar reutiliza o mesmo pedido e não duplica a reserva. Não há reserva automática ao abrir um rascunho de orçamento.

Use **Liberar reserva de estoque** antes de revisar datas ou quantidades. A liberação cancela o pedido em rascunho e preserva seu histórico. Uma reserva com saída já confirmada exige conferência operacional. Reservas de propostas não expiram automaticamente: a equipe precisa liberar as reservas que não devem continuar ocupando o estoque.

O fluxo seguinte continua usando os serviços anteriores: contrato e parcelas → saída → devoluções parciais/fotos → reposição/avarias → fechamento → baixas financeiras. Os bloqueios de estoque e cotas usam transação e trava da empresa para impedir concorrência acima do disponível.

## Recursos acrescentados

- **Eventos:** planejamento vinculado ao pedido, tarefas com datas, checklist e vários clientes responsáveis. Apenas tarefas explicitamente compartilhadas entram na área externa. Contratos individuais/conjuntos para cada responsável e modelos avançados ainda não estão implementados.
- **Funil:** leads/oportunidades por etapa, vínculo com cliente e evento e histórico de mudanças. A criação de oportunidades é manual; não há conversão automática de qualquer mensagem recebida em uma venda.
- **Check-in de participantes:** importação CSV `nome;codigo`, cadastro na entrada, QR individual assinado e conferência por câmera compatível, leitor externo ou colagem do QR. A primeira inclusão de cada identificação no evento consome uma unidade da cota do mês, por importação ou na entrada; reimportações e novas leituras não duplicam a contagem. O leitor de participantes é separado das etiquetas de produtos do estoque.
- A cota mensal de participantes usa o fuso **America/Bahia** nesta versão. A apuração dessa cota em outros fusos ainda precisa ser adaptada; o relatório semanal já considera o fuso configurado na empresa.
- **Locais:** cadastro de espaços, capacidade informada pelo operador e reservas com data/hora. Sobreposições são bloqueadas no mesmo espaço; espaços distintos podem receber eventos simultâneos. Reservas adjacentes, cujo fim coincide com o início da próxima, são permitidas. Liberação/reagendamento direto dessas reservas ainda precisa ser expandido.
- **Treinamentos:** conteúdo textual, distribuição a membros da empresa, arquivamento e conclusão individual. Não há vídeos hospedados, provas ou certificação automática.
- **Cotações:** pedido de itens/serviços, respostas e valores por fornecedor, comparação e aprovação registrada. Valores são informados pela equipe; não são consultas automáticas ou respostas inventadas dos fornecedores. Envio externo automático ainda pendente.
- **Área do cliente:** link privado, revogável e com validade, autorizado explicitamente para eventos selecionados. Mostra documentos do próprio cliente vinculados a esses eventos e tarefas públicas; não expõe o estoque, finanças internas, notas ou eventos de outras empresas. Para aceitar ou assinar uma proposta, continua sendo necessário o link individual do documento.
- **Relatório semanal:** `POST /api/cron/relatorio-semanal`, autenticado por `CRON_SECRET`, processa segundas-feiras na hora local da empresa. Envia por SMTP configurado um resumo dos eventos e tarefas públicas da semana para clientes com área ativa, e-mail e URL pública HTTPS. Cada área/segunda-feira tem uma chave única. Erros de envio ficam incertos para conferência, sem repetição cega. Agende externamente a chamada; não existe agendador provisionado automaticamente.
- **Métricas de propostas:** visita confirmada pelo navegador, deduplicada por cookie e intervalo de 30 minutos. Pré-carregamentos e robôs/prévias conhecidos são filtrados. Os números são estimativas; robôs que imitam um navegador e visitantes com cookies diferentes não podem ser identificados perfeitamente. Não são contadas simples requisições de download ou renderização no servidor.
- **Loja de Apps:** catálogo com links para configurar os provedores existentes, disponibilidade por plano e indicação de custos pendentes. Não instala ou contrata um serviço ao clicar.
- **Financeiro avançado:** resultado gerencial de caixa e anexos privados de comprovantes. DRE contábil por competência e conciliação bancária automática continuam pendentes.
- **Link exclusivo:** cadastro de domínio, desafio TXT e verificação DNS reais. O vínculo do domínio/TLS na hospedagem e o roteamento por host ainda estão pendentes; propriedade DNS confirmada não é publicada como site já funcionando.
- **Suporte:** solicitações pela empresa e respostas pelo administrador Detali. Preferência de telefone e horário não confirma automaticamente um agendamento.

O arquivo `src/lib/saas/catalog.ts` contém o catálogo central, o estado e os limites funcionais de cada recurso. A matriz comercial é persistida em `saas_plans`, editável pelo painel. O catálogo não trata itens parciais como completos: NFS-e, composição de kits com produtos diferentes, editor visual livre de sites, tabelas alternativas de preço e automações avançadas continuam descritos como pendências.

## Estado do catálogo

| Recurso | Estado do código | Limitação principal |
| --- | --- | --- |
| Usuários e permissões | Existente | Convites geram links; não alegam envio por e-mail |
| Clientes | Existente | Isolados por empresa e perfil |
| Fornecedores | Parcial | Categorias e catálogo de serviços pendentes |
| Gestão de eventos | Parcial | Modelos avançados de documentos pendentes |
| Propostas por e-mail e WhatsApp | Existente | Envio depende dos provedores configurados |
| Financeiro | Existente | Pagamentos externos dependem do provedor |
| Funil de vendas | Existente | Movimentação e oportunidades manuais |
| Check-in por QR Code | Existente | Câmera depende de navegador compatível e permissão |
| Relatório semanal | Parcial | SMTP e agendador externos precisam ser ligados |
| Loja de Apps | Existente | Catálogo, sem contratação automática |
| Criador de sites | Parcial | Editor visual livre pendente |
| Agenda de locais | Existente | Cadastro e reservas; expansão de reagendamento pendente |
| Treinamentos | Existente | Conteúdo textual; sem provas ou certificados |
| Notas fiscais | Parcial | NF-e implementada; NFS-e pendente; exige homologação |
| Link exclusivo | Parcial | DNS verificável; hospedagem, TLS e roteamento pendentes |
| Múltiplos responsáveis | Parcial | Contratos individuais ou conjuntos automáticos pendentes |
| Cotações | Parcial | Envio automático para fornecedores pendente |
| Financeiro avançado | Parcial | Conciliação e DRE por competência pendentes |
| Propostas avançadas | Parcial | Tabelas alternativas e automações pendentes |
| Suporte | Parcial | Solicitações e respostas funcionam; operação e SLA a definir |
| Estoque e reservas | Parcial | Kits com itens diferentes pendentes |
| Saída e devolução | Existente | Reutiliza a conferência e o fechamento anteriores |
| Atendimento e agentes WhatsApp | Existente | Provedor, IA e worker precisam estar configurados |
| Assistente interno | Existente | Comandos com IA dependem do provedor; respeitam permissões |
| Relatórios gerenciais | Existente | Consulta e exportação |
| Backups | Existente | Produção exige armazenamento persistente e agendador |

“Existente” descreve o código disponível. Não significa que um serviço externo já esteja conectado ou validado em produção.

## Banco, RLS e arquivos

`0011_saas_foundation.sql` acrescenta as tabelas SaaS e campos de vínculo, cadastra os dois planos e atribui Essencial em teste às empresas anteriores. `0012_saas_security.sql` promove o gestor mais antigo de cada empresa a proprietário, acrescenta políticas RLS e gatilhos que rejeitam referências entre empresas. São alterações aditivas; não apagam clientes, estoque, documentos ou financeiro.

O aplicativo continua autenticando com Auth.js. As políticas SQL usam a identidade PostgreSQL/Supabase da requisição quando houver uma identidade compatível; **uma sessão Auth.js não se transforma automaticamente em uma sessão Supabase Auth**. As APIs públicas do banco não recebem privilégios de acesso às tabelas por `anon` ou `authenticated`. A aplicação opera pelo backend, com escopo de empresa, plano e permissões validado. Uma conexão administrativa do PostgreSQL e a chave `service_role` ignoram RLS; devem permanecer exclusivamente no servidor. Não foi alegado que RLS protege operações de um administrador que tem acesso direto ao banco.

Arquivos locais ficam em `STORAGE_DIR` e `BACKUP_DIR`. Para Supabase Storage, configure:

```dotenv
STORAGE_PROVIDER=supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=detali-files
SUPABASE_BACKUP_BUCKET=detali-backups
```

As migrações criam os buckets padrão privados somente quando o esquema `storage` existe. O backend monta o caminho `empresa/arquivo`, consulta o registro da empresa e só então lê ou grava. A chave privada nunca é enviada ao navegador. Se escolher nomes diferentes, crie e confira esses buckets privados explicitamente. Selecionar o modo Supabase não copia os arquivos locais anteriores: a migração dos arquivos precisa ser executada e conferida antes da troca.

Backups incluem os novos registros da empresa, assinatura, convites, planejamentos, participantes, locais e área externa. Configuração global dos planos e privilégios de administrador da plataforma não entram em backups de locadoras. Guarde a chave de criptografia e faça recuperação em destino separado; os backups não devem servir para conceder privilégios globais.

## Implantação pendente de conta externa

Em 15/11/2026, a conexão MCP foi autorizada e a migração do banco local para o projeto Supabase foi concluída: 72 registros, 54 tabelas de dados verificadas sem diferenças, 14 migrations do aplicativo e dois buckets privados. Os helpers de RLS foram movidos para um schema privado pela migration `0013`. A conferência de isolamento no banco remoto passou e o verificador de segurança terminou sem alertas. O aplicativo local já usa o PostgreSQL e o Storage remotos: leitura/gravação do banco, upload/download privado e seis verificações do navegador/API passaram. As chaves de criptografia foram preservadas e a origem local foi conferida novamente sem diferenças. Consulte [o guia de migração](SUPABASE-MIGRACAO.md) para as evidências e futuras trocas de credenciais. A publicação na Vercel, domínio, processamento de automações e agendadores ainda precisam ser configurados e testados.

WhatsApp, IA, SMTP, assinatura, PagBank e Focus NFe conservam as exigências descritas nos respectivos guias. Os testes controlados não equivalem a envio real, emissão fiscal real ou pagamento real. NFS-e de serviços ainda não foi implementada; o módulo fiscal continua voltado à NF-e de produtos/remessa.

## Validação local de 15/11/2026

Foram aprovados **165 testes distintos**: 33 de SaaS, 44 de assistente e atendimento, 37 funcionais do ERP, 31 fiscais, 11 de regras de conferência, cinco de agenda e quatro de calendário. O resultado reúne a suíte completa e a reexecução direcionada dos casos corrigidos; os mesmos testes não são somados novamente. Os bancos dos testes são isolados. Integrações externas usam respostas controladas.

A validação cobre isolamento entre duas empresas, revogação por vínculo, convites, permissões por ação, recursos diferentes entre Essencial e Plus, concorrência de estoque e cotas, QR/importação, área externa, RLS por papel SQL sem bypass e o fluxo proposta → reserva → contrato → saída → devolução → baixa financeira. O adaptador Supabase foi validado com HTTP controlado; isso não substitui testes no projeto remoto.

As migrations `0011` e `0012` foram aplicadas ao banco local após uma cópia de preservação. A comparação das colunas e registros anteriores em 43 tabelas de dados não encontrou alterações nos registros antigos. Relatórios e capturas da auditoria ficam em `docs/erp/`, ignorado pelo Git por conter artefatos locais.

A compilação de produção passou com checagem de tipos. A auditoria no Chrome reuniu **20 verificações de interface/API**, com empresas fictícias em banco separado: cadastro, convite, perfil, ativação administrativa, matriz de planos e preço público, troca de empresa, reserva, visitas do documento, CSV/QR, área do cliente, locais, treinamento, suporte e comprovante privado. Conta e check-in foram conferidos em 390 px, sem transbordamento horizontal e sem erros de JavaScript. O check-in foi confirmado pelo campo de leitor/colagem, com persistência, releitura idempotente e rejeição de outra empresa; câmera física não foi testada.

Na auditoria, faltava `APP_ENCRYPTION_KEY` no ambiente local. Ela foi configurada com a chave que já era usada pela criptografia, mantendo a compatibilidade com as credenciais anteriores. Em outro ambiente, configure e preserve essa chave antes de usar QR, credenciais criptografadas e backups.

Referências: [Auth.js](https://authjs.dev/reference/nextjs), [RLS no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) e [controle de acesso do Storage](https://supabase.com/docs/guides/storage/security/access-control).
