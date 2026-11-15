# Publicação da Detali

O aplicativo usa Node.js 24, Next.js, PostgreSQL e buckets privados do Supabase.
O domínio de produção é https://conferencia-locadora.vercel.app.
As variáveis privadas são configuradas no projeto da Vercel, somente no ambiente
Production. Nunca envie `.env.local`, `.data`, uploads ou backups ao Git.

## Banco e arquivos

Use a conexão Transaction Pooler do Supabase (porta 6543) nas funções da Vercel.
O adaptador PostgreSQL valida TLS com a autoridade certificadora do Supabase.
Preserve `AUTH_SECRET` e `APP_ENCRYPTION_KEY` ao republicar: a segunda chave é
necessária para abrir integrações e backups já criptografados.
Configure `STORAGE_PROVIDER=supabase`, URL, chave de servidor e nomes dos buckets.
Os arquivos privados ficam nos buckets `detali-files` e `detali-backups`.

## Tarefas automáticas

O plano Hobby da Vercel restringe a frequência de Cron. O script
`scripts/supabase-scheduler.sql` instala os agendamentos no próprio Supabase:
atendimento a cada minuto quando há trabalho, verificação de backups a cada
15 minutos e relatório semanal às segundas às 11h UTC (8h na Bahia).
O horário de backup e sua ativação continuam sendo definidos por empresa.

O proprietário do banco deve configurar no Supabase Vault os segredos
`detali_production_url` e `detali_production_cron_secret` (o mesmo `CRON_SECRET`
da Vercel), sem colocá-los em SQL versionado. O script instala tarefas pausadas;
ative somente os três jobs `detali-production-*` após validar a publicação.
O endpoint exige Bearer válido. Clientes da API não podem executar a função
privada que acessa o Vault. Revise cron.job_run_details e respostas do pg_net
para monitorar falhas; o agendador não confirma entrega de mensagens.

## Serviços externos

WhatsApp, modelos de IA, SMTP, PagSeguro, assinatura digital e emissão fiscal
dependem da configuração real de cada provedor. A presença do módulo no menu
não comprova uma integração ativa. Teste cada conta configurada antes de usar
com clientes. NF-e depende de cadastro fiscal e credenciais do emissor.

## Limites a acompanhar

Funções da Vercel têm limite de corpo de requisição/resposta. Uploads e downloads
grandes exigem acesso direto ao Storage por URLs assinadas, especialmente backups.
Os formulários existentes permitem arquivos de até 5 MB; arquivos próximos desse
limite podem exceder os 4,5 MB da plataforma e precisam ser menores na Vercel.
Monitore cotas dos planos contratados, armazenamento, conexões e execução.
