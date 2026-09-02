# Design exports

Editable SVG snapshots of the clock page with the sidebar open, for reworking
the layout in a vector editor and handing the result back as a reference.

- `clock-sidebar-light.svg`
- `clock-sidebar-dark.svg`

Both are 1440×900 captures of the real page, not redrawings, so what is in
them is what the browser paints.

## Re-exporting

```sh
design-exports/tools/export-svg.sh                    # both themes, 1440x900
design-exports/tools/export-svg.sh --theme dark
design-exports/tools/export-svg.sh --size 1280x800
```

Needs node (22+, for the built-in `WebSocket`), python3, and Chrome —
no npm install. Set `CHROME=/path/to/chrome` if it is not in the usual place.
The script serves `clock-extension/` on a local port, drives a headless Chrome
over the DevTools protocol, and tears both down when it finishes.

## What is in the file

- **The clock face** is genuine SVG, lifted from `#clock` in `index.html` with
  every CSS-derived fill and stroke inlined as an attribute, so it stands on
  its own without the stylesheet. Ids are kept (`day-wedge`, `numerals-day`,
  `hand-hour`, `wake-sleep-lines`, `sun-icon`, …), as are the day/night clip
  paths and the moon-phase mask. The whole face sits in one group scaled from
  its 440×440 viewBox, so it moves and scales as a unit.
- **Everything else** — sidebar, toggle tab, readout — is HTML in the real
  page, so it is rebuilt here as rects and `<text>`. Text stays live text at
  its measured baseline, in IBM Plex Sans; install the fonts from
  `clock-extension/fonts/` if your editor does not have them, or glyph widths
  will shift.
- **Form controls** (selects, number and time inputs, checkboxes, radios) are
  redrawn as shapes. Chrome paints those internally, so there is nothing in
  the DOM to copy — the rounded rect, the label, and the chevron, tick or dot
  are drawn to match what it shows.
- **Group names** follow the DOM: each `<g>` carries the element's id or its
  first class as both `id` and `data-name`, so Illustrator, Figma and Inkscape
  all show a layer tree that lines up with the markup.

The seconds hand, the digital readout and the date are frozen at whatever
moment the capture ran.
