# Store assets

The five screenshots on the Chrome Web Store listing, at the 1280×800 the
store asks for. They are captures of the real page, not mock-ups.

| File | Shows |
| --- | --- |
| `screenshot-1-clock.png` | The face on its own, day and night centred: 24-hour hour hand, day/night shading, sun on the hand. |
| `screenshot-2-sidebar.png` | The whole sidebar — location, the places on the dial, time travel, the options — beside three places on the centred face. |
| `screenshot-3-time-travel.png` | Time travel: the clock parked on a winter evening months off, ringed and badged so it cannot be taken for live, with the knobs that got it there. |
| `screenshot-4-louis-xiv.png` | Louis XIV: the dial turned so the waking hours sit centred, with wake and bedtime drawn on the face. |
| `screenshot-5-night-moon.png` | Night in Sydney: the moon on the hour hand at its real phase, New York's morning in grayscale beside it. |

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

Every scene is pinned to the instant at the top of the file, so the pictures
read as views of one afternoon: Marseille's 16:26 is Tokyo's 23:26. A scene may
carry an `advance` in seconds to stand a few minutes further on, which is what
keeps two shots of the same face from reading as the same picture twice — and
what moves a second hand off whatever it happens to be lying along. The clock
is frozen by standing a fixed `Date` in front of the page's own — `clock.js`
computes every frame from `now()` and nothing from elapsed time, so that is
enough to park the face without the simulator's badge landing across the
picture. The date is chosen for its moon: a gibbous one reads as a moon in a
way that a nearly-new one does not.

Two things a scene cannot say in storage, and says instead as its own key.
`simulate` switches the simulator on after the page has come up — whether it is
running is deliberately not remembered across restarts, so there is nothing to
seed; the scene sets `simDateTime` for the moment and this throws the switch.
`sidebarScroll` scrolls the panel to the part of it the picture is about.

The page is served over HTTP rather than loaded as an extension, so the one
thing it cannot show is "Show the clock in every new tab" — that option hides
itself when there is no `chrome.runtime` to honour it. Everything else in the
sidebar is what the extension puts there.
