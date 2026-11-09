<p align="center">
  <img src="real/icon-192.png" width="88" height="88" alt="Ícone do Clareia">
</p>

<h1 align="center">Clareia</h1>

<p align="center"><strong>O poder, em números.</strong><br>Explore despesas parlamentares. Compare recortes. Confira as fontes.</p>

<p align="center">
  <a href="https://github.com/jvitorbarros15/clareia/actions/workflows/ci.yml"><img src="https://github.com/jvitorbarros15/clareia/actions/workflows/ci.yml/badge.svg?branch=main" alt="Status do CI na main"></a>
</p>

<p align="center">
  <a href="#o-projeto">O projeto</a> ·
  <a href="#dados-e-metodologia">Metodologia</a> ·
  <a href="#rodar-localmente">Rodar localmente</a> ·
  <a href="#contribuir">Contribuir</a>
</p>

---

## O projeto

O **Clareia** transforma dados públicos sobre representantes brasileiros em uma experiência de investigação acessível, em português. A proposta é aproximar a pergunta da evidência: encontrar um número, entender o contexto e chegar aos registros que o compõem.

A interface combina direção editorial, retratos, gráficos interativos e a pergunta **“Como chegamos nisso?”**. Hoje, o foco são as despesas da Cota para o Exercício da Atividade Parlamentar (CEAP) da Câmara dos Deputados.

### O que você pode explorar

| Recurso | Experiência |
| --- | --- |
| **Busca investigativa** | Perguntas como “Quem mais gastou com passagens?” e comparações entre os representantes da amostra. As respostas usam regras locais sobre os registros publicados. |
| **Comparações interativas** | Ordenação por despesas, comparação lado a lado e filtros de categoria para entender como o resultado muda. |
| **Gráficos conectados** | Composição das despesas, evolução mensal e destaques por categoria, com valores e registros acessíveis a partir da interface. |
| **Atlas de representantes** | Mapa de hexágonos por UF de representação. Não indica onde o dinheiro foi gasto. |
| **Evidências e exportação** | Painéis “Como chegamos nisso?”, consulta dos lançamentos, referências oficiais e download em CSV. |
| **Acompanhamento pessoal** | Perfis salvos no navegador, sem conta. Interface responsiva e ícones para adicionar o site à tela inicial no iOS e Android. |

### Cobertura atual

Esta `main` contém um **piloto com dados reais de três deputados, em janeiro e fevereiro de 2025**, na legislatura 57. O recorte está definido em [`config/pilot.json`](config/pilot.json).

- A amostra é técnica: as ordenações não representam um ranking nacional.
- Os valores medem despesas registradas na CEAP no período, não o custo total nem a qualidade de um mandato.
- Partido e UF exibidos nesta versão vêm do cadastro consultado na coleta; a atribuição histórica por competência ainda está em desenvolvimento.
- Projetos, votações, eleições, patrimônio e emendas ainda não têm dados publicados nesta versão.
- A busca atual não usa um modelo de IA ou RAG. O acompanhamento salva favoritos localmente, sem enviar notificações.

O coletor da `main` restringe o piloto a três IDs e dois meses. Ampliar a cobertura exige validar o pipeline; não basta alterar a configuração.

## Dados e metodologia

**Todo número precisa de um caminho até a fonte.** O pipeline preserva a origem dos registros, trabalha com valores em centavos e mantém versões das publicações.

1. **Coletar e conferir estabilidade.** A API é consultada em dois passes, com tamanhos de página diferentes; o arquivo anual também é capturado duas vezes.
2. **Conciliar as fontes.** As ocorrências são pareadas por identidade, competência, documento, categoria e valor, com conferência adicional de número, emissão e lote. Registros presentes em apenas uma fonte seguem regras explícitas.
3. **Preservar o significado.** Ajustes negativos mantêm o sinal. Campos ausentes permanecem desconhecidos. Ocorrências ambíguas e divergências retêm a nova publicação para revisão.
4. **Recalcular antes de ativar.** Uma segunda implementação relê os originais preservados e compara os resultados com o banco. Somente versões com auditoria aprovada podem ficar ativas.
5. **Gerar o site.** A interface recebe arquivos estáticos da versão aprovada, com referências às fontes e exportações dos registros.

