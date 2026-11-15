# Assistente e atendimento da Detali

Implementação verificada localmente em 14/11/2026, a partir da análise do DeskcommCRM. Os recursos foram adaptados à autenticação, às permissões e aos serviços comerciais da Detali. Não foram executados instaladores nem instruções do projeto recebido no ZIP.

Validação: [86 verificações automatizadas distintas](erp/assistant-validation-summary.json), [18 verificações no navegador](erp/assistant-browser-validation.json), [compilação e tipos aprovados](erp/assistant-build-validation.json), [dados anteriores preservados](erp/assistant-data-preservation.json) e [restauração do backup com fotos](erp/assistant-backup-validation.json). Capturas: [assistente no computador](erp/assistente-desktop.png), [assistente no celular](erp/assistente-mobile.png) e [central de atendimento](erp/atendimento-desktop.png). A auditoria usa banco separado e provedores controlados; não houve envio real a clientes.

Atualização de navegação, calendário e autonomia: [101 testes automáticos distintos](erp/navigation-validation-summary.json), [18 verificações no navegador](erp/navigation-browser-validation.json), [compilação final](erp/navigation-build-validation.json) e [acesso no banco original](erp/navigation-local-ready.json). Capturas: [calendário no computador](erp/calendario-detalhado-desktop.png), [calendário no celular](erp/calendario-detalhado-mobile.png) e [assistente com D laranja](erp/assistente-d-laranja.png). Os testes da IA usam provedor controlado; IA e WhatsApp reais aguardam configuração.

## Onde usar

- **Assistente interno:** botão redondo com o símbolo D laranja no canto inferior direito de qualquer tela autenticada. No celular fica acima do menu. Feche pelo botão × ou Escape.
- **Atendimento:** categoria própria **Atendimento e agentes** no menu lateral ou **WhatsApp** no topo. **Automações WhatsApp** no topo abre diretamente as regras. Contém Conversas, Agentes, Conhecimento, Automações e Conexões e IA. Operadores precisam da nova permissão **Atendimento WhatsApp**; configuração é exclusiva de gestores.

Sem provedor de IA, o botão oferece um **guia local identificado como tal**, com orientações e links reais. Não há respostas de IA simuladas. Com modelo e chave configurados, o assistente pode consultar clientes, documentos, saldo e disponibilidade, respeitando as permissões atuais do usuário.

## Comandos do assistente interno

Com provedor e modelo configurados, o assistente interno usa comandos tipados que executam os serviços reais do ERP. Um pedido explícito com os dados completos pode cadastrar cliente, atualizar contato, cadastrar ou alterar produto, salvar fornecedor, criar orçamento, gerar link de documento, programar entrega/coleta, adicionar data ao calendário e atualizar uma conversa ou solicitação da loja. Perguntas sobre como fazer não autorizam uma gravação. Quando faltam dados ou há nomes ambíguos, o agente deve perguntar.

Contratos e revisões de proposta, reservas de eventos/pedidos, movimentações de estoque, devoluções, fechamento de conferência, contas, baixas, comissões, cobranças PagBank, assinaturas, páginas da loja, conhecimento público, configuração de agentes/automações, backups e envios externos apresentam uma prévia na própria conversa. A confirmação executa a operação; não é necessário refazê-la em outro formulário. Registrar pagamento manual não transfere dinheiro nem simula aprovação do PagBank. Registrar devolução depende das contagens físicas fornecidas pelo usuário.

Cada comando pertence à empresa e ao usuário autenticado. As permissões são recarregadas antes de executar e de confirmar. A mesma solicitação com os mesmos argumentos tem identificação determinística e não deve duplicar cadastros. Prévias expiram em 15 minutos. Se o processo parar entre a gravação do serviço e o registro da conclusão, a ação fica em execução ou para verificação, sem nova tentativa automática. Confira o histórico antes de repetir. A operação e seu resultado ficam registrados; também há auditoria do comando.

