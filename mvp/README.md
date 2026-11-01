# Clareia — três interfaces interativas

MVP local das três referências escolhidas: **Investigação verde**, **Explorador escuro** e **Editorial azul**. O seletor no topo permite alternar entre elas. Investigação reaproveita os retratos do esboço; Editorial e Explorador usam retratos limpos gerados a partir da referência, para evitar resíduos de botões e números nas fotografias.

As três alternativas agora têm páginas completas, com o mesmo logotipo aprovado: **clareia + raios dourados**. A escolha da composição continua em aberto.

## Abrir

Com Node.js instalado, execute na raiz do projeto:

```powershell
node mvp/server.mjs
```

- [Investigação](http://127.0.0.1:4173/?modelo=investigacao)
- [Explorador](http://127.0.0.1:4173/?modelo=explorador)
- [Editorial](http://127.0.0.1:4173/?modelo=editorial)

Também é possível abrir `index.html` diretamente no navegador. O servidor local melhora o funcionamento de links compartilhados e da área de transferência. Não há dependências de npm, fontes remotas ou serviços externos necessários para a interface. Encerre o servidor com `Ctrl+C`.

## O que funciona

- Composições distintas, responsivas, com os elementos de cada referência.
- Busca demonstrativa: comparação de duas pessoas, consulta por nome, rankings de gastos ou projetos, categoria, estado, ano e média mensal. Perguntas fora da cobertura recebem uma explicação.
- Rankings por total/mês, maiores/menores gastos, projetos e participações em votações no Explorador.
- Filtros de ano (2024/2025), estado e categoria onde disponíveis na composição.
- Painel “Como chegamos nisso?” com cálculo, contexto, composição e registros.
- Perfis, detalhamento mensal nos pontos do gráfico, séries selecionáveis e tabela acessível.
- Exportação CSV dos registros fictícios e compartilhamento de URL com filtros/pergunta.
- Navegação por teclado, fechamento de diálogo por Escape e respeito a movimento reduzido.

## Página completa — expansão de 1º de novembro de 2026

Todos os recursos abaixo estão disponíveis nas três composições:

- **Panorama:** quatro indicadores com acesso às respectivas contagens e registros.
- **Despesas:** gráfico de composição, controle contínuo de período, barras mensais, fornecedores e abertura dos registros por categoria.
- **Atlas:** mapa esquemático navegável das 27 UFs, seleção por teclado ou menu e aplicação do estado aos filtros. Apenas SP, MG e RJ têm dados de demonstração; as demais UFs mostram indisponibilidade. O mapa é explicitamente não geográfico.
- **Diretório:** busca por nome, estado e partido fictício, acesso ao perfil, acompanhamento e inclusão na comparação.
- **Comparador:** escolha de duas pessoas, inversão dos lados, total/média mensal, composição por categoria e explicação da diferença percentual.
- **Projetos:** filtros por tema, etapa e texto; quatro cenários com autoria, tramitação e acompanhamento local.
- **Votações:** três cenários com objetos de votação, placares de cinco perfis, destaque individual e lista nominal. Esses cenários não representam a contagem anual inteira do ranking.
- **Outras dimensões:** painéis demonstrativos de trajetória/eleições, patrimônio declarado, etapas de emendas e fornecedores.
- **Acompanhamento:** favoritos de pessoas e projetos persistidos neste navegador, linha do tempo e resumo dos acompanhados. Não há envio de e-mails ou alertas externos.
- **Assistente:** entrada flutuante, exemplos de perguntas e encaminhamento à investigação existente; atalho `/` para a busca principal.
- **Navegação:** índice fixo de seções, indicação da seção atual, progresso de leitura e retorno ao topo.

### Movimento por direção visual

- **Investigação:** transições suaves, revelação progressiva e contadores de contexto.
- **Editorial:** entradas mais discretas, tipografia serifada, divisórias e composição de votações em linhas amplas.
- **Explorador:** painéis escuros com profundidade, revelações e inclinação leve dos cartões ao mover o mouse.

O botão **Movimento** desativa as animações e salva a preferência. A preferência de movimento reduzido do sistema é respeitada. Nenhuma informação depende da animação para aparecer.

## Limites explícitos

Todas as pessoas, valores, retratos e atividades são **fictícios**. Os links da Câmara apontam à documentação da futura integração; não são comprovação dos valores da demonstração. A busca usa regras locais, **não é um RAG nem uma IA conectada**. Não há backend de dados, autenticação ou coleta de fontes oficiais.

As imagens de referência divergiam no valor de Carla. Para preservar cada composição, Investigação usa R$ 150 mil em 2025; Editorial e Explorador usam R$ 120 mil. Os registros de cada amostra somam exatamente aos valores exibidos. A comparação por mês usa meses em exercício; menores gastos excluem perfis com menos de seis meses. Votações contam participações fictícias, sem atribuir posições políticas.

## Arquivos

- `index.html`: entrada e contêiner acessível de detalhes.
- `styles.css`: três composições e adaptações para telas menores.
- `app.js`: navegação, interações e cálculos de apresentação.
- `data.js`: registros locais de demonstração com somas consistentes.
- `portal.js`: seções completas, cenários de atividade, mapa esquemático, favoritos e coordenação das interações.
- `portal.css`: identidade compartilhada, três direções visuais completas e movimento responsivo.
- `assets/`: retratos e imagens de referência, com origem e prompt em [assets/README.md](assets/README.md).
- `server.mjs`: servidor estático local, restrito ao diretório do MVP.
- `verify.cjs`: verificação no Chromium com Playwright instalado separadamente; não é uma dependência de execução do MVP.
- `verify-portal.cjs`: verificação dos fluxos da página completa, persistência e movimento.

As referências visuais foram geradas com imagegen. A interface é HTML/CSS/JavaScript real; não é uma imagem clicável sobreposta.

## Verificação realizada

Os três modelos foram inspecionados visualmente no Chromium em desktop e celular. Os testes cobrem larguras de 360, 390, 768 e 1280 px, cálculos, filtros, busca, consultas fora da cobertura, painéis, foco por teclado, tabelas, CSV e compartilhamento com restauração do estado. Não foram encontrados erros de JavaScript nem falhas de carregamento dos arquivos locais na execução final.

Com o servidor ativo e Playwright disponível:

```powershell
node mvp/verify.cjs
node mvp/verify-portal.cjs
```

O script usa `playwright` instalado no projeto ou, no Windows, a instalação global em `%APPDATA%/npm/node_modules/playwright`. Relatório em [verification.json](../output/qa/verification.json).

Os testes da expansão também verificam o arraste contínuo sem recriar o controle, soma dos registros da categoria/período, estados sem dados, filtros do diretório, inversão da comparação, favoritos após recarregar, projetos, placares, dossiês, linha do tempo, assistente e animações. Relatório: [portal-verification.json](../output/qa/portal-verification.json).

Capturas do MVP funcionando:

| Modelo | Desktop | Celular |
| --- | --- | --- |
| Investigação | [Captura](../output/qa/investigacao-desktop.png) | [Captura](../output/qa/investigacao-mobile.png) |
| Explorador | [Captura](../output/qa/explorador-desktop.png) | [Captura](../output/qa/explorador-mobile.png) |
| Editorial | [Captura](../output/qa/editorial-desktop.png) | [Captura](../output/qa/editorial-mobile.png) |

Capturas das páginas **completas**:

| Modelo | Desktop | Celular |
| --- | --- | --- |
| Investigação | [Página completa](../output/qa/investigacao-full-desktop.png) | [Página completa](../output/qa/investigacao-full-mobile.png) |
| Explorador | [Página completa](../output/qa/explorador-full-desktop.png) | [Página completa](../output/qa/explorador-full-mobile.png) |
| Editorial | [Página completa](../output/qa/editorial-full-desktop.png) | [Página completa](../output/qa/editorial-full-mobile.png) |
