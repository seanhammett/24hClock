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
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var location = null; // { lat, lon } or null
  var orientation = 'noon'; // 'noon' (12 at top) | 'centered' (day slice at top)

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
    var inner = Clock24.angleToPoint(angle, R - 2);
    var outer = Clock24.angleToPoint(angle, R + 8);
    var tick = document.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', inner.x.toFixed(2));
    tick.setAttribute('y1', inner.y.toFixed(2));
    tick.setAttribute('x2', outer.x.toFixed(2));
    tick.setAttribute('y2', outer.y.toFixed(2));
    tick.setAttribute('class', 'sun-marker');
    markersGroup.appendChild(tick);

    var pos = Clock24.angleToPoint(angle, R + 24);
    var label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', pos.x.toFixed(2));
    label.setAttribute('y', pos.y.toFixed(2));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('class', 'sun-marker-label');
    label.textContent = timeText;
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

  /**
   * Dial offset for the current orientation. Centered mode puts solar noon
   * (which sunrise and sunset are symmetric about) at the top, so the day
   * slice mirrors across the vertical axis — including on polar days/nights,
   * where there is no sunrise but solar noon is still defined.
   */
  function computeDialOffset(times) {
    if (orientation !== 'centered' || !times) return 0;
    return -Clock24.timeToAngle(Clock24.toZoned(times.solarNoon));
  }

  function refresh() {
    if (!location) {
      Clock24.setDialOffset(0);
      renderNeutral();
      return;
    }

    var now = new Date();
    var times = SunCalc.getTimes(now, location.lat, location.lon);
    Clock24.setDialOffset(computeDialOffset(times));
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
      orientation = mode === 'centered' ? 'centered' : 'noon';
      refresh();
    },
    refresh: refresh
  };

  // Initial paint (no location yet; sidebar.js sets one after loading storage).
  refresh();
})();
