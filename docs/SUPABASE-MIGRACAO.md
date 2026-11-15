# Migração da Detali para Supabase

Em 15/11/2026, a cópia do banco local foi importada no projeto `uwugpokkybjuroegdefn`. Foram conferidas as 54 tabelas de dados, com 72 registros no total. As quantidades e os checksums do conteúdo de todas as tabelas coincidiram com a origem, incluindo planos e privilégios do administrador da plataforma. O histórico de migrations fica em uma tabela adicional.

As 14 migrations do aplicativo estão aplicadas. Todas as 55 tabelas públicas têm RLS habilitada; `anon` e `authenticated` não recebem acesso direto às tabelas. As funções de segurança ficam no schema `detali_private`, fora da API pública. Os buckets `detali-files` e `detali-backups` são privados. Não havia arquivos locais em `storage` nem registros de anexos ou backups para transferir.

A conferência remota incluiu acesso com papel `authenticated`: somente clientes da empresa correspondente ficaram visíveis, e uma identidade vazia não acessou registros. As permissões temporárias dessa conferência foram revertidas. O verificador de segurança do Supabase não apresentou alertas ao final.

## Conectar o aplicativo

O aplicativo local foi conectado ao PostgreSQL e ao Storage do Supabase em 15/11/2026. A conexão foi conferida com as 54 tabelas e os 72 registros; uma gravação de teste no banco foi revertida, e uploads/downloads nos dois buckets privados passaram com remoção somente dos arquivos de verificação. A comparação final do banco local original também não encontrou alterações desde a cópia.

O painel foi aberto no Chrome usando uma sessão curta de verificação para um proprietário ativo já existente, sem alterar contas ou senhas. Login público, bloqueio de API anônima, clientes e estoque correspondentes ao banco remoto, API do painel e renderização sem erros de JavaScript passaram em seis verificações. A compilação de produção com checagem de tipos passou; permanecem avisos anteriores de lint sobre imports e imagens.

As credenciais foram configuradas nos arquivos privados `.env.local` e `.env.supabase.local`, fora do Git. O ambiente anterior foi preservado em um backup criptografado em `.data`. A integração MCP administra o projeto, mas as credenciais usadas pelo aplicativo são independentes dessa integração.

Para uma futura troca de credenciais, informe **somente no arquivo privado `.env.supabase.local`**, na raiz do projeto, ou use o configurador local:

```dotenv
TARGET_DATABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

1. Abra o [projeto no Supabase](https://supabase.com/dashboard/project/uwugpokkybjuroegdefn). Em **Connect**, copie a URI de **Session pooler**, usando a senha do banco e TLS (`sslmode=require`). A senha deve estar codificada para uma URL se tiver caracteres especiais. Não invente o hostname ou a região: copie a URI exibida no projeto.
2. Em **Settings → API Keys**, encontre a chave legada **service_role**. O adaptador atual usa essa chave JWT no servidor. Cole-a no segundo campo. As chaves públicas `anon` e `publishable` não substituem essa chave.
3. Salve o arquivo. Os dois valores são privados: não envie no chat, em capturas, no Git ou em variáveis `NEXT_PUBLIC_*`.

O configurador local `.data/configurar-supabase.cmd` permite informar esses dados em uma janela, sem editar arquivos. Ele guarda a entrada protegida pela conta do Windows, valida o banco e testa upload/download nos dois buckets antes de alterar o ambiente. No formulário, use a chave `service_role`, não `anon`, e informe a senha real do banco quando a URI copiada ainda contiver um marcador de senha.

As conexões PostgreSQL Supabase do aplicativo e dos scripts de migração usam o certificado raiz público oficial, incluído em `src/lib/db/certs/supabase-root-2021.json`, com validação de certificado e hostname habilitada. Parâmetros de TLS da URI são normalizados para não substituir essa validação no driver `pg`. Isso evita o erro de autoridade desconhecida sem desativar a verificação de segurança. Origem e fingerprint ficam registrados junto ao certificado; ele não contém credenciais. Veja a [orientação oficial sobre SSL](https://supabase.com/docs/guides/platform/ssl-enforcement).

`DATABASE_URL`, `STORAGE_PROVIDER=supabase` e as variáveis de Storage já estão configuradas e foram testadas. Os valores anteriores de `AUTH_SECRET` e `APP_ENCRYPTION_KEY` foram preservados exatamente. Ao trocar a senha do banco, atualizar também a conexão do aplicativo e dos ambientes publicados; a mudança no Supabase não atualiza esses ambientes automaticamente. Conservar as chaves de criptografia, pois substituí-las pode invalidar sessões, QR, backups ou credenciais criptografadas.

O login continua sendo Auth.js, com os usuários existentes. Esta migração não cria contas no Supabase Auth. O deploy na Vercel, o domínio e os serviços externos ainda são etapas separadas. Para Vercel, avaliar o **Transaction pooler** e limitar o pool do cliente; checar a compatibilidade de consultas e transações antes da publicação.

Os dois bancos não são sincronizados automaticamente. Se houver alterações no banco local depois da cópia, reconciliar essas alterações antes da troca definitiva, sem repetir uma importação em um destino já preenchido.

## Preservação e ferramentas

A cópia física e o arquivo criptografado ficaram em `.data/supabase-migration-20261115-01/`, ignorado pelo Git. O relatório local detalhado está em `docs/erp/supabase-migration-20261115.json`. O SQL de transferência contém dados privados e também fica fora do Git.

`npm run database:export-platform -- .data/NOME-DA-COPIA` exporta uma **cópia física já preparada** em `.data/NOME-DA-COPIA/source`. Pare todos os processos que gravam no banco antes de copiar `.data/pglite` para essa pasta. O exportador recusa o banco original e exige que o histórico de migrations corresponda aos arquivos atuais.

A exportação integral preserva todas as empresas e os registros globais da plataforma. Ela mantém os documentos JSON gerados pelo PostgreSQL como texto, preservando precisão numérica e microssegundos. A importação é uma transação única, mantém chaves estrangeiras e gatilhos ativos, resolve referências circulares opcionais em uma segunda etapa e verifica os checksums antes do commit. Um destino preenchido é recusado; apenas os planos iniciais conhecidos podem ser atualizados para os valores exatos da origem.

O comando anterior `database:import` continua destinado a backups individuais de locadoras. Ele não é o importador integral da plataforma.

Referências oficiais: [conexões PostgreSQL e poolers](https://supabase.com/docs/guides/database/connecting-to-postgres), [chaves de API](https://supabase.com/docs/guides/getting-started/api-keys) e [arquivos privados](https://supabase.com/docs/guides/storage/security/access-control).
