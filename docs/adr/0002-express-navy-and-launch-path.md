# ADR 0002 — Express Navy identity and launch path

Date: 27 November 2026 · Status: accepted (identity), proposed (hosting budget)

## Context

The miniature-railway concept and the sage palette from ADR 0001 were rejected on 27 November 2026.
Three professional directions were compared; **Direction A, Express Navy**, was approved.

## Decisions

### Identity

| Role | Token | Hex | Contrast |
| --- | --- | --- | --- |
| Brand, headings, nav bars | `navy` / `ink` | `#0B1F3A` | 16.5:1 on white |
| Primary action | `primary` | `#16335C` | white text 12.6:1 |
| Links, focus ring, info | `signal` | `#2357B5` | 6.8:1 on white |
| Accent line (never text) | `saffron` | `#E8731A` | 3.0:1, decoration only |
| Saffron as text | `saffron-text` | `#B5530E` | 5.0:1 |
| Page background | `ivory` | `#F4F5F2` | — |
| Panels | `surface` | `#FFFFFF` | — |
| Secondary text | `muted` | `#4A5562` | 7.6:1 |
| Icons, field borders | `steel` | `#6B7480` | 4.7:1 (meets 3:1 for UI boundaries) |
| Rules | `line` | `#D5DAE1` | decorative only |
| Success / warning / error | | `#1E7A46` / `#8A5A00` / `#C62828` | 5.4 / 5.9 / 5.6:1 |

Typography: IBM Plex Sans (interface and headings, semibold) and IBM Plex Mono (times, train
numbers, references), self-hosted from `@fontsource`. Small radii (4–6 px), borders over shadows,
no gradients.

### Logo

An original symbol (a journey line from an origin ring to a saffron destination node, forming a
"P") and wordmark. Construction and animation: [docs/brand.md](../brand.md).

### Motion (revised 27 Nov 2026)

Motion is a larger part of the experience: logo intro, staggered hero entrance, scroll reveals,
layered parallax in landscape scenes, map camera moves, route draw-on and a journey indicator,
ticket reveal, chart and card transitions. GSAP was considered and not adopted: the same effects
are achieved with native IntersectionObserver/requestAnimationFrame and CSS, with no extra
download, and Motion keeps the app's page transitions. Lenis stays removed (no scroll hijacking).
Everything is disabled under `prefers-reduced-motion`. Details: [docs/brand.md](../brand.md).

### Maps (built 27 Nov 2026)

MapLibre GL JS with OpenFreeMap vector tiles (no key, no usage fees, provided as-is). Public
pages add an OpenRailwayMap overlay showing real track geometry; signed-in pages do not, because
its terms allow only public, registration-free use. Journey lines are straight dashed segments
between stops, labelled "Schematic route, not track geometry"; tracing real OSM rail geometry per
route is future work. Station positions are approximate and say so. A simplified map with the same
controls is shown when WebGL or the tile service is unavailable. Google Maps is not used because it
needs a billing account. Component: `src/features/map/RailMap.tsx`; data: `GET /api/v1/stations/map`.

### Hosting

Free tiers are acceptable for **staging** only: free Render web services sleep after 15 minutes,
background workers have no free tier, and free Postgres expires after 30 days with no backups.
**Production** needs at least an always-on web service and a paid database (about USD 13–20 a
month on Render). Not purchased; awaiting the owner's approval.

## Consequences

- Every component uses the tokens above through Tailwind theme classes; no hex values in components.
- The design-system unit test fails if `tokens.ts` and `index.css` drift apart.
- Real photography can replace the drawn landscape scenes once licensed images are chosen (`docs/attribution.md`).
