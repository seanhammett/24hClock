/*
 * sidebar.js — collapsible settings panel: lat/lon inputs with validation,
 * debounced persistence to chrome.storage.local, and display of the
 * computed sun times published by daynight.js.
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
    showMinuteMarks: 'showMinuteMarks'
  };

  var PLACES = window.CITIES.slice().sort(function (a, b) {
    return a.label.localeCompare(b.label);
  });

  var DEFAULT_FAVORITES = ['marseille', 'landevieille', 'london', 'sonoma', 'capetown'];
  var favorites = DEFAULT_FAVORITES.slice();

  function findPlace(id) {
    for (var i = 0; i < PLACES.length; i++) {
      if (PLACES[i].id === id) return PLACES[i];
    }
    return null;
  }

  /** Timezone for custom coordinates: whole-hour offset from longitude. */
  function zoneFromLongitude(lon) {
    return { type: 'offset', minutes: Math.round(lon / 15) * 60 };
  }

  // chrome.storage.local in the extension; localStorage fallback so the
  // page still works when opened as a plain file during development.
  var storage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
    ? {
        get: function (keys, cb) { chrome.storage.local.get(keys, cb); },
        set: function (obj) { chrome.storage.local.set(obj); }
      }
    : {
        get: function (keys, cb) {
          var out = {};
          keys.forEach(function (k) {
            var raw = localStorage.getItem(k);
            if (raw !== null) out[k] = JSON.parse(raw);
          });
          cb(out);
        },
        set: function (obj) {
          Object.keys(obj).forEach(function (k) {
            localStorage.setItem(k, JSON.stringify(obj[k]));
          });
        }
      };

  var sidebar = document.getElementById('sidebar');
  var toggle = document.getElementById('sidebar-toggle');
  var placeSelect = document.getElementById('place-select');
  var latInput = document.getElementById('lat-input');
  var lonInput = document.getElementById('lon-input');
  var errorEl = document.getElementById('input-error');
  var sunTimesEl = document.getElementById('sun-times');
  var sunriseEl = document.getElementById('sunrise-time');
  var sunsetEl = document.getElementById('sunset-time');
  var polarNote = document.getElementById('polar-note');
  var overrideNewTab = document.getElementById('override-newtab');

  // The background service worker reads this flag when new tabs are created.
  // The "tabs" permission is optional: requested here on enable (must happen
  // inside the user gesture) and released again on disable, so the extension
  // installs with no permission warnings.
  var permissionsApi = (typeof chrome !== 'undefined' && chrome.permissions) || null;

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

  // ---- Orientation + hand visibility -------------------------------------

  var orientNoon = document.getElementById('orient-noon');
  var orientCentered = document.getElementById('orient-centered');
  var orientLouis = document.getElementById('orient-louis');
  var louisTimes = document.getElementById('louis-times');
  var wakeInput = document.getElementById('wake-input');
  var bedInput = document.getElementById('bed-input');
  var showMinute = document.getElementById('show-minute');
  var showSecond = document.getElementById('show-second');

  function currentOrientation() {
    if (orientCentered.checked) return 'centered';
    if (orientLouis.checked) return 'louis';
    return 'noon';
  }

  function onOrientationChange() {
    var mode = currentOrientation();
    storage.set(makeEntry(STORAGE_KEYS.orientation, mode));
    louisTimes.hidden = mode !== 'louis';
    window.DayNight.setOrientation(mode);
  }

  orientNoon.addEventListener('change', onOrientationChange);
  orientCentered.addEventListener('change', onOrientationChange);
  orientLouis.addEventListener('change', onOrientationChange);

  function onWakeBedChange() {
    var entry = {};
    entry[STORAGE_KEYS.wakeTime] = wakeInput.value;
    entry[STORAGE_KEYS.bedTime] = bedInput.value;
    storage.set(entry);
    window.DayNight.setWakeBed(wakeInput.value, bedInput.value);
  }

  wakeInput.addEventListener('change', onWakeBedChange);
  bedInput.addEventListener('change', onWakeBedChange);

  var showMinuteMarks = document.getElementById('show-minute-marks');

  function applyHandVisibility() {
    document.body.classList.toggle('hide-minute-hand', !showMinute.checked);
    document.body.classList.toggle('hide-second-hand', !showSecond.checked);
    document.body.classList.toggle('show-minute-marks', showMinuteMarks.checked);
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

  // ---- Collapse / expand ------------------------------------------------

  function setCollapsed(collapsed, persist) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    if (persist) {
      storage.set(makeEntry(STORAGE_KEYS.collapsed, collapsed));
    }
  }

  function makeEntry(key, value) {
    var obj = {};
    obj[key] = value;
    return obj;
  }

  toggle.addEventListener('click', function () {
    var collapsed = !document.body.classList.contains('sidebar-collapsed');
    setCollapsed(collapsed, true);
  });

  // ---- Places dropdown + favorites ---------------------------------------

  var favToggle = document.getElementById('fav-toggle');

  function isFavorite(id) {
    return favorites.indexOf(id) !== -1;
  }

  /** Rebuild the select: Custom, then Favorites, then the remaining cities. */
  function buildPlaceOptions(selectedValue) {
    while (placeSelect.firstChild) {
      placeSelect.removeChild(placeSelect.firstChild);
    }

    var custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom coordinates…';
    placeSelect.appendChild(custom);

    function addGroup(label, places) {
      if (!places.length) return;
      var group = document.createElement('optgroup');
      group.label = label;
      places.forEach(function (place) {
        var opt = document.createElement('option');
        opt.value = place.id;
        opt.textContent = place.label;
        group.appendChild(opt);
      });
      placeSelect.appendChild(group);
    }

    addGroup('★ Favorites', PLACES.filter(function (p) { return isFavorite(p.id); }));
    addGroup('All cities', PLACES.filter(function (p) { return !isFavorite(p.id); }));

    placeSelect.value = selectedValue || 'custom';
    updateFavToggle();
  }

  function updateFavToggle() {
    var id = placeSelect.value;
    var isPlace = !!findPlace(id);
    var fav = isPlace && isFavorite(id);
    favToggle.disabled = !isPlace;
    favToggle.textContent = fav ? '★' : '☆'; // ★ / ☆
    favToggle.classList.toggle('is-fav', fav);
    favToggle.setAttribute('aria-pressed', String(fav));
    favToggle.title = fav ? 'Remove from favorites' : 'Add to favorites';
  }

  favToggle.addEventListener('click', function () {
    var id = placeSelect.value;
    if (!findPlace(id)) return;
    var idx = favorites.indexOf(id);
    if (idx === -1) {
      favorites.push(id);
    } else {
      favorites.splice(idx, 1);
    }
    storage.set(makeEntry(STORAGE_KEYS.favorites, favorites));
    buildPlaceOptions(id); // keep the current city selected
  });

  var locationReadout = document.getElementById('location-readout');

  function formatCoords(lat, lon) {
    return Math.abs(lat).toFixed(4) + '°' + (lat >= 0 ? 'N' : 'S') +
      ', ' + Math.abs(lon).toFixed(4) + '°' + (lon >= 0 ? 'E' : 'W');
  }

  /** Point the clock and shading at a location (or null to clear). */
  function applyLocation(loc) {
    window.Clock24.setTimeZone(loc ? loc.tz : null);
    window.DayNight.setLocation(loc ? { lat: loc.lat, lon: loc.lon } : null);
    if (!loc) {
      locationReadout.textContent = '';
    } else {
      var place = findPlace(loc.place);
      locationReadout.textContent = (place ? place.label + ' — ' : '') +
        formatCoords(loc.lat, loc.lon);
    }
  }

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
          tz: zoneFromLongitude(result.location.lon)
        };
      }
      storage.set(makeEntry(STORAGE_KEYS.location, loc));
      applyLocation(loc);
    }, 400);
  }

  latInput.addEventListener('input', onInput);
  lonInput.addEventListener('input', onInput);

  // ---- Sun-times display -------------------------------------------------

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  document.addEventListener('daynight:updated', function (e) {
    var d = e.detail;
    if (d.state === 'empty') {
      sunTimesEl.hidden = true;
      return;
    }
    sunTimesEl.hidden = false;
    if (d.state === 'ok') {
      sunriseEl.textContent = formatTime(d.sunrise);
      sunsetEl.textContent = formatTime(d.sunset);
      polarNote.hidden = true;
    } else {
      sunriseEl.textContent = '–';
      sunsetEl.textContent = '–';
      polarNote.textContent = d.state === 'polar-day'
        ? 'Sun does not set today.'
        : 'Sun does not rise today.';
      polarNote.hidden = false;
    }
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
    STORAGE_KEYS.showSecond
  ], function (items) {
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
    louisTimes.hidden = mode !== 'louis';
    if (typeof items[STORAGE_KEYS.wakeTime] === 'string') {
      wakeInput.value = items[STORAGE_KEYS.wakeTime];
    }
    if (typeof items[STORAGE_KEYS.bedTime] === 'string') {
      bedInput.value = items[STORAGE_KEYS.bedTime];
    }
    window.DayNight.setWakeBed(wakeInput.value, bedInput.value);
    window.DayNight.setOrientation(mode);

    showMinute.checked = items[STORAGE_KEYS.showMinute] !== false;
    showSecond.checked = items[STORAGE_KEYS.showSecond] !== false;
    showMinuteMarks.checked = items[STORAGE_KEYS.showMinuteMarks] === true;
    applyHandVisibility();
    // Restore without animating: state should appear settled on load.
    document.body.classList.add('no-transition');
    // Default to expanded on first run so the location inputs are discoverable.
    setCollapsed(items[STORAGE_KEYS.collapsed] === true, false);
    requestAnimationFrame(function () {
      document.body.classList.remove('no-transition');
    });

    if (Array.isArray(items[STORAGE_KEYS.favorites])) {
      favorites = items[STORAGE_KEYS.favorites].filter(function (id) {
        return !!findPlace(id);
      });
    }

    var loc = items[STORAGE_KEYS.location];
    var selected = 'custom';
    if (loc && typeof loc.lat === 'number' && typeof loc.lon === 'number') {
      if (!loc.tz) { // saves from before timezones existed
        loc.place = 'custom';
        loc.tz = zoneFromLongitude(loc.lon);
      }
      latInput.value = loc.lat;
      lonInput.value = loc.lon;
      if (findPlace(loc.place)) selected = loc.place;
      applyLocation(loc);
    }
    buildPlaceOptions(selected);
  });
})();
