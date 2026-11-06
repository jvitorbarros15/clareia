# Clareia — mapas e gráficos como investigação

Direção aprovada em 1º de novembro de 2026. As visualizações devem compartilhar contexto e levar até evidências. Todos os dados do MVP permanecem fictícios.

## Implementado no MVP

| Experiência | Interação | Limite explícito |
| --- | --- | --- |
| Meu estado no Congresso | Mapa esquemático das 27 UFs; intensidade por total, média por representante ou projetos; tabela de cálculo | Só SP, MG e RJ têm amostra. UF de representação não é destino da despesa. Média por representante não ajusta tempo em exercício |
| Investigação conectada | Explorar uma UF atualiza rankings e escolhe até duas pessoas locais no comparador | Quando há só uma pessoa, o gráfico mostra uma série; a comparação não inventa outro perfil |
| O que mudou mês a mês? | Dois seletores de mês destacam um intervalo; totais e tabela correspondem ao intervalo; pontos abrem os registros do mês | A comparação anual acima mantém seu período explicitamente indicado. Ausência de exercício não vira zero |
| Para onde foi o dinheiro? | Categoria → fornecedor → registros; valor e período acompanham a navegação | Fornecedores e documentos fictícios; nenhuma imagem de comprovante oficial foi inventada |
| Como votaram? | Placar e detalhamento nominal com retratos; votação ligada à proposta | Cenário independente de cinco pessoas; não representa plenário real |
| O caminho de um projeto | Linha de etapas, estado atual, autoria e acompanhamento local | Tramitação fictícia; aprovação em uma Casa não equivale a lei vigente |

## Próximas visualizações, dependentes de dados reais validados

1. **Mapa geográfico oficial:** malha IBGE versionada, tabela alternativa acessível, valores absolutos e denominadores explícitos. Usar códigos oficiais para junções. Não estimar estados sem cobertura.
2. **Mudanças mensais:** destacar variações descritivas após verificar cobertura de ambos os períodos. Mostrar base e diferença absoluta; não calcular porcentagem com denominador zero. Não chamar um pico de fraude ou irregularidade.
3. **Grade de votos:** retratos por voto, filtros de UF/partido na data da votação, texto exato do objeto votado, orientações separadas de votos individuais. Preservar categorias da fonte e distinguir ausência de voto não disponibilizado.
4. **Mapa de emendas por município:** autor, finalidade, beneficiário e etapas financeiras distintas. Não atribuir a sede de um fornecedor ao local da obra. Destino nacional, multiestadual ou desconhecido deve permanecer nessas categorias. Pagamento não comprova entrega.
5. **Investigações compartilháveis:** links que preservam recortes, pessoas, versão dos dados e intervalo do gráfico. Evidência e exportação devem reproduzir exatamente a visualização.

## Regras visuais

- Escala e unidade sempre visíveis; zero real, indisponível e fora de exercício têm estados diferentes.
- Comparações usam a mesma definição, moeda, período e versão da base.
- Não misturar categorias financeiras (salário, cota, gabinete, emendas) em um único ranking de “gastos”.
- Tabela acessível e navegação por teclado; nenhuma informação depende apenas de cor ou hover.
- Respeitar movimento reduzido. Transições não devem sugerir uma precisão maior que a fonte.
- Mapas, gráfico, tabela, CSV e assistente devem usar o mesmo serviço de métricas na implementação real.

## Primeiro fluxo real a entregar

Escolher UF → comparar representantes elegíveis → selecionar meses → abrir uma categoria → fornecedor → registro oficial → compartilhar o recorte com versão e fontes.

Critério de aceite: outro usuário consegue reproduzir o total a partir dos registros e entender o que foi incluído, excluído e considerado desconhecido.