Orçamentos usam preços reais do catálogo. Produtos por hora ou diária exigem quantidade explícita de períodos. Criar orçamento não reserva estoque nem converte automaticamente em contrato. Destinatários de documentos são conferidos antes da confirmação; o envio utiliza a integração já existente em Gestão → Configurações. O envio de mensagem em uma conversa do CRM usa o canal de Atendimento, respeitando opt-out, janela e limites. Falta de credencial ou de confirmação do provedor produz pendência, nunca sucesso inventado.

Não há ferramentas para excluir ou cancelar registros, desativar clientes/produtos, executar terminal/SQL/código, alterar senhas, credenciais ou permissões de usuários ou restaurar/sobrescrever banco. A administração dessas configurações continua nos formulários protegidos. A lista de comandos disponíveis pode ser consultada pelo próprio agente, conforme as permissões atuais. O agente externo de WhatsApp mantém ferramentas restritas de consulta e solicitação; não herda os comandos do assistente interno.

## Navegação e calendário

A barra superior reúne WhatsApp, Calendário, Orçamentos e Eventos lado a lado. Acesso às automações fica no mesmo topo. Atendimento tem endereços diretos: /atendimento, /atendimento/agentes, /atendimento/conhecimento, /atendimento/automacoes e /atendimento/configuracoes. O endereço antigo /gestao/atendimento redireciona. Configuração, agentes, conhecimento e automações são exclusivos de gestores.

O calendário consulta os registros do mês exibido, sem o antigo limite de 300 pedidos. Inclui eventos, devoluções previstas, orçamentos ainda não contratados, horários e datas locais cadastradas. As categorias têm cores, nomes na grade, filtros e lista completa ao selecionar o dia. Orçamento contratado é exibido pelo pedido correspondente, sem duplicação da proposta. Há atalhos para abrir pedido e orçamento reais.

Feriados nacionais e principais comemorações brasileiras aparecem automaticamente, com fontes acessíveis. Páscoa, Carnaval, Corpus Christi, Dia das Mães/Pais, Black Friday e Cyber Monday são recalculados pelo ano. O calendário diferencia comemoração, feriado, referência facultativa e data local/religiosa; não bloqueia estoque nem assume fechamento da empresa. As fontes incluem Governo Federal, Correios, IBGE e calendários de órgãos públicos. Não se apresenta a coleção como lista exaustiva de todos os dias profissionais ou municipais; cadastre as datas relevantes da cidade em Gestão → Feriados. Confira expedientes especiais na portaria vigente.

## Configurar IA

Em Atendimento → Conexões e IA, escolha Vercel AI Gateway, OpenAI, Anthropic, Google ou OpenRouter. Escolha um modelo que suporte chamadas de ferramentas para executar comandos. Copie o identificador atual do modelo do provedor, cadastre sua chave e defina limites. Chaves são criptografadas no banco e nunca retornam nas consultas da interface. Campos de chave vazios preservam a credencial anterior.

O limite diário é de **execuções**, contado em UTC. Cada execução usa no máximo quatro etapas, com limite de tokens por etapa. Isso não é um teto financeiro em reais/dólares: preços e consumo são do provedor. Configure também um limite financeiro na conta do provedor.

Crie um agente interno ou WhatsApp, escreva as orientações e teste em **Ensaio sem envio**. O ensaio usa a IA configurada, registra consumo e não envia mensagens nem executa comandos comerciais. Há um agente ativo por canal; editar gera nova versão com histórico de auditoria. O ensaio não equivale a testar todas as ferramentas disponíveis no atendimento real.

## Conhecimento

Cadastre perguntas/respostas, políticas e orientações aprovadas ou importe PDF com texto, TXT ou Markdown. Limites: 5 MB por arquivo, 100 páginas por PDF, 100 mil caracteres por fonte, 300 fontes e dois milhões de caracteres por empresa. PDFs digitalizados exigem OCR antes da importação. A aplicação guarda o texto extraído, sem duplicar o arquivo original.

