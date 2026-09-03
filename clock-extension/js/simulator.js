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

  // The scrub's thumb, which has to be taken off the track's width to work out
  // where along the day a given pixel falls. Set to match the slider's own
  // width in newtab.css.
  var THUMB = 16;

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
  var slider = document.getElementById('sim-slider');
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
    slider.value = String(zonedDate.getUTCHours() * 60 + zonedDate.getUTCMinutes());
    showMonthOf(dateInput.value);
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

  // ---- Date, time, slider, orientation ------------------------------------

  /** The ISO date a given number of days on from another. */
  function shiftDate(iso, days) {
    var p = parseDate(iso);
    if (!p) return iso;
    var d = new Date(p.y, p.m, p.d + days);
    return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /**
   * Move the scrub to a minute of the day. The value may run outside the day in
   * either direction — the scrub has no ends — and every whole day it is out by
   * moves the date with it, so running off midnight carries on into tomorrow
   * rather than landing back on the same morning.
   *
   * `base` is the date the value is measured from, which for a drag is the date
   * the drag started on: the pointer's offset is cumulative, so counting the
   * carry against a date that had already moved would apply it twice.
   */
  function setMinutes(value, base) {
    var v = Math.round(value);
    var carry = Math.floor(v / DAY_MINUTES);
    var m = v - carry * DAY_MINUTES;
    slider.value = String(m);
    timeInput.value = pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
    var date = shiftDate(base || dateInput.value, carry);
    if (date !== dateInput.value) {
      dateInput.value = date;
      showMonthOf(date); // and with it the calendar, which has a new day on it
    }
    fieldsAreDefault = false;
    save();
    apply();
  }

  // A range input stops dead at both ends, but time has none: run off the right
  // and the clock should come back at midnight on the next day and carry on. So
  // the drag is tracked by hand — the default is suppressed, the pointer
  // captured, and the value taken from how far it has moved rather than from
  // where it is, which is what lets it go round the dial as many times as the
  // drag is long.
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
      span: span,
      date: dateInput.value
    };
    slider.setPointerCapture(e.pointerId);
    e.preventDefault();
    slider.focus();
    setMinutes(drag.from, drag.date);
  });

  slider.addEventListener('pointermove', function (e) {
    if (!drag) return;
    setMinutes(drag.from + (e.clientX - drag.x) / drag.span * DAY_MINUTES, drag.date);
  });

  function endDrag(e) {
    if (!drag) return;
    drag = null;
    if (slider.hasPointerCapture(e.pointerId)) slider.releasePointerCapture(e.pointerId);
  }

  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);

  // The keyboard reaches the ends the same way, and steps over them onto the
  // next or previous day.
  slider.addEventListener('keydown', function (e) {
    var v = Number(slider.value);
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowDown') && v === 0) {
      e.preventDefault();
      setMinutes(-1);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowUp') && v === DAY_MINUTES - 1) {
      e.preventDefault();
      setMinutes(DAY_MINUTES);
    }
  });

  slider.addEventListener('input', function () {
    setMinutes(Number(slider.value));
  });

  function onFieldInput() {
    var t = /^(\d{1,2}):(\d{2})/.exec(timeInput.value);
    if (t) slider.value = String(+t[1] * 60 + +t[2]);
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
      var t = /^(\d{1,2}):(\d{2})/.exec(dt.time);
      if (t) slider.value = String(+t[1] * 60 + +t[2]);
      showMonthOf(dt.date);
    } else {
      setFieldsToNow();
    }
  });

  window.Simulator = {
    /** Is a chosen moment, rather than the current one, driving the face? */
    isActive: function () { return active; }
  };
})();
