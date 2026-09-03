/*
 * simulator.js — the Simulator block of the sidebar. Parks the clock at a
 * chosen date and time instead of the current one.
 *
 * That is all it does. Where the clock is pointed, and how many places it shows
 * at once, belong to the blocks above it; this only decides which moment every
 * one of those hands is reading. The moment is entered as wall clock at the
 * main location and turned into one absolute instant, which is handed to
 * Clock24 — from there the hour, minute and second hands, the day/night slices,
 * the moon phase and every extra location's hand all follow it without knowing
 * anything about this panel.
 */
(function () {
  'use strict';

  var Clock24 = window.Clock24;
  var DayNight = window.DayNight;
  var storage = window.Store;

  var STORAGE_KEYS = {
    dateTime: 'simDateTime'
  };

  var DAY_MINUTES = 1440;

  // How the knobs are geared. A full turn of the time knob is one day and a
  // full turn of the day knob is one year, so what each knob is pointing at is
  // the reading itself — midnight at the top of one, the first of January at
  // the top of the other — rather than an arbitrary position within a range.
  var DAYS_PER_TURN = 365;

  // How far a knob has to be dragged to turn it all the way round, and how much
  // finer that is with Shift held. 200px for a whole day is about seven minutes
  // to the pixel; the same 200px for a year is a fortnight, which is why the
  // day knob wants the fine gear more than the time one does — and why the
  // calendar above is still the way to land on an exact date.
  var PX_PER_TURN = 200;
  var FINE = 0.25;

  // The top of each knob, which is what its pointer and its marks are both
  // measured from. The time knob is read the way the dial is — noon at the top,
  // midnight at the bottom, the same half-turn timeToAngle puts into every
  // angle on the face — so the two are never a mirror of each other. The day
  // knob is read by the seasons rather than by the calendar: the June solstice
  // at the top, the September equinox a quarter round, the December solstice at
  // the bottom, the March equinox three quarters.
  //
  // The solstice is worked out for the year in question rather than fixed at a
  // day number, since a leap year moves every day after February along by one.
  // Which day in June it falls on drifts by a day either way over the years,
  // and a day is a degree of this knob.
  var NOON = 720;

  // The ring of marks each knob is read against, drawn from the top: an hour a
  // mark on the time knob, and a twelfth of a year — a month's worth — on the
  // day knob. Every quarter is drawn longer, which on the day knob is the
  // solstices and the equinoxes and on the time knob is midnight, noon and the
  // two sixes. The ring is struck evenly, so a season's mark can sit up to a
  // couple of days off the true one; that is under two degrees of the knob.
  var TICK_IN = 24;
  var TICK_OUT = 27.5;
  var TICK_MAJOR_IN = 21.5;

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---- State --------------------------------------------------------------

  var active = false;
  var instant = null; // the absolute moment being simulated

  // Whether the date and time on show are only a seeded "now" rather than a
  // moment the user chose or a saved one. The main location decides how the
  // fields read, and it arrives from storage on its own schedule, so a default
  // seeded before it lands is re-taken once it does.
  var fieldsAreDefault = true;

  var deltaTimer = null;

  // ---- Elements -----------------------------------------------------------

  var activeInput = document.getElementById('sim-active');
  var controls = document.getElementById('sim-controls');
  var dateInput = document.getElementById('sim-date');
  var calTitle = document.getElementById('sim-cal-title');
  var calWeek = document.getElementById('sim-cal-week');
  var calGrid = document.getElementById('sim-cal-grid');
  var calPrev = document.getElementById('sim-cal-prev');
  var calNext = document.getElementById('sim-cal-next');
  var timeInput = document.getElementById('sim-time');
  var timeKnob = document.getElementById('sim-knob-time');
  var dayKnob = document.getElementById('sim-knob-day');
  var nowButton = document.getElementById('sim-now');
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

  /** The main location's zone — the one the entered wall clock is read in. */
  function mainZone() {
    return Clock24.getTimeZone();
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
    deltaEl.textContent = (active && instant !== null) ? describeGap(instant) : '';
  }

  // ---- Persistence --------------------------------------------------------

  function save() {
    // A date or time field mid-edit is momentarily empty; saving that would
    // restore an unusable panel next time, so only a complete pair is kept.
    if (!dateInput.value || !timeInput.value) return;
    storage.set(storage.entry(STORAGE_KEYS.dateTime,
      { date: dateInput.value, time: timeInput.value }));
  }

  // ---- Reading the fields -------------------------------------------------

  /** The instant the fields describe, read as wall clock at the main location. */
  function instantFromFields() {
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput.value);
    var t = /^(\d{1,2}):(\d{2})/.exec(timeInput.value);
    if (!d || !t) return null;
    return Clock24.instantFromWallClock(+d[1], d[2] - 1, +d[3], +t[1], +t[2], mainZone());
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
    if (at === null) return;
    setFields(Clock24.toZoneTime(new Date(at), mainZone()));
  }

  function setFields(zonedDate) {
    dateInput.value = isoDate(zonedDate);
    timeInput.value = hhmm(zonedDate);
    showMonthOf(dateInput.value);
    showKnobs();
  }

  /** Seed the fields with the current moment, as the main location reads it. */
  function setFieldsToNow() {
    setFields(Clock24.toZoneTime(new Date(), mainZone()));
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

  // ---- Applying the moment to the clock -----------------------------------

  function apply() {
    if (!active) return;

    var next = instantFromFields();
    if (next === null) return; // half-typed date or time; leave the face alone
    instant = next;

    Clock24.setSimulatedInstant(instant);
    // The lines mark a routine, which a moment months away is not part of.
    // Everything else about how the dial is drawn — the orientation above all —
    // stays exactly as the Options block below has it.
    DayNight.setShowWakeSleep(false);
    DayNight.refresh();
    renderDelta();
  }

  // ---- Turning it on and off ----------------------------------------------

  function setActive(on) {
    on = !!on;
    activeInput.checked = on;
    // Before the early return below, so the fold always ends up matching the
    // switch even if the two ever fall out of step.
    controls.hidden = !on;
    if (on === active) return;
    active = on;
    document.body.classList.toggle('simulating', active);

    if (active) {
      apply();
      // "from now" moves on its own, so the line is kept honest between edits.
      deltaTimer = setInterval(renderDelta, 60000);
      return;
    }

    clearInterval(deltaTimer);
    deltaTimer = null;
    instant = null;
    Clock24.setSimulatedInstant(null);
    renderDelta();
    // Puts back the wake/sleep lines the Options block holds — including any
    // edit made to them while this was running — and repaints, which re-spaces
    // the rim labels for the moment now on show.
    window.Sidebar.restoreLiveState();
  }

  activeInput.addEventListener('change', function () {
    setActive(activeInput.checked);
  });

  // The entered time is wall clock at the main location, so moving that
  // location holds the moment and moves the reading of it instead.
  document.addEventListener('location:changed', function () {
    if (fieldsAreDefault && !active) {
      setFieldsToNow();
      return;
    }
    fieldsFromInstant();
    save();
  });

  // ---- Date, time and the two knobs ---------------------------------------

  /** The ISO date a given number of days on from another. */
  function shiftDate(iso, days) {
    var p = parseDate(iso);
    if (!p) return iso;
    var d = new Date(p.y, p.m, p.d + days);
    return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /**
   * Move to a minute of the day. The value may run outside the day in either
   * direction — a knob has no ends — and every whole day it is out by moves the
   * date with it, so turning past midnight carries on into tomorrow rather than
   * landing back on the same morning.
   *
   * `base` is the date the value is measured from, which for a drag is the date
   * the drag started on: the turn is cumulative, so counting the carry against
   * a date that had already moved would apply it twice.
   */
  function setMinutes(value, base) {
    var v = Math.round(value);
    var carry = Math.floor(v / DAY_MINUTES);
    var m = v - carry * DAY_MINUTES;
    timeInput.value = pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
    var date = shiftDate(base || dateInput.value, carry);
    if (date !== dateInput.value) {
      dateInput.value = date;
      showMonthOf(date); // and with it the calendar, which has a new day on it
    }
    fieldsAreDefault = false;
    showKnobs();
    save();
    apply();
  }

  /**
   * Move the date by whole days, leaving the time of day where it is: the same
   * hour of a different day, which is what the day knob is for. Days that do
   * not exist in the destination's calendar cannot arise — every date has a
   * next one — but an hour can go missing to a clock change, and apply() lands
   * on the moment actually reached in that case, exactly as the time knob does.
   */
  function setDays(offset, base) {
    var date = shiftDate(base || dateInput.value, Math.round(offset));
    if (date === dateInput.value) return;
    dateInput.value = date;
    showMonthOf(date);
    fieldsAreDefault = false;
    showKnobs();
    save();
    apply();
  }

  // ---- The knobs ----------------------------------------------------------

  // Turned the way a plug-in's knobs are: press anywhere on one and drag up or
  // down, as far as the gesture goes. Neither knob has ends — a day rolls into
  // the next and a year into the next — and taking the value from how far the
  // pointer has moved rather than from where it is on a track is what allows
  // that: the drag is a distance, and a distance can be any number of turns.
  //
  // Nothing is ever read back off a knob. Both are painted from the date and
  // time fields, which stay the one record of the moment on show.

  /**
   * The marks around a knob, `count` of them from the top round, with every
   * `quarter`th drawn longer. They are struck here rather than written out
   * twenty-four times in the markup, since the count is the one thing that
   * differs between the two knobs.
   */
  function buildTicks(host, count, quarter) {
    for (var i = 0; i < count; i++) {
      var major = i % quarter === 0;
      var tick = document.createElementNS(SVG_NS, 'line');
      tick.setAttribute('x1', '32');
      tick.setAttribute('y1', String(32 - TICK_OUT));
      tick.setAttribute('x2', '32');
      tick.setAttribute('y2', String(32 - (major ? TICK_MAJOR_IN : TICK_IN)));
      tick.setAttribute('transform',
        'rotate(' + (i * 360 / count).toFixed(2) + ' 32 32)');
      if (major) tick.setAttribute('class', 'is-major');
      host.appendChild(tick);
    }
  }

  /** How far a drag of `px` turns a knob geared at `perTurn` units a turn. */
  function travel(px, perTurn, fine) {
    return px / PX_PER_TURN * perTurn * (fine ? FINE : 1);
  }

  /**
   * One knob: its drag, its keys, and the painting of it. `spec.begin` takes
   * down whatever a move is measured from — the drag is cumulative, so it is
   * always applied to the state the drag started in rather than to the state it
   * has just left, which would count every step twice — and `spec.move` is
   * handed how far the knob has turned since, in the knob's own units.
   *
   * Shift is picked up mid-drag rather than only at the start, and taking it up
   * or letting it go re-anchors the drag: what has been turned so far is banked
   * at the gear it was turned at, and the rest starts again from where the
   * pointer is now. Rescaling the whole drag would jump the knob on the
   * keypress instead.
   *
   * What comes back is how to paint it, which is the only thing the rest of the
   * panel has to say to a knob.
   */
  function makeKnob(el, spec) {
    var hand = el.querySelector('.knob-hand');
    var drag = null;

    buildTicks(el.querySelector('.knob-ticks'), spec.ticks, spec.quarter);

    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { y: e.clientY, turned: 0, fine: e.shiftKey, from: spec.begin() };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
      el.focus();
    });

    el.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (e.shiftKey !== drag.fine) {
        drag.turned += travel(drag.y - e.clientY, spec.perTurn, drag.fine);
        drag.y = e.clientY;
        drag.fine = e.shiftKey;
      }
      spec.move(drag.turned + travel(drag.y - e.clientY, spec.perTurn, drag.fine),
        drag.from);
    });

    function end(e) {
      if (!drag) return;
      drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    }

    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    // The arrow keys turn it a notch and the page keys a bigger one, through
    // the same pair as a drag: one notch from where the knob is now.
    el.addEventListener('keydown', function (e) {
      var by = 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') by = spec.step;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') by = -spec.step;
      else if (e.key === 'PageUp') by = spec.page;
      else if (e.key === 'PageDown') by = -spec.page;
      else return;
      e.preventDefault();
      spec.move(by, spec.begin());
    });

    /** Point it at `fraction` of a turn from the top. */
    return function paint(fraction, valueNow, valueText) {
      hand.setAttribute('transform', 'rotate(' + (fraction * 360).toFixed(2) + ' 32 32)');
      el.setAttribute('aria-valuenow', String(valueNow));
      el.setAttribute('aria-valuetext', valueText);
    };
  }

  /** The minute of the day the time field is showing, or null mid-edit. */
  function currentMinutes() {
    var t = /^(\d{1,2}):(\d{2})/.exec(timeInput.value);
    return t ? +t[1] * 60 + +t[2] : null;
  }

  /** Whole days between two UTC dates. */
  function daysBetween(from, to) {
    return Math.round((to - from) / 86400000);
  }

  /**
   * Where a date falls in its own year: the day itself, for the reading, and
   * how far round the knob it is, which is measured from the June solstice
   * rather than from the first of January.
   */
  function yearPosition(iso) {
    var p = parseDate(iso);
    if (!p) return null;
    var start = Date.UTC(p.y, 0, 1);
    var length = daysBetween(start, Date.UTC(p.y + 1, 0, 1));
    var day = daysBetween(start, Date.UTC(p.y, p.m, p.d));
    var solstice = daysBetween(start, Date.UTC(p.y, 5, 21));
    return {
      day: day,
      turned: ((day - solstice) % length + length) % length / length,
      date: new Date(p.y, p.m, p.d)
    };
  }

  // A turn of the time knob is a day, measured from the minute and the date the
  // drag began on: run past midnight in either direction and the date goes with
  // it, which is the whole reason the moment is kept as a date and a time
  // rather than as a time of day.
  var paintTime = makeKnob(timeKnob, {
    perTurn: DAY_MINUTES,
    ticks: 24,
    quarter: 6,
    step: 1,
    page: 60,
    begin: function () {
      return { minutes: currentMinutes(), date: dateInput.value };
    },
    move: function (turned, from) {
      if (from.minutes !== null) setMinutes(from.minutes + turned, from.date);
    }
  });

  // A turn of the day knob is a year, and the time of day is not touched: the
  // same hour on a different day. A year is taken as 365 days however long the
  // one being crossed actually is, which leaves a full turn of the pointer and
  // a full turn of the knob a day apart in a leap year and nowhere else.
  var paintDay = makeKnob(dayKnob, {
    perTurn: DAYS_PER_TURN,
    ticks: 12,
    quarter: 3,
    step: 1,
    page: 7,
    begin: function () { return dateInput.value; },
    move: setDays
  });

  /** Both knobs, from the fields — the only direction anything moves. */
  function showKnobs() {
    var m = currentMinutes();
    // Noon at the top, as on the face: half a turn on from where the minutes
    // of the day would otherwise put it.
    if (m !== null) paintTime(((m + NOON) % DAY_MINUTES) / DAY_MINUTES, m, timeInput.value);

    var pos = yearPosition(dateInput.value);
    if (pos) paintDay(pos.turned, pos.day + 1, DAY_TITLE.format(pos.date));
  }

  function onFieldInput() {
    showKnobs();
    fieldsAreDefault = false;
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
  // above, which commits it directly.
  timeInput.addEventListener('input', onFieldInput);
  timeInput.addEventListener('change', onFieldCommit);

  nowButton.addEventListener('click', function () {
    setFieldsToNow();
    fieldsAreDefault = false;
    save();
    apply();
  });

  // ---- Restore ------------------------------------------------------------

  storage.get([STORAGE_KEYS.dateTime], function (items) {
    var dt = items[STORAGE_KEYS.dateTime];
    if (dt && typeof dt.date === 'string' && typeof dt.time === 'string') {
      fieldsAreDefault = false;
      dateInput.value = dt.date;
      timeInput.value = dt.time;
      showMonthOf(dt.date);
      showKnobs();
    } else {
      setFieldsToNow();
    }
  });

  window.Simulator = {
    /** Is a chosen moment, rather than the current one, driving the face? */
    isActive: function () { return active; }
  };
})();