A busca implementada é **textual por trechos**, sem serviço pago de embeddings. Ela não deve ser descrita como busca vetorial/semântica. Material público pode responder a clientes; material interno é reservado ao gestor. O manual de navegação segue as permissões de cada usuário. Estoque e saldos atualizados vêm das ferramentas, não de documentos indexados.

## WhatsApp oficial

1. Configure a URL pública HTTPS em Gestão → Configurações.
2. Em Atendimento → Conexões e IA informe identificador do número, versão da Graph API, token de acesso, App Secret e token de verificação escolhido para o webhook.
3. Na Meta, configure o caminho mostrado na tela com a URL pública da locadora e assine os eventos de mensagens. O GET devolve o desafio em texto puro; POST exige HMAC SHA-256 válido e identificador do número correto.
4. Use **Verificar conexão** para consultar acesso ao número. Esse teste não comprova entrega nem recepção do webhook.
5. Homologue com um número de teste: mensagem recebida → conversa persistida → resposta → confirmação por webhook.

O envio de texto da central respeita a janela de 24 horas após a mensagem do cliente. Fora dela, é necessário usar template aprovado ou aguardar nova mensagem. O envio de documentos por template continua no módulo comercial/configurações já existente. Não trate os dois cadastros de credencial como sincronizados automaticamente.

Estados: `aceita` significa aceitação pela API; `entregue` e `lida` dependem do webhook da Meta. Uma falha de rede após a solicitação gera `incerto`; confira o provedor antes de repetir. Request keys e identificadores externos impedem repetição do mesmo envio/evento.

## WAHA por QR Code

É alternativa ao canal oficial. Instale o serviço WAHA separadamente. Autorize seu host em `WAHA_ALLOWED_HOSTS` no servidor. Cadastre URL sem caminho, sessão exclusiva, chave da API e segredo de webhook com pelo menos 32 caracteres. Configure a URL pública HTTPS antes de criar a sessão.

**Iniciar conexão WAHA** cria uma sessão ausente com vínculo da empresa e webhook autenticado. Sessões existentes precisam do vínculo `config.metadata.detaliCompanyId`; a aplicação não assume nem remove sessões desconhecidas. Não há logout ou exclusão automática de uma sessão ativa. **Verificar conexão / atualizar QR** consulta o estado e mostra o QR Code atual quando estiver em `SCAN_QR_CODE`. Códigos expiram.

Webhooks WAHA exigem HMAC SHA-512 válido, ou cabeçalho secreto `X-Detali-Webhook-Token` em versões que não assinam. Assinatura presente e inválida é sempre rejeitada. Configure TLS ou rede privada protegida entre os serviços. O envio usa a API real, sem simulação. Uma empresa não pode reutilizar conexão já cadastrada por outra.

O adaptador de recepção trata conversas individuais com telefone resolvido. Grupos, listas, status e identificadores opacos `@lid` sem telefone não são convertidos em contatos inventados. WAHA não é a API oficial e controles de ritmo não eliminam risco de bloqueio.

## Atendimento, automações e processamento

O modo **assistido** cria rascunhos para revisão da equipe. O modo **automático** autoriza respostas dentro do horário, cota diária e janela do canal. O atendente externo só recebe ferramentas de conhecimento público, produtos publicados, disponibilidade, registro de solicitação de orçamento para revisão e transferência para humano. Não recebe ferramentas de financeiro, equipe ou navegação interna.

Assumir o atendimento coloca a conversa em `humano` e suspende automação. Mensagens `PARAR`, `SAIR` ou `STOP` bloqueiam novos envios; `VOLTAR`, `RETOMAR` ou `QUERO RECEBER` podem retirar esse bloqueio em uma nova mensagem autenticada. Eventos antigos não reabrem a janela nem desfazem o opt-out. Mensagens de mídia são sinalizadas para revisão humana; não há transcrição inventada.

