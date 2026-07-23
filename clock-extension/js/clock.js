/*
 * clock.js — shared dial math, static face construction, and the hand
 * animation loop. Exposes window.Clock24 for daynight.js / sidebar.js.
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

  var zoneSpec = null;
  var zoneFormatter = null;

  function setTimeZone(spec) {
    zoneSpec = spec || null;
    zoneFormatter = null;
    if (zoneSpec && zoneSpec.type === 'iana') {
      zoneFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zoneSpec.name,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hourCycle: 'h23'
      });
    }
  }

  /**
   * Convert an absolute Date to a Date whose local getters (getHours, …)
   * read as wall-clock time in the configured zone. With no zone set,
   * returns the date unchanged.
   */
  function toZoned(date) {
    if (!zoneSpec) return date;
    if (zoneSpec.type === 'iana') {
      var p = {};
      zoneFormatter.formatToParts(date).forEach(function (part) {
        p[part.type] = part.value;
      });
      return new Date(+p.year, p.month - 1, +p.day, +p.hour, +p.minute,
        +p.second, date.getMilliseconds());
    }
    // Fixed offset: shift so local getters read UTC + offset.
    return new Date(date.getTime() +
      (zoneSpec.minutes + date.getTimezoneOffset()) * 60000);
  }

  function zonedNow() {
    return toZoned(new Date());
  }

  /**
   * Map a Date's local time of day to a dial angle in degrees clockwise
   * from 12-o'clock-up. Noon → 0°, midnight → 180°, 06:00 → 270°, 18:00 → 90°.
   * Shared by the hands, the day/night wedge, and the sunrise/sunset markers
   * so they can never disagree.
   */
  function timeToAngle(date) {
    var dayFraction = (date.getHours() +
      date.getMinutes() / 60 +
      date.getSeconds() / 3600 +
      date.getMilliseconds() / 3600000) / 24;
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
    toZoned: toZoned,
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

  var tickEls = [];
  var numeralEls = []; // [hour] -> array of the copies for that hour

  function buildFace() {
    for (var h = 0; h < 24; h++) {
      var tick = document.createElementNS(SVG_NS, 'line');
      tick.setAttribute('stroke-width', '2');
      tick.setAttribute('data-hour', h);
      tick.setAttribute('class', 'tick');
      ticksGroup.appendChild(tick);
      tickEls.push(tick);

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
    for (var h = 0; h < 24; h++) {
      var angle = displayAngle(hourToAngle(h));
      var outer = angleToPoint(angle, R - 4);
      var inner = angleToPoint(angle, R - 14);

      tickEls[h].setAttribute('x1', outer.x.toFixed(2));
      tickEls[h].setAttribute('y1', outer.y.toFixed(2));
      tickEls[h].setAttribute('x2', inner.x.toFixed(2));
      tickEls[h].setAttribute('y2', inner.y.toFixed(2));

      var pos = angleToPoint(angle, R - 34);
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
    var OUTER = 118;
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

    // Quarter-hour labels just inside the ring (minute frame: 0 at top).
    [0, 15, 30, 45].forEach(function (m) {
      var pos = angleToPoint(m / 60 * 360, OUTER - 19);
      var label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', pos.x.toFixed(2));
      label.setAttribute('y', pos.y.toFixed(2));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('class', 'minute-label');
      label.textContent = String(m);
      minuteTicksGroup.appendChild(label);
    });
  }

  buildMinuteRing();

  // ---- Hands + animation loop -----------------------------------------

  var hourHand = document.getElementById('hand-hour');
  var minuteHand = document.getElementById('hand-minute');
  var secondHand = document.getElementById('hand-second');
  var sunIcon = document.getElementById('sun-icon');
  var moonIcon = document.getElementById('moon-icon');
  // Set in from the hand's tip (at 92) so the tip stays visible past the icon.
  var ICON_RADIUS = 70;

  var digitalMain = document.getElementById('digital-main');
  var digitalSeconds = document.getElementById('digital-seconds');
  var dateReadout = document.getElementById('date-readout');

  function rotate(el, angle) {
    el.setAttribute('transform', 'rotate(' + angle + ' ' + C + ' ' + C + ')');
  }

  var lastDateKey = null;
  var lastDigital = '';
  var lastSeconds = -1;

  function frame() {
    var now = zonedNow();

    var hourAngle = displayAngle(timeToAngle(now));
    rotate(hourHand, hourAngle);

    // Translate rather than rotate the icons so the crescent stays upright.
    var tip = angleToPoint(hourAngle, ICON_RADIUS);
    var iconAt = 'translate(' + tip.x.toFixed(2) + ' ' + tip.y.toFixed(2) + ')';
    sunIcon.setAttribute('transform', iconAt);
    moonIcon.setAttribute('transform', iconAt);

    rotate(minuteHand, (now.getMinutes() + now.getSeconds() / 60) / 60 * 360);
    rotate(secondHand, (now.getSeconds() + now.getMilliseconds() / 1000) / 60 * 360);

    var text = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (text !== lastDigital) {
      lastDigital = text;
      digitalMain.textContent = text;
    }

    // Seconds are a separate, dimmer span so hours and minutes read first
    var secs = now.getSeconds();
    if (secs !== lastSeconds) {
      lastSeconds = secs;
      digitalSeconds.textContent = ':' + (secs < 10 ? '0' : '') + secs;
    }

    // Recompute sunrise/sunset and the date line when the date rolls over.
    var dateKey = now.toDateString();
    if (dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      dateReadout.textContent = now.toLocaleDateString([], {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      if (window.DayNight) {
        window.DayNight.refresh();
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  // Recompute when the tab becomes visible again (rAF is throttled while
  // hidden, so the date-rollover check may be stale after sleep/wake).
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && window.DayNight) {
      window.DayNight.refresh();
    }
  });
})();
