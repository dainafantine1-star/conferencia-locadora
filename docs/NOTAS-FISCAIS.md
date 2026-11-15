# NF-e de produtos e remessas

O módulo fica em **Notas fiscais**, no menu lateral, e no atalho **NF-e** no topo. Foi implementado para NF-e modelo 55, conforme a escolha da locadora. O gestor pode conceder a operadores a permissão **Notas fiscais: emitir, baixar e enviar** em Gestão → Equipe. Apenas gestores alteram a configuração fiscal.

## Configuração da empresa

1. Na Focus NFe, cadastre a empresa, configure certificado digital, credenciamento na SEFAZ, numeração/série e emissão em homologação. A conta e eventual contratação do provedor são feitas pela locadora. O sistema não contratou um plano e não guarda o arquivo/senha do certificado.
2. Em Notas fiscais → Configuração fiscal, complete emitente e endereço fiscal, incluindo inscrição estadual, CRT, município/IBGE e CEP. Informe o token **da empresa e do ambiente correto**. Os tokens ficam criptografados no servidor e não são devolvidos ao navegador. Campo vazio preserva o token; remoção é explícita.
3. Configure perfis de operação: natureza, entrada/saída, finalidade, CFOP na mesma UF/outra UF, consumidor final, presença e transporte. O contador precisa definir CST/CSOSN, PIS, COFINS, alíquotas, benefícios e campos de IBS/CBS aplicáveis. Os campos adicionais seguem o leiaute da Focus; não há tributação inventada nem código fiscal preenchido por exemplo automático. Pagamentos e demais campos gerais também são configurados no perfil.
4. Cadastre NCM/unidade/origem dos produtos. Tributos específicos por produto podem substituir o padrão do perfil. Os valores completos `{{valor_produto}}`, `{{quantidade}}`, `{{valor_unitario}}` são substituídos nos tributos por item; `{{valor_produtos}}` nos campos gerais. Não são executadas expressões ou código. Os cálculos tributários automáticos disponíveis dependem do leiaute do provedor; nenhum motor tributário universal é presumido.
5. Teste a operação da empresa em homologação. Depois, informe o token de produção, marque a liberação explícita e selecione Produção. Notas de homologação permanecem identificadas como teste, inclusive no nome do arquivo e na mensagem.

## Operação

Selecione cliente, pedido opcional e perfil. Complete o endereço e a identificação fiscal do destinatário, IE e contato. Adicione os produtos e informe quantidades e valores fiscais. Na remessa, o valor dos bens não é preenchido com o preço da locação. Frete, seguro, desconto e outras despesas são informados por item. Os valores dos produtos usam centavos e arredondamento por item; totais tributários são calculados pelo provedor conforme a configuração.

Salve, revise os itens e os campos fiscais e digite **EMITIR**. O sistema persiste a referência antes do pedido à Focus. Solicitações simultâneas não repetem o POST. Uma resposta de recebimento/processamento não é tratada como autorização. A consulta atualiza autorização, rejeição, denegação ou cancelamento conforme o provedor. Timeout mantém resultado incerto; não há reemissão automática. Confira a mesma referência no provedor antes de criar outro documento.

Notas rejeitadas permitem correção, nova revisão e reenvio com a mesma referência. Notas autorizadas não permitem edição. Uma revisão antiga ou perfil alterado exige nova conferência do rascunho.

Após autorização, **Baixar DANFE em PDF** e **Baixar XML autorizado** fazem download dos arquivos do provedor. O sistema não monta um PDF próprio e o chama de NF-e. URLs são restritas ao host do ambiente Focus, sem seguir redirecionamentos ou encaminhar tokens a outros destinos. O formato, limite de tamanho e integridade dos arquivos são verificados. Cópias baixadas ficam no banco, com SHA-256, e entram no backup criptografado. O XML também precisa conter a chave da nota. Downloads usam o último status registrado; consulte o resultado para atualizar mudanças feitas externamente. Para enviar por WhatsApp, o status é consultado novamente.

## WhatsApp

A conexão é a mesma de **Atendimento e agentes**, sem conta/número inventados. O destinatário é o telefone registrado na NF-e e precisa ser conferido pelo operador antes do envio.

- **Meta Cloud API:** upload privado do PDF como mídia e envio de mensagem `document`. Fora da janela de 24 horas, configure um template previamente aprovado com cabeçalho DOCUMENT, idioma e parâmetros de corpo na ordem aprovada. Podem ser usados `{{numero}}`, `{{cliente}}`, `{{empresa}}` como valores completos. A existência/aprovação do template é validada pela Meta no envio.
- **WAHA:** exige host autorizado pelo servidor, sessão WORKING vinculada à empresa e confirmação do chat do destinatário. Envia o arquivo PDF em base64 pelo endpoint de documentos.

O envio aparece no histórico fiscal e na conversa do CRM. “Aceita” significa aceitação pela API. Recibos Meta autenticados atualizam entrega/leitura/falha, inclusive quando chegam antes da gravação do resultado. Não há confirmação de entrega inventada para WAHA. Opt-out e limite diário do CRM são respeitados. Um envio incerto impede uma repetição cega; confira a conversa e o provedor. A troca do provedor/conexão não elimina o opt-out já conhecido do contato.

## Dados e limites da entrega

As três tabelas fiscais possuem isolamento por empresa no servidor e RLS habilitada sem acesso público no PostgreSQL/Supabase. As três entram no backup/restauração, incluindo snapshots, credenciais cifradas, arquivos já baixados e histórico. A migração apenas acrescenta tabelas; não muda contas, preços ou movimentações de estoque. Emitir remessa não confirma uma saída física nem cria recebível de locação.

O módulo não inclui NFS-e, NFC-e, carta de correção, inutilização ou solicitação de cancelamento. Cancelamentos realizados no provedor são reconhecidos ao consultar. Esses recursos não foram solicitados nesta etapa. O assistente de navegação encontra o módulo; a emissão permanece na tela, com revisão explícita.

Os testes usam banco separado e respostas controladas, sem emitir documento fiscal ou enviar mensagem a destinatário real. Homologação e emissão reais exigem a configuração e validação da empresa. As evidências estão em `docs/erp/fiscal-*.json`.

## Fontes da integração

- [Operações de NF-e e ambientes da Focus](https://doc.focusnfe.com.br/docs/operacoes-disponiveis-na-api)
- [Emissão](https://doc.focusnfe.com.br/reference/emitir_nfe), [consulta](https://doc.focusnfe.com.br/reference/consultar_nfe) e [referência/idempotência](https://doc.focusnfe.com.br/reference/referencia)
- [Campos da NF-e e cálculos disponíveis](https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html)
- [Templates com mídia, coleção oficial Meta](https://www.postman.com/meta/whatsapp-business-platform/request/2qbotrb/send-message-template-media)
- [WAHA: envio de documentos](https://waha.devlike.pro/docs/how-to/send-messages/) e [consulta de contatos](https://waha.devlike.pro/docs/how-to/contacts/)
- [Receita Federal: cálculo do dígito do CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj)
