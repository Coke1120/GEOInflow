# Liekan UI reference

## Theme
The supplied eleven HTML pages are the visual authority. White sidebar, pale #F5F7FA content surface, compact analytics layout.
## Palette
Ink #16181D, secondary #697386, faint #9AA3B2, divider #E9ECF1, brand #0F62FE, brand2 #4589FF, selected #EDF2FF, up #F04452, down #0E9F6E.
## Typography
Inter weights 400/500/600/700/800; original system Chinese fallbacks and tabular numbers. Exact sizes from reference.
## Components
Original inline SVG, 14px cards, 9px nav/chips, 22 ECharts 5.5.0 definitions. Preserve positions and headers.
## Layout
228px sidebar, resize 180–320px, content max 1200px, 32px horizontal padding.
## Depth
Use the original borders, badge fills and logo shadow; no new decorative surfaces.
## Do and do not
Componentize and bind real data. Preserve original source and UI. Keep management in existing button-triggered drawers. Never replace charts with upstream UI defaults.
## Responsive
Desktop fidelity at 1280/1440. Preserve existing desktop geometry; basic narrow-screen access at 768/390 without altering user browser viewport.
## Implementation guide
CSS Modules and scoped reference utilities, local fonts/charts. Independent contract and upstream adapter. Animations match original fade-in with reduced-motion support.
