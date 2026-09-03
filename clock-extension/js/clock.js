/*
 * clock.js — shared dial math, static face construction, and the hand
 * animation loop. Exposes window.Clock24 for daynight.js / sidebar.js /
 * locations.js.
 */
(function () {
  'use strict';

  var C = 220;   // SVG center (x and y)
  var R = 180;   // face radius

  // ---- Timezone handling ------------------------------------------------
  // The clock can display the time at the saved location rather than the
  // browser's. A zone spec is either { type: 'iana', name: 'Europe/Paris' }
  // (exact, DST-aware — from cities.js, or from tz-lookup for custom
  // coordinates) or { type: 'offset', minutes: 120 } (approximated from
  // longitude, only if the lookup fails), or null for the browser's zone.
  //
  // A spec is wrapped in a zone — the spec plus its Intl formatter, which is
  // the expensive half — so locations.js can hold a dozen of them open at
  // once. The dial itself still has exactly one primary zone: the one the
  // hands, the wedge and the readouts all read.

  function makeZone(spec) {
    if (!spec) return null;
    if (spec.type !== 'iana') return { spec: spec, formatter: null };
    return {
      spec: spec,
      formatter: new Intl.DateTimeFormat('en-US', {
        timeZone: spec.name,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hourCycle: 'h23'
      })
    };
  }

  var primaryZone = null;

  function setTimeZone(spec) {
    primaryZone = makeZone(spec);
  }

  /**
   * The zone the dial itself reads. Anything measuring another zone against
   * the face — the extra hour hands — needs the same one the hands use, not
   * its own copy built from a spec that may since have moved on.
   */
  function getTimeZone() {
    return primaryZone;
  }

  /**
   * Convert an absolute Date to a Date whose *UTC* getters (getUTCHours, …)
   * read as wall-clock time in the given zone. A null zone means the
   * browser's own.
   *
   * The reading is carried in UTC rather than local time because UTC has no
   * DST: build it with the local constructor instead and any wall clock that
   * happens to fall in the *viewer's* own spring-forward gap has no local
   * instant to sit on, so it silently slides an hour — which would show a
   * London hand an hour out for anyone watching from Paris on the morning the
   * clocks go forward. Every reader below uses the UTC getters to match.
   */
  function toZoneTime(date, zone) {
    if (!zone) {
      return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
        date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()));
    }
    if (zone.spec.type === 'iana') {
      var p = {};
      zone.formatter.formatToParts(date).forEach(function (part) {
        p[part.type] = part.value;
      });
      return new Date(Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute,
        +p.second, date.getMilliseconds()));
    }
    return new Date(date.getTime() + zone.spec.minutes * 60000);
  }

  /** The same, in the primary zone — what the dial itself is drawn from. */
  function toZoned(date) {
    return toZoneTime(date, primaryZone);
  }

  /**
   * How far a zone runs ahead of UTC, in minutes, at a given instant. Read
   * back out of the wall clock rather than from a table, so DST is included
   * for free — and so half- and quarter-hour zones come out exact.
   */
  function offsetMinutes(zone, date) {
    return Math.round((toZoneTime(date, zone).getTime() - date.getTime()) / 60000);
  }

  /**
   * The inverse of toZoneTime: the absolute instant at which a zone's wall
   * clock reads this date and time. An offset is only knowable from an
   * instant, so guess one, correct it by the offset there, then re-read the
   * offset at the answer and correct again — the second pass is what puts the
   * hours either side of a DST change on the right instant.
   */
  function instantFromWallClock(year, month, day, hour, minute, zone) {
    var target = Date.UTC(year, month, day, hour, minute);
    var t = target - offsetMinutes(zone, new Date(target)) * 60000;
    return target - offsetMinutes(zone, new Date(t)) * 60000;
  }

  // ---- Time source --------------------------------------------------------
  // Everything on the page reads the clock through now(), so the simulator can
  // freeze it at an arbitrary instant simply by handing one over. Nothing here
  // derives from elapsed time — every frame is computed from `now` alone — so
  // a frozen or scrubbed clock needs no other change to the loop.

  var simInstant = null; // absolute ms while simulating, else null for live

  function now() {
    return simInstant === null ? new Date() : new Date(simInstant);
  }

  function zonedNow() {
    return toZoned(now());
  }

  /**
   * Map a zoned Date's time of day to a dial angle in degrees clockwise from
   * 12-o'clock-up. Noon → 0°, midnight → 180°, 06:00 → 270°, 18:00 → 90°.
   * Shared by the hands, the day/night wedge, and the sunrise/sunset markers
   * so they can never disagree. Reads UTC, the frame toZoneTime hands back.
   */
  function timeToAngle(date) {
    var dayFraction = (date.getUTCHours() +
      date.getUTCMinutes() / 60 +
      date.getUTCSeconds() / 3600 +
      date.getUTCMilliseconds() / 3600000) / 24;
    return (dayFraction * 360 + 180) % 360;
  }

  /** Convert a dial angle (0° = up, clockwise) and radius to SVG coordinates. */
  function angleToPoint(angleDeg, r) {
    var rad = (angleDeg - 90) * Math.PI / 180;
    return {
      x: C + r * Math.cos(rad),
      y: C + r * Math.sin(rad)
    };
  }

  /** Dial angle for a whole hour numeral (0–23). */
  function hourToAngle(h) {
    return (h / 24 * 360 + 180) % 360;
  }

  // ---- Dial orientation ---------------------------------------------------
  // In "centered" orientation the whole dial (face, numerals, hour hand) is
  // rotated by a fixed offset so the day/night slices sit symmetrically
  // about the vertical axis. Minute and second hands are unaffected.

  var dialOffset = 0;

  /** Rotate a dial angle into its on-screen position. */
  function displayAngle(angle) {
    return ((angle + dialOffset) % 360 + 360) % 360;
  }

  function setDialOffset(deg) {
    var norm = ((deg % 360) + 360) % 360;
    if (norm === dialOffset) return;
    dialOffset = norm;
    layoutFace();
  }

  window.Clock24 = {
    C: C,
    R: R,
    timeToAngle: timeToAngle,
    angleToPoint: angleToPoint,
    hourToAngle: hourToAngle,
    displayAngle: displayAngle,
    setDialOffset: setDialOffset,
    setTimeZone: setTimeZone,
    getTimeZone: getTimeZone,
    makeZone: makeZone,
    toZoneTime: toZoneTime,
    offsetMinutes: offsetMinutes,
    instantFromWallClock: instantFromWallClock,
    toZoned: toZoned,
    now: now,
    zonedNow: zonedNow
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---- Static face: 24 ticks + numerals -------------------------------

  var ticksGroup = document.getElementById('ticks');
  // One numeral set per region; the two are identical and sit exactly on top
  // of each other, so only the clipped parts of each are ever visible.
  var numeralGroups = [
    document.getElementById('numerals-day'),
    document.getElementById('numerals-night')
  ];

  // Ticks run at quarter-hour steps: the hour marks full length, the halves
  // shorter, the quarters shorter still, so the eye picks out the hours first
  // and can still read the subdivisions between them.
  var TICK_LENGTHS = { 1: 10, 0.5: 6, 0.25: 3.5 };
  var TICK_WIDTHS =  { 1: 2,  0.5: 1, 0.25: 1 };

  var tickEls = []; // { el, hour, length } for every quarter-hour mark
  var numeralEls = []; // [hour] -> array of the copies for that hour

  function buildFace() {
    for (var q = 0; q < 96; q++) {
      var hour = q / 4;
      // Largest step the mark falls on: whole hour, half, or quarter.
      var step = q % 4 === 0 ? 1 : (q % 2 === 0 ? 0.5 : 0.25);
      var tick = document.createElementNS(SVG_NS, 'line');
      tick.setAttribute('stroke-width', String(TICK_WIDTHS[step]));
      // daynight.js colours each tick by the region it sits in; it takes a
      // fractional hour as happily as a whole one.
      tick.setAttribute('data-hour', hour);
      // Same stroke colour as the hours — daynight.js paints them all — but
      // held back by opacity, which fades toward whichever fill is behind it
      // rather than toward one fixed colour.
      tick.setAttribute('class', step === 1 ? 'tick'
        : (step === 0.5 ? 'tick tick-half' : 'tick tick-quarter'));
      ticksGroup.appendChild(tick);
      tickEls.push({ el: tick, hour: hour, length: TICK_LENGTHS[step] });
    }

    for (var h = 0; h < 24; h++) {
      var copies = [];
      for (var g = 0; g < numeralGroups.length; g++) {
        var label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('data-hour', h);
        label.setAttribute('class', 'numeral');
        label.textContent = String(h);
        numeralGroups[g].appendChild(label);
        copies.push(label);
      }
      numeralEls.push(copies);
    }
    layoutFace();
  }

  /** Position ticks and numerals for the current dial offset. */
  function layoutFace() {
    for (var i = 0; i < tickEls.length; i++) {
      var t = tickEls[i];
      // All ticks hang from the same outer edge, so the ring reads as one line
      // however far each mark reaches in.
      var tickAngle = displayAngle(hourToAngle(t.hour));
      var outer = angleToPoint(tickAngle, R - 4);
      var inner = angleToPoint(tickAngle, R - 4 - t.length);

      t.el.setAttribute('x1', outer.x.toFixed(2));
      t.el.setAttribute('y1', outer.y.toFixed(2));
      t.el.setAttribute('x2', inner.x.toFixed(2));
      t.el.setAttribute('y2', inner.y.toFixed(2));
    }

    for (var h = 0; h < 24; h++) {
      var angle = displayAngle(hourToAngle(h));
      // Set out far enough that the minute hand sweeps inside the numerals.
      var pos = angleToPoint(angle, R - 30);
      for (var g = 0; g < numeralEls[h].length; g++) {
        numeralEls[h][g].setAttribute('x', pos.x.toFixed(2));
        numeralEls[h][g].setAttribute('y', pos.y.toFixed(2));
      }
    }
  }

  buildFace();

  // ---- Minute markers (optional, very faint) ----------------------------
  // A 60-tick ring inside the hour ring. It reads against the minute hand's
  // conventional :00-at-top frame, so it never rotates with the dial offset.

  var minuteTicksGroup = document.getElementById('minute-ticks');

  function buildMinuteRing() {
    // Just inside the hour numerals (centred at R - 30), which is also where
    // the minute hand's tip lands, so the hand points right at the ring.
    var OUTER = 130;
    for (var m = 0; m < 60; m++) {
      var angle = m / 60 * 360;
      var outer = angleToPoint(angle, OUTER);
      var inner = angleToPoint(angle, OUTER - (m % 5 === 0 ? 9 : 5));
      var tick = document.createElementNS(SVG_NS, 'line');
      tick.setAttribute('x1', outer.x.toFixed(2));
      tick.setAttribute('y1', outer.y.toFixed(2));
      tick.setAttribute('x2', inner.x.toFixed(2));
      tick.setAttribute('y2', inner.y.toFixed(2));
      tick.setAttribute('stroke-width', m % 5 === 0 ? '1.5' : '1');
      tick.setAttribute('class', 'minute-tick');
      minuteTicksGroup.appendChild(tick);
    }

    // Five-minute labels just inside the ring (minute frame: 0 at top). The
    // quarters carry a touch more weight so the ring still reads at a glance.
    for (var i = 0; i < 12; i++) {
      var minute = i * 5;
      var pos = angleToPoint(minute / 60 * 360, OUTER - 19);
      var label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', pos.x.toFixed(2));
      label.setAttribute('y', pos.y.toFixed(2));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('class', minute % 15 === 0
        ? 'minute-label minute-label-quarter'
        : 'minute-label');
      label.textContent = String(minute);
      minuteTicksGroup.appendChild(label);
    }
  }

  buildMinuteRing();

  // ---- Hands + animation loop -----------------------------------------

  var hourHand = document.getElementById('hand-hour');
  var nowMarker = document.getElementById('now-marker');
  var minuteHand = document.getElementById('hand-minute');
  var secondHand = document.getElementById('hand-second');
  var sunIcon = document.getElementById('sun-icon');
  var moonIcon = document.getElementById('moon-icon');

  // With the minute hand shown the hour hand stops short of it; with the minute
  // hand hidden there is nothing to leave room for, so it reaches out most of
  // the way to where that hand would have ended and the icon rides out with it.
  // The icon sits a fixed distance back from the tip either way, so the tip
  // stays visible past it.
  //
  // The short reach only has to be told apart from the minute hand's tip at
  // 136, not held right back from it: the two are different weights and the
  // hour hand carries the sun or moon, so 26 of clear dial between them is
  // plenty and the hand is far more readable for the length.
  var HAND_TIP_SHORT = 110;
  var HAND_TIP_LONG = 126;
  var ICON_INSET = 22;

  var hourHandLines = hourHand.getElementsByTagName('line');
  var iconRadius = HAND_TIP_SHORT - ICON_INSET;

  // The plain hand: a light core inside a dark outline, matching index.html.
  var HAND_W_OUTLINE = 9;
  var HAND_W_CORE = 3;

  /**
   * How heavy the hour hand is drawn. locations.js widens it to the shape of a
   * name pill when there is a name to write along it — the hand then is the
   * pill, for its whole length — and calls with nothing to put it back.
   */
  function setHourHandWeight(outline, core) {
    hourHandLines[0].setAttribute('stroke-width', String(outline || HAND_W_OUTLINE));
    hourHandLines[1].setAttribute('stroke-width', String(core || HAND_W_CORE));
  }

  window.Clock24.setHourHandWeight = setHourHandWeight;

  /** Run the hour hand out to the minute hand's reach, or pull it back in. */
  function setHourHandExtended(extended) {
    var tip = extended ? HAND_TIP_LONG : HAND_TIP_SHORT;
    iconRadius = tip - ICON_INSET;
    for (var i = 0; i < hourHandLines.length; i++) {
      hourHandLines[i].setAttribute('y2', String(C - tip));
    }
  }

  window.Clock24.setHourHandExtended = setHourHandExtended;

  /** Where the sun/moon rides on the hour hand, so callers can keep clear. */
  window.Clock24.iconRadius = function () { return iconRadius; };

  /** How far the hour hand reaches. */
  window.Clock24.hourTipRadius = function () { return iconRadius + ICON_INSET; };

  var digitalMain = document.getElementById('digital-main');
  var digitalSeconds = document.getElementById('digital-seconds');
  var dateReadout = document.getElementById('date-readout');

  function rotate(el, angle) {
    el.setAttribute('transform', 'rotate(' + angle + ' ' + C + ' ' + C + ')');
  }

  var lastDateKey = null;
  var lastDigital = '';
  var lastSeconds = -1;

  /** Which day a zoned reading falls on, as a comparable key. */
  function dateKeyOf(zonedDate) {
    return zonedDate.toISOString().slice(0, 10);
  }

  /**
   * Freeze the clock at an absolute instant, or hand it back to real time with
   * null. A jump lands on a different date more often than the loop's own
   * once-a-day check can catch, so re-test it here and forget the last date if
   * it has moved — that is what makes the next frame redo the sun times, the
   * moon phase and the date line. Scrubbing within one day changes none of
   * those, and skipping the repaint there is what keeps a drag cheap.
   */
  function setSimulatedInstant(ms) {
    simInstant = (typeof ms === 'number' && isFinite(ms)) ? ms : null;
    if (dateKeyOf(zonedNow()) !== lastDateKey) lastDateKey = null;
  }

  window.Clock24.setSimulatedInstant = setSimulatedInstant;

  // The extra locations' hands ride this same frame, so they are handed the
  // angle the hour hand has just been given rather than working out their own
  // a moment later and landing a frame behind it.
  var frameHooks = [];

  window.Clock24.onFrame = function (fn) { frameHooks.push(fn); };

  function frame() {
    var now = zonedNow();

    var trueAngle = timeToAngle(now);
    var hourAngle = displayAngle(trueAngle);
    rotate(hourHand, hourAngle);
    // Same angle as the hour hand, so the mark always lines up with it.
    rotate(nowMarker, hourAngle);

    // Translate rather than rotate the icons so the crescent stays upright.
    var tip = angleToPoint(hourAngle, iconRadius);
    var iconAt = 'translate(' + tip.x.toFixed(2) + ' ' + tip.y.toFixed(2) + ')';
    sunIcon.setAttribute('transform', iconAt);
    moonIcon.setAttribute('transform', iconAt);

    rotate(minuteHand, (now.getUTCMinutes() + now.getUTCSeconds() / 60) / 60 * 360);
    rotate(secondHand, (now.getUTCSeconds() + now.getUTCMilliseconds() / 1000) / 60 * 360);

    var text = now.toLocaleTimeString([],
      { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    if (text !== lastDigital) {
      lastDigital = text;
      digitalMain.textContent = text;
    }

    // Seconds are a separate, dimmer span so hours and minutes read first
    var secs = now.getUTCSeconds();
    if (secs !== lastSeconds) {
      lastSeconds = secs;
      digitalSeconds.textContent = ':' + (secs < 10 ? '0' : '') + secs;
    }

    // Recompute sunrise/sunset and the date line when the date rolls over.
    var dateKey = dateKeyOf(now);
    if (dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      dateReadout.textContent = now.toLocaleDateString([], {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        timeZone: 'UTC'
      });
      if (window.DayNight) {
        window.DayNight.refresh();
      }
      // The phase moves slowly enough that once a day is plenty.
      if (window.MoonPhase) {
        window.MoonPhase.refresh(now);
      }
    }

    for (var h = 0; h < frameHooks.length; h++) frameHooks[h](hourAngle);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  // Recompute when the tab becomes visible again (rAF is throttled while
  // hidden, so the date-rollover check may be stale after sleep/wake).
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (window.DayNight) window.DayNight.refresh();
    if (window.MoonPhase) window.MoonPhase.refresh();
  });
})();
