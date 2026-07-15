# Dashboard hero building photos

Each project's building photo shows on the dashboard hero card and in the
"Choose a project" picker cards.

Preferred format is **.webp** (much smaller — pages load far faster), named
after the project ID:

| Project                         | File name                           |
|---------------------------------|-------------------------------------|
| Natuzzi Harmony Residences      | natuzzi-harmony-residences.webp     |
| Peace Avenue                    | peace-avenue.webp                   |
| Peace Lagoons - A               | peace-lagoons-tower-a.webp          |
| Peace Lagoons - B               | peace-lagoons-tower-b.webp          |
| Peace Lagoons II - A            | peace-lagoons-ii-tower-a.webp       |
| Peace Lagoons II - B            | peace-lagoons-ii-tower-b.webp       |
| Sky Line                        | sky-line.webp                       |
| Sky Livings                     | sky-livings.webp                    |
| Sky Suites                      | sky-suites.webp                     |
| Sky Vista                       | sky-vista.webp                      |

The default "All units" hero uses **../hero.webp** (in the `photos/` folder).

Notes:
- **You can still upload a `.png`** — the card loads `<id>.webp` first, then
  `<id>.png`, then the brand texture, so a PNG upload will show. But WebP is
  strongly preferred; ping me and I'll convert any PNG you add down to a small
  WebP (a 3.5 MB PNG becomes ~0.4 MB with no visible quality loss).
- Portrait renders of the whole building work well; the cards crop to the
  lower part (entrance/podium).
