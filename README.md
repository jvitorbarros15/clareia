# Clareia

Portal de investigação cidadã sobre política brasileira. Protótipo em português com três direções visuais: **Investigação**, **Explorador** e **Editorial**.

**Os perfis, valores, projetos e votos do MVP são fictícios.** A busca usa regras locais; não há IA, API oficial ou banco de produção conectado. Não usar os exemplos como informação sobre pessoas reais.

## Executar

Com Node.js instalado, na raiz do repositório:

```sh
node mvp/server.mjs
```

Abra http://127.0.0.1:4173 e escolha o modelo no topo. Também é possível abrir `mvp/index.html` diretamente; o servidor oferece comportamento mais consistente para links e armazenamento local.

## Documentação

- [Direção da plataforma](DIRECAO-DA-PLATAFORMA.md)
- [Design e UX](DESIGN-UI-UX.md)
- [Mapas e gráficos: implementado e próximos passos](MAPAS-E-GRAFICOS.md)
- [Plano de ingestão e qualidade dos dados oficiais](docs/PLANO-DADOS-REAIS.md)
- [Matriz de validação dos dados reais — a implementar](docs/MATRIZ-DE-VALIDACAO.md)
- [Proposta de stack futura](STACK-TECNICA.md)
- [MVP, funcionalidades e verificação](mvp/README.md)

O MVP é HTML/CSS/JavaScript sem build. A proposta TypeScript/React/Next.js ainda não foi implementada. Favoritos ficam somente no navegador. Não há envio de notificações.

## Verificar

Com o servidor ativo, Playwright e seu Chromium instalados:

```sh
node mvp/verify.cjs
node mvp/verify-portal.cjs
node mvp/verify-discovery.cjs
```

Os relatórios e screenshots são gerados em `output/qa/` e não são versionados. As referências visuais e a origem das imagens estão em `mvp/assets/README.md`.
