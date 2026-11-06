# Clareia — direção de UI, UX e frontend

> Exploração de design · 31 de outubro de 2026  
> As três alternativas abaixo ainda estão em avaliação.  
> Complementa [a direção da plataforma](DIRECAO-DA-PLATAFORMA.md).

## 1. O que o primeiro olhar deve comunicar

O visitante deve ver pessoas, entender as três comparações e perceber que pode explorar os detalhes. Fotos e valores ocupam a primeira tela. A busca e os filtros ficam próximos desse conteúdo.

Prioridades visuais, nesta ordem:

1. Fotos dos parlamentares nos três rankings.
2. Nome, posição e valor ou quantidade de projetos.
3. Período, Casa, UF e definição da métrica.
4. Gráficos e exploração geográfica.
5. Evidências e metodologia acessíveis a partir de cada resultado.

Usar uma frase curta de apresentação. A abertura deve reservar espaço para os rankings, sem uma grande área promocional acima deles.

## 2. Três direções para comparar

### Editorial

**Personalidade:** publicação de dados acessível, com ritmo de leitura tranquilo.

- Fundo branco quente, superfícies claras e verde profundo.
- Títulos com uma fonte serifada discreta; interface e números em fonte sem serifa.
- Primeiro colocado com retrato maior, seguido de linhas menores para os demais.
- Separadores finos e bastante espaço entre grupos.
- Gráficos integrados à página, com poucas molduras.

Favorece a descoberta por cidadãos e dá presença às pessoas. É a recomendação inicial para o público escolhido, ainda sujeita à preferência do usuário.

### Painel

**Personalidade:** ferramenta organizada, rápida de consultar e comparar.

- Fundo cinza muito claro, cartões brancos e azul como acento.
- Tipografia sem serifa em toda a interface.
- Retratos circulares menores e listas compactas.
- Grupos de informação delimitados e controles próximos dos resultados.
- Navegação lateral compacta no desktop; organização simplificada no celular.

Favorece consultas recorrentes e filtros. É preciso preservar espaço e tamanho de texto para não exigir familiaridade com dashboards.

### Noturno

**Personalidade:** presença visual forte, com fotografias em destaque.

- Fundo carvão com leve tom verde, texto claro e acento verde-lima suave.
- Retratos grandes na liderança de cada ranking.
- Números destacados e gráficos luminosos, com poucos efeitos decorativos.
- Cartões com limites discretos e hierarquia clara entre retrato, nome e valor.

Favorece o impacto inicial. Convém testar leitura prolongada e manter contraste confortável nas tabelas e notas secundárias.

### Paletas iniciais

| Uso | Editorial | Painel | Noturno |
| --- | --- | --- | --- |
| Fundo | `#F7F7F2` | `#F3F6FB` | `#111715` |
| Superfície | `#FFFFFF` | `#FFFFFF` | `#1C2521` |
| Texto principal | `#20392D` | `#142B49` | `#F2F4EB` |
| Texto secundário | `#66756B` | `#62748B` | `#AFBBB2` |
| Acento | `#285B42` | `#3163CB` | `#C6E98E` |

As cores são propostas de identidade. Não representam avaliação moral dos políticos, posições ideológicas ou dados de partido. As combinações usadas no produto ainda devem passar pela verificação de contraste.

## 3. Anatomia da página inicial

### Cabeçalho

Marca à esquerda e uma busca ampla: **“Busque um nome ou faça uma pergunta”**. Manter espaço para acesso à metodologia e navegação principal sem competir com as fotos.

Na primeira versão, a busca por nomes funciona independentemente do assistente. Sugestões podem mostrar perfis e exemplos de perguntas em grupos identificados.

### Contexto e filtros

Mostrar Casa legislativa, período e filtros por estado e partido. Permitir limpar filtros e compartilhar a consulta. O título do ranking e a informação de período precisam continuar associados durante a navegação.

Em uma versão funcional, considerar uma faixa de filtros fixa após a rolagem, desde que não cubra conteúdo nem consuma muito espaço no celular.

### Rankings com retratos

Três grupos visíveis: **Quem mais gastou**, **Quem menos gastou** e **Quem apresentou mais projetos**.

Cada grupo mostra alguns destaques e um acesso ao ranking completo. O primeiro lugar pode receber mais espaço, sem medalhas ou linguagem de prêmio. As regras de elegibilidade, autoria e reembolsos estão no documento principal.

No cartão, o usuário precisa reconhecer nome, UF, partido, posição e medida. Foto e nome abrem o perfil; a métrica pode abrir o conjunto de registros que explica aquele número. Evitar controles aninhados que dificultem o clique ou a navegação por teclado.

### Gráficos e mapa

Uma composição possível é dar mais largura ao gráfico temporal e colocar o mapa em um painel adjacente no desktop. No celular, cada visualização recebe a largura inteira.

Cada gráfico tem uma pergunta clara, unidade, período, detalhes ao tocar e acesso aos registros. O mapa informa a que geografia o dado se refere: por exemplo, UF de representação do parlamentar.

Ao selecionar um estado ou categoria, mostrar o filtro aplicado e uma forma evidente de removê-lo. Usar rótulos e seleção visível para que a pessoa entenda por que os outros números mudaram.

## 4. Fluxos principais

| Ação | Resposta esperada da interface |
| --- | --- |
| Selecionar um retrato | Abrir uma prévia contextual do perfil, com caminho para a página completa |
| Selecionar um total | Mostrar os registros que compõem a métrica, mantendo o período |
| Ver ranking completo | Abrir uma lista pesquisável com a mesma ordenação e os mesmos filtros |
| Alterar período ou estado | Atualizar resultados compatíveis e indicar a seleção aplicada |
| Tocar em uma barra do gráfico | Exibir o valor exato e oferecer o detalhamento daquele período |
| Selecionar uma UF no mapa | Aplicar o filtro geográfico e identificar seu significado |
| Fazer uma pergunta | Exibir uma resposta curta, fontes, contexto e ação “Ver dados” |
| Comparar duas pessoas | Mostrar as mesmas métricas no mesmo período, com diferenças de cobertura explícitas |

