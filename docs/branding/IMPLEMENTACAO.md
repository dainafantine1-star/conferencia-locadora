# Identidade Detali

Implementação local baseada em `detali-identidade/referencia.png`, `GUIA-VISUAL.md`, `tokens.css` e `PROMPT-CODEX.md`. A prancha foi aberta e inspecionada antes das alterações. Nenhuma publicação ou alteração de infraestrutura foi executada.

## Alterações

- `src/app/globals.css`: importa os tokens fornecidos, integra as cinco cores ao Tailwind 4 e adapta os tons neutros existentes para superfícies quentes. Define tipografia, foco de teclado, números tabulares, raios, espaçamento de navegação e redução de movimento. As cores semânticas de sucesso, alerta e erro foram preservadas.
- `src/app/layout.tsx`: fontes locais via `next/font/local`, nome e descrição Detali, ícones e cor do navegador. Permite ampliar a tela pelo navegador.
- `src/components/Brand.tsx`, `NavIcon.tsx` e `ui.tsx`: assinatura compartilhada, ícones lineares, cartões, botões, campos, seleção, badges, estados vazios, carregamento, mensagens e navegação responsiva. A navegação mantém a filtragem por perfil e o encerramento de sessão.
- `src/app/login/page.tsx`: acesso com assinatura, slogan, apresentação em desktop e composição compacta no celular. Preserva credenciais demonstrativas e autenticação existentes.
- `src/app/(app)/painel/page.tsx` e `src/components/charts.tsx`: indicadores, ações, barras, gráficos e textos na paleta Detali.
- `src/app/(app)/calendario/page.tsx`, `src/components/Calendar.tsx` e `AgendaAvailability.tsx`: seleção de datas, alternância mês/lista, alvos de toque e formulários adaptados ao celular.
- `src/app/(app)/pedidos/[id]/page.tsx`: tabela de saldo com rolagem restrita ao componente em telas pequenas.
- `src/app/(app)/pedidos/[id]/retorno/page.tsx`: quantidades previstas e recebidas nesta etapa, mensagem de diferença e indicação textual de avarias, sem alterar cálculos, validação ou gravação.
- Catálogo, clientes, equipe, saída, fechamento e demais formulários recebem o tema pelos componentes compartilhados e tokens.

Alterações preexistentes de agenda, catálogo, login, banco, seed e documentação foram preservadas. As rotas de API, autenticação, permissões e regras de negócio não foram modificadas nesta tarefa. Nenhum dado ilustrativo da prancha foi cadastrado.

## Ativos e fontes

Não foram encontrados arquivos originais da logo no projeto nem no pacote recebido. `public/brand/detali.svg` e `detali-light.svg` são **reconstruções aproximadas em caminhos SVG**, sem dependência de fonte para o lettering. O símbolo preserva o recorte quadrado e a dobra lateral. `detali-symbol.svg`, `detali-touch.png` e `src/app/favicon.ico` atendem aos tamanhos compactos. Não devem ser tratados como arquivos oficiais finais da marca.

A comparação com a referência em escala grande e reduzida está em [logo-comparison.png](screenshots/logo-comparison.png). A assinatura em produção local é exibida com pelo menos 140 px; a comparação também inclui um ícone com 24 px.

Bricolage Grotesque e Inter são arquivos variáveis oficiais obtidos de `google/fonts`, hospedados em `public/fonts` e acompanhados de suas licenças SIL Open Font License. Não houve substituição de família tipográfica. O carregamento não depende de chamadas ao Google Fonts durante o uso ou build.

## Verificação

- `npm.cmd test`: 2 arquivos e 16 testes aprovados.
- `npx.cmd tsc --noEmit`: aprovado.
- `npm.cmd run lint`: aprovado, sem erros; 28 avisos preexistentes de imports/variáveis não utilizados e imagem de anexo com `<img>`.
- `npm.cmd run build`: aprovado na versão final, incluindo compilação, lint, tipos e geração das páginas. Sem mudança de dependências do aplicativo.
- Inspeção no Chrome: **38 combinações de página/estado**, em **1440, 390 e 320 px**, sem transbordamento horizontal, erros JavaScript ou falhas de requisição. Fontes oficiais e logos carregadas em todas as verificações. Evidências em [browser-validation.json](browser-validation.json).
- Teclado: Tab entre campos com contorno de 2 px; foco creme na navegação escura; item atual indicado com `aria-current` e acesso direto ao conteúdo.
- Login: erro de credenciais inválidas e acesso válido. Perfis gestor e operador conferidos; Equipe ausente para operador e API respondendo **403**, como esperado.
- Painel, pedidos, novo pedido, catálogo, clientes, equipe, agenda em mês/lista, detalhe e tabela de saldo, saída, retorno, fechamento, ajuste e reabertura foram abertos. Estado vazio testado com busca sem resultados. Retorno testado com preenchimento de quantidades em bom estado e resumo atualizado, **sem salvar**. A saída foi inspecionada em pedido já aberto, pois não havia rascunho disponível; não houve reconfirmação.

As principais combinações de texto têm contraste acima de 4,5:1: ameixa/laranja **5,65:1**, creme/laranja queimado **6,13:1**, ameixa/creme **15,24:1**, texto auxiliar/branco **6,96:1** e texto auxiliar/pêssego **5,10:1**. As bordas neutras dos campos têm **3,96:1** sobre branco. Rótulos dos indicadores mantêm opacidade integral, legendas usam texto escuro e o detalhe gráfico do login fica afastado do texto. Valores em [contrast-validation.json](contrast-validation.json).

As telas existentes usam seções expansíveis para ajustes e reabertura; ambas foram abertas, sem confirmação de alterações. Não havia componente de modal independente para tematizar. Gravação de pedidos, devoluções, cobrança, uploads e leitura pela câmera não foram executados nesta validação visual; os testes existentes cobrem regras de negócio. Nenhum registro de negócio foi criado ou alterado para obter capturas.

## Capturas

- [Visão geral: desktop e celular](screenshots/visao-geral.png)
- [Acesso em desktop](screenshots/login-desktop.png) e [celular](screenshots/login-mobile.png)
- [Erro de acesso](screenshots/login-error.png)
- [Painel em desktop](screenshots/painel-desktop.png) e [celular](screenshots/painel-mobile-390.png)
- [Painel do operador](screenshots/painel-operador-mobile.png)
- [Agenda em desktop](screenshots/calendario-desktop.png), [lista](screenshots/agenda-lista-desktop.png) e [celular](screenshots/calendario-mobile-390.png)
- [Novo pedido em desktop](screenshots/pedidos-novo-desktop.png) e [celular](screenshots/pedidos-novo-mobile-390.png)
- [Busca sem resultados](screenshots/pedidos-empty.png)
- [Tabela de saldo](screenshots/pedido-desktop.png) e [saída](screenshots/saida-desktop.png)
- [Retorno em desktop](screenshots/retorno-desktop.png), [quantidades conferidas](screenshots/retorno-conferido-desktop.png) e [celular](screenshots/pedidos-detalhe-retorno-mobile-390.png)
- [Fechamento](screenshots/fechamento-desktop.png), [ajuste](screenshots/ajuste-desktop.png) e [reabertura](screenshots/reabertura-desktop.png)
- [Comparação da logo com a prancha](screenshots/logo-comparison.png)

As capturas longas mostram a navegação fixa na posição correspondente à altura inicial da janela. A página tem espaço ao final para que os últimos controles possam ser alcançados por rolagem.
