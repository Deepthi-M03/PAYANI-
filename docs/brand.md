# PAYANI brand

## Symbol

A single journey drawn as one line: it leaves an **origin** (the ring at the foot), climbs,
and loops round to arrive at a **destination** (the saffron node). Together they form a "P".
The line is the route; the two nodes are the stations at either end.

- Construction: 48 × 48 grid. Route path `M15 41V17.5a9.5 9.5 0 0 1 9.5-9.5h4a10.5 10.5 0 0 1 0 21H24`,
  stroke 5, round caps and joins. Origin ring r 3.4, stroke 2.4. Destination node r 4.6, Saffron `#E8731A`.
- Clear space: at least half the symbol's height on every side.
- Minimum size: 16 px (favicon), 24 px in interfaces.

## Wordmark

`PAYANI` in IBM Plex Sans SemiBold, letter-spacing 0.2 em, beside the symbol. Navy `#0B1F3A` on light
backgrounds, white on navy. Files: `frontend/public/logo-light.svg` (for light backgrounds),
`logo-dark.svg` (for navy), `favicon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
`apple-touch-icon.png`. In code: `Logo` and `LogoMark` in `src/design-system/Logo.tsx`.

## Logo animation

1. The route draws from origin to destination (900 ms, `cubic-bezier(.2,0,0,1)`).
2. The destination node lands with a slight overshoot (420 ms, starting at 760 ms).
3. The letters rise in one after another (55 ms apart).

Used by the boot screen (`index.html`, first visit per session, about 1.2 s), the public header,
the sign-in panel, the closing call to action and the route-level loader. Under
`prefers-reduced-motion` the logo appears complete with no movement.

## Motion system

| Layer | Tool | Examples |
| --- | --- | --- |
| Page transitions in the app | Motion (`motion/react`) | 320 ms fade and rise on route change |
| Entrances and micro-interactions | CSS keyframes and transitions | hero words, cards, ticket reveal, chart bars, button press |
| Scroll reveals and parallax | IntersectionObserver + requestAnimationFrame (`src/motion/reveal.tsx`) | landing sections, landscape layers |
| Maps | MapLibre camera (`fitBounds`), route draw-on and a one-pass journey indicator (`src/features/map`) | search results, landing hero, booking route |

Rules: nothing hijacks scrolling; nothing delays an action; animations run only while visible;
every one is disabled under `prefers-reduced-motion`.
