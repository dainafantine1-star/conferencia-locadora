# DeskcommCRM: WhatsApp, automações e assistente para a Detali

Análise em 14/11/2026 do arquivo `C:\Users\daina\Downloads\DeskcommCRM-main.zip`.

Este documento registra a análise anterior à implementação autorizada depois. O escopo efetivamente adaptado à Detali está em [Assistente e atendimento](ASSISTENTE-E-ATENDIMENTO.md); a seção final desta análise descreve o estado antes dessa adaptação.

## Resultado e alcance da análise

O projeto contém implementações de atendimento WhatsApp, agentes de IA, ferramentas de operação do CRM, base de conhecimento e automações. É uma base aproveitável para ampliar a Detali, mas não um módulo que possa ser simplesmente copiado e ativado no ERP atual.

Esta foi uma leitura estática de código e documentação. Não instalei dependências, não executei o CRM nem sua suíte de testes, não conectei números ou provedores e não alterei os módulos da Detali. Testes e evidências presentes no ZIP pertencem ao projeto de origem; não equivalem a validação desta instalação. Arquivos de instruções e skills dentro do ZIP foram tratados como conteúdo do projeto, sem instalar ou executar suas instruções.

Os arquivos para consulta foram extraídos em `.data/crm-review/DeskcommCRM-main`, fora do código da aplicação. Há documentos antigos em `lib/ai/README.md` e `lib/waha/README.md` que dizem “placeholder”, mas existem implementações posteriores. O runtime antigo em `lib/ai/runtime/agent.ts` está marcado como obsoleto; o caminho atual está em `lib/agent-engine` e `workers/agent-worker/main.ts`.

## Recursos encontrados

| Área | O que existe no código | Referências no projeto de origem |
| --- | --- | --- |
| WhatsApp por QR Code | Cliente WAHA, conexão e identidade de sessão, recepção por webhook, envio e anexos. Requer serviço WAHA e sessão conectada. | `lib/waha`, `lib/channels/connect-waha.ts`, `lib/channels/adapters/waha.ts` |
| WhatsApp oficial | Adaptador Meta Cloud API, credenciais por sessão, webhook de entrada e sincronização/envio de templates. | `lib/channels/adapters/meta-cloud.ts`, `lib/channels/meta`, `app/api/v1/webhooks/meta` |
| Canal intermediado | Adaptador Zernio, credenciais, templates e entrada por webhook. É uma alternativa de transporte, não uma dependência obrigatória dos outros canais. | `lib/channels/adapters/zernio.ts`, `lib/channels/zernio` |
| Atendimento humano | Inbox, histórico, responsáveis, transferência entre IA e humano, alertas e respostas rápidas. | `components/inbox`, `lib/escalacao`, `lib/mcp/tools/handoff.ts` |
| Mídia | Envio de imagens, documentos, vídeo e áudio; transcrição de áudio com API compatível e conversão de mídia. Requer os provedores e ferramentas correspondentes. | `lib/messaging/media`, `lib/waha/media-send.ts` |
| Agentes | Cadastro, versões, publicação, pausa, teste de respostas, configuração de capacidades, roteamento e execução em processo próprio. | `app/api/v1/ai/agents`, `lib/ai/agents`, `workers/agent-worker/main.ts` |
| Provedores de IA | Registro de provedores OpenAI, Anthropic, Google e OpenRouter; credenciais e escolha de modelo. | `lib/agent-engine/edge/llm/providers.ts` |
| Conhecimento | Perguntas e respostas, PDF/Markdown/texto, materiais selecionados por agente, catálogo sincronizado e conversas aproveitáveis. Indexação e busca usam banco e provedor de embeddings. | `lib/ai/rag`, `workers/rag-indexer.ts`, `components/ai/ChaveDeConhecimento.tsx` |
| Continuidade | Histórico e resumo persistido, próximos passos, memória, regras de follow-up e encaminhamento ao humano. | `lib/agent-engine/agent/inbound-turn.ts`, `lib/followup`, `app/api/v1/ai/followups` |
| Automações | Ações registradas para marcadores, responsável, criação/movimentação de oportunidade, webhook externo, mensagem WhatsApp, fluxo e mensagem gerada por IA. | `lib/automation/actions/register-all.ts`, `lib/automation/engine.ts` |
| Integrações externas | Entradas de contatos por webhook e saídas para serviços como n8n/Zapier. Não significa que um fluxo específico dessas ferramentas já venha configurado. | `app/api/v1/webhooks/in`, `lib/automation/actions/call-webhook.ts` |
| Agente que executa ações | Catálogo MCP com consulta de contatos, conversas, produtos, oportunidades e agenda; operações sujeitas a papel, escopo e auditoria. Algumas capacidades são exclusivas de humanos. | `lib/mcp/server.ts`, `lib/mcp/tools`, `lib/agent-engine/edge/crm/mcp-tools.ts` |
| Governança | Limites de gasto/passos, credenciais protegidas, escopo por organização/funil, verificações antes de enviar, fila persistente e acompanhamento de falhas. Presença de controles não certifica ausência de vulnerabilidades. | `lib/agent-engine/guardrails`, `lib/agent-engine/queue`, `lib/mcp/auth.ts` |
| Evolução da IA | Propostas, versões e aplicação de melhorias com decisão humana. Não equivale a treinar um modelo novo automaticamente. | `app/api/v1/ai/agents/[id]/proposals`, `app/app/ai/evolution` |
| Chamadas WhatsApp | Cliente e telas/rotas de chamada via serviço opcional WaCalls, com pareamento e histórico. Não validei operação nem agente de voz autônomo. | `lib/wacalls`, `app/api/v1/voice`, `components/voice/ActiveCallPanel.tsx` |

