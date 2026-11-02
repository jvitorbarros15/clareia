# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Register

brand (editorial). The public home is a showcase where design carries the product; exploration surfaces (rankings, charts, records) follow product rules inside it.

## Users

Brazilian citizens who want to understand and follow their representatives, most of them without Legislative vocabulary and many on a phone. Their job: find a politician, see what they spend and propose, and reach the official record behind a number.

## Product Purpose

Clareia (provisional name) turns official public data about Brazilian politicians into answers people can verify. Promise: "Entenda quem te representa, o que faz e como usa o dinheiro público." Success means a visitor understands what a ranking measures, recognizes the period, and can go from a portrait or a number to the records that sustain it.

## Positioning

Every interesting number carries its own proof: "Como chegamos nisso?" opens the formula, the universe, the period, the records and the official source. The search works as an investigation assistant, and rankings are interactive discoveries rather than verdicts.

## Operating Context

Product language is Brazilian Portuguese, with BRL values and Brazilian date formats. First scope under evaluation: federal deputies (Câmara dos Deputados), quota reimbursements and bills presented. Sources: Câmara open data, Senado, TSE, Portal da Transparência.

## Capabilities and Constraints

- The current demo (`mvp/`) uses fictional people, parties, values and generated portraits; it has three design models (investigação, explorador, editorial), selected with `?modelo=`.
- The editorial model is the chosen direction to polish first (decided 2026-11-01).
- Missing data shows as "indisponível", never as zero. Rankings say exactly what they order and never award "melhor/pior/mais honesto".
- Votações, emendas, eleições and patrimônio are not yet covered; the UI must state gaps instead of filling them.
- AI answers must reuse the portal's metric definitions; numbers come from reproducible queries.

## Brand Commitments

Personality: clara, confiável, acolhedora. Decorative colors carry no political meaning (no party colors, no left/right coding). Name and identity are provisional until availability is checked.

## Evidence on Hand

Fictional sample of 12 deputies and fictional portraits in `output/retratos-ficticios.*` and `mvp/assets/`. No real people, testimonials, press or usage numbers exist; none may be fabricated.

## Product Principles

1. Every number answers: what it measures, which period, where it came from, when it was updated.
2. Progressive disclosure: summary, then chart, then records, then source.
3. People first: faces and names open the exploration, without moral labels.
4. State the gap instead of guessing.
5. Works on a phone and for someone new to the Legislative.

## Accessibility & Inclusion

Keyboard navigation, text alternatives to charts, essential actions available without hover, readable contrast for non-specialist and older audiences, `prefers-reduced-motion` respected.
