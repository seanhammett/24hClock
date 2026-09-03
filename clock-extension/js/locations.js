/*
 * locations.js — the additional locations in the Options panel, and the extra
 * hour hands they put on the face.
 *
 * The main location is the sidebar's, and keeps the real hour hand, the sun and
 * moon that ride it, the day/night slices and the readouts. With company on the
 * dial that hand widens to a pill for its whole length and carries its own name
 * along it; on its own it goes back to the plain hand. Every location
 * added here gets a plain hand with its name written along it — one per colour
 * in the palette, or all of them the same navy in grayscale — turning with the
 * same clock as the main one: one moment, seen from a dozen places.
 * Which moment that is belongs to nothing here — the face reads it through
 * Clock24.now(), so parking it with the simulator moves these hands too.
 *
 * Hands are not converted one by one every frame — that would mean a formatter
 * call per hand per frame. Each location's offset from UTC is measured once,
 * when the list or the moment's day changes, and the hands follow from the
 * difference: one hour is 15° on a 24-hour dial, whole or not.
 */
(function () {
  'use strict';

  var Clock24 = window.Clock24;
  var Places = window.Places;
  var storage = window.Store;
  var C = Clock24.C;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var STORAGE_KEYS = {
    extras: 'extraLocations',
    handStyle: 'handStyle',
    handsHidden: 'handsHidden',
    // Read only, to carry over lists saved when these lived in the simulator
    // and the main location was the first row of them.
    simLocations: 'simLocations'
  };

  // Eleven besides the main one, which is where the dial stops being readable.
  var MAX_EXTRA = 11;

  // One colour per extra hand, taken by position in the list so a location
  // keeps its colour while it stays put. Near-primaries first — red, blue,
  // yellow, green — since those are the furthest apart anything can be and most
  // lists are short; the secondaries fill in behind them. They are saturated
  // rather than pale because what carries a hand's colour is a 3px core inside
  // a 6px dark outline, so the outline does the separating from the face and
  // the core is free to be vivid.
  //
  // Two colours on the dial are spoken for: the accent (#ff6b57, the second
  // hand and the sun markers) and the wake/sleep gold (#f2c14e). The red and
  // the yellow below are the nearest neighbours of those, and are pitched
  // deeper and purer to stay apart from them — and neither of the two is ever
  // drawn as a hand with a name on it, which is the bigger difference.
  var HAND_COLORS = [
    '#e02d22', // red
    '#1a63e0', // blue
    '#f5c400', // yellow
    '#2eb84d', // green
    '#9a4fe0', // violet
    '#ff8a1f', // orange
    '#00bcd4', // cyan
    '#e0208a', // magenta
    '#8fce1f', // lime
    '#5c63e8', // indigo
    '#00b894'  // teal
  ];

  // Writing on a pill, dark or light. Which one a colour takes is worked out
  // from the colour rather than fixed, because a saturated palette runs from
  // yellow to indigo and no single ink reads on both.
  var INK_DARK = '#12233f';
  var INK_LIGHT = '#f4f7fc';

  // Grayscale: every hand the same navy the outlines are drawn in, turned
  // inside out — the light stroke on the outside, the dark one within — so an
  // extra hand still reads against both halves of the face and still cannot be
  // mistaken for the hour hand, which is that arrangement the other way round.
  //
  // The light stroke stands a little less proud than the dark one does in
  // colour: a pale halo carries further than a navy one against the same face,
  // so at the same width it reads as the heavier hand of the two.
  var MONO_EDGE = '#e8ecf4';
  var MONO_CORE = '#1c2742';
  var MONO_OUTLINE_W = 4.5;
  var MONO_EDGE_GROW = 1;

  // Every extra hand is the same length as the real hour hand, and reaches the
  // same point on the dial: they are all hour hands showing the same moment,
  // and one that stopped short would read as saying something else. Two places
  // in the same zone therefore lie exactly on top of each other, which is what
  // the '+' on a shared name is for. They start at the hub rather than reaching
  // back past it the way the real hands do — a dozen tails crossing at the
  // centre is a knot.

  // A name rides on a pill lying along its hand, running from the centre out to
  // wherever the name ends. Every name begins the same distance out, which is
  // both the simplest rule and the one that reads best: two hands an hour apart
  // are 15° apart on this dial and only 2·r·sin(7.5°) from each other at radius
  // r, so a name set at 30 has cleared its neighbour's pill by the time it is
  // written — and with every name at the same radius the dial reads as laid out
  // rather than patched.
  var PILL_START = 0;
  var PILL_PAD_IN = 30;  // where the writing begins; the hub's edge is at 8
  var PILL_PAD_OUT = 6;
  var PILL_WIDTH = 8.5;  // across the hand; narrower than the hub over its end
  var PILL_GAP = 9;      // clear hand between a pill's end and the hand's tip

  // A hand and its pill are drawn as one silhouette — every dark shape first,
  // then every light one over it — so no outline is ever left lying across the
  // hand where the two meet.
  var OUTLINE = '#1c2742';
  var OUTLINE_W = 6;
  var CORE_W = 3;
  var EDGE = 1.5;        // how far the dark silhouette stands proud of the light

  // The main location's pill has to keep clear of the sun and moon, which ride
  // in the middle of its hand.
  var ICON_R = 15;
  var ICON_CLEAR = 5;

  // ---- State --------------------------------------------------------------

  var handStyle = 'colour'; // or 'mono': see HAND_COLORS and MONO_CORE above
  // The hands off the face, the list kept. The rows go on telling the time in
  // every place — it is only the dial that goes back to one hand.
  var handsHidden = false;
  var extras = [];   // [{ place, lat, lon, tz }] — everywhere but the main one
  var zones = [];    // parallel: each extra's Clock24 zone
  var offsets = [];  // parallel: minutes east of UTC at the moment on show
  var mainOffset = 0;

  // What is on the dial now, so the frame loop can turn it without building it
  // again.
  var drawn = [];
  var mainDrawn = null;

  // ---- Elements -----------------------------------------------------------

  var handsGroup = document.getElementById('extra-hands');
  var labelsGroup = document.getElementById('hand-labels');
  var rowsEl = document.getElementById('loc-rows');
  var addButton = document.getElementById('loc-add');
  var styleField = document.getElementById('loc-style-field');
  var hideButton = document.getElementById('loc-hide');
  var styleButtons = {
    colour: document.getElementById('loc-style-colour'),
    mono: document.getElementById('loc-style-mono')
  };
  var errorEl = document.getElementById('loc-error');

  // ---- Small helpers ------------------------------------------------------

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** Zoned readings carry their wall clock in UTC. See toZoneTime in clock.js. */
  function hhmm(d) {
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }

  /** A zone for a location, falling back if its saved name is unresolvable. */
  function zoneFor(loc) {
    try {
      return Clock24.makeZone(loc.tz);
    } catch (e) {
      return Clock24.makeZone(Places.zoneFromLongitude(loc.lon));
    }
  }

  /** The main location, as the sidebar has it, or null if none is set. */
  function mainLocation() {
    return (window.Sidebar && window.Sidebar.mainLocation()) || null;
  }

  /**
   * Short enough for the rim. Cities give up their name before the comma;
   * custom coordinates borrow the city their timezone is named for, which is
   * both shorter and more use than the numbers.
   */
  function shortLabel(loc) {
    var place = Places.find(loc.place);
    if (place) return place.label.split(',')[0];
    if (loc.tz && loc.tz.type === 'iana') {
      return loc.tz.name.split('/').pop().replace(/_/g, ' ');
    }
    if (loc.tz && loc.tz.type === 'offset') {
      var h = loc.tz.minutes / 60;
      return 'UTC' + (h >= 0 ? '+' : '−') + Math.abs(h);
    }
    return 'Custom';
  }

  function showError(message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }

  // ---- Persistence --------------------------------------------------------

  function save() {
    var entry = {};
    entry[STORAGE_KEYS.extras] = extras;
    entry[STORAGE_KEYS.handStyle] = handStyle;
    entry[STORAGE_KEYS.handsHidden] = handsHidden;
    storage.set(entry);
  }

  /** Keep a zone per extra. Rebuilt whenever the list or a row's place changes. */
  function syncZones() {
    zones = extras.map(zoneFor);
  }

  // ---- Drawing ------------------------------------------------------------

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
    return el;
  }

  /** A stroke along the hand, measured out from the hub. */
  function radialLine(from, to, stroke, width, cap) {
    return svgEl('line', {
      x1: C, y1: (C - from).toFixed(2), x2: C, y2: (C - to).toFixed(2),
      stroke: stroke, 'stroke-width': width, 'stroke-linecap': cap || 'butt'
    });
  }

  /**
   * The pill itself, lying along the hand from `r0` outward. `grow` puffs it
   * out for the dark copy that goes underneath, which is all the outline is:
   * the same shape, a little larger, laid down with the hand's own.
   */
  function pillRect(r0, len, grow, fill, cls) {
    var across = PILL_WIDTH + grow * 2;
    var rect = svgEl('rect', {
      x: (C - across / 2).toFixed(2), y: (C - r0 - len - grow).toFixed(2),
      width: across.toFixed(2), height: (len + grow * 2).toFixed(2),
      rx: (across / 2).toFixed(2), fill: fill
    });
    if (cls) rect.setAttribute('class', cls);
    return rect;
  }

  function rotation(angle) {
    return 'rotate(' + angle.toFixed(3) + ' ' + C + ' ' + C + ')';
  }

  function norm360(angle) {
    return ((angle % 360) + 360) % 360;
  }

  /** Past the six o'clock line a name would run backwards, so it is turned. */
  function isFlipped(angle) {
    return norm360(angle) > 180;
  }

  function makeLabel(text, ink) {
    var label = svgEl('text', {
      'class': 'hand-label', x: 0, y: 0, fill: ink,
      'text-anchor': 'middle', 'dominant-baseline': 'central'
    });
    label.textContent = text.toUpperCase();
    return label;
  }

  /** Relative luminance of a #rrggbb, on the WCAG curve. */
  function luminance(hex) {
    var channel = function (i) {
      var c = parseInt(hex.substr(1 + i * 2, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  }

  /**
   * Dark or light writing, whichever reads better on a pill of this colour —
   * by contrast ratio against each, rather than a lightness cutoff picked by
   * hand. The two inks are not equally far from the middle, so the crossover is
   * not at the middle either.
   */
  function inkFor(fill) {
    var lum = luminance(fill);
    var onDark = (lum + 0.05) / (luminance(INK_DARK) + 0.05);
    var onLight = (luminance(INK_LIGHT) + 0.05) / (lum + 0.05);
    return onDark >= onLight ? INK_DARK : INK_LIGHT;
  }

  /**
   * How one extra hand is painted: the wide stroke laid down first, the narrow
   * one over it, and the writing on the pill the narrow one also fills.
   *
   * In colour the wide stroke is the same navy every outline on the face is
   * drawn in and the hand's own colour sits inside it. Grayscale swaps them:
   * the light stroke goes outside and the navy within, which keeps the hand
   * legible on both halves of the face without giving it a colour at all.
   */
  function paintFor(index) {
    if (handStyle === 'mono') {
      return {
        edge: MONO_EDGE, fill: MONO_CORE, ink: MONO_EDGE,
        edgeWidth: MONO_OUTLINE_W, edgeGrow: MONO_EDGE_GROW
      };
    }
    var colour = HAND_COLORS[index % HAND_COLORS.length];
    return {
      edge: OUTLINE, fill: colour, ink: inkFor(colour),
      edgeWidth: OUTLINE_W, edgeGrow: EDGE
    };
  }

  /**
   * A name longer than the room its hand has is squeezed to fit rather than
   * allowed to run out over the numerals or the sun. Only the longest few
   * place names on the shortest hands ever reach this.
   */
  function fitLabel(label, natural, room) {
    if (natural <= room) return natural;
    label.setAttribute('textLength', room.toFixed(2));
    label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    return room;
  }

  function placeLabel(label, angle, middle) {
    label.setAttribute('transform',
      'translate(' + C + ' ' + (C - middle).toFixed(2) + ') ' +
      'rotate(' + (isFlipped(angle) ? 90 : -90) + ')');
  }

  /**
   * One extra location's hand, with its name on a pill coming out from under
   * the hub. The pill cannot be cut until the name has been measured and the
   * name cannot be measured until it is in the document, so the name goes in
   * first and is moved back to the front once everything under it exists.
   */
  function addHand(paint, tip, angle, text) {
    var group = svgEl('g', { transform: rotation(angle) });
    handsGroup.appendChild(group);

    var label = null;
    var width = 0;
    var len = 0;
    if (text) {
      label = makeLabel(text, paint.ink);
      group.appendChild(label);
      var room = tip - PILL_GAP - PILL_PAD_IN - PILL_PAD_OUT;
      width = fitLabel(label, label.getComputedTextLength(), room);
      // Measured from the hub, since that is where every pill begins.
      len = PILL_PAD_IN + width + PILL_PAD_OUT;
    }

    group.appendChild(radialLine(0, tip, paint.edge, paint.edgeWidth, 'round'));
    if (label) {
      group.appendChild(pillRect(PILL_START, len, paint.edgeGrow, paint.edge));
    }

    group.appendChild(radialLine(0, tip, paint.fill, CORE_W, 'round'));
    if (label) {
      group.appendChild(pillRect(PILL_START, len, 0, paint.fill, 'hand-pill'));
      placeLabel(label, angle, PILL_PAD_IN + width / 2);
      group.appendChild(label);
    }
    return { el: group, flipped: isFlipped(angle) };
  }

  /**
   * The main location's name, written straight along the real hour hand. Once
   * there is a second place on the dial that hand grows to a pill's width for
   * its whole length — see setHourHandWeight below — so it is its own pill and
   * needs no shape drawn on it: only the writing goes here.
   *
   * The hand carries the sun and moon in the middle of it, so the name takes
   * whichever side of them has more room: from the hub out to the icon, unless
   * the icon sits so far in that there is more hand beyond it than before it.
   * Either way the writing stays within the hand, which is what it is written
   * on — so the outer bound is the hand's own tip, not the dial's.
   */
  function addMainName(text, angle) {
    var group = svgEl('g', { transform: rotation(angle) });
    labelsGroup.appendChild(group);

    var label = makeLabel(text, INK_DARK);
    group.appendChild(label);

    var icon = Clock24.iconRadius();
    var inner = icon - ICON_R - ICON_CLEAR;
    var outer = icon + ICON_R + ICON_CLEAR;
    var tip = Clock24.hourTipRadius() - PILL_PAD_OUT;
    var inboard = (inner - PILL_PAD_IN) >= (tip - outer);
    var from = inboard ? PILL_PAD_IN : outer;
    var room = Math.max(0, (inboard ? inner : tip) - from);

    var width = fitLabel(label, label.getComputedTextLength(), room);
    placeLabel(label, angle, from + width / 2);
    return { el: group, flipped: isFlipped(angle) };
  }

  /** The hour hand as a pill along its whole length, or as the plain hand. */
  function setMainHandWeight(named) {
    if (named) Clock24.setHourHandWeight(PILL_WIDTH + EDGE * 2, PILL_WIDTH);
    else Clock24.setHourHandWeight();
  }

  /**
   * One name per hour stood on. Places on the same offset stand on exactly the
   * same spot on the dial, so only the highest ranked of them is named and a
   * '+' says the rest are underneath. The main location is first in that
   * ranking and takes the name onto its own hand when it wins: Sonoma as the
   * main location and Los Angeles below it reads "SONOMA +" on the hour hand.
   *
   * With no main location set there is no main hand to name — the dial is the
   * browser's own clock — so that slot drops out of the ranking altogether and
   * an extra sharing its hour is named in its own right.
   */
  function namesByIndex(labels, offs) {
    var named = {};
    var out = [];
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] === null) { out.push(null); continue; }
      var key = String(offs[i]);
      if (named[key]) { out.push(null); continue; }
      named[key] = true;
      var shared = 0;
      for (var j = 0; j < labels.length; j++) {
        if (labels[j] !== null && offs[j] === offs[i]) shared++;
      }
      out.push(labels[i] + (shared > 1 ? ' +' : ''));
    }
    return out;
  }

  /**
   * Draw a hand for every extra location, and a name for every hour they stand
   * on. Called from the daynight:updated event rather than directly, because a
   * repaint can change the dial offset — "day & night centered" turns the whole
   * dial by solar noon — and these angles have to be measured against the
   * offset in force.
   *
   * A rebuild can be a date or a summer time boundary away from the last one,
   * so the offsets are taken again here rather than trusted.
   */
  function render() {
    clear(handsGroup);
    clear(labelsGroup);
    drawn = [];
    mainDrawn = null;
    // With nowhere else on the dial — no other places, or their hands put away
    // — there is nothing to tell apart, so the hour hand goes back to being
    // simply the hour hand: no name along it, and the plain weight it wears
    // without one.
    if (!extras.length || handsHidden) { setMainHandWeight(false); return; }

    var at = Clock24.now();
    var main = mainLocation();
    mainOffset = Clock24.offsetMinutes(Clock24.getTimeZone(), at);
    offsets = zones.map(function (z) { return Clock24.offsetMinutes(z, at); });

    var mainAngle = Clock24.displayAngle(Clock24.timeToAngle(Clock24.toZoned(at)));
    // The main location first in both, because its hand is drawn over every
    // other one and its name over every other name.
    var allOffsets = [mainOffset].concat(offsets);
    var names = namesByIndex(
      [main ? shortLabel(main) : null].concat(extras.map(shortLabel)), allOffsets);

    // Back to front, so the higher a place sits in the list the further forward
    // its hand is drawn.
    for (var i = extras.length - 1; i >= 0; i--) {
      var delta = (offsets[i] - mainOffset) / 1440 * 360;
      var hand = addHand(paintFor(i), Clock24.hourTipRadius(),
        norm360(mainAngle + delta), names[i + 1]);
      hand.delta = delta;
      drawn.push(hand);
    }

    setMainHandWeight(!!names[0]);
    if (names[0]) mainDrawn = addMainName(names[0], mainAngle);
  }

  /**
   * The hands have to keep up with the clock, real or parked. Rebuilding them
   * sixty times a second would mean measuring a dozen names that often, so they
   * are only turned: each extra hand is the hour hand's own angle plus its
   * fixed offset from it. The one thing a turn cannot do is flip a name that
   * has crossed the six o'clock line, which is worth a rebuild — twice a day at
   * most, per hand.
   */
  Clock24.onFrame(function (hourAngle) {
    for (var i = 0; i < drawn.length; i++) {
      // The angle handed over has the dial's own rotation in it already, so
      // this adds only the hand's offset from the main one. Putting it back
      // through displayAngle would turn the extra hands by the dial offset a
      // second time — which does nothing at all with 12 noon at top.
      var angle = norm360(hourAngle + drawn[i].delta);
      if (isFlipped(angle) !== drawn[i].flipped) { render(); return; }
      drawn[i].el.setAttribute('transform', rotation(angle));
    }
    if (mainDrawn) {
      if (isFlipped(hourAngle) !== mainDrawn.flipped) { render(); return; }
      mainDrawn.el.setAttribute('transform', rotation(hourAngle));
    }
    retimeRows();
  });

  // Each place's own clock in the panel, which only ever changes by the minute
  // — of the moment on show, so a scrubbed clock takes the rows with it.
  var shownMinute = null;

  function retimeRows() {
    var minute = Math.floor(Clock24.now().getTime() / 60000);
    if (minute === shownMinute) return;
    shownMinute = minute;
    renderRowTimes();
  }

  // daynight.js fires this at the end of every repaint, once the dial offset
  // for the new state is settled. Every repaint arrives this way, and a repaint
  // is also how a change of main location, of the simulated moment or of the
  // date reaches us: each of those goes through DayNight before it gets here.
  document.addEventListener('daynight:updated', function () {
    render();
    renderRowTimes();
  });

  // ---- The location rows --------------------------------------------------

  /** Each row's own wall-clock reading of the moment on show. */
  function renderRowTimes() {
    var at = Clock24.now();
    var els = rowsEl.querySelectorAll('.loc-time');
    for (var i = 0; i < els.length && i < zones.length; i++) {
      els[i].textContent = hhmm(Clock24.toZoneTime(at, zones[i]));
    }
  }

  function buildRow(loc, index) {
    var row = document.createElement('div');
    row.className = 'loc-row';

    var head = document.createElement('div');
    head.className = 'loc-row-head';

    var swatch = document.createElement('span');
    swatch.className = 'loc-swatch';
    var paint = paintFor(index);
    swatch.style.background = paint.fill;
    swatch.style.borderColor = paint.edge;
    swatch.setAttribute('aria-hidden', 'true');
    head.appendChild(swatch);

    var select = document.createElement('select');
    select.className = 'loc-place';
    select.setAttribute('aria-label', 'Location ' + (index + 2));
    Places.fillPlaceSelect(select, Places.find(loc.place) ? loc.place : 'custom');
    head.appendChild(select);

    var up = document.createElement('button');
    up.type = 'button';
    up.className = 'loc-btn';
    up.textContent = '↑';
    up.title = index === 0 ? 'Make this the main location' : 'Move up';
    head.appendChild(up);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'loc-btn';
    remove.textContent = '×';
    remove.title = 'Remove';
    head.appendChild(remove);

    var time = document.createElement('span');
    time.className = 'loc-time';
    time.textContent = '–';
    head.appendChild(time);

    row.appendChild(head);

    var coords = document.createElement('div');
    coords.className = 'coord-row loc-coords';
    coords.hidden = !!Places.find(loc.place);
    var latInput = coordField(coords, 'Latitude', loc.lat, -90, 90);
    var lonInput = coordField(coords, 'Longitude', loc.lon, -180, 180);
    row.appendChild(coords);

    select.addEventListener('change', function () {
      var place = Places.find(select.value);
      if (place) {
        extras[index] = {
          place: place.id, lat: place.lat, lon: place.lon,
          tz: { type: 'iana', name: place.tz }
        };
      } else {
        // "Custom coordinates…": keep where the row already was and let the
        // inputs, now revealed, take it from here.
        extras[index] = {
          place: 'custom', lat: loc.lat, lon: loc.lon,
          tz: Places.zoneForCoords(loc.lat, loc.lon)
        };
      }
      showError(null);
      save();
      renderRows();
      render();
    });

    var debounce = null;
    function onCoordInput() {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        var lat = Number(latInput.value);
        var lon = Number(lonInput.value);
        if (latInput.value.trim() === '' || lonInput.value.trim() === '') {
          showError('Enter both a latitude and a longitude.');
          return;
        }
        if (isNaN(lat) || lat < -90 || lat > 90) {
          showError('Latitude must be between −90 and 90.');
          return;
        }
        if (isNaN(lon) || lon < -180 || lon > 180) {
          showError('Longitude must be between −180 and 180.');
          return;
        }
        showError(null);
        // No re-render of the rows: that would take the focus out of the field
        // being typed in. The row's own controls are already correct for a
        // custom place.
        extras[index] = {
          place: 'custom', lat: lat, lon: lon, tz: Places.zoneForCoords(lat, lon)
        };
        syncZones();
        save();
        render();
        renderRowTimes();
      }, 400);
    }

    latInput.addEventListener('input', onCoordInput);
    lonInput.addEventListener('input', onCoordInput);

    // Promoting the top row swaps it with the main location, which the sidebar
    // owns; the one it displaces comes back into the list in its place, so
    // nothing is lost either way round.
    up.addEventListener('click', function () {
      var moved = extras.splice(index, 1)[0];
      if (index === 0) {
        var old = mainLocation();
        if (old) extras.unshift(old);
        save();
        renderRows();
        window.Sidebar.setMainLocation(moved);
        return;
      }
      extras.splice(index - 1, 0, moved);
      save();
      renderRows();
      render();
    });

    remove.addEventListener('click', function () {
      extras.splice(index, 1);
      save();
      renderRows();
      render();
    });

    return row;
  }

  /** One of the two number inputs in a row's custom-coordinates pair. */
  function coordField(parent, labelText, value, min, max) {
    var field = document.createElement('div');
    field.className = 'field';
    var label = document.createElement('label');
    label.textContent = labelText;
    var input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.min = String(min);
    input.max = String(max);
    input.inputMode = 'decimal';
    input.value = String(value);
    label.appendChild(input);
    field.appendChild(label);
    parent.appendChild(field);
    return input;
  }

  function renderRows() {
    syncZones();
    clear(rowsEl);
    extras.forEach(function (loc, i) {
      rowsEl.appendChild(buildRow(loc, i));
    });
    addButton.disabled = extras.length >= MAX_EXTRA;
    // Nothing to colour until there is a hand, so the choice appears with it.
    styleField.hidden = !extras.length;
    shownMinute = null;
    renderRowTimes();
  }

  /**
   * Three dots per button, showing what that mode does rather than naming it:
   * the first three colours of the palette, or three of the one navy every
   * grayscale hand is drawn in, each ringed the way the hand itself is.
   */
  function buildStyleDots() {
    Object.keys(styleButtons).forEach(function (mode) {
      var host = styleButtons[mode].querySelector('.loc-dots');
      clear(host);
      for (var i = 0; i < 3; i++) {
        var dot = document.createElement('span');
        dot.className = 'loc-dot';
        dot.style.background = mode === 'mono' ? MONO_CORE : HAND_COLORS[i];
        dot.style.borderColor = mode === 'mono' ? MONO_EDGE : OUTLINE;
        host.appendChild(dot);
      }
    });
  }

  function showStyle() {
    Object.keys(styleButtons).forEach(function (mode) {
      var on = mode === handStyle;
      styleButtons[mode].setAttribute('aria-pressed', on ? 'true' : 'false');
      styleButtons[mode].classList.toggle('is-on', on);
    });
    hideButton.setAttribute('aria-pressed', handsHidden ? 'true' : 'false');
    hideButton.classList.toggle('is-on', handsHidden);
  }

  function chooseStyle(mode) {
    if (mode === handStyle) return;
    handStyle = mode;
    showStyle();
    save();
    renderRows();
    render();
  }

  Object.keys(styleButtons).forEach(function (mode) {
    styleButtons[mode].addEventListener('click', function () { chooseStyle(mode); });
  });

  hideButton.addEventListener('click', function () {
    handsHidden = !handsHidden;
    showStyle();
    save();
    render();
  });

  /** A city not already on the dial: a favorite if there is a spare one. */
  function nextUnusedPlace() {
    var used = {};
    var main = mainLocation();
    if (main) used[main.place] = true;
    extras.forEach(function (r) { used[r.place] = true; });
    var favorites = Places.getFavorites().map(Places.find).filter(Boolean);
    var pool = favorites.concat(Places.all);
    for (var i = 0; i < pool.length; i++) {
      if (!used[pool[i].id]) return pool[i];
    }
    return Places.all[0];
  }

  addButton.addEventListener('click', function () {
    if (extras.length >= MAX_EXTRA) return;
    var place = nextUnusedPlace();
    extras.push({
      place: place.id, lat: place.lat, lon: place.lon,
      tz: { type: 'iana', name: place.tz }
    });
    save();
    renderRows();
    render();
  });

  // ---- Restore ------------------------------------------------------------

  storage.get([STORAGE_KEYS.extras, STORAGE_KEYS.handStyle,
    STORAGE_KEYS.handsHidden, STORAGE_KEYS.simLocations], function (items) {
    var saved = items[STORAGE_KEYS.extras];
    // Lists saved while these lived in the simulator began with the main
    // location, which now has a home of its own in the panel above.
    var migrated = false;
    if (!Array.isArray(saved) && Array.isArray(items[STORAGE_KEYS.simLocations])) {
      saved = items[STORAGE_KEYS.simLocations].slice(1);
      migrated = true;
    }
    if (Array.isArray(saved)) {
      extras = saved.filter(function (r) {
        return r && typeof r.lat === 'number' && typeof r.lon === 'number' && r.tz;
      }).slice(0, MAX_EXTRA);
    }

    handStyle = items[STORAGE_KEYS.handStyle] === 'mono' ? 'mono' : 'colour';
    handsHidden = items[STORAGE_KEYS.handsHidden] === true;
    buildStyleDots();
    showStyle();
    // Written out at once, so the old list is read exactly once and every load
    // after this one starts from the list this panel actually owns.
    if (migrated) save();
    renderRows();
    render();
  });

  window.Locations = {
    /** Redraw the hands: the face's own geometry has moved under them. */
    render: render,
    /** Rebuild the rows: the favorites their menus are grouped by have moved. */
    refreshRows: renderRows
  };
})();
