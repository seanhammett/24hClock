# Implementation Plan: 24-Hour Analog Clock — Chrome New Tab Extension

## 1. Overview

A Chrome extension (Manifest V3) that replaces the new tab page with a large analog clock. The clock is unusual in two ways:

1. **The hour hand completes one full rotation per 24 hours** (not 12). **Noon (12:00) points straight up; midnight (00:00) points straight down.** The minute and second hands behave normally (one rotation per hour and per minute, respectively).
2. **The clock face is divided into a daylight slice (white) and a nighttime slice (dark blue)**, based on sunrise and sunset times computed from a location the user enters manually in a collapsible sidebar on the right.

Because the hour hand maps the full day onto one rotation, each time of day corresponds to exactly one fixed angle on the dial — which is what makes painting sunrise→sunset as a static "pie slice" meaningful.

## 2. Tech stack and constraints

- **Manifest V3**, using `chrome_url_overrides.newtab`.
- **Plain HTML/CSS/JavaScript** (no build step needed). Render the clock as **inline SVG** — SVG arcs make the day/night slices and tick marks far easier and crisper than canvas.
- **No remote code.** MV3 CSP forbids loading scripts from CDNs. All JS must be bundled in the extension. If a sunrise library is used (recommended: SunCalc, MIT license), vendor the file into the extension directory. Alternatively, implement the NOAA solar position algorithm directly (~60 lines).
- **No network calls required** if location is entered as latitude/longitude — sunrise/sunset is computed locally. (Optional stretch: city-name geocoding, see §8.)
- **Persistence** via `chrome.storage.local` (location + sidebar collapsed state). Requires `"permissions": ["storage"]`.

## 3. File structure

```
clock-extension/
├── manifest.json
├── newtab.html
├── css/
│   └── newtab.css
├── js/
│   ├── clock.js        # hand angles, rAF loop
│   ├── daynight.js     # sunrise/sunset → SVG arc paths
│   ├── sidebar.js      # sidebar UI, input handling, storage
│   └── suncalc.js      # vendored sunrise/sunset library
└── icons/
    ├── icon16.png, icon48.png, icon128.png
```

## 4. Manifest

```json
{
  "manifest_version": 3,
  "name": "24-Hour Day/Night Clock",
  "version": "1.0.0",
  "description": "New tab analog clock with a 24-hour hour hand and day/night shading.",
  "chrome_url_overrides": { "newtab": "newtab.html" },
  "permissions": ["storage"],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

## 5. Core math (get this exactly right)

Use a convention of **degrees clockwise from 12-o'clock-up**, applied via SVG `transform="rotate(angle cx cy)"` around the clock center.

Let `h`, `m`, `s`, `ms` be local time components.

**Hour hand (24-hour dial, noon at top, midnight at bottom):**

```js
const dayFraction = (h + m/60 + s/3600) / 24;   // 0 at midnight, 0.5 at noon
const hourAngle = (dayFraction * 360 + 180) % 360;
```

Sanity checks: 00:00 → 180° (down). 06:00 → 270° (left). 12:00 → 0°/360° (up). 18:00 → 90° (right). Time still advances clockwise.

**Minute hand (normal):** `minuteAngle = (m + s/60) / 60 * 360`

**Second hand (normal):** `secondAngle = (s + ms/1000) / 60 * 360` (using ms gives smooth sweep; use `Math.floor(s)`-based value instead if a ticking hand is preferred — make it smooth by default).

**Time → dial angle helper** (reused for sunrise/sunset markers): any time of day maps to the dial via the same formula as the hour hand. Encapsulate as `timeToAngle(date)` in one shared module so the hands and the slices can never disagree.

**Angle → SVG point:** with center `(C, C)` and radius `r`:

```js
const rad = (angleDeg - 90) * Math.PI / 180;  // SVG 0° is at 3 o'clock; shift so 0° = up
const x = C + r * Math.cos(rad);
const y = C + r * Math.sin(rad);
```

## 6. Clock face rendering (SVG)

Suggested structure, bottom to top:

1. **Base circle** — the full face, filled dark blue (night is the default; day is painted on top). Dark blue ≈ `#12233f`; pick a value with enough contrast against the page background.
2. **Daylight wedge** — a filled `<path>` pie slice from `sunriseAngle` to `sunsetAngle` (going clockwise, i.e., through the top of the dial where noon sits), filled white/off-white. Build with the standard arc-path recipe: `M center L sunrisePoint A r r 0 largeArcFlag 1 sunsetPoint Z`. Set `largeArcFlag = 1` when the daylight span exceeds 12 hours. **Watch the winding direction**: daylight runs sunrise → noon → sunset, which is clockwise through the *top* of the dial, never through midnight at the bottom.
3. **Sunrise / sunset markers** — small ticks or sun/moon-line glyphs on the rim at the two boundary angles, plus optional small labels of the computed times (e.g., "07:42", "18:15") just outside the rim.
4. **Hour ticks and numerals** — 24 major ticks. Label at least 0, 6, 12, 18 (12 at top, 0 at bottom, 6 left, 18 right); minor ticks for the other hours. Numeral color must be legible on both white and dark-blue regions — either use a midtone with outline, or color each numeral based on which region it falls in.
5. **Hands** — hour (short, thick), minute (long), second (thin, accent color). Each is a group rotated with `transform: rotate(...)`. Add a center hub circle on top.
6. Optional digital readout of the current time below or inside the face.