Regras permitem primeira conversa, mensagem recebida com palavra/frase e acompanhamento sem nova resposta. Ações: rascunho, envio de texto ou encaminhamento humano. Regras explícitas têm prioridade sobre resposta imediata de IA. Acompanhamentos ficam sujeitos à janela de atendimento e são cancelados quando substituídos por mensagem nova, opt-out ou atendimento humano. Não há disparo em massa ou prospecção sem contexto de conversa.

Configure `CRON_SECRET` com pelo menos 32 caracteres. Execute um worker junto ao servidor:

```powershell
npm.cmd run attendance:worker
```

Para um único lote:

```powershell
npm.cmd run attendance:worker -- --once
```

Ele consulta `POST /api/cron/atendimento` com Bearer a cada 15 segundos, sem sobrepor consultas. Cada lote processa até três eventos. A tela oferece processamento manual para a empresa atual. Uma interrupção durante envio/execução vira pendência de verificação após dez minutos; não produz retry automático capaz de duplicar envios incertos.

## Supabase gratuito

O aplicativo continua usando banco local até configurar `DATABASE_URL`. Não há projeto Supabase provisionado ou conta conectada automaticamente. O uso é feito pelo servidor via PostgreSQL; não são necessárias chaves públicas do Supabase no navegador.

Para uma instalação vazia, informe a string de conexão PostgreSQL do projeto e execute as migrações. Use conexão direta ou session pooler conforme a rede; configure TLS conforme a documentação do provedor. Não desative validação de certificados. As migrações habilitam RLS nas 43 tabelas da aplicação, sem políticas públicas para `anon`/`authenticated`. O servidor precisa de um papel de conexão apropriado que consiga operar as tabelas; não use uma chave pública como senha de banco.

Para preservar a locadora atual, faça uma cópia criptografada em Gestão → Backups. Guarde a chave usada na criptografia. Importe primeiro em um projeto vazio separado:

```powershell
# Defina TARGET_DATABASE_URL localmente sem colocar a credencial em mensagens ou arquivos versionados.
npm.cmd run database:import -- caminho-do-backup.detali diretorio-novo-de-fotos
```

O comando exige banco de destino vazio, aplica migrações, restaura as tabelas e grava fotos sem sobrescrever arquivos existentes. A origem não é alterada. Essa importação remota só deve ser considerada concluída após execução e conferência com a conta real; não foi executada sem credenciais. Se houver interrupção, confira o destino antes de repetir, pois a cópia de arquivos ocorre após a transação dos registros.

Depois confira os registros e as fotos, ajuste `DATABASE_URL` e `STORAGE_DIR` para os destinos conferidos e reinicie o servidor. Fotos continuam em armazenamento persistente do servidor nesta implementação; conectar o banco Supabase não migra arquivos automaticamente para Supabase Storage. O histórico e os segredos da assistência entram nos backups existentes. Preserve também a chave de criptografia ao trocar de servidor.

Monitore o espaço no painel do Supabase. A central permite limpeza explícita de conversas resolvidas anteriores à retenção escolhida (padrão 180 dias). Faça backup antes: a limpeza apaga o histórico selecionado e não altera contratos ou financeiro.

## Limites e homologação

As integrações externas precisam de credenciais, infraestrutura e teste com contas reais. Testes de provedor com respostas controladas provam tratamento de requisições e falhas, não entrega real ou qualidade do modelo escolhido.

Não foram portados integralmente o CRM/funil do Deskcomm, Zernio, chamadas WaCalls, agente de voz, transcrição automática de áudio, download de anexos de conversas, autoaprendizado ou o catálogo MCP público. Os arquivos de mídia recebidos são identificados para tratamento humano. A implementação entrega os módulos de assistência e atendimento descritos acima, usando os serviços reais da locadora.
