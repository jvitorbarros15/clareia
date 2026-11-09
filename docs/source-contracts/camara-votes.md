# Votações

Fontes: arquivos anuais oficiais `votacoes`, `votacoesVotos` e `votacoesProposicoes`. Dois passes, originais cifrados, resultado apenas para revisão.

## Regras

- Sim e Não são conferidos contra o placar declarado de cada um. As demais categorias só têm um total conjunto na fonte (`votosOutros`): cada categoria mantém o nome original e não é interpretada individualmente.
- Voto vazio não é abstenção, ausência nem voto contrário: a votação fica retida.
- Voto registrado não é presença ou falta.
- Votação sem voto individual e sem placar não é nominal. Placar declarado sem votos individuais fica retido.
- A proposição afetada vem de `votacoesProposicoes`. O arquivo de objetos lista tudo que estava em discussão no evento e não diz o que foi votado.
- Tipo da votação, lido só da descrição oficial: mérito, requerimento, emenda ou destaque, e outro. O que não for claro fica em outro.
- Isto mostra como cada deputado votou. Não é ligado a despesas nem vira custo por voto.

## Falta

Nada: a publicação existe (`npm run publish:votes`) e só `--approve` ativa.
