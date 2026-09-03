# Store assets

The five screenshots on the Chrome Web Store listing, at the 1280×800 the
store asks for. They are captures of the real page, not mock-ups.

| File | Shows |
| --- | --- |
| `screenshot-1-clock.png` | The face on its own: 24-hour hour hand, day/night shading, sun on the hand. |
| `screenshot-2-sidebar.png` | The whole sidebar — location, the places on the dial, the simulator, the options. |
| `screenshot-3-timezones.png` | Seven places on one dial, each hand in its own colour and named along its length, on the day-and-night-centred face. |
| `screenshot-4-louis-xiv.png` | Louis XIV: the dial turned so the waking hours sit centred, with wake and bedtime drawn on the face. |
| `screenshot-5-night-moon.png` | Night in Tokyo: the moon on the hour hand at its real phase, the other places in grayscale. |

## Re-shooting

```sh
store-assets/tools/screenshots.sh                 # all five, 1280x800
store-assets/tools/screenshots.sh --only sidebar  # one, by filename fragment
store-assets/tools/screenshots.sh --out /tmp/shots
```

Needs node (22+, for the built-in `WebSocket`), python3, and Chrome — no npm
install. Set `CHROME=/path/to/chrome` if it is not in the usual place. The
script serves `clock-extension/` on a local port, drives a headless Chrome over
the DevTools protocol, and tears both down when it finishes.

## How a scene is set up

`tools/scenes.json` is the whole of it. Each scene is the settings the page
would have been saved with — location, orientation, the extra locations, the
hand style — which the driver writes into storage before loading the page, so
what is captured is the page coming up in that state rather than a page poked
into it afterwards.

Every scene is pinned to the one instant at the top of the file, so the five
pictures read as five views of the same moment: Marseille's 16:26 is Tokyo's
23:26. The clock is frozen by standing a fixed `Date` in front of the page's
own — `clock.js` computes every frame from `now()` and nothing from elapsed
time, so that is enough to park the face without the simulator's badge landing
across the picture. The date is chosen for its moon: a gibbous one reads as a
moon in a way that a nearly-new one does not.

The page is served over HTTP rather than loaded as an extension, so the one
thing it cannot show is "Show the clock in every new tab" — that option hides
itself when there is no `chrome.runtime` to honour it. Everything else in the
sidebar is what the extension puts there.
