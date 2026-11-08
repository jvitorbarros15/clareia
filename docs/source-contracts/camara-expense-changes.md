# Diferenças entre capturas financeiras

**Após a [revisão externa](precision-review-2026-11-08.md):** relatórios com as regras antigas de parcelas/multiplicidade são recusados na releitura. O histórico de comparação ao fim deste arquivo descreve a execução anterior à correção. A versão atual tem 13 competências retidas; compará-la consigo mesma não produz diferença total zero, e sim total indisponível com 179 competências comparáveis e 13 não comparáveis.

Continuação da [carga intermediária](camara-expense-intermediate.md). A ferramenta produz evidência privada para revisão de versões; não escreve no banco, não altera uma publicação e não busca dados na rede.

```sh
npm run compare:expenses:intermediate -- --local --before-run ID --before-version SHA256 --after-run ID --after-version SHA256
```

Cada versão é um relatório completo preservado em `reports/<SHA256>.batch.json`. O comando confere o hash, a entrada de seleção/temporal e **executa novamente a auditoria dos originais** das duas versões. Um status `passed` copiado de outro relatório não dispensa a releitura. Locks protegem as execuções e são adquiridos em ordem; uma mesma execução é bloqueada uma vez só. Versão ou origem inválida não gera uma comparação aprovada.

O resultado fica em `data/private/expense-comparisons/<id>.json`, com os hashes exatos das duas versões, motivos e diferenças por pessoa/competência. Sua identidade exclui somente o instante de criação. Repetir a mesma comparação confere o arquivo existente, sem sobrescrever sua evidência. A saída tem sempre `status=review-required` e `publicationEligible=false`.

## Comparar valores sem criar falsas retiradas

1. Os escopos precisam ter a mesma legislatura, ano, conjunto de IDs e meses. Ampliar de três para 16 pessoas ou de 16 para o universo nacional exige uma comparação explícita de escopos em outra etapa; não se chama de retirada o que ficou fora do recorte.
2. Uma competência só permite comparação financeira quando as duas versões estão completas ou sem despesas confirmadas. Falha, retenção e lacuna têm listas de adições/remoções e diferença **nulas**, nunca zero. Os valores conhecidos de cada lado aparecem separadamente; sem todas as competências comparáveis, não há diferença total geral.
3. A comparação é de multiconjuntos: documento, número, categoria, valores financeiros conhecidos/desconhecidos, emissão civil, lote e fornecedor quando há CNPJ validado. Identidade desconhecida de fornecedor não é resolvida por nome ou CPF. Nenhuma linha é deduplicada.
4. ID derivado do bruto, ordem, página, posição e relógio não identificam uma retirada financeira. “Não informado” e vazio nos campos de documento/número têm a mesma semântica usada na conciliação. Trocar representação ou repaginar pode mudar a evidência sem mudar os valores.
5. Uma assinatura financeira que saiu e outra que entrou são mostradas separadamente, com contagem e centavos originais. Isso **não prova** correção de um mesmo pagamento nem retirada bancária: o documento pode ter várias ocorrências, metadados podem ter sido completados e as fontes podem compartilhar um erro. Não há pareamento por documento, nome, proximidade de valores ou posição para inventar uma ligação entre versões.
6. Negativos continuam assinados. Retirar uma linha de -R$ 50 aumenta o total em R$ 50; não é retirada de uma despesa positiva. Acumulação e diferenças usam `BigInt`, serializadas como strings de centavos.

Quando o multiconjunto financeiro permanece igual, diferenças nos campos públicos dos registros são sinalizadas como metadados. Cobertura compara estados, exercício e valores de partido/UF, ignorando apenas posições das linhas de evidência. Mudanças na versão de pessoas, na seleção, nas regras ou nos hashes das fontes também são motivos de revisão. Concordância dos totais não dispensa esses controles.

## Política para a integração de publicação

Este incremento implementa detecção e relatório; a publicação intermediária continua indisponível. A integração SQL deverá exigir auditorias correspondentes às versões exatas e uma decisão registrada para mudanças financeiras, de cobertura, de dependências ou de regras, com motivo e evidências. A decisão precisa se vincular aos hashes de antes/depois e da comparação; não valerá para uma captura posterior por coincidência de total. O site mantém a versão anteriormente aprovada quando a candidata falha ou sua cobertura está incompleta.

A publicação própria de pessoas, essa integração da política/SQL e os resumos ainda precisam ser implementados. O novo comando não cria um atalho de aprovação nem modifica o `--accept-removed` do piloto antigo. Uma comparação sem diferenças não libera, sozinha, uma versão intermediária.

## Verificação real em 08/11/2026

Comparação de duas versões preservadas da execução `expenses-2025-intermediate-20261108`: uma com os três meses SIGEPA ainda retidos, outra após a corroboração oficial. Ambas passaram na releitura independente. Resultado: 189 competências comparáveis, três não comparáveis com cobertura nova, nenhuma retirada/adição financeira inferida e diferença total geral indisponível. Os 329 registros antes retidos não são tratados como um aumento de despesa.

Comparar uma versão consigo mesma permite os 192 recortes e diferença zero. Testes cobrem alteração exclusiva da API (na coleta), multiplicidade, negativos, cobertura ausente, campos históricos, mudança de fonte, representação/posição, escopos incompatíveis, falsificação de totais/hashes e locks.

Typecheck e 190 testes passaram. A comparação real foi repetida, conservando a identidade e o relatório anterior; a comparação da versão atual consigo mesma também foi executada com releitura dos originais: 192 competências comparáveis, nenhuma mudança e diferença de zero centavos. Logs em `output/qa/expense-changes-real.log`, `expense-changes-repeat.log`, `expense-changes-self.log` e `expense-changes-full-tests.log`.