Uma prévia lateral pode funcionar bem no desktop. No celular, usar uma página ou painel que preserve a leitura e permita voltar ao ponto anterior. Escolher uma dessas soluções após testar o conteúdo real.

## 5. Busca com respostas

O painel de resposta deve nascer junto à busca e manter a página reconhecível. A pessoa pode ler uma resposta rápida e voltar aos rankings sem entrar em uma experiência separada de chat.

Ordem sugerida da resposta:

1. Resposta direta, em uma a três frases.
2. Número, pequena tabela ou gráfico quando útil.
3. Recorte utilizado: Casa, período, UF e outros filtros.
4. Fontes e data de atualização.
5. Ações como “Ver dados”, “Abrir perfil” ou “Comparar”.

Projetar também os estados de consulta em andamento, pessoa ambígua, base incompleta, ausência de resultado e falha de serviço. Mostrar progresso sem inventar uma resposta provisória. No protótipo visual atual, as respostas são locais e demonstrativas, sem modelo conectado.

## 6. Comportamento no celular

- Busca em uma linha própria, com campo de texto confortável.
- Filtros principais visíveis; opções adicionais podem abrir uma área dedicada.
- Três rankings empilhados, mantendo o acesso a todas as categorias.
- Retratos menores dentro de linhas legíveis; sem exigir rolagem horizontal para ler valores.
- Gráficos com menos rótulos e detalhes por toque.
- Mapa acompanhado de um seletor ou lista de estados.
- Navegação de retorno que preserve filtros e posição na página.

## 7. Regras para o sistema visual

- Espaçamento consistente em múltiplos de 4 ou 8 px.
- Texto principal em torno de 16 px no produto; notas secundárias legíveis e pouco numerosas.
- Números tabulares em tabelas e comparações; reais no formato brasileiro.
- Bordas discretas e cantos moderadamente arredondados.
- Cor de acento usada para seleção, ações e gráficos; paleta de partidos apenas quando pertinente ao conteúdo.
- Animações curtas para mudanças de estado, respeitando a preferência por movimento reduzido.
- Retratos com enquadramento consistente, origem conhecida e alternativa quando a foto faltar.
- Ícones acompanhados de texto quando o significado não for evidente.

Como referência de acessibilidade, a WCAG prevê contraste mínimo de 4,5:1 para texto comum, com exceções como texto grande, e um critério de tamanho mínimo de alvo de 24 × 24 CSS px com exceções. Para os controles principais no celular, propomos áreas de toque próximas de 44 × 44 px. Referências: [contraste — W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) e [tamanho de alvo — W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## 8. Estados que o frontend precisa prever

Carregando, vazio por filtro, dados indisponíveis, fonte desatualizada, foto ausente, erro parcial, documento indisponível e resultado de comparação incompleto.

Um gráfico ainda carregando não deve parecer um gráfico de valor zero. Uma falha em uma fonte deve permitir continuar consultando as demais áreas disponíveis, com indicação do que está incompleto.

## 9. Registro da exploração visual

Foram exploradas três alternativas: Editorial, Painel e Noturno. Os protótipos em HTML foram removidos a pedido do usuário. Este documento preserva as ideias de design; não há código HTML de interface mantido no projeto.

Todos os nomes, retratos e valores são fictícios. Os retratos foram gerados com a ferramenta integrada de geração de imagens. A amostra usa as mesmas seis pessoas nas três alternativas para facilitar a comparação de layout.

As propostas concentram-se na abertura, rankings, gráficos e busca. O mapa geográfico e a página completa de perfil ainda precisam ser detalhados. Não há integração de dados ou RAG implementada.

Arquivos dos retratos preservados: [original PNG](../output/retratos-ficticios.png) e [cópia JPEG](../output/retratos-ficticios.jpg).

### Prompt dos retratos

Ferramenta utilizada: geração de imagens integrada, sem CLI.

> Use case: photorealistic-natural. Create ONE portrait contact sheet asset for a civic website design prototype. Exactly 6 square photographic headshots arranged edge-to-edge in a precise 3-column by 2-row grid, with no gaps, borders, text, numbers, badges or watermarks. Overall image aspect ratio 3:2. Every portrait occupies exactly one equally sized square. All six people are wholly fictional Brazilian adult civic professionals, do not resemble or depict any real politician or known public figure. Diverse appearances and ages 35-65: first row a woman with medium brown skin and shoulder-length dark hair, a light-skinned gray-haired man with glasses, a dark-skinned man with short hair; second row a light-skinned woman with short brown hair, a brown-skinned older man with salt-and-pepper hair, a dark-skinned woman with natural curly hair. Neutral friendly expressions, direct eye contact, professional shirts or jackets without insignia, consistent soft editorial studio lighting, matte warm gray backgrounds. Identical head-and-shoulders framing, face centered in each square, full head visible with space above. Realistic professional portrait photography, natural skin texture, no caricature. These are generic fictional portraits for UI demonstration, not actual officeholders.

## 10. Próxima escolha de design

Escolher a alternativa mais próxima do resultado desejado e identificar quais elementos das outras merecem ser aproveitados. Depois, detalhar uma direção consistente para página inicial, perfil, comparação, mapa e resposta da busca.

Uma combinação possível é a tipografia e o ritmo da Editorial com os filtros e a organização da Painel. Essa combinação é uma proposta, não uma decisão tomada.
