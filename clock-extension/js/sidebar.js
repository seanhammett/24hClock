/*
 * sidebar.js — the sidebar shell (the handle, collapse) and the location block
 * at the top of it: lat/lon inputs with validation, debounced persistence, and
 * the note daynight.js publishes for a day with no sunrise or sunset.
 *
 * The location set here is the main one: it carries the real hour hand, the sun
 * and moon, and the day/night shading. Everywhere else on the dial is
 * locations.js, in the same panel just below.
 *
 * While the simulator is driving the face it overrides two of the settings here
 * — orientation and wake/sleep — so those are kept as live values and only
 * pushed once it hands the face back.
 */
(function () {
  'use strict';

  var STORAGE_KEYS = {
    location: 'location',
    collapsed: 'sidebarCollapsed',
    favorites: 'favorites',
    overrideNewTabs: 'overrideNewTabs',
    orientation: 'orientation',
    wakeTime: 'wakeTime',
    bedTime: 'bedTime',
    showMinute: 'showMinuteHand',
    showSecond: 'showSecondHand',
    showMinuteMarks: 'showMinuteMarks',
    showSubhourTicks: 'showSubhourTicks',
    showWakeSleep: 'showWakeSleep',
    theme: 'theme'
  };

  var Places = window.Places;
  var findPlace = Places.find;
  var zoneForCoords = Places.zoneForCoords;

  var storage = window.Store;
  var makeEntry = window.Store.entry;

  /** Is the simulator currently driving the face? */
  function simulating() {
    return !!(window.Simulator && window.Simulator.isActive());
  }

  var placeSelect = document.getElementById('place-select');
  var latInput = document.getElementById('lat-input');
  var lonInput = document.getElementById('lon-input');
  var errorEl = document.getElementById('input-error');
  var polarNote = document.getElementById('polar-note');
  var overrideNewTab = document.getElementById('override-newtab');

  // The background service worker reads this flag when new tabs are created.
  // The "tabs" permission is optional: requested here on enable (must happen
  // inside the user gesture) and released again on disable, so the extension
  // installs with no permission warnings.
  var permissionsApi = (typeof chrome !== 'undefined' && chrome.permissions) || null;

  // The same page is also served as a plain website, where there is no service
  // worker to honour the flag and no new tab to take over, so the option is
  // hidden rather than offered and left doing nothing. Everything below still
  // runs against the hidden checkbox, which keeps the two builds identical.
  if (!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)) {
    overrideNewTab.closest('.checkbox-label').hidden = true;
  }

  overrideNewTab.addEventListener('change', function () {
    if (!overrideNewTab.checked) {
      storage.set(makeEntry(STORAGE_KEYS.overrideNewTabs, false));
      if (permissionsApi) {
        permissionsApi.remove({ permissions: ['tabs'] });
      }
      return;
    }
    if (!permissionsApi) { // plain-file development fallback
      storage.set(makeEntry(STORAGE_KEYS.overrideNewTabs, true));
      return;
    }
    permissionsApi.request({ permissions: ['tabs'] }, function (granted) {
      if (granted) {
        storage.set(makeEntry(STORAGE_KEYS.overrideNewTabs, true));
      } else {
        overrideNewTab.checked = false;
        storage.set(makeEntry(STORAGE_KEYS.overrideNewTabs, false));
      }
    });
  });

  // ---- Appearance --------------------------------------------------------
  // theme.js has already painted from its own fast-path copy; this is the
  // canonical setting, so it persists the choice and hands it back to theme.js
  // to apply and re-cache.

  var themeSelect = document.getElementById('theme-select');

  themeSelect.addEventListener('change', function () {
    storage.set(makeEntry(STORAGE_KEYS.theme, window.Theme.set(themeSelect.value)));
  });

  // ---- Orientation + hand visibility -------------------------------------

  var orientNoon = document.getElementById('orient-noon');
  var orientCentered = document.getElementById('orient-centered');
  var orientLouis = document.getElementById('orient-louis');
  var wakeTimes = document.getElementById('wake-times');
  var wakeInput = document.getElementById('wake-input');
  var bedInput = document.getElementById('bed-input');
  var showMinute = document.getElementById('show-minute');
  var showSecond = document.getElementById('show-second');
  var showWakeSleep = document.getElementById('show-wake-sleep');

  function currentOrientation() {
    if (orientCentered.checked) return 'centered';
    if (orientLouis.checked) return 'louis';
    return 'noon';
  }

  /** The wake/bed inputs matter when the lines are shown or the dial uses them. */
  function updateWakeTimesVisibility() {
    wakeTimes.hidden = !showWakeSleep.checked && !orientLouis.checked;
  }

  function onOrientationChange() {
    var mode = currentOrientation();
    storage.set(makeEntry(STORAGE_KEYS.orientation, mode));
    updateWakeTimesVisibility();
    window.DayNight.setOrientation(mode);
  }

  orientNoon.addEventListener('change', onOrientationChange);
  orientCentered.addEventListener('change', onOrientationChange);
  orientLouis.addEventListener('change', onOrientationChange);

  function onWakeBedChange() {
    liveWake = wakeInput.value;
    liveBed = bedInput.value;
    var entry = {};
    entry[STORAGE_KEYS.wakeTime] = liveWake;
    entry[STORAGE_KEYS.bedTime] = liveBed;
    storage.set(entry);
    if (!simulating()) window.DayNight.setWakeBed(liveWake, liveBed);
  }

  wakeInput.addEventListener('change', onWakeBedChange);
  bedInput.addEventListener('change', onWakeBedChange);

  showWakeSleep.addEventListener('change', function () {
    liveShowWakeSleep = showWakeSleep.checked;
    storage.set(makeEntry(STORAGE_KEYS.showWakeSleep, liveShowWakeSleep));
    updateWakeTimesVisibility();
    if (!simulating()) window.DayNight.setShowWakeSleep(liveShowWakeSleep);
  });

  var showMinuteMarks = document.getElementById('show-minute-marks');
  var minuteMarksRow = document.getElementById('minute-marks-row');

  // The marker ring is read against the minute hand, so it follows it: the
  // option is offered only while the hand is on, and its own setting is kept
  // so turning the hand back on restores the ring as the user left it.
  function applyHandVisibility() {
    document.body.classList.toggle('hide-minute-hand', !showMinute.checked);
    document.body.classList.toggle('hide-second-hand', !showSecond.checked);
    document.body.classList.toggle('show-minute-marks',
      showMinute.checked && showMinuteMarks.checked);
    minuteMarksRow.hidden = !showMinute.checked;
    // Nothing to keep clear of once the minute hand is off, so the hour hand
    // and the sun/moon it carries take the extra room.
    window.Clock24.setHourHandExtended(!showMinute.checked);
    // The sun and moon have just moved along the hand, and the main location's
    // name on it has to stay clear of them.
    if (window.Locations) window.Locations.render();
  }

  showMinute.addEventListener('change', function () {
    storage.set(makeEntry(STORAGE_KEYS.showMinute, showMinute.checked));
    applyHandVisibility();
  });

  showSecond.addEventListener('change', function () {
    storage.set(makeEntry(STORAGE_KEYS.showSecond, showSecond.checked));
    applyHandVisibility();
  });

  showMinuteMarks.addEventListener('change', function () {
    storage.set(makeEntry(STORAGE_KEYS.showMinuteMarks, showMinuteMarks.checked));
    applyHandVisibility();
  });

  var showSubhourTicks = document.getElementById('show-subhour-ticks');

  function applySubhourTicks() {
    document.body.classList.toggle('hide-subhour-ticks', !showSubhourTicks.checked);
  }

  showSubhourTicks.addEventListener('change', function () {
    storage.set(makeEntry(STORAGE_KEYS.showSubhourTicks, showSubhourTicks.checked));
    applySubhourTicks();
  });

  // ---- Collapse / expand -------------------------------------------------

  var toggle = document.getElementById('sidebar-toggle');

  function setCollapsed(collapsed, persist) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    if (persist) {
      storage.set(makeEntry(STORAGE_KEYS.collapsed, collapsed));
    }
  }

  toggle.addEventListener('click', function () {
    setCollapsed(!document.body.classList.contains('sidebar-collapsed'), true);
  });

  // ---- Places dropdown + favorites ---------------------------------------

  var favToggle = document.getElementById('fav-toggle');

  function buildPlaceOptions(selectedValue) {
    Places.fillPlaceSelect(placeSelect, selectedValue);
    updateFavToggle();
  }

  function updateFavToggle() {
    var id = placeSelect.value;
    var isPlace = !!findPlace(id);
    var fav = isPlace && Places.isFavorite(id);
    favToggle.disabled = !isPlace;
    favToggle.textContent = fav ? '★' : '☆'; // ★ / ☆
    favToggle.classList.toggle('is-fav', fav);
    favToggle.setAttribute('aria-pressed', String(fav));
    favToggle.title = fav ? 'Remove from favorites' : 'Add to favorites';
  }

  favToggle.addEventListener('click', function () {
    var id = placeSelect.value;
    if (!findPlace(id)) return;
    Places.toggleFavorite(id);
    storage.set(makeEntry(STORAGE_KEYS.favorites, Places.getFavorites()));
    buildPlaceOptions(id); // keep the current city selected
    // The rows below group their menus the same way, so they have moved too.
    if (window.Locations) window.Locations.refreshRows();
  });

  var locationReadout = document.getElementById('location-readout');

  /** How a location reads under the clock: the city if it is one, else coords. */
  function describeLocation(loc) {
    var place = findPlace(loc.place);
    var coords = Places.formatCoords(loc.lat, loc.lon);
    return place ? place.label + ' (' + coords + ')' : coords;
  }

  // ---- Live state ---------------------------------------------------------
  // What the Options block would have the clock show. The one setting the
  // simulator overrides is the wake/sleep lines, which it hides, so while it is
  // active that is only recorded and persisted; restoreLiveState puts it back
  // when it is done. Everything else — the location, the orientation — is
  // pushed straight through, because the simulator moves the moment and nothing
  // else about how the dial is drawn.

  var liveLocation = null;
  var liveShowWakeSleep = false;
  var liveWake = '07:00';
  var liveBed = '23:00';

  function pushLiveLocation() {
    window.Clock24.setTimeZone(liveLocation ? liveLocation.tz : null);
    window.DayNight.setLocation(liveLocation
      ? { lat: liveLocation.lat, lon: liveLocation.lon }
      : null);
    locationReadout.textContent = liveLocation ? describeLocation(liveLocation) : '';
  }

  /** Point the clock and shading at a location (or null to clear). */
  function applyLocation(loc) {
    liveLocation = loc || null;
    pushLiveLocation();
    // Both the extra hands and the simulator's fields are measured against the
    // main location, so they are told rather than left to notice.
    document.dispatchEvent(new CustomEvent('location:changed'));
  }

  /**
   * Take a location from elsewhere in the panel — promoting one of the extra
   * locations — and make it the main one, controls and all.
   */
  function setMainLocation(loc) {
    if (!loc) return;
    showError(null);
    latInput.value = loc.lat;
    lonInput.value = loc.lon;
    storage.set(makeEntry(STORAGE_KEYS.location, loc));
    applyLocation(loc);
    buildPlaceOptions(findPlace(loc.place) ? loc.place : 'custom');
  }

  function restoreLiveState() {
    window.DayNight.setWakeBed(liveWake, liveBed);
    window.DayNight.setShowWakeSleep(liveShowWakeSleep);
    // Both of the above are a no-op where the lines were already off, so this
    // is what guarantees the repaint: the clock is back on real time and the
    // whole face has to be redrawn for it.
    pushLiveLocation();
  }

  window.Sidebar = {
    restoreLiveState: restoreLiveState,
    /** The location carrying the real hour hand, or null if none is set. */
    mainLocation: function () { return liveLocation; },
    setMainLocation: setMainLocation
  };

  placeSelect.addEventListener('change', function () {
    updateFavToggle();
    var place = findPlace(placeSelect.value);
    if (!place) return; // "Custom coordinates…" — keep whatever is typed
    showError(null);
    latInput.value = place.lat;
    lonInput.value = place.lon;
    var loc = {
      lat: place.lat,
      lon: place.lon,
      place: place.id,
      tz: { type: 'iana', name: place.tz }
    };
    storage.set(makeEntry(STORAGE_KEYS.location, loc));
    applyLocation(loc);
  });

  // ---- Validation + persistence ----------------------------------------

  function parseInputs() {
    var latRaw = latInput.value.trim();
    var lonRaw = lonInput.value.trim();
    if (latRaw === '' && lonRaw === '') {
      return { empty: true };
    }
    if (latRaw === '' || lonRaw === '') {
      return { error: 'Enter both a latitude and a longitude.' };
    }
    var lat = Number(latRaw);
    var lon = Number(lonRaw);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      return { error: 'Latitude must be between −90 and 90.' };
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      return { error: 'Longitude must be between −180 and 180.' };
    }
    return { location: { lat: lat, lon: lon } };
  }

  function showError(message) {
    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  }

  var debounceTimer = null;

  function onInput() {
    placeSelect.value = 'custom'; // typing coordinates leaves the preset
    updateFavToggle();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var result = parseInputs();
      if (result.error) {
        showError(result.error);
        return;
      }
      showError(null);
      var loc = null;
      if (!result.empty) {
        loc = {
          lat: result.location.lat,
          lon: result.location.lon,
          place: 'custom',
          tz: zoneForCoords(result.location.lat, result.location.lon)
        };
      }
      storage.set(makeEntry(STORAGE_KEYS.location, loc));
      applyLocation(loc);
    }, 400);
  }

  latInput.addEventListener('input', onInput);
  lonInput.addEventListener('input', onInput);

  // ---- Polar note --------------------------------------------------------
  // Sunrise and sunset are marked on the rim, which is where they are read.
  // The only thing left to say in words is when there are none to mark.

  document.addEventListener('daynight:updated', function (e) {
    var polar = e.detail.state === 'polar-day' || e.detail.state === 'polar-night';
    if (polar) {
      polarNote.textContent = e.detail.state === 'polar-day'
        ? 'Sun does not set today.'
        : 'Sun does not rise today.';
    }
    polarNote.hidden = !polar;
  });

  // ---- Restore persisted state -------------------------------------------

  storage.get([
    STORAGE_KEYS.location,
    STORAGE_KEYS.collapsed,
    STORAGE_KEYS.favorites,
    STORAGE_KEYS.overrideNewTabs,
    STORAGE_KEYS.orientation,
    STORAGE_KEYS.wakeTime,
    STORAGE_KEYS.bedTime,
    STORAGE_KEYS.showMinute,
    STORAGE_KEYS.showSecond,
    STORAGE_KEYS.showMinuteMarks,
    STORAGE_KEYS.showSubhourTicks,
    STORAGE_KEYS.showWakeSleep,
    STORAGE_KEYS.theme
  ], function (items) {
    // First run: nothing has ever been saved, so both storage backends hand
    // back an empty object. Seed a worked example rather than the bare neutral
    // face, so a new user lands on something that shows off what the clock does
    // — and persist it, so their first tweak edits these rather than starting over.
    if (Object.keys(items).length === 0) {
      items = {};
      items[STORAGE_KEYS.location] = {
        lat: 43.2965, lon: 5.3698, place: 'marseille',
        tz: { type: 'iana', name: 'Europe/Paris' }
      };
      items[STORAGE_KEYS.collapsed] = false;      // sidebar open
      items[STORAGE_KEYS.orientation] = 'centered';
      items[STORAGE_KEYS.wakeTime] = '07:20';
      items[STORAGE_KEYS.bedTime] = '23:40';
      items[STORAGE_KEYS.showMinute] = true;
      items[STORAGE_KEYS.showSecond] = true;
      items[STORAGE_KEYS.showMinuteMarks] = false; // the one thing left off
      items[STORAGE_KEYS.showSubhourTicks] = true;
      items[STORAGE_KEYS.showWakeSleep] = true;
      items[STORAGE_KEYS.theme] = 'system'; // follow Chrome until told otherwise
      storage.set(items);
    }

    // Saves from before this option, and anything unrecognised, follow Chrome.
    // theme.js has already painted from its cache, but this is the copy that
    // decides: re-applying repairs the page if the cache was cleared or fell
    // out of step, and leaves the two agreeing again.
    themeSelect.value = window.Theme.set(items[STORAGE_KEYS.theme]);

    overrideNewTab.checked = items[STORAGE_KEYS.overrideNewTabs] === true;
    // If the user revoked the tabs permission externally, reflect reality.
    if (overrideNewTab.checked && permissionsApi) {
      permissionsApi.contains({ permissions: ['tabs'] }, function (has) {
        if (!has) {
          overrideNewTab.checked = false;
          storage.set(makeEntry(STORAGE_KEYS.overrideNewTabs, false));
        }
      });
    }

    var saved = items[STORAGE_KEYS.orientation];
    var mode = (saved === 'centered' || saved === 'louis') ? saved : 'noon';
    orientCentered.checked = mode === 'centered';
    orientLouis.checked = mode === 'louis';
    orientNoon.checked = mode === 'noon';
    // The lines used to come with Louis XIV mode, so keep them on for anyone
    // already in it who has never touched the new checkbox.
    var savedWakeSleep = items[STORAGE_KEYS.showWakeSleep];
    showWakeSleep.checked = typeof savedWakeSleep === 'boolean'
      ? savedWakeSleep
      : mode === 'louis';
    updateWakeTimesVisibility();
    if (typeof items[STORAGE_KEYS.wakeTime] === 'string') {
      wakeInput.value = items[STORAGE_KEYS.wakeTime];
    }
    if (typeof items[STORAGE_KEYS.bedTime] === 'string') {
      bedInput.value = items[STORAGE_KEYS.bedTime];
    }
    // The simulator is never active this early, so these apply straight away.
    liveShowWakeSleep = showWakeSleep.checked;
    liveWake = wakeInput.value;
    liveBed = bedInput.value;
    window.DayNight.setWakeBed(liveWake, liveBed);
    window.DayNight.setShowWakeSleep(liveShowWakeSleep);
    window.DayNight.setOrientation(mode);

    showMinute.checked = items[STORAGE_KEYS.showMinute] !== false;
    showSecond.checked = items[STORAGE_KEYS.showSecond] !== false;
    showMinuteMarks.checked = items[STORAGE_KEYS.showMinuteMarks] === true;
    applyHandVisibility();
    showSubhourTicks.checked = items[STORAGE_KEYS.showSubhourTicks] !== false;
    applySubhourTicks();
    // Restore without animating: state should appear settled on load.
    document.body.classList.add('no-transition');
    // Default to expanded on first run so the location inputs are discoverable.
    setCollapsed(items[STORAGE_KEYS.collapsed] === true, false);
    requestAnimationFrame(function () {
      document.body.classList.remove('no-transition');
    });

    Places.setFavorites(items[STORAGE_KEYS.favorites]);

    var loc = items[STORAGE_KEYS.location];
    var selected = 'custom';
    if (loc && typeof loc.lat === 'number' && typeof loc.lon === 'number') {
      if (!loc.tz) { // saves from before timezones existed
        loc.place = 'custom';
        loc.tz = zoneForCoords(loc.lat, loc.lon);
      }
      if (loc.tz.type === 'offset' && !findPlace(loc.place)) {
        // Upgrade coordinates saved under the old longitude approximation.
        loc.tz = zoneForCoords(loc.lat, loc.lon);
        storage.set(makeEntry(STORAGE_KEYS.location, loc));
      }
      latInput.value = loc.lat;
      lonInput.value = loc.lon;
      if (findPlace(loc.place)) selected = loc.place;
      applyLocation(loc);
    }
    buildPlaceOptions(selected);
  });
})();
