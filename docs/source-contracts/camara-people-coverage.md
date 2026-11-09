# Cobertura mensal de pessoas

Versão publicável de exercício, partido e UF por competência, derivada do histórico da API e cruzada com o XML legado. O identificador vem só do conteúdo publicado: reprocessar fontes idênticas não cria versão nova.

## Quando um mês não publica partido ou UF

- As fontes divergem sobre o exercício, ou o cruzamento não pôde ser feito.
- Só uma fonte relata uma troca de partido: o mês da troca e os seguintes ficam sem partido. A UF continua.
- Eventos simultâneos conflitantes: vale a partir do mês do conflito.
- Depois do último estado conhecido há evento de outra legislatura que diverge dele.

Mês com mais de um partido lista os partidos sem escolher um. Mês de escopo parcial traz `partialScope`.

## Aprovação

`npm run publish:people -- --history-run ID --legacy-run ID` grava a versão inativa e audita. Sem `--approve` o site não muda. Uma auditoria que falha fica registrada como `failed` e retira a versão.

O build agendado restaura o banco do R2. Para valer em produção, aprove com `DATABASE_URL` apontando para o banco restaurado e salve o estado com `npm run db:state`. Sem `DATABASE_URL` a aprovação exige `--local` e só afeta o banco local.