**Update loop:** `requestAnimationFrame` for smooth motion; recompute hand angles from `new Date()` each frame (never accumulate deltas — this self-corrects for tab throttling and sleep/wake).

**Day/night slice refresh:** recompute sunrise/sunset when (a) location changes, (b) the local date rolls over (check the date string each frame or on a 1-minute interval), (c) the tab regains visibility (`visibilitychange`).

## 7. Layout & sidebar

- **Main area:** flex layout, clock centered horizontally and vertically. Clock SVG sized responsively, e.g. `min(80vh, 80vw)`. Page background: a very dark neutral so both slices read clearly.
- **Sidebar (right, collapsible):**
  - Fixed-position panel on the right edge, e.g. 300 px wide; collapses to a slim edge tab or hamburger/chevron button. Animate with a CSS `transform: translateX()` transition. The clock stays centered in the remaining space (or full viewport — either is fine; pick one and be consistent).
  - Persist collapsed/expanded state in `chrome.storage.local`.
  - **Contents:**
    - **Location inputs:** latitude and longitude number fields (lat −90…90, lon −180…180, validated), plus a "Save" or auto-save on change (debounced).
    - Display of the computed sunrise and sunset times for today.
    - Validation/error text (in-interface voice: state what's wrong and the accepted range, e.g. "Latitude must be between −90 and 90").
    - Empty state before any location is saved: a short line inviting the user to enter coordinates, and the clock renders with a neutral single-color face (or a default 06:00–18:00 split — choose the neutral face; it's more honest).
- Keyboard accessibility: sidebar toggle focusable, visible focus rings, inputs labeled. Respect `prefers-reduced-motion` for the sidebar animation (second-hand sweep may remain).

## 8. Sunrise/sunset computation

- Use vendored **SunCalc**: `SunCalc.getTimes(new Date(), lat, lon)` → `.sunrise` / `.sunset` as local `Date` objects. Convert each to a dial angle with the shared `timeToAngle()`.
- Times are computed for the browser's local timezone. Note in the sidebar that shading assumes the entered location is in (or near) the user's own timezone; a location on the other side of the world will produce technically correct-but-odd shading. This is acceptable for v1.
- **Polar edge cases:** SunCalc returns `Invalid Date` for sunrise/sunset during polar day/night. Handle explicitly:
  - Polar day → entire face white, no markers, sidebar shows "Sun does not set today."
  - Polar night → entire face dark blue, sidebar shows "Sun does not rise today."
- **DST transitions:** covered automatically because times come from local `Date` objects; just make sure the recompute-on-date-change trigger fires.
- **Optional stretch (v2):** city-name lookup via a bundled offline city→coordinates dataset (preferred over a geocoding API, which would need host permissions and a network dependency).

## 9. Implementation milestones

Work in this order; each step leaves the extension loadable and testable via `chrome://extensions` → "Load unpacked".

1. **Scaffold:** manifest + blank `newtab.html` that loads as the new tab. Verify override works.
2. **Static face:** SVG circle, 24 ticks, numerals, correct orientation (12 top, 0 bottom).
3. **Hands + loop:** implement `timeToAngle()`, the three hands, rAF loop. Verify against the sanity checks in §5 by temporarily hard-coding times (00:00, 06:00, 12:00, 18:00).
4. **Day/night slices:** hard-code sunrise 07:00 / sunset 19:00; build the arc-path generator; verify winding (white slice through the top). Then test asymmetric cases (e.g., 04:30/22:00 summer, 08:45/16:30 winter) and a >12 h daylight span for `largeArcFlag`.
5. **Sidebar UI:** collapsible panel, lat/lon inputs, validation, storage read/write, restore on load.
6. **Wire SunCalc:** real sunrise/sunset from stored coordinates; markers + time labels; empty state; polar cases.
7. **Refresh triggers:** date rollover, `visibilitychange`, location change.
8. **Polish:** responsive sizing, numeral legibility on both slices, focus states, reduced motion, icons.

## 10. Acceptance criteria

- Opening a new tab shows the clock; no network requests occur.
- At 12:00 local the hour hand points straight up; at 00:00 straight down; at 18:00 to the right. Minute and second hands match a normal clock at all times.
- With a real location saved (e.g., Paris: 48.8566, 2.3522), the white slice boundaries match the sunrise/sunset times shown in the sidebar, and the hour hand is inside the white slice during the day and the dark slice at night.
- Daylight spans longer than 12 h render correctly (test a high-latitude summer location, e.g., Reykjavík in June).
- Polar day/night locations render a fully white / fully dark face with an explanatory message instead of erroring.
- Location and sidebar state survive browser restart.
- Sidebar collapses/expands smoothly and is keyboard-operable.

## 11. Known pitfalls to warn the agent about

- **Do not** use the standard 12-hour formula (`h % 12 / 12 * 360`) for the hour hand, and do not forget the `+180°` offset that puts midnight at the bottom.
- **Do not** draw the daylight arc through the bottom of the dial — the clockwise sweep from sunrise to sunset must pass through noon at the top.
- `largeArcFlag` must be derived from whether daylight exceeds 12 hours, not hard-coded.
- Recompute time from `new Date()` every frame; never `setInterval(1000)` accumulation (drifts, breaks on tab throttle).
- MV3 blocks inline `<script>` and remote scripts — all JS in separate local files referenced from `newtab.html`.
