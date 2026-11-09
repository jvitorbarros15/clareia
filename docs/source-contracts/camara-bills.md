# Projetos de lei

Fontes: arquivos anuais oficiais `proposicoes-AAAA.csv` e `proposicoesAutores-AAAA.csv` em dadosabertos.camara.leg.br. Dois passes, originais cifrados, resultado apenas para revisão.

## Regras

- Tipos: PL, PLP e PEC.
- Proponente e coautoria vêm do campo `proponente`. A ordem de assinatura é guardada e não define autoria.
- Autor sem `idDeputadoAutor` (Senado, comissão, Executivo) não vira pessoa.
- Situação é a descrição da fonte na data da captura. Nada é inferido a partir dela.
- Quantidade de projetos não mede qualidade.
- A fonte marca mais de um proponente em alguns projetos. `joint` conta as propostas com proponente múltiplo; não trate `proposed` como autoria solo.
- Norma resultante: só quando a situação é exatamente "Transformado em Norma Jurídica" e o despacho oficial traz o tipo e o número. PL gera lei ordinária, PLP lei complementar e PEC emenda constitucional; outro tipo, ou mais de uma norma citada, fica `unresolved`.

## Retenções

Ficam fora das contagens, com a evidência preservada: ano do número diferente do ano da apresentação (há registros do arquivo de 2025 apresentados em 2003), sem linha de autor, autor repetido, URI de autor de outra pessoa e indicador de proponente inválido.

## Publicação

`npm run publish:bills -- --run ID [--run ID...]` junta os anos, grava a versão inativa na tabela `bills_v1` e reconta por pessoa a partir do banco. Só `--approve` ativa. Sem `DATABASE_URL`, `--approve` exige `--local`. A contagem no site só aparece com versão aprovada.

## Falta

Linha do tempo das tramitações para evidência no site e atualização recorrente dos projetos antigos ainda ativos. `publicationEligible` continua falso.
