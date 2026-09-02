/*
 * simulator.js — the Simulator tab. Parks the clock at a chosen date and time
 * and gives every location after the first its own hour hand.
 *
 * The first location is the main one: it keeps the real hour hand, the sun and
 * moon that ride it, the day/night slices and the readouts, exactly as the live
 * clock does. Every other location gets a plain coloured hand with its name
 * written along it. The date and time are entered as wall-clock at the main
 * location and turned into one absolute instant; every other hand is derived
 * from that same instant, so the face always shows a single moment seen from a
 * dozen places.
 *
 * Hands are not converted one by one every frame — that would mean a formatter
 * call per hand per frame. Each location's offset from UTC is measured once,
 * when the instant or the list changes, and the hands follow from the
 * difference: one hour is 15° on a 24-hour dial, whole or not.
 */
(function () {
  'use strict';

  var Clock24 = window.Clock24;
  var DayNight = window.DayNight;
  var Places = window.Places;
  var storage = window.Store;
  var makeEntry = window.Store.entry;
  var C = Clock24.C;
  var R = Clock24.R;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var STORAGE_KEYS = {
    locations: 'simLocations',
    dateTime: 'simDateTime',
    orientation: 'simOrientation',
    liveTime: 'simLiveTime',
    // Read only, to seed the list the first time from the everyday location.
    liveLocation: 'location'
  };

  var MAX_LOCATIONS = 12;

  // One colour per extra hand, taken by position in the list so a location
  // keeps its colour while it stays put. Each has to read against both halves
  // of the face — the pale daylight and the navy night — and stay clear of
  // the accent (#ff6b57, the second hand and sun markers) and the wake/sleep
  // gold (#f2c14e). The first few are the most widely separated, since most
  // lists are short.
  var HAND_COLORS = [
    '#4fb4d9', '#56d96b', '#a37de5', '#e58aab', '#4fd9c4', '#c3d94f',
    '#7d99e5', '#d95fc0', '#8ad94f', '#4fd9f0', '#ce9de5'
  ];

  // Every extra hand is the same length as the real hour hand, and reaches the
  // same point on the dial: they are all hour hands showing the same moment,
  // and one that stopped short would read as saying something else. Two places
  // in the same zone therefore lie exactly on top of each other, which is what
  // the '+' on a shared name is for. They start at the hub rather than reaching
  // back past it the way the real hands do — a dozen tails crossing at the
  // centre is a knot.

  // A name rides on a pill lying along its hand, starting at the centre and
  // running only as far as the name needs. The hub is drawn over the pill's
  // inner end, so the writing starts far enough along to clear it.
  var PILL_START = 0;
  var PILL_PAD_IN = 11;  // the hub's outer edge is at 8
  var PILL_PAD_OUT = 7;
  var PILL_WIDTH = 10;   // across the hand; narrower than the hub over its end
  var PILL_GAP = 9;      // clear hand between a pill's end and the hand's tip

  // Nothing reaches past this: the hour numerals are centred at 150 and the
  // minute hand stops at 136, so that is where the dial's middle ends.
  var PILL_LIMIT = 136;
  var PILL_INNER_LIMIT = 0;

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

  // The hour hand's own light core, so the main location's pill belongs to the
  // hand it names the way the coloured ones do.
  var MAIN_FILL = '#e8ecf4';

  var DAY_MINUTES = 1440;

  // The scrub's thumb, which has to be taken off the track's width to work out
  // where along the day a given pixel falls. Set to match the slider's own
  // width in newtab.css.
  var THUMB = 16;

  // ---- State --------------------------------------------------------------

  var active = false;
  var live = false;   // the real clock drives the moment, the places stay
  var rows = [];      // [{ place, lat, lon, tz }] — index 0 is the main one
  var zones = [];     // parallel: each row's Clock24 zone
  var offsets = [];   // parallel: minutes east of UTC at the current instant
  var instant = null; // the absolute moment being simulated
  var orientation = 'noon';

  // What has actually been pushed to DayNight, so scrubbing does not repaint
  // the whole face four times for settings that have not moved.
  var appliedLocationKey = null;
  var deltaTimer = null;

  // What is on the dial now, so live time can turn it without building it again.
  var drawn = [];
  var mainDrawn = null;

  // ---- Elements -----------------------------------------------------------

  var handsGroup = document.getElementById('extra-hands');
  var labelsGroup = document.getElementById('sim-hand-labels');
  var activeInput = document.getElementById('sim-active');
  var dateInput = document.getElementById('sim-date');
  var calTitle = document.getElementById('sim-cal-title');
  var calWeek = document.getElementById('sim-cal-week');
  var calGrid = document.getElementById('sim-cal-grid');
  var calPrev = document.getElementById('sim-cal-prev');
  var calNext = document.getElementById('sim-cal-next');
  var timeInput = document.getElementById('sim-time');
  var slider = document.getElementById('sim-slider');
  var nowButton = document.getElementById('sim-now');
  var liveButton = document.getElementById('sim-live');
  var orientNoon = document.getElementById('sim-orient-noon');
  var orientCentered = document.getElementById('sim-orient-centered');
  var rowsEl = document.getElementById('sim-rows');
  var addButton = document.getElementById('sim-add');
  var errorEl = document.getElementById('sim-error');
  var locationReadout = document.getElementById('location-readout');
  var deltaEl = document.getElementById('sim-delta');

  // ---- Small helpers ------------------------------------------------------

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Zoned readings carry their wall clock in UTC, so both of these read it
  // back out the same way. See toZoneTime in clock.js.

  function isoDate(d) {
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

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

  function describe(loc) {
    var place = Places.find(loc.place);
    var coords = Places.formatCoords(loc.lat, loc.lon);
    return place ? place.label + ' (' + coords + ')' : coords;
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  /**
   * The same day of a later month, or the last day of it where that month is
   * short: one month after 31 January is 28 February, not 3 March.
   */
  function addMonths(base, count) {
    var d = new Date(base.getTime());
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + count);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d;
  }

  /**
   * How far the simulated moment is from now, in years, months, days and
   * hours, with the parts that come to nothing left out. Months and years are
   * counted on the calendar rather than in lots of 30 or 365 days, so the gap
   * from one date to the same date next year is a year exactly.
   */
  function describeGap(target) {
    var future = target >= Date.now();
    var from = new Date(future ? Date.now() : target);
    var to = new Date(future ? target : Date.now());

    var months = (to.getFullYear() - from.getFullYear()) * 12
      + (to.getMonth() - from.getMonth());
    if (months > 0 && addMonths(from, months).getTime() > to.getTime()) months--;
    if (months < 0) months = 0;

    var mark = addMonths(from, months);
    var rest = to.getTime() - mark.getTime();
    var days = Math.floor(rest / 86400000);
    var hours = Math.floor((rest % 86400000) / 3600000);

    var parts = [];
    if (months >= 12) parts.push(plural(Math.floor(months / 12), 'year'));
    if (months % 12) parts.push(plural(months % 12, 'month'));
    if (days) parts.push(plural(days, 'day'));
    if (hours) parts.push(plural(hours, 'hour'));

    return (parts.length ? parts.join(', ') : 'less than an hour')
      + (future ? ' from now' : ' ago');
  }

  function renderDelta() {
    deltaEl.textContent = (active && !live && instant !== null)
      ? describeGap(instant) : '';
  }

  function showError(message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }

  // ---- Persistence --------------------------------------------------------

  function save() {
    var entry = {};
    entry[STORAGE_KEYS.locations] = rows;
    entry[STORAGE_KEYS.orientation] = orientation;
    entry[STORAGE_KEYS.liveTime] = live;
    // A date or time field mid-edit is momentarily empty; saving that would
    // restore an unusable panel next time, so only a complete pair is kept.
    if (dateInput.value && timeInput.value) {
      entry[STORAGE_KEYS.dateTime] = { date: dateInput.value, time: timeInput.value };
    }
    storage.set(entry);
  }

  /** Keep a zone per row. Rebuilt whenever the list or a row's place changes. */
  function syncZones() {
    zones = rows.map(zoneFor);
  }

  // ---- Reading the fields -------------------------------------------------

  /** The instant the fields describe, read as wall clock at the main location. */
  function instantFromFields() {
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput.value);
    var t = /^(\d{1,2}):(\d{2})/.exec(timeInput.value);
    if (!d || !t || !zones.length) return null;
    return Clock24.instantFromWallClock(+d[1], d[2] - 1, +d[3], +t[1], +t[2], zones[0]);
  }

  /**
   * The moment on show: the real one while live time is running, otherwise the
   * one the fields describe. Everything that draws reads it through here, so
   * there is one answer to what the face is showing.
   */
  function moment() {
    if (live) return Date.now();
    return (active && instant !== null) ? instant : instantFromFields();
  }

  /**
   * Put the fields back in step with the moment they describe. Two jobs: when
   * the main location changes the moment holds and the fields move to the new
   * zone's reading of it, rather than the hands jumping; and on commit they
   * show the moment actually reached, which differs from what was typed only
   * in the hour a zone skips on the morning its clocks go forward.
   */
  function fieldsFromInstant() {
    var at = (active && instant !== null) ? instant : instantFromFields();
    // The fields hold the chosen moment even while the real clock is driving.
    if (at === null || !zones.length) return;
    setFields(Clock24.toZoneTime(new Date(at), zones[0]));
  }

  function setFields(zonedDate) {
    dateInput.value = isoDate(zonedDate);
    timeInput.value = hhmm(zonedDate);
    slider.value = String(zonedDate.getUTCHours() * 60 + zonedDate.getUTCMinutes());
    showMonthOf(dateInput.value);
  }

  // ---- The calendar -------------------------------------------------------

  // The date is picked out of a month rather than typed into a field, so the
  // input behind it is only ever the value; everything visible is here. The
  // month on show is not always the month of the chosen day — paging through
  // the calendar looks ahead without moving the simulation.

  var calView = null;
  var MONTH_TITLE = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  var DAY_TITLE = new Intl.DateTimeFormat(undefined,
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  var CAL_STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

  function parseDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return m ? { y: +m[1], m: m[2] - 1, d: +m[3] } : null;
  }

  function isoOf(y, m, d) {
    return y + '-' + pad2(m + 1) + '-' + pad2(d);
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  /** Narrow weekday initials in the reader's own language, Monday first. */
  function weekdayNames() {
    var fmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
    var out = [];
    for (var i = 0; i < 7; i++) {
      out.push(fmt.format(new Date(2024, 0, 1 + i)));  // 1 Jan 2024 was a Monday
    }
    return out;
  }

  function renderCalendar() {
    var chosen = dateInput.value;
    var sel = parseDate(chosen);
    if (!calView) {
      var seed = sel || { y: new Date().getFullYear(), m: new Date().getMonth() };
      calView = { y: seed.y, m: seed.m };
    }

    var first = new Date(calView.y, calView.m, 1);
    calTitle.textContent = MONTH_TITLE.format(first);

    if (!calWeek.firstChild) {
      weekdayNames().forEach(function (name) {
        var cell = document.createElement('span');
        cell.textContent = name;
        calWeek.appendChild(cell);
      });
    }

    clear(calGrid);
    // Six rows every month, so the panel below does not shuffle up and down as
    // the calendar is paged through.
    var lead = (first.getDay() + 6) % 7;
    var cursor = new Date(calView.y, calView.m, 1 - lead);
    var today = new Date();
    var onView = false;

    for (var i = 0; i < 42; i++) {
      var iso = isoOf(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'sim-cal-day';
      cell.textContent = String(cursor.getDate());
      cell.setAttribute('data-date', iso);
      cell.setAttribute('aria-label', DAY_TITLE.format(cursor));
      if (cursor.getMonth() !== calView.m) cell.className += ' is-other';
      if (sameDay(cursor, today)) cell.className += ' is-today';
      var picked = iso === chosen;
      if (picked) cell.className += ' is-on';
      cell.setAttribute('aria-pressed', picked ? 'true' : 'false');
      cell.disabled = live;
      // One tab stop for the whole month; the arrow keys move within it.
      cell.tabIndex = picked ? 0 : -1;
      onView = onView || picked;
      calGrid.appendChild(cell);
      cursor.setDate(cursor.getDate() + 1);
    }

    if (!onView && calGrid.children[lead]) calGrid.children[lead].tabIndex = 0;
  }

  /** Turn the calendar to the month a date is in, and draw it. */
  function showMonthOf(iso) {
    var p = parseDate(iso);
    if (p) calView = { y: p.y, m: p.m };
    renderCalendar();
  }

  function focusDay(iso) {
    var cell = calGrid.querySelector('[data-date="' + iso + '"]');
    if (cell) cell.focus();
  }

  function chooseDate(iso) {
    dateInput.value = iso;
    showMonthOf(iso);
    onFieldCommit();
    renderCalendar();
    focusDay(dateInput.value);
  }

  calGrid.addEventListener('click', function (e) {
    var cell = e.target;
    if (!cell || !cell.getAttribute || !cell.getAttribute('data-date')) return;
    chooseDate(cell.getAttribute('data-date'));
  });

  // The arrow keys move the chosen day rather than only the focus: stepping a
  // day or a week at a time is the quickest way to walk a scenario forward.
  calGrid.addEventListener('keydown', function (e) {
    var from = e.target.getAttribute && parseDate(e.target.getAttribute('data-date'));
    if (!from) return;
    var step = CAL_STEP[e.key] || 0;
    var months = e.key === 'PageUp' ? -1 : (e.key === 'PageDown' ? 1 : 0);
    if (!step && !months) return;
    e.preventDefault();
    var base = new Date(from.y, from.m, from.d);
    var to = months ? addMonths(base, months) : new Date(from.y, from.m, from.d + step);
    chooseDate(isoOf(to.getFullYear(), to.getMonth(), to.getDate()));
  });

  function pageMonth(step) {
    if (!calView) renderCalendar();
    var to = new Date(calView.y, calView.m + step, 1);
    calView = { y: to.getFullYear(), m: to.getMonth() };
    renderCalendar();
  }

  calPrev.addEventListener('click', function () { pageMonth(-1); });
  calNext.addEventListener('click', function () { pageMonth(1); });

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

  function makeLabel(text) {
    var label = svgEl('text', {
      'class': 'sim-hand-label', x: 0, y: 0,
      'text-anchor': 'middle', 'dominant-baseline': 'central'
    });
    label.textContent = text.toUpperCase();
    return label;
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
  function addHand(colour, tip, angle, text) {
    var group = svgEl('g', { transform: rotation(angle) });
    handsGroup.appendChild(group);

    var label = null;
    var width = 0;
    var len = 0;
    if (text) {
      label = makeLabel(text);
      group.appendChild(label);
      var room = tip - PILL_GAP - PILL_START - PILL_PAD_IN - PILL_PAD_OUT;
      width = fitLabel(label, label.getComputedTextLength(), room);
      len = width + PILL_PAD_IN + PILL_PAD_OUT;
    }

    group.appendChild(radialLine(0, tip, OUTLINE, OUTLINE_W, 'round'));
    if (label) group.appendChild(pillRect(PILL_START, len, EDGE, OUTLINE));

    group.appendChild(radialLine(0, tip, colour, CORE_W, 'round'));
    if (label) {
      group.appendChild(pillRect(PILL_START, len, 0, colour, 'sim-hand-pill'));
      placeLabel(label, angle, PILL_START + PILL_PAD_IN + width / 2);
      group.appendChild(label);
    }
    return { el: group, flipped: isFlipped(angle) };
  }

  /**
   * The main location's name, on the real hour hand. That hand carries the sun
   * and moon in the middle of it, so the pill takes whichever side of them has
   * more room: from the centre out to the icon, unless the icon sits so far in
   * that there is more hand beyond it than before it.
   *
   * The hour hand is drawn by clock.js, below this, so its outline cannot be
   * shared. Instead the hand's own core is redrawn over the pill's dark edge
   * where the two cross, which comes to the same thing: one silhouette.
   */
  function addMainPill(text, angle) {
    var group = svgEl('g', { transform: rotation(angle) });
    labelsGroup.appendChild(group);

    var label = makeLabel(text);
    group.appendChild(label);

    var icon = Clock24.iconRadius();
    var inner = icon - ICON_R - ICON_CLEAR;
    var outer = icon + ICON_R + ICON_CLEAR;
    var inboard = (inner - PILL_INNER_LIMIT) >= (PILL_LIMIT - outer);
    var room = (inboard ? inner - PILL_INNER_LIMIT : PILL_LIMIT - outer)
      - PILL_PAD_IN - PILL_PAD_OUT;
    var width = fitLabel(label, label.getComputedTextLength(), room);
    var len = width + PILL_PAD_IN + PILL_PAD_OUT;
    var r0 = inboard ? Math.min(PILL_START, inner - len) : outer;

    var from = Math.max(Clock24.hourTailRadius(), r0 - EDGE - 1);
    var to = Math.min(Clock24.hourTipRadius(), r0 + len + EDGE + 1);

    group.appendChild(pillRect(r0, len, EDGE, OUTLINE));
    if (to > from) group.appendChild(radialLine(from, to, MAIN_FILL, CORE_W));
    group.appendChild(pillRect(r0, len, 0, MAIN_FILL, 'sim-hand-pill'));
    placeLabel(label, angle, r0 + PILL_PAD_IN + width / 2);
    group.appendChild(label);
    return { el: group, flipped: isFlipped(angle) };
  }

  function colourFor(index) {
    return HAND_COLORS[(index - 1) % HAND_COLORS.length];
  }

  function angleFor(mainAngle, index) {
    return Clock24.displayAngle(
      mainAngle + (offsets[index] - offsets[0]) / 1440 * 360);
  }

  /**
   * One name per hour stood on. Places on the same offset stand on exactly the
   * same spot on the dial, so only the highest ranked of them is named and a
   * '+' says the rest are underneath. The main location is part of that
   * ranking and takes the name onto its own hand when it wins: Sonoma first
   * and Los Angeles second reads "SONOMA +" on the hour hand.
   */
  function namesByRow() {
    var named = {};
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var key = String(offsets[i]);
      if (named[key]) { out.push(null); continue; }
      named[key] = true;
      var shared = 0;
      for (var j = 0; j < rows.length; j++) {
        if (offsets[j] === offsets[i]) shared++;
      }
      out.push(shortLabel(rows[i]) + (shared > 1 ? ' +' : ''));
    }
    return out;
  }

  /**
   * Draw a hand for every extra location, and a name for every hour they stand
   * on. Called from the daynight:updated event rather than directly, because a
   * repaint can change the dial offset — "day & night centered" turns the whole
   * dial by solar noon — and these angles have to be measured against the
   * offset in force.
   */
  function renderHands() {
    clear(handsGroup);
    clear(labelsGroup);
    drawn = [];
    mainDrawn = null;
    // The offsets are measured in apply(), which every path that changes the
    // list goes through; a mismatch means a repaint has landed in between.
    if (!active || !rows.length) return;
    if (offsets.length !== rows.length) return;

    var at = moment();
    if (at === null) return;
    // A rebuild on live time can be a date or a summer time boundary away from
    // the last one, so the offsets are taken again rather than trusted.
    if (live) {
      offsets = zones.map(function (z) {
        return Clock24.offsetMinutes(z, new Date(at));
      });
    }

    var mainAngle = Clock24.timeToAngle(Clock24.toZoneTime(new Date(at), zones[0]));
    var names = namesByRow();
    var i;

    // Back to front, so the higher a place sits in the list the further forward
    // its hand is drawn.
    for (i = rows.length - 1; i >= 1; i--) {
      var hand = addHand(colourFor(i), Clock24.hourTipRadius(),
        angleFor(mainAngle, i), names[i]);
      hand.delta = (offsets[i] - offsets[0]) / 1440 * 360;
      drawn.push(hand);
    }

    if (names[0]) mainDrawn = addMainPill(names[0], angleFor(mainAngle, 0));
  }

  /**
   * While live time is running the hands have to keep up with the real clock.
   * Rebuilding them sixty times a second would mean measuring a dozen names
   * that often, so they are only turned: each extra hand is the hour hand's own
   * angle plus its fixed offset from it. The one thing a turn cannot do is flip
   * a name that has crossed the six o'clock line, which is worth a rebuild —
   * twice a day at most, per hand.
   */
  Clock24.onFrame(function (hourAngle) {
    if (!live) return;
    if (active) {
      for (var i = 0; i < drawn.length; i++) {
        // The angle handed over has the dial's own rotation in it already, so
        // this adds only the hand's offset from the main one. Putting it back
        // through displayAngle would turn the extra hands by the dial offset a
        // second time — which does nothing at all with 12 noon at top.
        var angle = norm360(hourAngle + drawn[i].delta);
        if (isFlipped(angle) !== drawn[i].flipped) { renderHands(); return; }
        drawn[i].el.setAttribute('transform', rotation(angle));
      }
      if (mainDrawn) {
        if (isFlipped(hourAngle) !== mainDrawn.flipped) { renderHands(); return; }
        mainDrawn.el.setAttribute('transform', rotation(hourAngle));
      }
    }
    retimeRows();
  });

  // Each place's own clock in the panel, which only ever changes by the minute.
  var shownMinute = null;

  function retimeRows() {
    var minute = Math.floor(Date.now() / 60000);
    if (minute === shownMinute) return;
    shownMinute = minute;
    renderRowTimes();
  }

  // daynight.js fires this at the end of every repaint, once the dial offset
  // for the new state is settled.
  document.addEventListener('daynight:updated', function () {
    if (active) renderHands();
  });

  // ---- Applying the whole state to the clock ------------------------------

  function apply() {
    // The row times are a useful preview of the entered moment even with the
    // switch off, so they are kept current either way.
    renderRowTimes();
    if (!active) return;
    if (!rows.length) { setActive(false); return; }

    var next = instantFromFields();
    if (next === null) return; // half-typed date or time; leave the face alone
    // Held even while live time is running, so switching back off puts the
    // chosen moment straight back rather than losing it.
    instant = next;

    var at = new Date(moment());
    offsets = zones.map(function (z) { return Clock24.offsetMinutes(z, at); });

    var main = rows[0];
    var key = main.lat + ',' + main.lon;
    Clock24.setTimeZone(main.tz);
    Clock24.setSimulatedInstant(live ? null : instant);
    DayNight.setShowWakeSleep(false);
    DayNight.setOrientation(orientation);
    if (key !== appliedLocationKey) {
      appliedLocationKey = key;
      DayNight.setLocation({ lat: main.lat, lon: main.lon });
    }
    DayNight.refresh();

    locationReadout.textContent = describe(main);
    renderDelta();
    renderRowTimes();
  }

  // ---- The location rows --------------------------------------------------

  /** Each row's own wall-clock reading of the moment the fields describe. */
  function renderRowTimes() {
    var at = moment();
    var els = rowsEl.querySelectorAll('.sim-row-time');
    for (var i = 0; i < els.length && i < zones.length; i++) {
      els[i].textContent = at === null
        ? '–'
        : hhmm(Clock24.toZoneTime(new Date(at), zones[i]));
    }
  }

  function buildRow(loc, index) {
    var isMain = index === 0;
    var colour = isMain ? null : HAND_COLORS[(index - 1) % HAND_COLORS.length];

    var row = document.createElement('div');
    row.className = 'sim-row';

    var head = document.createElement('div');
    head.className = 'sim-row-head';

    var swatch = document.createElement('span');
    if (isMain) {
      // The main location has no extra hand: it is the one carrying the real
      // sun and moon, so say that rather than showing a colour it never uses.
      swatch.className = 'sim-swatch sim-swatch-main';
      swatch.textContent = '☀';
    } else {
      swatch.className = 'sim-swatch';
      swatch.style.background = colour;
    }
    swatch.setAttribute('aria-hidden', 'true');
    head.appendChild(swatch);

    var select = document.createElement('select');
    select.className = 'sim-place';
    select.setAttribute('aria-label', isMain ? 'Main location' : 'Location ' + (index + 1));
    Places.fillPlaceSelect(select, Places.find(loc.place) ? loc.place : 'custom');
    head.appendChild(select);

    var up = document.createElement('button');
    up.type = 'button';
    up.className = 'sim-btn';
    up.textContent = '↑';
    up.title = index === 1 ? 'Make this the main location' : 'Move up';
    up.disabled = isMain;
    head.appendChild(up);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'sim-btn';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.disabled = rows.length < 2;
    head.appendChild(remove);

    row.appendChild(head);

    var meta = document.createElement('div');
    meta.className = 'sim-row-meta';
    var role = document.createElement('span');
    role.className = 'sim-role';
    role.textContent = isMain ? 'Main' : '';
    meta.appendChild(role);
    var time = document.createElement('span');
    time.className = 'sim-row-time';
    time.textContent = '–';
    meta.appendChild(time);
    row.appendChild(meta);

    var coords = document.createElement('div');
    coords.className = 'coord-row sim-coords';
    coords.hidden = !!Places.find(loc.place);
    var latInput = coordField(coords, 'Latitude', loc.lat, -90, 90);
    var lonInput = coordField(coords, 'Longitude', loc.lon, -180, 180);
    row.appendChild(coords);

    select.addEventListener('change', function () {
      var place = Places.find(select.value);
      if (place) {
        rows[index] = {
          place: place.id, lat: place.lat, lon: place.lon,
          tz: { type: 'iana', name: place.tz }
        };
      } else {
        // "Custom coordinates…": keep where the row already was and let the
        // inputs, now revealed, take it from here.
        rows[index] = {
          place: 'custom', lat: loc.lat, lon: loc.lon,
          tz: Places.zoneForCoords(loc.lat, loc.lon)
        };
      }
      showError(null);
      syncZones();
      // A new main location shades the face from a new place; the moment stays
      // where it is and the fields move to that zone's reading of it.
      if (index === 0) fieldsFromInstant();
      save();
      renderRows();
      apply();
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
        // No re-render: that would take the focus out of the field being typed
        // in. The row's own controls are already correct for a custom place.
        rows[index] = {
          place: 'custom', lat: lat, lon: lon, tz: Places.zoneForCoords(lat, lon)
        };
        syncZones();
        if (index === 0) fieldsFromInstant();
        save();
        apply();
      }, 400);
    }

    latInput.addEventListener('input', onCoordInput);
    lonInput.addEventListener('input', onCoordInput);

    up.addEventListener('click', function () {
      var moved = rows.splice(index, 1)[0];
      rows.splice(index - 1, 0, moved);
      syncZones();
      // Promoting into first place hands the shading to a new zone; as above,
      // the moment holds and the fields move to suit.
      if (index === 1) fieldsFromInstant();
      save();
      renderRows();
      apply();
    });

    remove.addEventListener('click', function () {
      rows.splice(index, 1);
      syncZones();
      if (index === 0 && rows.length) fieldsFromInstant();
      save();
      renderRows();
      apply();
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
    rows.forEach(function (loc, i) {
      rowsEl.appendChild(buildRow(loc, i));
    });
    addButton.disabled = rows.length >= MAX_LOCATIONS;
    renderRowTimes();
  }

  /** A city not already in the list: a favorite if there is a spare one. */
  function nextUnusedPlace() {
    var used = {};
    rows.forEach(function (r) { used[r.place] = true; });
    var favorites = Places.getFavorites().map(Places.find).filter(Boolean);
    var pool = favorites.concat(Places.all);
    for (var i = 0; i < pool.length; i++) {
      if (!used[pool[i].id]) return pool[i];
    }
    return Places.all[0];
  }

  addButton.addEventListener('click', function () {
    if (rows.length >= MAX_LOCATIONS) return;
    var place = nextUnusedPlace();
    rows.push({
      place: place.id, lat: place.lat, lon: place.lon,
      tz: { type: 'iana', name: place.tz }
    });
    save();
    renderRows();
    apply();
  });

  // ---- Turning it on and off ----------------------------------------------

  function setActive(on) {
    on = !!on && rows.length > 0;
    activeInput.checked = on;
    if (on === active) return;
    active = on;
    document.body.classList.toggle('simulating', active);

    if (active) {
      appliedLocationKey = null;
      apply();
      // "from now" moves on its own, so the line is kept honest between edits.
      deltaTimer = setInterval(renderDelta, 60000);
      return;
    }

    clearInterval(deltaTimer);
    deltaTimer = null;
    instant = null;
    appliedLocationKey = null;
    clear(handsGroup);
    clear(labelsGroup);
    drawn = [];
    mainDrawn = null;
    Clock24.setSimulatedInstant(null);
    renderDelta();
    // Puts back the location, orientation and wake/sleep the Options panel
    // holds — including any edit made to them while this was running — and
    // repaints, which re-spaces the rim labels now that ours are gone.
    window.Sidebar.restoreLiveState();
    renderRowTimes();
  }

  /**
   * Hand the moment to the real clock, or take it back. The places, the
   * orientation and the entered date and time all stay as they are — only what
   * drives the hands changes — so the button is a straight A/B between now and
   * the scenario. The controls that set the moment are shut off rather than
   * emptied, and go on showing the moment they will put back.
   */
  function setLive(on) {
    live = !!on;
    liveButton.setAttribute('aria-pressed', live ? 'true' : 'false');
    // Not 'sim-live': that is the button's own class, and a body carrying it
    // would take the button's rules with it.
    document.body.classList.toggle('live-time', live);

    timeInput.disabled = live;
    slider.disabled = live;
    nowButton.disabled = live;
    calPrev.disabled = live;
    calNext.disabled = live;
    renderCalendar();

    shownMinute = null;
    apply();
    renderDelta();
  }

  liveButton.addEventListener('click', function () {
    setLive(!live);
    save();
  });

  activeInput.addEventListener('change', function () {
    setActive(activeInput.checked);
  });

  // ---- Date, time, slider, orientation ------------------------------------

  function wrapMinutes(value) {
    return ((value % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  }

  /** Move the scrub to a minute of the day, wrapping through midnight. */
  function setMinutes(value) {
    var m = Math.round(wrapMinutes(value));
    slider.value = String(m);
    timeInput.value = pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
    save();
    apply();
  }

  // A range input stops dead at both ends, but a day has none: run off the
  // right and the time should come back at midnight and carry on. So the drag
  // is tracked by hand — the default is suppressed, the pointer captured, and
  // the value taken from how far it has moved rather than from where it is,
  // which is what lets it go round more than once. Only the time wraps; the
  // date stays where it was set.
  var drag = null;

  slider.addEventListener('pointerdown', function (e) {
    var rect = slider.getBoundingClientRect();
    // The thumb needs room at both ends, so the travel is shorter than the
    // element by its own width.
    var span = Math.max(1, rect.width - THUMB);
    var at = (e.clientX - rect.left - THUMB / 2) / span * DAY_MINUTES;
    // Where the drag starts is clamped, not wrapped: pressing on the last pixel
    // of the track means the end of the day, not the beginning of it. Only what
    // the drag adds to that wraps.
    drag = {
      x: e.clientX,
      from: Math.max(0, Math.min(DAY_MINUTES - 1, at)),
      span: span
    };
    slider.setPointerCapture(e.pointerId);
    e.preventDefault();
    slider.focus();
    setMinutes(drag.from);
  });

  slider.addEventListener('pointermove', function (e) {
    if (!drag) return;
    setMinutes(drag.from + (e.clientX - drag.x) / drag.span * DAY_MINUTES);
  });

  function endDrag(e) {
    if (!drag) return;
    drag = null;
    if (slider.hasPointerCapture(e.pointerId)) slider.releasePointerCapture(e.pointerId);
  }

  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);

  // The keyboard reaches the ends the same way, and wraps there too.
  slider.addEventListener('keydown', function (e) {
    var v = Number(slider.value);
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowDown') && v === 0) {
      e.preventDefault();
      setMinutes(DAY_MINUTES - 1);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowUp') && v === DAY_MINUTES - 1) {
      e.preventDefault();
      setMinutes(0);
    }
  });

  slider.addEventListener('input', function () {
    setMinutes(Number(slider.value));
  });

  function onFieldInput() {
    var t = /^(\d{1,2}):(\d{2})/.exec(timeInput.value);
    if (t) slider.value = String(+t[1] * 60 + +t[2]);
    save();
    apply();
  }

  // Only once the field is committed, so nothing is rewritten under a
  // half-typed entry.
  function onFieldCommit() {
    onFieldInput();
    fieldsFromInstant();
    save();
  }

  // The date has no field of its own to listen to: it is set by the calendar
  // below, which commits it directly.
  timeInput.addEventListener('input', onFieldInput);
  timeInput.addEventListener('change', onFieldCommit);

  nowButton.addEventListener('click', function () {
    if (!zones.length) syncZones();
    setFields(Clock24.toZoneTime(new Date(), zones[0]));
    save();
    apply();
  });

  function onOrientationChange() {
    orientation = orientCentered.checked ? 'centered' : 'noon';
    save();
    apply();
  }

  orientNoon.addEventListener('change', onOrientationChange);
  orientCentered.addEventListener('change', onOrientationChange);

  // ---- Restore ------------------------------------------------------------

  storage.get([
    STORAGE_KEYS.locations,
    STORAGE_KEYS.dateTime,
    STORAGE_KEYS.orientation,
    STORAGE_KEYS.liveTime,
    STORAGE_KEYS.liveLocation
  ], function (items) {
    var saved = items[STORAGE_KEYS.locations];
    if (Array.isArray(saved) && saved.length) {
      rows = saved.filter(function (r) {
        return r && typeof r.lat === 'number' && typeof r.lon === 'number' && r.tz;
      }).slice(0, MAX_LOCATIONS);
    }
    if (!rows.length) {
      // Start from wherever the everyday clock is pointed, so the first look at
      // this panel shows a face the user already recognises.
      var seed = items[STORAGE_KEYS.liveLocation];
      rows = [(seed && typeof seed.lat === 'number' && seed.tz) ? seed : {
        place: 'marseille', lat: 43.2965, lon: 5.3698,
        tz: { type: 'iana', name: 'Europe/Paris' }
      }];
    }
    syncZones();

    orientation = items[STORAGE_KEYS.orientation] === 'centered' ? 'centered' : 'noon';
    orientCentered.checked = orientation === 'centered';
    orientNoon.checked = orientation === 'noon';

    var dt = items[STORAGE_KEYS.dateTime];
    if (dt && typeof dt.date === 'string' && typeof dt.time === 'string') {
      dateInput.value = dt.date;
      timeInput.value = dt.time;
      var t = /^(\d{1,2}):(\d{2})/.exec(dt.time);
      if (t) slider.value = String(+t[1] * 60 + +t[2]);
      showMonthOf(dt.date);
    } else {
      setFields(Clock24.toZoneTime(new Date(), zones[0]));
    }

    // After the fields, so shutting them off finds them filled in. The switch
    // that runs the simulator is not remembered, but which moment it would show
    // is, the same as the date and the time.
    setLive(items[STORAGE_KEYS.liveTime] === true);
    renderRows();
  });

  window.Simulator = {
    isActive: function () { return active; },
    /** Redraw the hands: the face's own geometry has moved under them. */
    render: renderHands,
    /** The panel is being shown: pick up favorites changed in the other one. */
    onShown: function () { if (rows.length) renderRows(); }
  };
})();
