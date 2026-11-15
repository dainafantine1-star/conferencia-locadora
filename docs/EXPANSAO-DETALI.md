# Expansão funcional Detali

Escopo confirmado pela usuária em 13/11/2026: evoluir o sistema além do MVP, implementar os módulos solicitados e permitir configurar serviços externos posteriormente. Preservar a identidade Detali e os dados existentes. Sem publicação automática.

## Critérios

- Dados de operação persistidos no banco com isolamento por empresa, validação no servidor e permissões.
- Valores em centavos; parcelas e comissões calculadas a partir de regras explícitas configuradas.
- Fluxos externos não configurados devem apresentar estado pendente, sem retorno de sucesso simulado.
- Integrações só serão classificadas como homologadas após testes com as contas da usuária.
- Auditoria final por função: implementada e testada, implementada aguardando configuração, ou pendente.

## Implementação

1. Corrigir defeitos reproduzidos na base: isolamento do catálogo, datas, idempotência das devoluções, contagem/fuso dos relatórios e integridade da baixa de cobrança.
2. Ampliar cadastros: dados de clientes, fornecedores, produtos, preços, movimentações e disponibilidade por período.
3. Comercial: orçamentos, conversão em contrato/pedido, documento imprimível, acesso compartilhado, parcelas, assinatura e regras de comissão.
4. Financeiro: contas a pagar/receber, baixas parciais, recibos e comissões com histórico.
5. Logística: entregas, retiradas, responsáveis, endereço, agenda e vínculo com conferências reais.
6. Administração: permissões, configuração das integrações, backups, feriados e relatórios exportáveis.
7. Site integrado: catálogo público, destaques, banners, páginas, contato e pedidos de orçamento, usando os mesmos produtos da locadora.
8. Conectar os fluxos na interface, testar APIs e persistência em banco isolado, validar desktop e celular e entregar relatório com pendências reais.

## Auditoria inicial

Onze novos testes funcionais reproduziram oito falhas antes das correções. Após corrigir as consultas/validações, os onze passaram. A autenticação desses testes de API é controlada por um substituto de teste; os testes de navegador usam autenticação real. O banco de auditoria `.data/auditoria-funcional-20261113` foi criado separadamente do banco de uso existente, com migrações e dados de demonstração usados exclusivamente como fixtures.
