# 24-Hour Day/Night Clock

Chrome extension: an analog clock whose hour hand makes one rotation per
24 hours (noon up, midnight down), with the face shaded white for daylight
and dark blue for night based on sunrise/sunset at a user-entered location.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this `clock-extension/` folder
4. Click the extension's toolbar icon to open the clock (pin it via the
   puzzle-piece menu for one-click access)

By default the clock only opens when you click the icon. Tick **"Show the
clock in every new tab"** in the sidebar to have every new tab redirect to
the clock instead. (The `tabs` permission exists to detect newly created
new-tab pages for this option; nothing is logged or sent anywhere.)

## Use

- Click the chevron on the right edge to open the settings sidebar.
- Pick a place from the dropdown — 115 major cities worldwide, with a
  Favorites group pinned at the top (★ button adds/removes the selected
  city) — or enter latitude (−90…90) and longitude (−180…180) manually;
  the location auto-saves and the face shades to today's daylight span, with
  sunrise/sunset marked on the rim.
- The clock shows the local time at the selected location. Dropdown places
  use their exact IANA timezone (DST-aware); custom coordinates estimate the
  timezone from longitude (whole hours, no DST).
- With no location saved the face renders in a neutral single color.
- Polar day/night locations render a fully light/dark face with a note in the
  sidebar.
- Options: dial orientation — "12 noon at top" (default) or "Day & night
  centered", which rotates the whole dial (numerals, shading, hour hand) so
  the day and night slices mirror across the vertical axis; the minute and
  second hands can each be hidden independently.

Sunrise/sunset is computed locally with the vendored [SunCalc](https://github.com/mourner/suncalc)
library (MIT) — the extension makes no network requests.