## O assistente no canto direito

Não encontrei um chat global pronto que combine ajuda de navegação e comandos do ERP. O painel flutuante de chamada de voz encontrado não é esse assistente.

É viável construir o componente visual e reaproveitar os padrões de agentes, conhecimento, ferramentas e auditoria. Os canais devem ter contextos próprios:

- **Assistente interno:** usuário autenticado, permissões do usuário, tela atual, manual da Detali e ferramentas do ERP.
- **Atendente WhatsApp:** identidade do cliente validada, dados permitidos daquele atendimento e transferência para humano. Não recebe acesso geral ao financeiro ou à equipe.

Exemplos a implementar no assistente interno:

| Pedido da pessoa | Comportamento esperado |
| --- | --- |
| “Onde imprimo QR Codes?” | Explicar o caminho e oferecer abrir o Catálogo. |
| “Como registro uma devolução?” | Orientar com base no fluxo real e oferecer abrir o pedido. |
| “Há 100 taças para o período informado?” | Consultar a disponibilidade real por datas; pedir as datas se faltarem. |
| “Monte um orçamento para este cliente” | Validar cliente, produtos, período e preços; preparar e apresentar o resultado. |
| “Envie o orçamento no WhatsApp” | Conferir documento e destinatário, apresentar a ação e executar apenas com a autorização correspondente. |
| “Quanto este contrato ainda deve?” | Consultar o financeiro permitido ao usuário; informar saldo persistido. |

Comandos da locadora precisam de ferramentas novas ligadas aos serviços reais de estoque, comercial, financeiro e logística. O catálogo do CRM é voltado a contatos, funil, conversas, catálogo de comércio e compromissos. Agenda de compromissos não substitui disponibilidade de itens alugados por período.

Navegação e consultas podem acontecer diretamente dentro do acesso do usuário. Operações com efeito financeiro, cancelamento, alterações de acesso e envio ao cliente devem ter prévia clara, autorização adequada, validação no servidor, auditoria e prevenção de duplicidade. Não é necessário dar ao modelo acesso a SQL ou comandos livres do servidor.

## Como aproveitar no projeto atual

1. Manter a Detali como responsável por clientes, estoque, contratos e financeiro; definir um único responsável pelos envios de cada número de WhatsApp, evitando respostas duplicadas de sistemas diferentes.
2. Escolher a integração: executar o Deskcomm separado e conectá-lo às APIs da Detali, ou portar gradualmente os módulos desejados. A primeira alternativa preserva mais do CRM original; a segunda exige adaptar banco, autenticação, telas e processos de execução.
3. Criar o assistente flutuante e a base de ajuda da Detali, com links reais para as telas.
4. Expor consultas do ERP ao agente com permissões por usuário/empresa. Dados comerciais mutáveis devem vir das APIs, não de documentos antigos indexados.
5. Acrescentar comandos de escrita com validações e confirmação adequadas, usando os mesmos serviços das telas existentes.
6. Conectar WhatsApp, provedor de IA e processos de execução; testar primeiro com número/ambiente de teste antes do atendimento de clientes.

O CRM usa Next/React, mas depende de Supabase/Postgres, políticas de acesso no banco, Storage, busca vetorial, processos de execução e mecanismos de fila/agendamento. A Detali atual usa Auth.js/Drizzle e banco local PGlite, com suporte a Postgres. Compartilhar a linguagem não torna as bases intercambiáveis. O comando `db:migrate` do `package.json` do CRM ainda é um TODO que termina com sucesso sem migrar; não deve ser usado como comprovação de instalação do banco.

A chave para indexação de conhecimento é tratada separadamente do modelo de conversa: a interface `components/ai/ChaveDeConhecimento.tsx` informa dependência de OpenAI para preparar o material. Mudar o modelo de chat não elimina automaticamente essa dependência.

O ZIP inclui licença MIT em `LICENSE`, com aviso de autoria e condições de preservação dos avisos nas cópias. Dependências e serviços externos têm suas próprias condições e custos.

## Escolha do WhatsApp e referências externas

Para atendimento comercial em produção, recomendo priorizar o canal oficial da Meta. Templates e janela de atendimento precisam ser respeitados; a documentação oficial distingue mensagens livres durante a janela e templates aprovados para outras situações: [Meta — envio de mensagens](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/).

WAHA oferece conexão por sessão/QR Code, mas não equivale ao canal oficial. Seus controles de ritmo e horário não garantem que o número nunca será bloqueado. O próprio projeto documenta esse risco: [WAHA — bloqueios](https://waha.devlike.pro/docs/overview/how-to-avoid-blocking/).

## O que ainda não está entregue na Detali

- Inbox e recepção bidirecional de WhatsApp do Deskcomm.
- Agentes, indexação, memória, follow-ups e automações desse CRM.
- Chat flutuante de navegação e ferramentas de comandos da locadora.
- Serviço de chamadas de voz e eventual agente de voz.
- Configuração/homologação dos serviços externos e implantação dos processos necessários.

O envio de documentos via Meta já preparado anteriormente na Detali não significa que esses recursos de CRM e autoatendimento já estejam integrados.
