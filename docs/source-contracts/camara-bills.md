# Projetos de lei

Fontes: arquivos anuais oficiais `proposicoes-AAAA.csv` e `proposicoesAutores-AAAA.csv` em dadosabertos.camara.leg.br. Dois passes, originais cifrados, resultado apenas para revisão.

## Regras

- Tipos: PL, PLP e PEC.
- Proponente e coautoria vêm do campo `proponente`. A ordem de assinatura é guardada e não define autoria.
- Autor sem `idDeputadoAutor` (Senado, comissão, Executivo) não vira pessoa.
- Situação é a descrição da fonte na data da captura. Nada é inferido a partir dela.
- Quantidade de projetos não mede qualidade.

## Retenções

Ficam fora das contagens, com a evidência preservada: ano do número diferente do ano da apresentação (há registros do arquivo de 2025 apresentados em 2003), sem linha de autor, autor repetido, URI de autor de outra pessoa e indicador de proponente inválido.

## Falta

Tramitações pela API, norma resultante e tipo de norma, projetos antigos ainda ativos, tabela própria e ligação com o site. `publicationEligible` continua falso.