A segunda implementação ajuda a detectar diferenças de processamento. Ela compartilha regras metodológicas com o coletor e **não constitui uma revisão independente dessas regras**, nem comprova completude da fonte ou legitimidade de uma despesa.

Fornecedores pessoa física são apresentados como “Fornecedor pessoa física”. Os originais ficam fora do Git e do diretório público. Na automação, originais arquivados e cópias do banco recebem criptografia AES-256-GCM, e o site gerado e o dump do banco passam por uma varredura de CPF antes da persistência da nova cópia.

Fontes utilizadas: [API de Dados Abertos da Câmara](https://dadosabertos.camara.leg.br/api/v2/api-docs) e [arquivo anual CEAP de 2025](https://www.camara.leg.br/cotas/Ano-2025.csv.zip). As [notas técnicas do piloto](real/README.md) registram a conciliação, capturas anteriores e limitações encontradas; os dados servidos em cada build são identificados pelo seu `manifest.json`.

## Rodar localmente

**Requisitos:** Git, Node.js 22 ou superior, npm e acesso à internet para a primeira coleta. O modo local usa PostgreSQL embarcado via PGlite; não exige configurar um servidor de banco ou Cloudflare R2.

```sh
git clone https://github.com/jvitorbarros15/clareia.git
cd clareia
npm ci
```

Colete o recorte, confira os originais e gere a primeira versão do site, avançando apenas quando cada comando concluir com sucesso:

```sh
npm run collect
npm run verify:annual
npm run build:site
npm run dev
```

Abra **[http://127.0.0.1:4174](http://127.0.0.1:4174)**.

`collect` grava uma versão candidata. `verify:annual` registra a auditoria que permite sua ativação. `build:site` gera `dist/` a partir da versão ativa; `dev` apenas serve essa pasta, sem recompilar automaticamente. Se ainda não houver uma versão aprovada, o build recusa a publicação.

O banco local fica em `data/local/postgres`; as capturas da coleta, em `data/runs/`. Ambos são ignorados pelo Git. Após editar a interface, execute `npm run build:site` novamente e recarregue a página. Interrompa o servidor antes de repetir a sequência de coleta, auditoria e build.

### Configuração opcional

| Variável | Uso |
| --- | --- |
| `PORT` | Porta do servidor local. Padrão: `4174`. |
| `DATABASE_URL` | Conexão com PostgreSQL externo. Se ausente, usa PGlite local. |
| `TEST_DATABASE_URL` | Banco PostgreSQL externo para testes de integração; configurado no CI. |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Arquivamento e restauração no Cloudflare R2. O fluxo local básico não depende dessas variáveis. |
| `CLAREIA_VAULT_KEY` | Chave de 32 bytes codificada em base64 para os arquivos cifrados no armazenamento remoto. |

Veja [`.env.example`](.env.example). As variáveis precisam estar no ambiente do processo: arquivos `.env` não são carregados automaticamente. Configure credenciais da automação nos secrets do GitHub.

## Desenvolvimento e verificações

Para verificar o código, sem fazer uma nova coleta:

```sh
npm run typecheck
npm test
```

Para conferir os dados locais coletados:

```sh
npm run verify:annual
npm run verify:api-annual
```

Para testar a interface, instale a dependência opcional de navegador e mantenha `npm run dev` ativo em outro terminal:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run verify:browser
npm run verify:ui
```

Os testes de navegador conferem valores contra os arquivos publicados, navegação até os registros, exportação e comportamento da interface em diferentes larguras. Relatórios e capturas de tela ficam em `output/qa/`, fora do Git.

## Arquitetura

O processamento acontece antes da publicação. A navegação pelo site gerado não precisa consultar um banco ou a API da Câmara a cada visita.

```mermaid
flowchart LR
    A["Fontes oficiais: API + CSV"] --> B["Coleta e conciliação"]
    B --> C["Versão candidata no PostgreSQL"]
    C --> D["Releitura dos originais"]
    D -->|Aprovada| E["Versão ativa"]
    D -->|Divergência| F["Retida para revisão"]
    E --> G["Build estático em dist/"]
    G --> H["Portal no navegador"]
```

| Camada | Tecnologias |
| --- | --- |
| Interface | HTML, CSS e JavaScript, com gráficos SVG e fontes locais. |
| Coleta e processamento | TypeScript sobre Node.js; Zod, `csv-parse` e `fflate`. |
| Persistência | PostgreSQL; PGlite no ambiente local e `pg` para banco externo. |
| Build | esbuild e geração de HTML, JavaScript, JSON e CSV estáticos. |
| Qualidade | TypeScript, executor de testes do Node.js, Playwright e GitHub Actions. |
| Arquivamento | Cloudflare R2 e criptografia AES-256-GCM. |

### Organização do repositório

```text
clareia/
├── real/                Interface, ícones, fontes e retratos
├── src/                 Coleta, conciliação, banco, publicação e servidor local
├── scripts/             Auditorias, build e verificações de navegador
├── tests/               Testes automatizados
├── config/              Recorte do piloto
└── .github/workflows/   CI e automações de coleta
```

`dist/`, `data/` nas pastas de execução e `output/qa/` são artefatos locais; não fazem parte da distribuição do código.

### Atualização e publicação

O [workflow de coleta](.github/workflows/collect.yml) está definido para três execuções diárias, além da execução manual. Ele restaura o banco cifrado do R2, verifica alterações, coleta, gera o site e preserva o estado. A auditoria da nova versão depende da variável de repositório `PUBLISH_ENABLED=true`.

Na `main`, `--if-changed` verifica a impressão digital do **arquivo anual**: uma mudança apenas na API ainda não dispara uma nova coleta. Portanto, a agenda não equivale a uma garantia de atualização de todas as fontes.

O build produz `dist/` para hospedagem estática. O workflow de coleta atual não faz deploy desse diretório; configurar a hospedagem é uma etapa separada. O [CI](.github/workflows/ci.yml) executa a checagem de tipos e os testes em pushes e pull requests.

## Evolução da plataforma

A expansão segue a validação das fontes e das regras de cada domínio:

1. Consolidar o universo histórico de representantes, períodos de exercício, partidos e UFs por competência.
2. Ampliar as despesas de 2025 e implementar a atualização de 2026, com ciclos próprios para API e arquivo anual.
3. Integrar projetos de lei, autoria e tramitação.
4. Integrar votações nominais, conciliando cada categoria de voto com o placar oficial.
5. Integrar emendas, com identificação revisada dos autores e distinção entre ano da emenda, execução e pagamento.

Resumos prontos e carregamento dos registros sob demanda fazem parte da preparação para um universo maior. A busca com IA e RAG é uma direção futura: respostas numéricas deverão vir de consultas verificáveis, com contexto e fontes explícitas.

## Contribuir

Abra uma [issue](https://github.com/jvitorbarros15/clareia/issues) com o comportamento observado, o recorte e, quando disponível, a versão e a referência oficial. Para mudanças na interface, inclua a largura da tela e uma captura; para mudanças nos dados, descreva a regra e um caso que permita reproduzi-la sem expor identificadores pessoais.

Pull requests devem explicar o problema, o comportamento resultante e a verificação realizada. Mudanças metodológicas precisam preservar a rastreabilidade e manter casos incertos explícitos. Execute `npm run typecheck` e `npm test` quando alterar código, acrescentando verificações de navegador para mudanças de interação.

O protótipo com dados fictícios está preservado na tag [`mvp-final`](https://github.com/jvitorbarros15/clareia/tree/mvp-final). A interface atual consome as publicações reais aprovadas.
