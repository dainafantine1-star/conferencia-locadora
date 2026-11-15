# Operação e configuração da Detali

O código usa dados persistidos, valores monetários em centavos e permissões verificadas no servidor. Os serviços externos precisam de configuração e homologação na conta da locadora. Configurar credenciais não equivale a testar uma entrega, cobrança ou assinatura real.

## Primeira instalação sem demonstração

1. Instale Node.js 20.9 ou superior e execute `npm ci`.
2. Copie `.env.example` para `.env.local`. Preencha `AUTH_SECRET` e `APP_ENCRYPTION_KEY` com segredos aleatórios de pelo menos 32 caracteres. Preserve uma cópia segura da chave de criptografia; ela é necessária para credenciais e backups antigos.
3. Configure `DATABASE_URL` para Postgres em produção, com TLS conforme o provedor. Sem essa variável, o banco PGlite fica no diretório `PGLITE_DIR`; use uma única instância do servidor para esse modo.
4. Execute `npm run db:migrate`. A rotina escolhe Postgres ou PGlite conforme o ambiente.
5. Preencha temporariamente `COMPANY_NAME`, `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` e execute `npm run company:create`. A senha deve ter pelo menos 12 caracteres. Remova essas variáveis após criar o gestor.
6. Execute `npm run build` e `npm start`. Cadastre empresa, contatos, inventário, preços, comissão e cláusulas em **Gestão**.

`npm run db:seed` é exclusivamente para demonstração: cria empresas, contas e movimentações de exemplo. Não execute essa rotina em uma instalação comercial vazia. Uma instalação que já possui dados deve preservar seu banco, aplicar as migrações aditivas e administrar usuários pela tela de equipe.

## Fluxo comercial e físico

- Cadastre clientes com CPF/CNPJ, endereço e contato. Cadastre produtos e seus preços de locação, separados dos valores de reposição e avaria.
- Conte o inventário. Estoque não informado permanece desconhecido; não é convertido em disponibilidade fictícia.
- Emita um orçamento com quantidades, preço por período, número de períodos, frete, desconto, datas e condições. A soma é calculada no servidor.
- Para contratar, as parcelas precisam somar exatamente o total, o estoque deve estar disponível e as cláusulas/dados das partes precisam estar preenchidos. A operação cria contrato, pedido e contas a receber juntos.
- O contrato preserva os dados e condições da emissão. Revisões de proposta revogam links anteriores. O aceite da proposta registra interesse; a assinatura é realizada pelo provedor contratado.
- Confirme quantidades de saída no pedido e registre cada devolução. Avarias ficam indisponíveis até reparo; faltas confirmadas no fechamento baixam o estoque físico. Reabrir restaura a baixa das faltas e preserva o histórico financeiro.
- No financeiro, registre baixas somente com pagamento conferido. Baixas parciais reduzem o saldo e geram recibos. Recebimentos anteriores são considerados no novo fechamento; diferenças podem gerar saldo ou conta de reembolso.
- A logística só conclui entrega após conferir saída; coleta exige devolução conferida ou fechamento das faltas. Agendamento de rota não altera quantidades por conta própria.

## Integrações

Configure em **Gestão → Configurações**. As credenciais são criptografadas no banco e a interface recebe somente a indicação de que estão cadastradas.

### E-mail

Informe host, porta, usuário, senha SMTP, remetente autorizado e modo TLS. O teste verifica conexão/autenticação. O envio de documentos anexa o PDF real; recibos são gerados somente a partir de uma baixa. “Enviado” significa aceito pelo servidor, sem afirmar entrega à caixa de entrada. Consulte o histórico e o serviço antes de repetir um envio incerto.

### WhatsApp

Use a API oficial WhatsApp Business Cloud: token, ID do número, versão da Graph API, idioma e template aprovado com **um parâmetro de texto no corpo**, destinado ao link do documento. Configure a URL pública HTTPS do sistema. Verifique autorização do cliente para contato e aprovação do template na sua conta.

### PagBank / PagSeguro

Informe token, ambiente e URL pública HTTPS. Comece no sandbox e homologue a conta antes da produção. O checkout cobra o saldo real da parcela. A aplicação registra a notificação em `/api/pagbank/[id]` e valida a assinatura SHA-256 do corpo, referência, moeda e valor antes da baixa. A página de retorno nunca marca a parcela como paga. Repetições da mesma notificação não criam pagamentos duplicados.

Pagamentos divergentes, cobranças com resultado incerto e operações de estorno no provedor exigem conciliação. Não há baixa baseada apenas no redirecionamento do navegador.

### Assinatura ZapSign

Informe token, ambiente e método de autenticação: certificado digital ou assinatura em tela com token por e-mail. O sistema envia o PDF real, guarda o hash do documento e consulta o status no provedor. O PDF assinado só é disponibilizado após confirmação do serviço. Links temporários de download são atualizados por consulta. A validade das cláusulas e o método escolhido devem ser definidos pela locadora.

## Loja e aplicativo

Defina um endereço exclusivo, nome, aparência, contatos e banners em **Gestão → Loja integrada**. Publique os produtos em **Estoque**. Páginas dinâmicas usam texto com parágrafos, sem execução de HTML do visitante. Solicitações e contatos recebem protocolo e ficam no painel; não confirmam reserva automaticamente.

O aplicativo é uma **PWA**, acessível por navegador e instalável na tela inicial. Compartilha dados e permissões com o sistema. Precisa de conexão para operações; nenhuma alteração é simulada offline. Publicação em lojas nativas Android/iOS não faz parte desta implementação.

## Backups e restauração

Use armazenamento persistente para `STORAGE_DIR` e `BACKUP_DIR`. Não utilize diretórios temporários de funções serverless para guardar fotos ou cópias definitivas. Faça cópias externas dos arquivos `.detali` e mantenha a chave separada.

Em **Backups**, gere e baixe um arquivo criptografado. O processo verifica a leitura/descriptografia e o SHA-256 antes de registrar sucesso. Inclui dados da empresa e anexos existentes; falha ao encontrar um anexo não é ignorada.

Para automação, configure `CRON_SECRET`, habilite a rotina diária e escolha a hora local. Execute `npm run backup:worker` junto ao servidor usando um gerenciador de processos. Alternativamente, agende um POST HTTPS a `/api/cron/backups` com `Authorization: Bearer <CRON_SECRET>` a cada 15 minutos. Um token cadastrado ou uma opção marcada não comprova que o agendador está rodando; confira o histórico.

Restaure inicialmente em um diretório novo e vazio:

```sh
npm run backup:restore -- caminho/arquivo.detali .data/recuperacao
```

A rotina valida o arquivo, cria o esquema em PGlite e restaura dados/anexos em diretório separado. Recusa sobrescrever uma base existente. Preserve o original até concluir a conferência. Migração dessa cópia para um Postgres operacional exige procedimento administrativo planejado.

## Referências dos provedores

- [Checkout PagBank](https://developer.pagbank.com.br/reference/criar-checkout) e [autenticidade das notificações](https://developer.pagbank.com.br/reference/confirmar-autenticidade-da-notificacao).
- [Nodemailer SMTP](https://nodemailer.com/smtp).
- [WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview/).
- [Criação de documentos ZapSign](https://docs.zapsign.com.br/documentos/criar-documento) e [consulta de documento](https://docs.zapsign.com.br/documentos/detalhar-documento).
- [BrasilAPI](https://github.com/BrasilAPI/BrasilAPI). O calendário importado deve ser conferido para feriados locais e pontos facultativos.
