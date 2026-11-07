# Clareia

Portal de investigação cidadã sobre política brasileira. Protótipo em português com três direções visuais: **Investigação**, **Explorador** e **Editorial**.

**O MVP visual em `mvp/` usa dados fictícios.** A busca demonstrativa usa regras locais, sem IA conectada. Não usar esses exemplos como informação sobre pessoas reais.

Há também um **[piloto com dados oficiais](real/README.md)** em `real/`, separado do MVP: TypeScript, PostgreSQL local, três deputados e dois meses de lançamentos CEAP. A fonte principal é o arquivo anual da Câmara, com discrepâncias da API documentadas.

## Piloto real

```sh
npm ci
npm run collect
npm run dev
```

Abra http://127.0.0.1:4174. No workspace em que a coleta já foi feita, basta `npm run dev`. Encerre o servidor antes de uma nova coleta. Consulte [instruções, testes e limites](real/README.md).

## Executar

Com Node.js instalado, na raiz do repositório:

```sh
node mvp/server.mjs
```

Abra http://127.0.0.1:4173/?modelo=editorial. Os outros modelos continuam acessíveis pelos links no README do MVP.

## Documentação

- [Índice dos planos para agentes](<for agents/README.md>)
- [Direção da plataforma](<for agents/DIRECAO-DA-PLATAFORMA.md>)
- [Design e UX](<for agents/DESIGN-UI-UX.md>)
- [Mapas e gráficos: implementado e próximos passos](<for agents/MAPAS-E-GRAFICOS.md>)
- [Proposta de stack futura](<for agents/STACK-TECNICA.md>)
- [Plano de coleta e atualização contínua](<for agents/PLANO-COLETA-E-ATUALIZACAO.md>)
- [Plano de ingestão e qualidade dos dados oficiais](<for agents/PLANO-DADOS-REAIS.md>)
- [Matriz de validação dos dados reais — a implementar](<for agents/MATRIZ-DE-VALIDACAO.md>)
- [MVP, funcionalidades e verificação](mvp/README.md)

O MVP é HTML/CSS/JavaScript sem build. A coleta e o backend reais usam TypeScript; a migração visual para React/Next.js continua proposta. Favoritos do MVP ficam somente no navegador. Não há envio de notificações nem agendamento de produção instalado.

## Verificar

Com o servidor ativo, Playwright e seu Chromium instalados:

```sh
node mvp/verify.cjs
node mvp/verify-portal.cjs
node mvp/verify-discovery.cjs
```

Os relatórios e screenshots são gerados em `output/qa/` e não são versionados. As referências visuais e a origem das imagens estão em `mvp/assets/README.md`.
