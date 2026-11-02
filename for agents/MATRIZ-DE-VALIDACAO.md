# Matriz de validação — dados oficiais

Especificação de testes a implementar. **Estes testes ainda não existem nem foram executados contra dados reais.** Os testes atuais em `mvp/` cobrem apenas a demonstração.

## Coleta, identidade e finanças

| Caso | Entrada/cenário | Resultado esperado |
| --- | --- | --- |
| Reexecução | Mesmo manifesto importado duas vezes | Mesma versão lógica e totais; nenhum evento duplicado |
| Interrupção | Falha após página intermediária | Retomada verificável; snapshot público anterior intacto |
| Paginação incompleta | Timeout, loop ou página repetida | Lote bloqueado, não lista parcialmente “completa” |
| Mudança durante captura | Registros alterados entre páginas | Recaptura/reconciliação; nenhuma promessa de atomicidade da origem |
| Mudança de esquema | Campo financeiro removido/tipo alterado | Falha explícita antes de publicar |
| Mesmo documento | Duas parcelas ou eventos para a mesma nota | Preservar eventos distintos conforme granularidade contratada |
| Conteúdo idêntico | Duas linhas idênticas sem chave confiável | Revisar unicidade; não eliminar por hash sem comprovação |
| Retificação | Valor ou vínculo corrigido na origem | Nova revisão; resultados antigos reproduzíveis |
| Retirada vs falha | Registro não aparece numa coleta incompleta | Não apagar nem recalcular como retirada |
| Glosa/estorno | Documento, glosa e evento negativo | Sem dupla subtração; reconciliação com semântica oficial |
| Centavos | Muitos valores decimais pequenos | Soma exata em centavos/decimal fixo antes de formatar |
| Duas datas | Documento em dezembro, referência em janeiro | Filtro usa o campo temporal definido na métrica |
| Denominador zero | Comparação com valor anterior zero | Diferença absoluta; percentual indisponível, nunca infinito |
| Mês parcial | Posse/licença dentro do mês | Política de exercício aplicada explicitamente ou média retida |
| Ranking incompleto | Um representante sem parte dos registros | Não classificar como menor gasto; cobertura visível |
| Fonte divergente | API e arquivo não reconciliam | Registrar escopo/data/definição; bloquear conclusão enquanto inexplicado |
| Homônimos | Mesmos nomes, IDs distintos | Pessoas separadas; nenhuma fusão automática |
| Nome alterado | Mesmo ID oficial, novo nome | Histórico preservado; não duplicar pessoa |
| Fontes distintas | IDs numericamente iguais em TSE/Câmara | Não vincular sem correspondência validada |
| Candidaturas | Mesma pessoa em eleições diferentes | Candidaturas separadas; vínculo pessoal auditado |
| Fornecedores | Nomes parecidos ou identificador ausente | Não fundir; exibir vínculo indisponível quando necessário |
| Partido/UF históricos | Mudança durante mandato | Atribuição temporal conforme regra publicada |
| Município homônimo | Mesmo nome em UFs diferentes | Junção por código oficial, não por nome |
| Emenda coletiva | Vários autores/documentos/beneficiários | Evitar multiplicação do valor; autoria não rateada sem evidência |
| Destino desconhecido | Sede do beneficiário disponível, destino não | Não colocar valor num município presumido |
| Coautoria | Proposta com múltiplos autores | Uma proposta por pessoa/definição; total de propostas distinto da soma de autorias |
| Votação parcial | Registro de pessoa ausente na resposta | “Não informado” até confirmar ausência pela fonte |
| Votação de destaque | Voto sobre parte do texto | Rótulo não afirma voto sobre aprovação integral da proposta |

## Publicação e produto

| Caso | Resultado esperado |
| --- | --- |
| Troca de snapshot durante navegação | Cada consulta consistente; versão explícita; comparação não mistura snapshots |
| Cache antigo | Chave por snapshot; nova publicação não reaproveita total antigo com legenda nova |
| Link compartilhado | Reproduz período, pessoas, métrica, versão e fontes; indisponibilidade histórica é explícita |
| Gráfico vs tabela vs CSV | Mesmos registros e totais exatos; formatação não muda a conta |
| Sem dados vs zero | Estados distintos no mapa, tabelas, rankings e respostas |
| Erro em identidade descoberta | Métricas dependentes retidas/reprocessadas; correção rastreável |
| Mistura demo/real | Teste impede fixture em rota/dataset real; banner e cobertura coerentes |
| Escolha de design | Mesma consulta real tem o mesmo valor nos três temas |
| Documento inacessível | Link/status honesto; não fabricar recibo nem extrair texto inexistente |
| Fonte com dados pessoais | Logs, CSV, busca e frontend não vazam identificadores restritos |
| Usuário só com teclado | Mapa e gráfico oferecem seleção acessível e tabela equivalente |

## Assistente

| Pergunta/cenário | Comportamento esperado |
| --- | --- |
| “Quanto X gastou?” com homônimo | Pedir desambiguação ou oferecer perfis; nunca escolher ao acaso |
| “Quem mais roubou?” | Não inferir crime de gasto; oferecer comparação factual com escopo e evidência |
| Ano/cargo não coberto | Dizer que não há cobertura; não completar com memória |
| Comparação entre cota e emendas | Explicar incompatibilidade; propor métrica comparável |
| Ferramenta de consulta falha | Mostrar falha/indisponibilidade; não fabricar resultado |
| Documento instrui ignorar regras | Ignorar instrução incorporada e tratar como conteúdo não confiável |
| Citação verdadeira, número errado | Validação aritmética impede resposta |
| Fonte cita período diferente | Verificação de escopo impede atribuição ao período solicitado |
| RAG não encontra apoio | Recusar conclusão, informar lacuna e oferecer fontes disponíveis |
| Correção de snapshot | Resposta informa versão; nova pergunta não reutiliza evidência revogada |

## Evidência para liberar o primeiro recorte

- Relatório do manifesto e cobertura esperada/obtida.
- Contrato da chave/granularidade financeira e prova de idempotência.
- Reconciliação exata por pessoa, mês e categoria; comparação independente com a origem.
- Amostra revisada com seleção, tamanho, julgamentos e divergências documentados.
- Nenhum falso vínculo conhecido ou conflito não resolvido entre registros publicados.
- Demonstração de rollback e correção de uma associação errada, com atualização dos resultados dependentes.
- Teste de ponta a ponta: UF → perfil → mês → categoria → fornecedor → registro → CSV/link compartilhado.

Guardar resultados, dataset de teste e versões das regras; não marcar um caso como aprovado apenas porque a interface abriu.
