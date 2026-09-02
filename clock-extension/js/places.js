/*
 * places.js — everything that turns a place, or a bare pair of coordinates,
 * into something the clock can point at: the sorted city list, the favorites,
 * timezone resolution, and the shared place <select> builder.
 *
 * Both panels offer the same choice of place, so this lives here rather than
 * in either one of them. Storage is not its business: sidebar.js loads the
 * saved favorites into it and persists them back out again.
 */
(function () {
  'use strict';

  var PLACES = window.CITIES.slice().sort(function (a, b) {
    return a.label.localeCompare(b.label);
  });

  var DEFAULT_FAVORITES = ['marseille', 'landevieille', 'london', 'sonoma',
    'capetown', 'utqiagvik', 'mcmurdo'];
  var favorites = DEFAULT_FAVORITES.slice();

  function findPlace(id) {
    for (var i = 0; i < PLACES.length; i++) {
      if (PLACES[i].id === id) return PLACES[i];
    }
    return null;
  }

  /** Last-resort timezone for custom coordinates: whole-hour offset from longitude. */
  function zoneFromLongitude(lon) {
    return { type: 'offset', minutes: Math.round(lon / 15) * 60 };
  }

  /**
   * Timezone for arbitrary coordinates. tz-lookup gives a real IANA zone
   * (so DST and half-hour offsets come out right); the longitude offset is
   * kept as a fallback for a name this browser's Intl cannot resolve.
   */
  function zoneForCoords(lat, lon) {
    if (typeof tzlookup === 'function') {
      try {
        var name = tzlookup(lat, lon);
        new Intl.DateTimeFormat('en-US', { timeZone: name }); // throws if unknown
        return { type: 'iana', name: name };
      } catch (e) { /* fall through */ }
    }
    return zoneFromLongitude(lon);
  }

  function formatCoords(lat, lon) {
    return Math.abs(lat).toFixed(4) + '°' + (lat >= 0 ? 'N' : 'S') +
      ', ' + Math.abs(lon).toFixed(4) + '°' + (lon >= 0 ? 'E' : 'W');
  }

  function isFavorite(id) {
    return favorites.indexOf(id) !== -1;
  }

  /** Flip a city's favorite status; returns whether it is a favorite now. */
  function toggleFavorite(id) {
    if (!findPlace(id)) return false;
    var idx = favorites.indexOf(id);
    if (idx === -1) {
      favorites.push(id);
      return true;
    }
    favorites.splice(idx, 1);
    return false;
  }

  function getFavorites() {
    return favorites.slice();
  }

  /** Replace the list, dropping any id no longer in the city table. */
  function setFavorites(ids) {
    if (!Array.isArray(ids)) return getFavorites();
    favorites = ids.filter(function (id) { return !!findPlace(id); });
    return getFavorites();
  }

  /** Fill a <select>: Custom, then Favorites, then the remaining cities. */
  function fillPlaceSelect(select, selectedValue) {
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }

    var custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom coordinates…';
    select.appendChild(custom);

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
      select.appendChild(group);
    }

    addGroup('★ Favorites', PLACES.filter(function (p) { return isFavorite(p.id); }));
    addGroup('All cities', PLACES.filter(function (p) { return !isFavorite(p.id); }));

    select.value = selectedValue || 'custom';
  }

  window.Places = {
    all: PLACES,
    find: findPlace,
    zoneFromLongitude: zoneFromLongitude,
    zoneForCoords: zoneForCoords,
    formatCoords: formatCoords,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    getFavorites: getFavorites,
    setFavorites: setFavorites,
    fillPlaceSelect: fillPlaceSelect
  };
})();
