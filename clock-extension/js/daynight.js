/*
 * daynight.js — computes sunrise/sunset for the saved location and paints
 * the day/night slices, rim markers, and region-aware tick/numeral colors.
 * Emits a 'daynight:updated' event on document for the sidebar to display.
 */
(function () {
  'use strict';

  var Clock24 = window.Clock24;
  var C = Clock24.C;
  var R = Clock24.R;

  var NIGHT_FILL = '#12233f';
  var DAY_FILL = '#f4f1e8';
  var NEUTRAL_FILL = '#1d2536';
  var TICK_ON_DAY = '#41506e';
  var TICK_ON_NIGHT = '#93a3c4';
  var NUMERAL_ON_DAY = '#2b3854';
  var NUMERAL_ON_NIGHT = '#dbe3f2';

  var faceBase = document.getElementById('face-base');
  var dayWedge = document.getElementById('day-wedge');
  var markersGroup = document.getElementById('sun-markers');
  var louisGroup = document.getElementById('wake-sleep-lines');
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var LABEL_RADIUS = R + 8;   // inner end of each radial rim label
  var MIN_LABEL_GAP = 4;      // min degrees between labels before they overlap

  var location = null; // { lat, lon } or null
  // 'noon' (12 at top) | 'centered' (day slice at top) | 'louis' (waking hours at top)
  var orientation = 'noon';
  var wakeTime = '07:00'; // "HH:MM" — Louis XIV mode wake-up
  var bedTime = '23:00';  // "HH:MM" — Louis XIV mode bedtime

  /**
   * Pie-slice path from startAngle clockwise to endAngle (degrees from
   * 12-o'clock-up). For daylight this runs sunrise → noon(top) → sunset;
   * sunrise angles sit in (180°, 360°) and sunset in (0°, 180°), so the
   * clockwise sweep always crosses 0° at the top, never midnight at the
   * bottom.
   */
  function wedgePath(startAngle, endAngle) {
    var sweep = (endAngle - startAngle + 360) % 360;
    var largeArcFlag = sweep > 180 ? 1 : 0;
    var p1 = Clock24.angleToPoint(startAngle, R);
    var p2 = Clock24.angleToPoint(endAngle, R);
    return 'M ' + C + ' ' + C +
      ' L ' + p1.x.toFixed(2) + ' ' + p1.y.toFixed(2) +
      ' A ' + R + ' ' + R + ' 0 ' + largeArcFlag + ' 1 ' +
      p2.x.toFixed(2) + ' ' + p2.y.toFixed(2) + ' Z';
  }

  /** Is the given dial angle inside the clockwise daylight span? */
  function inDaylight(angle, sunriseAngle, daySweep) {
    return (angle - sunriseAngle + 360) % 360 <= daySweep;
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function clearMarkers() {
    while (markersGroup.firstChild) {
      markersGroup.removeChild(markersGroup.firstChild);
    }
  }

  function addMarker(angle, timeText) {
    // Tick tip stops short of LABEL_RADIUS so the label clears the orange mark.
    var inner = Clock24.angleToPoint(angle, R - 2);
    var outer = Clock24.angleToPoint(angle, R + 4);
    var tick = document.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', inner.x.toFixed(2));
    tick.setAttribute('y1', inner.y.toFixed(2));
    tick.setAttribute('x2', outer.x.toFixed(2));
    tick.setAttribute('y2', outer.y.toFixed(2));
    tick.setAttribute('class', 'sun-marker');
    markersGroup.appendChild(tick);

    var label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('class', 'sun-marker-label');
    label.setAttribute('data-angle', angle);
    label.textContent = timeText;
    placeRimLabel(label, angle);
    markersGroup.appendChild(label);
  }

  /** Color every tick and numeral for the region of the face it sits in. */
  function paintDialText(regionForHour) {
    var ticks = document.querySelectorAll('#ticks .tick');
    var numerals = document.querySelectorAll('#numerals .numeral');
    var i, el, day;
    for (i = 0; i < ticks.length; i++) {
      el = ticks[i];
      day = regionForHour(Number(el.getAttribute('data-hour')));
      el.setAttribute('stroke', day ? TICK_ON_DAY : TICK_ON_NIGHT);
    }
    for (i = 0; i < numerals.length; i++) {
      el = numerals[i];
      day = regionForHour(Number(el.getAttribute('data-hour')));
      el.setAttribute('fill', day ? NUMERAL_ON_DAY : NUMERAL_ON_NIGHT);
    }
  }

  function notify(detail) {
    document.dispatchEvent(new CustomEvent('daynight:updated', { detail: detail }));
  }

  function renderNeutral() {
    faceBase.setAttribute('fill', NEUTRAL_FILL);
    dayWedge.setAttribute('visibility', 'hidden');
    clearMarkers();
    paintDialText(function () { return false; });
    notify({ state: 'empty' });
  }

  function renderPolar(isPolarDay) {
    faceBase.setAttribute('fill', isPolarDay ? DAY_FILL : NIGHT_FILL);
    dayWedge.setAttribute('visibility', 'hidden');
    clearMarkers();
    paintDialText(function () { return isPolarDay; });
    notify({ state: isPolarDay ? 'polar-day' : 'polar-night' });
  }

  /** Parse "HH:MM" to minutes past midnight, or null if malformed. */
  function parseHM(str) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(str || '');
    if (!m) return null;
    var h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  /**
   * Dial offset that puts the midpoint of the waking window at the top, so
   * the awake hours sit symmetric about the vertical axis. Wake/bed are dial
   * readings (the frame the hands already use), so no timezone conversion is
   * needed. A bedtime at or before wake means it falls the next day.
   */
  function louisOffset() {
    var wake = parseHM(wakeTime);
    var bed = parseHM(bedTime);
    if (wake === null || bed === null) return 0;
    if (bed <= wake) bed += 1440;
    var midFraction = ((wake + bed) / 2 % 1440) / 1440;
    return -((midFraction * 360 + 180) % 360);
  }

  /** Dial angle for a time given in minutes past midnight. */
  function minutesToAngle(minutes) {
    return (minutes / 1440 * 360 + 180) % 360;
  }

  /** Format minutes-past-midnight the same way the sun times are shown. */
  function formatMinutes(minutes) {
    var d = new Date(2000, 0, 1);
    d.setMinutes(minutes);
    return formatTime(d);
  }

  function clearLouisLines() {
    while (louisGroup.firstChild) {
      louisGroup.removeChild(louisGroup.firstChild);
    }
  }

  /** A thin line from the hub to the rim, with the time called out outside it. */
  function addLouisLine(angle, timeText) {
    var end = Clock24.angleToPoint(angle, R);
    var line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', C);
    line.setAttribute('y1', C);
    line.setAttribute('x2', end.x.toFixed(2));
    line.setAttribute('y2', end.y.toFixed(2));
    line.setAttribute('class', 'wake-sleep-line');
    louisGroup.appendChild(line);

    var label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('class', 'wake-sleep-label');
    label.setAttribute('data-angle', angle);
    label.textContent = timeText;
    placeRimLabel(label, angle);
    louisGroup.appendChild(label);
  }

  /** Draw the wake/sleep lines when Louis XIV mode is on; otherwise clear them. */
  function renderLouisLines() {
    clearLouisLines();
    if (orientation !== 'louis') return;
    var wake = parseHM(wakeTime);
    var bed = parseHM(bedTime);
    if (wake === null || bed === null) return;
    addLouisLine(Clock24.displayAngle(minutesToAngle(wake)), formatMinutes(wake));
    addLouisLine(Clock24.displayAngle(minutesToAngle(bed)), formatMinutes(bed));
  }

  /**
   * Place a rim time label as a radial spoke: its center line runs along the
   * marker's radial line, its inner end just past the rim, reading outward. On
   * the right half the text is left-justified; on the left half it is right-
   * justified and flipped 180° so it stays upright. Keeping labels radial (not
   * horizontal) shrinks their tangential footprint, so near-coincident times
   * need far less separation.
   */
  function placeRimLabel(el, angle) {
    var rad = angle * Math.PI / 180;
    var s = Math.sin(rad), c = Math.cos(rad);
    var p = Clock24.angleToPoint(angle, LABEL_RADIUS);
    var rot = Math.atan2(-c, s) * 180 / Math.PI; // outward radial direction
    var anchor = 'start';
    if (s < 0) { anchor = 'end'; rot += 180; } // left half: flip to stay upright
    el.setAttribute('x', p.x.toFixed(2));
    el.setAttribute('y', p.y.toFixed(2));
    el.setAttribute('text-anchor', anchor);
    el.setAttribute('transform',
      'rotate(' + rot.toFixed(2) + ' ' + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ')');
  }

  /**
   * When two rim time labels (sun and/or wake/sleep) fall at nearly the same
   * angle they overlap — e.g. a wake time within a couple of minutes of
   * sunrise. Slide the crowded ones apart along the rim so both stay readable,
   * pushing each symmetrically away from the shared midpoint. Only the text
   * moves; every tick and line still points at its true time.
   */
  function resolveLabelCollisions() {
    var els = document.querySelectorAll('.sun-marker-label, .wake-sleep-label');
    if (els.length < 2) return;
    var items = [];
    for (var i = 0; i < els.length; i++) {
      items.push({ el: els[i], angle: Number(els[i].getAttribute('data-angle')) });
    }
    items.sort(function (a, b) { return a.angle - b.angle; });
    var n = items.length;

    for (var iter = 0; iter < 50; iter++) {
      var moved = false;
      for (var j = 0; j < n; j++) {
        var a = items[j];
        var b = items[(j + 1) % n];
        var gap = b.angle - a.angle + (j === n - 1 ? 360 : 0);
        if (gap < MIN_LABEL_GAP - 1e-6) {
          var push = (MIN_LABEL_GAP - gap) / 2;
          a.angle -= push;
          b.angle += push;
          moved = true;
        }
      }
      if (!moved) break;
    }

    items.forEach(function (it) { placeRimLabel(it.el, it.angle); });
  }

  /**
   * Dial offset for the current orientation. Centered mode puts solar noon
   * (which sunrise and sunset are symmetric about) at the top, so the day
   * slice mirrors across the vertical axis — including on polar days/nights,
   * where there is no sunrise but solar noon is still defined. Louis XIV mode
   * centers the manually entered waking window instead, independent of location.
   */
  function computeDialOffset(times) {
    if (orientation === 'louis') return louisOffset();
    if (orientation !== 'centered' || !times) return 0;
    return -Clock24.timeToAngle(Clock24.toZoned(times.solarNoon));
  }

  function refresh() {
    // Orient first: Louis XIV mode centers the waking window with no location.
    var times = location
      ? SunCalc.getTimes(new Date(), location.lat, location.lon)
      : null;
    Clock24.setDialOffset(computeDialOffset(times));
    renderLouisLines();

    if (!location) {
      renderNeutral();
    } else {
      renderForLocation(times);
    }

    // Both sun and wake/sleep labels are now placed; separate any that clash.
    resolveLabelCollisions();
  }

  function renderForLocation(times) {
    var sunriseValid = !isNaN(times.sunrise.getTime());
    var sunsetValid = !isNaN(times.sunset.getTime());

    if (!sunriseValid || !sunsetValid) {
      // Polar day or night: decide by the sun's altitude at solar noon.
      var noonPos = SunCalc.getPosition(times.solarNoon, location.lat, location.lon);
      renderPolar(noonPos.altitude > 0);
      return;
    }

    // Convert the absolute instants to wall-clock time at the location so
    // the wedge, markers, and hands all share the same dial.
    var sunriseLocal = Clock24.toZoned(times.sunrise);
    var sunsetLocal = Clock24.toZoned(times.sunset);
    var sunriseAngle = Clock24.timeToAngle(sunriseLocal);
    var sunsetAngle = Clock24.timeToAngle(sunsetLocal);
    var daySweep = (sunsetAngle - sunriseAngle + 360) % 360;

    faceBase.setAttribute('fill', NIGHT_FILL);
    dayWedge.setAttribute('d', wedgePath(Clock24.displayAngle(sunriseAngle),
      Clock24.displayAngle(sunsetAngle)));
    dayWedge.setAttribute('visibility', 'visible');

    clearMarkers();
    addMarker(Clock24.displayAngle(sunriseAngle), formatTime(sunriseLocal));
    addMarker(Clock24.displayAngle(sunsetAngle), formatTime(sunsetLocal));

    paintDialText(function (hour) {
      return inDaylight(Clock24.hourToAngle(hour), sunriseAngle, daySweep);
    });

    notify({ state: 'ok', sunrise: sunriseLocal, sunset: sunsetLocal });
  }

  window.DayNight = {
    setLocation: function (loc) {
      location = loc;
      refresh();
    },
    setOrientation: function (mode) {
      orientation = (mode === 'centered' || mode === 'louis') ? mode : 'noon';
      refresh();
    },
    setWakeBed: function (wake, bed) {
      wakeTime = wake;
      bedTime = bed;
      if (orientation === 'louis') refresh();
    },
    refresh: refresh
  };

  // Initial paint (no location yet; sidebar.js sets one after loading storage).
  refresh();
})();
