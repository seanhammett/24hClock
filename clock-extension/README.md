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

- Click the arrow on the right edge to open the sidebar, and again to close it.
  Everything is in the one panel: the location, the other places on the dial,
  the simulator, then the options.
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
- Below the location, **+ Add location** puts a second place on the same dial,
  up to eleven of them. Each gets a plain hour hand, the same length as the real
  one: they all show the same moment, and one that stopped short would read as
  saying something else. Every hand carries its place's name in capitals: an
  added one on a pill running out from under the hub, filled with that hand's own
  colour and outlined together with the hand so the two read as one shape, with
  the hand carrying on past the name to its tip. Beside each row is that place's
  own reading of the time on show.
- The hour hand takes its name differently. As soon as there is a second place
  to tell it from, it grows to a pill's width along its whole length and the name
  is written straight onto it — it is its own pill, so nothing is drawn on top of
  it. The name takes whichever side of the sun and moon has more room. On its own
  again, with no other place to distinguish it from, the hand goes back to the
  plain one it has always been.
- Under the list, two buttons of dots pick how those hands are painted — no
  label, since the dots show the thing itself. *Colour* gives every hand its own,
  from a palette that opens on the near-primaries — red, blue, yellow, green —
  since those are the furthest apart anything can be and most lists are short;
  the writing on each pill is dark or light, whichever reads better on that
  colour. *Grayscale* paints them all the same navy with a white outline and
  white writing, which is the hour hand's own arrangement turned inside out: no
  colour to remember, and the names still tell the hands apart.
- **Hide hands**, beside them, takes the added hands off the face and leaves
  everything else alone: the list stays, each row goes on showing its own time,
  and pressing it again puts the hands back as they were. With nothing else on
  the dial the hour hand drops its name and its extra width, so the face is the
  plain one again.
- The main location keeps the ordinary hour hand with its sun or moon, and it
  alone shades the face and drives the readouts. Use ↑ to move a place up the
  list; moving the top one up again makes it the main location and sends the old
  main into the list in its place.
- Places that stand on the same hour share a position on the dial, so only the
  highest one is named and a `+` says the others are underneath it — Sonoma above
  Los Angeles reads "SONOMA +", on the hour hand itself if Sonoma is the main
  place. The higher a place sits the further forward its hand is drawn, so the
  one that is named is always the one in front.
- Every name begins the same distance out from the centre. Places an hour apart
  stand only 15° apart, close enough that names written near the hub would land
  on top of each other, and by that distance the two hands have opened far enough
  for both to be read — so Marseille with London an hour behind it shows both.
  The pills still reach back to the centre; it is only the writing that starts
  further along, which also puts every name on the dial at one radius.
- Each row takes a city from the same dropdown as the main location, or custom
  coordinates. Half- and quarter-hour zones (Delhi, Kathmandu) land exactly
  where they should, and so do the weeks when one place has changed to or from
  summer time and another has not.
- The page around the clock is light or dark to match Chrome's own setting, and
  follows it live if that changes. "Appearance" overrides it with a fixed Light
  or Dark if you would rather it not. The face itself does not change either
  way: its pale daylight and navy night are the reading the clock is there to
  give, not a colour scheme.

## Simulator

The Simulator block sits between the locations and the options, and parks the
clock at a moment of your choosing. Every hand on the face moves to it, so a
dial showing a dozen places shows all of them at that one moment.

- Tick **Time Travel** to hand the face over; untick it to give it back. It is
  deliberately not remembered across restarts, so a forgotten simulation can
  never be mistaken for a clock that has stopped. The date and time are.
- The controls below the switch are folded away until it is on: they are a
  panel's worth on their own, and say nothing about a clock running live.
- While it is running the clock is framed in the accent colour and captioned
  **Simulated**, with how far the moment is from now underneath it — "4 days,
  12 hours from now", "8 months, 29 days, 5 hours ago". Months and years are
  counted on the calendar, so the same date next year is a year exactly. The
  second hand is put away: it would be sitting still.
- Pick a day out of the calendar, set the time, or drag the slider to sweep the
  whole day. Both read as wall-clock time at the main location. The calendar's
  arrows page through the months without moving the moment; on a day, the arrow
  keys walk it a day or a week at a time. The slider has no ends: run off one
  edge and the clock comes back round at the other on the next or previous day
  and carries on, so one long drag walks the moment through a week.
- Changing the main location while it is running holds the moment and re-reads
  the date and time into that place's zone, rather than making the hands jump.
- Everything under Options applies while it runs, orientation included: the
  simulator moves the moment and nothing else about how the dial is drawn. The
  one exception is the wake/sleep lines, which are hidden: they mark your own
  hours, which are not part of a scenario.

Sunrise/sunset is computed locally with the vendored [SunCalc](https://github.com/mourner/suncalc)
library (MIT) — the extension makes no network requests. The interface is set
in [IBM Plex Sans](https://github.com/IBM/plex), bundled in `fonts/` under the
SIL Open Font License 1.1 (see `fonts/LICENSE.txt`).
