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
the clock instead — Chrome will ask for the optional `tabs` permission at
that moment (used only to detect newly created new-tab pages; it is released
again when you untick the option).

## Privacy

Everything runs and stays on your device: the location, favorites, and
options are stored in Chrome's local extension storage, sunrise/sunset is
computed locally, and the extension makes no network requests and collects
no data.

## Use

- Click one of the two tabs on the right edge to open the sidebar: **Options**
  for the everyday clock, **Simulator** for the one described below. Clicking
  the tab that is already open closes the sidebar again.
- Pick a place from the dropdown — 123 major cities worldwide, with a
  Favorites group pinned at the top (★ button adds/removes the selected
  city) — or enter latitude (−90…90) and longitude (−180…180) manually;
  the location auto-saves and the face shades to today's daylight span, with
  sunrise/sunset marked on the rim.
- The clock shows the local time at the selected location. Dropdown places
  use their exact IANA timezone (DST-aware); for custom coordinates the zone is
  looked up from the coordinates themselves, falling back to an estimate from
  the longitude (whole hours, no DST) only if that lookup fails.
- With no location saved the face renders in a neutral single color.
- Polar day/night locations render a fully light/dark face with a note in the
  sidebar.
- A sun or moon rides the hour hand: the sun is cut off by the edge of the
  night slice as it sets, and the moon is revealed by it in turn, so the icon
  always matches the region of the face the hand is in. The moon's lit face is
  shaped to the real phase for the day, crescent through full and back.
- The current time is also marked on the hour-tick ring by a disc that flips
  between light and dark as it passes sunrise and sunset.
- Options: dial orientation — "12 noon at top" (default), "Day & night
  centered", which rotates the whole dial (numerals, shading, hour hand) so
  the day and night slices mirror across the vertical axis, or "Louis XIV",
  which centers your waking hours (wake-up and bedtime are entered below the
  option and drawn as lines on the face, independently of the orientation);
  the minute and second hands can each be hidden independently, a faint
  60-minute marker ring can be shown alongside the minute hand, and the half-
  and quarter-hour ticks on the hour ring can be turned off to leave just the
  hours. With the minute hand hidden the hour hand reaches further out, taking
  the room it no longer has to leave clear.
- The page around the clock is light or dark to match Chrome's own setting, and
  follows it live if that changes. "Appearance" overrides it with a fixed Light
  or Dark if you would rather it not. The face itself does not change either
  way: its pale daylight and navy night are the reading the clock is there to
  give, not a colour scheme.

## Simulator

The Simulator tab parks the clock at a moment of your choosing and shows that
one moment from up to twelve places at once.

- Tick **Activate Simulator** to hand the face over; untick it to give it back. It is
  deliberately not remembered across restarts, so a forgotten simulation can
  never be mistaken for a clock that has stopped. Everything else — the list of
  places, the date and time, whether live time is on, the orientation — is.
- **Use live time** hands the moment back to the real clock while keeping the
  places: the same several-city dial, running, down to the second hand and the
  seconds in the digital line. The date, the time and the slider are shut off
  while it is on, but keep the moment they hold, so the button is a straight
  A/B between now and the scenario. The clock keeps its accent frame — the
  simulator still has the face, and its own place and orientation with it.
- While it is running on a chosen moment the clock is framed in the accent
  colour and captioned **Simulated**, with how far the moment is from now
  underneath it — "4 days, 12 hours from now", "8 months, 29 days, 5 hours ago". Months and years are
  counted on the calendar, so the same date next year is a year exactly. The
  second hand is put away: it would be sitting still.
- Pick a day out of the calendar, set the time, or drag the slider to sweep the
  whole day. Both read as wall-clock time at the *first* place in the list. The
  calendar's arrows page through the months without moving the moment; on a day,
  the arrow keys walk it a day or a week at a time. The slider has no ends: drag
  off one edge and the time comes back round at the other and carries on, on the
  same date.
- The first place is the main one. It keeps the ordinary hour hand with its sun
  or moon, and it alone shades the face and drives the readouts. Every place
  after it gets a plain coloured hour hand, the same length as the real one:
  they all show the same moment, and one that stopped short would read as saying
  something else. Every hand, the main one included, carries its place's name in
  capitals on a pill running out from under the hub, filled with that hand's own
  colour and outlined together with the hand so the two read as one shape; the
  hand carries on past the name to its tip. The main hand's name takes whichever
  side of the sun and moon has more room. Use ↑ to move a place up the list;
  moving one to the top hands the shading over to it, and the moment being shown
  stays put while the date and time re-read into its zone.
- Places that stand on the same hour share a position on the dial, so only the
  highest one in the list is named and a `+` says the others are underneath it —
  Sonoma above Los Angeles reads "SONOMA +", on the hour hand itself if Sonoma is
  the main place. The higher a place sits in the list the further forward its
  hand is drawn, so the one that is named is always the one in front.
- Each row takes a city from the same dropdown as the Options panel, or custom
  coordinates. Half- and quarter-hour zones (Delhi, Kathmandu) land exactly
  where they should, and so do the weeks when two places have changed to or
  from summer time and the other has not.
- The simulator keeps its own choice of "12 noon at top" or "Day & night
  centered", so trying one out leaves the everyday clock as you had it. Louis
  XIV is not offered here, and the wake/sleep lines are hidden while it runs:
  they mark your own hours, which are not part of a scenario.

Sunrise/sunset is computed locally with the vendored [SunCalc](https://github.com/mourner/suncalc)
library (MIT) — the extension makes no network requests. The interface is set
in [IBM Plex Sans](https://github.com/IBM/plex), bundled in `fonts/` under the
SIL Open Font License 1.1 (see `fonts/LICENSE.txt`).
