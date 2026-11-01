# Origem dos retratos

- `investigation.png`: cópia do esboço gerado na conversa. A interface exibe somente os recortes dos retratos por meio de viewports SVG.
- `concepts.png`: referência aprovada de Editorial/Investigação/Explorador, preservada para comparação visual.
- `portraits-editorial.png`: nova folha de três retratos fictícios transparentes, gerada com a ferramenta integrada **imagegen** a partir de `output/conceitos-editorial-investigacao-explorador.png`. Os recortes de cada pessoa são definidos na interface; a imagem original é preservada. Usada no Editorial e no Explorador.

## Prompt final dos retratos limpos

```text
Create a CLEAN PORTRAIT ASSET SHEET for implementing this approved website design. Use the supplied UI mockup ONLY as reference for the identities and poses of the three fictional adults visible in the LEFT Editorial panel and RIGHT Explorador panel. Recreate those SAME three fictional people as high quality photographic cutout assets, no UI whatsoever.

Output one landscape transparent PNG contact sheet consisting of exactly THREE equally wide vertical columns: first woman, second man, third woman. The canvas must have TRUE TRANSPARENT background throughout. Each portrait sits wholly inside its own third of the image without overlap, with a little transparent space above the full head and on the sides. All portraits extend from full head (no hair cutoff) down to mid-torso, with bottom torso aligned to image bottom. Preserve original photographic identities and slightly upward gaze.
LEFT THIRD: Ana, adult Brazilian woman with shoulder-length dark wavy hair, dark charcoal blazer over ivory ribbed top, looking slightly upward toward viewer's right, natural calm serious expression. Match the large black-and-white woman in the editorial reference, but generate natural color so CSS can desaturate it.
CENTER THIRD: Bruno, adult Brazilian man with short curly dark hair, black rectangular glasses, neatly trimmed full beard, dark charcoal business suit and white shirt, looking slightly upward toward viewer's right. Match right-panel male portrait.
RIGHT THIRD: Carla, adult Brazilian woman with voluminous tight dark curls, medium brown skin, warm off-white blouse, looking slightly upward toward viewer's right with quiet confidence. Match right-panel third portrait.
Professional editorial studio lighting, realistic natural skin, gentle shadows, chest-up portraits that can work on light OR charcoal backgrounds, highest feasible portrait detail. No text, no rankings, no numbers, no labels, no cards, no chart, no buttons, no borders, no circular crops, no existing UI remnants. ONLY the three isolated people on transparent background. Equal scale of heads across all columns, generous space around head silhouette. These are invented fictional people from the supplied generated reference, not actual politicians.
```
