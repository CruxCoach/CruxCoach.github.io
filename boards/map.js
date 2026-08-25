(function () {
  'use strict';

  // ── i18n ──────────────────────────────────────────────────────────
  // The same script serves /boards/ (en) and /de/boards/ (de); the page's
  // <html lang> attribute decides which string table is used. Board names,
  // MoonBoard variant years, layout names and brand words stay untranslated.
  var LANG = (document.documentElement.lang === 'de') ? 'de' : 'en';
  var T = {
    en: {
      boardType: 'Board type',
      all: 'All',
      none: 'None',
      kilterWalls: 'Kilter walls',
      layout: 'Layout',
      angle: 'Angle',
      sizeHdr: 'Size ({n})',
      sizeFallback: 'Size {id}',
      other: 'Other',
      adjustable: 'Adjustable',
      fixed: 'Fixed',
      unknown: 'Unknown',
      unknownMoonVariant: 'MoonBoard variant unknown',
      moonSetup: 'MoonBoard setup',
      variant: 'Variant',
      type: 'Type',
      hardware: 'Hardware',
      commercial: 'Commercial',
      homeSetup: 'Home setup',
      noLeds: 'No LEDs',
      wellpassNote: 'egym Wellpass coverage (DACH, manually curated).',
      inWellpass: 'In Wellpass',
      notInWellpass: 'Not in Wellpass',
      countryHdr: 'Country ({n})',
      countryNote: 'Applies to every venue.',
      resetFilters: 'Reset detail filters',
      locations: '{n} locations',
      statusOf: '{shown} of {total} locations',
      boardsInView: 'Boards in view',
      noBoardsInView: 'No matching boards in this map area. Try panning out or relaxing the filters.',
      inViewCapped: '+ in view (first {max} listed)',
      inView: ' in view',
      toggleFilters: 'Toggle filters',
      showBoardsInView: 'Show boards in view',
      loadError: 'Could not load map data ({err}).',
      unnamed: '(unnamed)',
      addressLabel: 'Address:',
      websiteLabel: 'Official website:',
      hoursLabel: 'Opening hours',
      hoursNote: 'As published by the venue; public holidays and short-notice changes may differ.',
      hoursSource: 'Official source',
      hoursClosed: 'Closed',
      hoursAllDay: '24 hours',
      hoursNextDay: 'next day',
      hoursDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      instagramLabel: 'Instagram:',
      userLabel: 'User:',
      notOnWellpass: 'Not on egym Wellpass',
      openOsm: 'Open in OpenStreetMap →',
      adjustableRange: 'adjustable {min}–{max}°',
      angleStepSuffix: ' in {step}° steps',
      adjustableSetTo: 'adjustable, set to {angle}°',
      adjustableWord: 'adjustable',
      fixedAt: 'fixed at {angle}°',
      fixedAngle: 'fixed angle',
      angleAt: 'angle {angle}°',
      searchAria: 'Search venues and places',
      searchPlaceholder: 'Search gym, place or country',
      searchHint: 'Find a gym by name, or jump the map to any town or city.',
      searchNoResults: 'Nothing matches “{q}”.',
      searchMatchOne: '1 match',
      searchMatchMany: '{n} matches',
      searchCapped: ' (first {max} shown)',
      searchResultsLabel: 'Search results',
      groupVenues: 'Gyms',
      groupPlaces: 'Places',
      placesLoading: 'Loading places…',
      placesError: 'Place index unavailable.',
      placeJump: 'Map moved to {place}. Open the list to see boards in view.',
      locateAria: 'Show my location',
      locating: 'Finding your location…',
      locateFound: 'Your location, accurate to about {n} m.',
      locateHere: 'You are here',
      locateDenied: 'Location permission denied.',
      locateUnsupported: 'This browser cannot share a location.',
      locateFailed: 'Could not determine your location.',
      nearCity: 'near {city}',
      nearestBoards: 'Nearest boards',
      nearestFromYou: 'Straight-line distance from your location.',
      noNearestBoards: 'No boards match the current filters.',
      distanceKm: '{n} km',
      distanceM: '{n} m',
    },
    de: {
      boardType: 'Board-Typ',
      all: 'Alle',
      none: 'Keine',
      kilterWalls: 'Kilter-Wände',
      layout: 'Layout',
      angle: 'Winkel',
      sizeHdr: 'Größe ({n})',
      sizeFallback: 'Größe {id}',
      other: 'Andere',
      adjustable: 'Verstellbar',
      fixed: 'Fest',
      unknown: 'Unbekannt',
      unknownMoonVariant: 'MoonBoard-Variante unbekannt',
      moonSetup: 'MoonBoard-Setup',
      variant: 'Variante',
      type: 'Typ',
      hardware: 'Hardware',
      commercial: 'Kommerziell',
      homeSetup: 'Privat (Homewall)',
      noLeds: 'Keine LEDs',
      wellpassNote: 'egym-Wellpass-Abdeckung (DACH, manuell gepflegt).',
      inWellpass: 'In Wellpass',
      notInWellpass: 'Nicht in Wellpass',
      countryHdr: 'Land ({n})',
      countryNote: 'Gilt für jeden Standort.',
      resetFilters: 'Detailfilter zurücksetzen',
      locations: '{n} Standorte',
      statusOf: '{shown} von {total} Standorten',
      boardsInView: 'Boards in der Ansicht',
      noBoardsInView: 'Keine passenden Boards in diesem Kartenausschnitt. Zoom heraus oder lockere die Filter.',
      inViewCapped: '+ in der Ansicht (erste {max} gelistet)',
      inView: ' in der Ansicht',
      toggleFilters: 'Filter ein/aus',
      showBoardsInView: 'Boards in der Ansicht zeigen',
      loadError: 'Kartendaten konnten nicht geladen werden ({err}).',
      unnamed: '(ohne Namen)',
      addressLabel: 'Adresse:',
      websiteLabel: 'Offizielle Website:',
      hoursLabel: 'Öffnungszeiten',
      hoursNote: 'Wie von der Halle veröffentlicht; Feiertage und kurzfristige Änderungen können abweichen.',
      hoursSource: 'Offizielle Quelle',
      hoursClosed: 'Geschlossen',
      hoursAllDay: '24 Stunden',
      hoursNextDay: 'Folgetag',
      hoursDays: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
      instagramLabel: 'Instagram:',
      userLabel: 'Nutzer:',
      notOnWellpass: 'Nicht bei egym Wellpass',
      openOsm: 'In OpenStreetMap öffnen →',
      adjustableRange: 'verstellbar {min}–{max}°',
      angleStepSuffix: ' in {step}°-Schritten',
      adjustableSetTo: 'verstellbar, eingestellt auf {angle}°',
      adjustableWord: 'verstellbar',
      fixedAt: 'fest auf {angle}°',
      fixedAngle: 'fester Winkel',
      angleAt: 'Winkel {angle}°',
      searchAria: 'Hallen und Orte suchen',
      searchPlaceholder: 'Halle, Ort oder Land suchen',
      searchHint: 'Finde eine Halle über ihren Namen — oder springe zu einer beliebigen Stadt.',
      searchNoResults: 'Nichts passt zu „{q}“.',
      searchMatchOne: '1 Treffer',
      searchMatchMany: '{n} Treffer',
      searchCapped: ' (erste {max} gezeigt)',
      searchResultsLabel: 'Suchergebnisse',
      groupVenues: 'Hallen',
      groupPlaces: 'Orte',
      placesLoading: 'Orte werden geladen…',
      placesError: 'Ortsverzeichnis nicht verfügbar.',
      placeJump: 'Karte auf {place} bewegt. Die Liste zeigt die Boards im Ausschnitt.',
      locateAria: 'Meinen Standort anzeigen',
      locating: 'Standort wird ermittelt…',
      locateFound: 'Dein Standort, auf etwa {n} m genau.',
      locateHere: 'Du bist hier',
      locateDenied: 'Standortfreigabe verweigert.',
      locateUnsupported: 'Dieser Browser kann keinen Standort teilen.',
      locateFailed: 'Standort konnte nicht ermittelt werden.',
      nearCity: 'bei {city}',
      nearestBoards: 'Nächste Boards',
      nearestFromYou: 'Luftlinie von deinem Standort.',
      noNearestBoards: 'Keine Boards passen zu den aktuellen Filtern.',
      distanceKm: '{n} km',
      distanceM: '{n} m',
    },
  }[LANG];

  // Tiny placeholder formatter: tf('{n} locations', { n: 5 }) → '5 locations'.
  function tf(template, vars) {
    return template.replace(/\{(\w+)\}/g, function (_, k) { return vars[k]; });
  }

  // Keep colors in sync with tools/build-boards-data.mjs board list.
  var BOARDS = [
    { id: 'kilter',      label: 'Kilter Board',  color: '#ed1d24' },
    { id: 'tension',     label: 'Tension Board', color: '#7d8590' },
    { id: 'moonboard',   label: 'MoonBoard',     color: '#feb91e' },
    { id: 'grasshopper', label: 'Grasshopper',   color: '#00eaff' },
    { id: 'decoy',       label: 'Decoy',         color: '#c256c8' },
    { id: 'soill',       label: 'So iLL',        color: '#8bb297' },
    { id: 'touchstone',  label: 'Touchstone',    color: '#5b9bd5' },
    { id: 'aurora',      label: 'Aurora',        color: '#b93655' },
    { id: '12climb',     label: '12climb',       color: '#ed1667' },
  ];
  var COLOR = Object.fromEntries(BOARDS.map(function (b) { return [b.id, b.color]; }));
  var LABEL = Object.fromEntries(BOARDS.map(function (b) { return [b.id, b.label]; }));
  var ACCENT = '#e07a4f';

  // ── Reload persistence ────────────────────────────────────────────
  // The map view and every filter selection are mirrored to localStorage,
  // so reloading the page restores exactly what the visitor was looking at
  // instead of snapping back to the world view with all filters on.
  // Storage is best-effort: any failure (private mode, quota, disabled) is
  // swallowed and the map simply falls back to its defaults.
  var STORE_KEY = 'cc-boards-map-v1';

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function persist() {
    try {
      var c = map.getCenter();
      localStorage.setItem(STORE_KEY, JSON.stringify({
        view: { lat: c.lat, lon: c.lng, zoom: map.getZoom() },
        filters: {
          boards:    Array.from(activeBoards),
          layouts:   Array.from(activeLayouts),
          adj:       Array.from(activeAdj),
          moonCom:   Array.from(activeMoonCom),
          moonLed:   Array.from(activeMoonLed),
          moonVar:   Array.from(activeMoonVariants),
          wellpass:  Array.from(activeWellpass),
          sizes:     activeSizes === null ? null : Array.from(activeSizes),
          countries: activeCountries === null ? null : Array.from(activeCountries),
        },
      }));
    } catch (e) { /* storage unavailable or full — non-fatal */ }
    writeHash();
  }

  // Overwrite the active-filter sets from a persisted snapshot. Each
  // dimension is restored independently, so a snapshot written by an older
  // build (missing a key) degrades gracefully instead of throwing.
  function restoreFilters(f) {
    if (!f || typeof f !== 'object') return;
    if (Array.isArray(f.boards))  activeBoards       = new Set(f.boards);
    if (Array.isArray(f.layouts)) activeLayouts      = new Set(f.layouts);
    if (Array.isArray(f.adj))     activeAdj          = new Set(f.adj);
    if (Array.isArray(f.moonCom)) activeMoonCom      = new Set(f.moonCom);
    if (Array.isArray(f.moonLed)) activeMoonLed      = new Set(f.moonLed);
    if (Array.isArray(f.moonVar)) activeMoonVariants = new Set(f.moonVar);
    if (Array.isArray(f.wellpass)) activeWellpass    = new Set(f.wellpass);
    activeSizes     = Array.isArray(f.sizes)     ? new Set(f.sizes)     : null;
    activeCountries = Array.isArray(f.countries) ? new Set(f.countries) : null;
  }

  // ── Shareable URL state ───────────────────────────────────────────
  // The map kept its position in localStorage only, so a view worth
  // showing someone could not be sent to them — a gym you found, or every
  // Tension board in one region. The hash carries centre, zoom and the
  // board-type filter: enough to reproduce what the sender is looking at,
  // short enough to paste into a message. The detail filters stay in
  // localStorage; encoding all seven dimensions would double the URL for
  // a case nobody shares.
  //
  // A hash, when present, wins over the stored view: an incoming link must
  // show its own subject, not wherever the recipient last happened to be.
  function readHash() {
    var raw = (location.hash || '').replace(/^#/, '');
    if (!raw) return null;
    var parts = raw.split('&');
    var view = parts[0].split(',');
    var lat = parseFloat(view[0]);
    var lon = parseFloat(view[1]);
    var zoom = parseInt(view[2], 10);
    if (!isFinite(lat) || lat < -90 || lat > 90) return null;
    if (!isFinite(lon) || lon < -180 || lon > 180) return null;
    if (!isFinite(zoom) || zoom < 0 || zoom > 19) return null;
    var out = { lat: lat, lon: lon, zoom: zoom, boards: null };
    for (var i = 1; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] !== 'b' || !kv[1]) continue;
      // Drop unknown ids rather than filtering everything away on a typo.
      var ids = kv[1].split(',').filter(function (id) { return !!COLOR[id]; });
      if (ids.length) out.boards = ids;
    }
    return out;
  }

  // replaceState instead of assigning location.hash: assigning would push a
  // history entry for every pan, burying the page the visitor arrived from.
  function writeHash() {
    if (!map || typeof history === 'undefined' || !history.replaceState) return;
    var c = map.getCenter();
    var hash = '#' + c.lat.toFixed(4) + ',' + c.lng.toFixed(4) + ',' + map.getZoom();
    // Only spell out the board filter when it is not "everything".
    if (activeBoards && activeBoards.size && activeBoards.size < BOARDS.length) {
      hash += '&b=' + BOARDS
        .filter(function (b) { return activeBoards.has(b.id); })
        .map(function (b) { return b.id; })
        .join(',');
    }
    if (hash !== location.hash) {
      try { history.replaceState(null, '', location.pathname + location.search + hash); }
      catch (e) { /* some privacy modes throttle replaceState — non-fatal */ }
    }
  }

  var savedState = loadState();
  var hashState = readHash();

  var map = L.map('map', { worldCopyJump: true, zoomControl: true });
  var sv = hashState || (savedState && savedState.view);
  if (sv && isFinite(sv.lat) && sv.lat >= -90 && sv.lat <= 90 &&
      isFinite(sv.lon) && isFinite(sv.zoom) && sv.zoom >= 0 && sv.zoom <= 19) {
    map.setView([sv.lat, sv.lon], sv.zoom);
  } else {
    map.setView([47.5, 9.5], 4);
  }

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    maxNativeZoom: 19,
    // On HiDPI displays Leaflet otherwise scales 256-px tiles to fill more
    // CSS pixels, which reads as soft/blurry. detectRetina makes it request
    // higher-zoom tiles for the same map zoom on those devices, doubling
    // effective resolution at the cost of ~4× tile requests in those areas.
    detectRetina: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · data <a href="https://github.com/Stevie-Ray/hangtime-climbing-boards">hangtime-climbing-boards</a>',
  }).addTo(map);

  // One cluster for ALL venues. We group by (lat, lon) at the build step, so
  // a multi-board gym is already a single feature here — no more random
  // overlapping markers; clicks always hit the same composite marker.
  var cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    iconCreateFunction: function (c) {
      return L.divIcon({
        html: '<div class="marker-cluster-board" style="width:36px;height:36px;background:' +
          ACCENT + 'd9">' + c.getChildCount() + '</div>',
        className: '',
        iconSize: [36, 36],
      });
    },
  }).addTo(map);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Build an SVG pie marker for a venue with N≥2 distinct board types.
  // Each segment occupies 360/N degrees starting at 12 o'clock.
  function pieMarkerSvg(colors, size) {
    var n = colors.length;
    var r = size / 2;
    var cx = r, cy = r;
    if (n === 1) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 1) + '" fill="' + colors[0] + '" stroke="#fff" stroke-width="2"/>' +
        '</svg>';
    }
    var segments = '';
    for (var i = 0; i < n; i++) {
      var a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
      var a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
      var x0 = cx + (r - 1) * Math.cos(a0);
      var y0 = cy + (r - 1) * Math.sin(a0);
      var x1 = cx + (r - 1) * Math.cos(a1);
      var y1 = cy + (r - 1) * Math.sin(a1);
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      segments +=
        '<path d="M ' + cx + ' ' + cy +
        ' L ' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
        ' A ' + (r - 1) + ' ' + (r - 1) + ' 0 ' + large + ' 1 ' +
        x1.toFixed(2) + ' ' + y1.toFixed(2) + ' Z" fill="' + colors[i] + '"/>';
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      segments +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 1) + '" fill="none" stroke="#fff" stroke-width="2"/>' +
      '</svg>';
  }

  // Distinct board ids present at a venue, in canonical order.
  function distinctBoards(venueBoards) {
    var seen = {};
    var out = [];
    for (var i = 0; i < venueBoards.length; i++) {
      var b = venueBoards[i].board;
      if (!seen[b]) { seen[b] = 1; out.push(b); }
    }
    out.sort(function (a, b) { return BOARDS.findIndex(x => x.id === a) - BOARDS.findIndex(x => x.id === b); });
    return out;
  }

  function angleSummary(wall) {
    if (wall.adjustable === true) {
      if (wall.min_angle != null && wall.max_angle != null) {
        var step = wall.angle_increments != null ? tf(T.angleStepSuffix, { step: wall.angle_increments }) : '';
        return tf(T.adjustableRange, { min: wall.min_angle, max: wall.max_angle }) + step;
      }
      return wall.angle != null ? tf(T.adjustableSetTo, { angle: wall.angle }) : T.adjustableWord;
    }
    if (wall.adjustable === false) {
      return wall.angle != null ? tf(T.fixedAt, { angle: wall.angle }) : T.fixedAngle;
    }
    return wall.angle != null ? tf(T.angleAt, { angle: wall.angle }) : null;
  }

  function renderKilterWalls(walls) {
    if (!walls || !walls.length) return '';
    return walls.map(function (w) {
      var parts = [];
      if (w.size_label) parts.push(escapeHtml(w.size_label));
      else if (w.layout) parts.push(escapeHtml(w.layout));
      var ang = angleSummary(w);
      if (ang) parts.push(escapeHtml(ang));
      var line = parts.join(' · ');
      var prefix = walls.length > 1 && w.wall_name ? '<span class="label">' + escapeHtml(w.wall_name) + ':</span> ' : '';
      return '<div class="popup-wall">' + prefix + line + '</div>';
    }).join('');
  }

  function renderBoardDetails(boardObj) {
    var b = boardObj.board;
    if (b === 'kilter') {
      var bits = [];
      if (boardObj.walls && boardObj.walls.length) bits.push(renderKilterWalls(boardObj.walls));
      if (boardObj.address) bits.push('<div class="popup-wall"><span class="label">' + T.addressLabel + '</span> ' + escapeHtml(boardObj.address) + '</div>');
      if (boardObj.instagram) bits.push('<div class="popup-wall"><span class="label">' + T.instagramLabel + '</span> <a href="https://instagram.com/' +
        encodeURIComponent(boardObj.instagram) + '" target="_blank" rel="noopener">@' + escapeHtml(boardObj.instagram) + '</a></div>');
      return bits.join('');
    }
    if (b === 'moonboard') {
      var tags = [];
      tags.push(boardObj.variant
        ? (MOON_VARIANT_LABEL[boardObj.variant] || boardObj.variant)
        : T.unknownMoonVariant);
      if (boardObj.commercial === true) tags.push(T.commercial);
      else if (boardObj.commercial === false) tags.push(T.homeSetup);
      if (boardObj.led === true) tags.push('LED');
      else if (boardObj.led === false) tags.push(T.noLeds);
      if (typeof boardObj.angle === 'number') tags.push(boardObj.angle + '°');
      return tags.length ? '<div class="popup-wall">' + tags.join(' · ') + '</div>' : '';
    }
    if (boardObj.username) {
      return '<div class="popup-wall"><span class="label">' + T.userLabel + '</span> @' + escapeHtml(boardObj.username) + '</div>';
    }
    return '';
  }

  // Curated official-website links (tools/venue-links.json) arrive through
  // boards.geojson. The curation pipeline already refuses anything that is not
  // a credential-free https URL on a real host, but the map re-checks before
  // building an href: this value came out of a fetched file, and a popup is
  // exactly where a bad one would do its damage. Anything unexpected renders
  // as no link at all rather than as a link somewhere unexpected.
  function safeSiteUrl(raw) {
    if (typeof raw !== 'string' || raw.length > 300) return null;
    var u;
    try { u = new URL(raw); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password || u.port) return null;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(u.hostname)) return null;
    return u;
  }

  function renderSiteLine(props) {
    var url = safeSiteUrl(props.website);
    if (!url) return '';
    return '<div class="popup-site"><span class="label">' + T.websiteLabel + '</span> ' +
      '<a href="' + escapeHtml(url.href) + '" target="_blank" rel="noopener" referrerpolicy="origin">' +
      escapeHtml(url.hostname.replace(/^www\./, '')) + '</a>' +
      '</div>';
  }

  // ── Curated opening hours ─────────────────────────────────────────
  //
  // Hours arrive on the venue as a 7-element array, Monday first, where '' is a
  // day the venue itself states as closed. tools/venue-hours.mjs is what writes
  // them, and it refuses anything it cannot spell canonically — but the map
  // re-checks, because this came out of a fetched file and because a schedule
  // rendered wrong is worse than one not rendered at all: a visitor acts on it.
  //
  // Nothing here computes whether the venue is open now. The popup states what
  // the venue published and links the page it was read from; the clock, the
  // visitor's timezone and public holidays are all things this data does not
  // know, and guessing at them is how the previous hours dataset went wrong.
  function parseHoursDay(spec) {
    if (spec === '') return [];
    var parts = String(spec).split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var m = /^([0-2][0-9]):([0-5][0-9])-([0-2][0-9]):([0-5][0-9])$/.exec(parts[i]);
      if (!m) return null;
      var start = Number(m[1]) * 60 + Number(m[2]);
      var end = Number(m[3]) * 60 + Number(m[4]);
      if (start > 1439 || end > 1680 || end <= start) return null;
      if (out.length && start <= out[out.length - 1].end) return null;
      out.push({ start: start, end: end });
    }
    return out;
  }

  function safeHoursWeek(week) {
    if (!Array.isArray(week) || week.length !== 7) return null;
    var stated = 0;
    for (var i = 0; i < 7; i++) {
      if (typeof week[i] !== 'string') return null;
      if (week[i] === '') continue;
      if (!parseHoursDay(week[i])) return null;
      stated++;
    }
    return stated > 0 ? week : null;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatHoursDay(spec) {
    if (spec === '') return T.hoursClosed;
    if (spec === '00:00-24:00') return T.hoursAllDay;
    var ranges = parseHoursDay(spec);
    if (!ranges) return '';
    var out = [];
    for (var i = 0; i < ranges.length; i++) {
      var start = pad2(Math.floor(ranges[i].start / 60)) + ':' + pad2(ranges[i].start % 60);
      var end = ranges[i].end;
      var suffix = '';
      if (end > 1440) { end -= 1440; suffix = ' (' + T.hoursNextDay + ')'; }
      out.push(start + '–' + pad2(Math.floor(end / 60)) + ':' + pad2(end % 60) + suffix);
    }
    return out.join(', ');
  }

  // Runs of identical days collapse into one row, so a gym with the same
  // weekday schedule is two lines rather than seven.
  function formatHoursGroups(week) {
    var groups = [];
    var start = 0;
    for (var i = 1; i <= week.length; i++) {
      if (i < week.length && week[i] === week[start]) continue;
      var end = i - 1;
      groups.push({
        days: start === end ? T.hoursDays[start] : T.hoursDays[start] + '–' + T.hoursDays[end],
        hours: formatHoursDay(week[start])
      });
      start = i;
    }
    return groups;
  }

  function renderHoursSection(props) {
    var week = safeHoursWeek(props.hours);
    var src = safeSiteUrl(props.hours_src);
    if (!week || !src) return '';
    var rows = formatHoursGroups(week).map(function (g) {
      return '<div class="popup-hours-row"><span class="popup-hours-days">' + escapeHtml(g.days) +
        '</span><span class="popup-hours-time">' + escapeHtml(g.hours) + '</span></div>';
    }).join('');
    // The source is linked only when it is a different page from the official
    // website already shown above; otherwise that link is the source.
    var link = props.hours_src !== props.website
      ? ' <a href="' + escapeHtml(src.href) + '" target="_blank" rel="noopener" referrerpolicy="origin">' +
        escapeHtml(T.hoursSource) + '</a>'
      : '';
    return '<div class="popup-hours">' +
      '<div class="popup-hours-head"><span class="label">' + escapeHtml(T.hoursLabel) + '</span></div>' +
      rows +
      '<div class="popup-hours-note">' + escapeHtml(T.hoursNote) + link + '</div>' +
      '</div>';
  }

  function buildPopupHtml(lat, lon, props) {
    var subtitleParts = [];
    if (props.city) subtitleParts.push(escapeHtml(props.city));
    if (props.country) subtitleParts.push(escapeHtml(props.country));
    var subtitle = subtitleParts.length
      ? '<div class="meta">' + subtitleParts.join(', ') + '</div>'
      : '';
    var wellpassLine = '';
    if (props.wellpass === true) {
      wellpassLine = '<div class="popup-wellpass popup-wellpass-yes">✓ egym Wellpass</div>';
    } else if (props.wellpass === false) {
      wellpassLine = '<div class="popup-wellpass popup-wellpass-no">' + T.notOnWellpass + '</div>';
    }
    var sections = (props.boards || []).map(function (b) {
      var color = COLOR[b.board] || '#888';
      var detail = renderBoardDetails(b);
      return (
        '<div class="popup-board">' +
          '<div class="popup-board-header">' +
            '<span class="swatch" style="background:' + color + '"></span>' +
            (LABEL[b.board] || b.board) +
          '</div>' +
          detail +
        '</div>'
      );
    }).join('');
    return (
      '<div class="popup">' +
        '<h4>' + escapeHtml(props.name || T.unnamed) + '</h4>' +
        subtitle +
        renderSiteLine(props) +
        renderHoursSection(props) +
        wellpassLine +
        '<div class="popup-boards">' + sections + '</div>' +
        '<div class="popup-foot">' +
          '<a href="https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon +
            '#map=17/' + lat + '/' + lon + '" target="_blank" rel="noopener">' + T.openOsm + '</a>' +
          ' · ' + lat.toFixed(5) + ', ' + lon.toFixed(5) +
        '</div>' +
      '</div>'
    );
  }

  function buildMarker(lat, lon, props) {
    var distinct = distinctBoards(props.boards || []);
    var colors = distinct.map(function (id) { return COLOR[id] || '#888'; });
    var icon;
    if (colors.length <= 1) {
      icon = L.divIcon({
        html: '<div class="marker-dot" style="background:' + (colors[0] || '#888') + '"></div>',
        className: '',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
    } else {
      icon = L.divIcon({
        html: '<div class="marker-pie">' + pieMarkerSvg(colors, 18) + '</div>',
        className: '',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
    }
    return L.marker([lat, lon], { icon: icon })
      .bindPopup(buildPopupHtml(lat, lon, props), { maxWidth: 320 });
  }

  // ── Local venue search ────────────────────────────────────────────
  // A fully client-side search over the venues already in memory — gym
  // name, city and (localized) country. No geocoder and no third-party
  // request: it just filters the same dataset the markers come from, so
  // it works offline and keeps the site's "only OSM tiles" privacy rule.
  var SEARCH_MIN = 2;   // ignore 0–1 char queries (too noisy)
  var SEARCH_MAX = 50;  // cap rendered rows; the true total is reported

  // Localized country names (e.g. DE → "Germany"/"Deutschland") via the
  // built-in Intl API, so "germany"/"frankreich" reach venues whose data
  // only carries an ISO code. Falls back to the raw code where Intl or a
  // given code is unavailable.
  var REGION = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
      REGION = new Intl.DisplayNames([LANG], { type: 'region' });
    }
  } catch (e) { REGION = null; }
  function countryName(code) {
    if (!code) return '';
    if (REGION) { try { return REGION.of(code) || code; } catch (e) { return code; } }
    return code;
  }

  // Lowercase + strip diacritics + ß→ss so "Münster"/"munster" and
  // "Straße"/"strasse" match regardless of how either side is typed.
  function normalizeText(s) {
    return String(s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss');
  }

  // Sort key for a matched venue (lower = more relevant): name-prefix
  // beats name-substring beats city beats country.
  function scoreRecord(rec, q) {
    var i = rec.nName.indexOf(q);
    if (i === 0) return 0;
    if (i > 0) return 1;
    if (rec.nCity) { var c = rec.nCity.indexOf(q); if (c === 0) return 2; if (c > 0) return 3; }
    if (rec.nCountry && rec.nCountry.indexOf(q) >= 0) return 4;
    return 5; // matched only via scattered terms / board labels
  }

  // Shared inner markup for a venue row (dots + name + "city, country"),
  // used by both the in-view list and the search results. The country
  // text is passed in so each caller picks code vs. localized name.
  function venueRowInner(rec, countryText) {
    var distinct = distinctBoards(rec.boards);
    var dots = distinct.map(function (id) {
      return '<span class="venue-list-dot" style="background:' + (COLOR[id] || '#888') + '"></span>';
    }).join('');
    var metaParts = [];
    // An exact upstream city is stated plainly; a town the build attached by
    // proximity is hedged, because a gym 13 km outside Bangor is not in it.
    if (rec.city) metaParts.push(escapeHtml(rec.city));
    else if (rec.cityNearest) metaParts.push(escapeHtml(tf(T.nearCity, { city: rec.cityNearest })));
    if (countryText) metaParts.push(escapeHtml(countryText));
    return '<span class="venue-list-dots">' + dots + '</span>' +
      '<span class="venue-list-info">' +
        '<span class="venue-list-name">' + escapeHtml(rec.name) + '</span>' +
        (metaParts.length ? '<span class="venue-list-meta">' + metaParts.join(', ') + '</span>' : '') +
      '</span>';
  }

  // Reveal a venue. If it passes the current filters it lives in the
  // cluster, so break it out of any cluster blob and open its marker
  // popup; if it's filtered out, fly there and open an equivalent popup
  // at its coordinates so search still reaches it across active filters.
  function flyToRecord(rec) {
    if (!rec) return;
    if (rec.visible) {
      cluster.zoomToShowLayer(rec.marker, function () { rec.marker.openPopup(); });
    } else {
      map.setView([rec.lat, rec.lon], Math.max(map.getZoom(), 14));
      L.popup({ maxWidth: 320 })
        .setLatLng([rec.lat, rec.lon])
        .setContent(buildPopupHtml(rec.lat, rec.lon, {
          name: rec.name, city: rec.city, country: rec.country,
          wellpass: rec.wellpass, boards: rec.boards,
          website: rec.website,
          hours: rec.hours, hours_src: rec.hoursSrc,
        }))
        .openOn(map);
    }
  }

  // ── Place index ───────────────────────────────────────────────────
  // The venue search above can only find a city that some venue carries in
  // its `city` field, and barely a third of them do — searching "New York"
  // reached 2 of the 18 boards standing within 15 km of it. This index
  // answers the other half: jump the map to a place, and the clusters plus
  // the "boards in view" list show what is actually there, by geometry
  // rather than by patchy text.
  //
  // It is a static file from our own origin, not a geocoder call, so no
  // keystroke and no IP ever reaches a third party. ~240 KiB gzipped is too
  // much to spend on visitors who never open the search, so it loads on the
  // first real query and the service worker keeps it from there.
  var PLACE_MAX = 6;        // rendered place rows; gyms are the main event
  var PLACE_ZOOM = 11;      // city-wide view — neighbouring boards stay visible
  var placeIndex = null;    // [{ name, country, lat, lon, region, nName, nHay }]
  var placeState = 'idle';  // idle | loading | ready | error
  var placeLoad = null;

  function loadPlaces(onReady) {
    if (placeLoad) return placeLoad;
    placeState = 'loading';
    placeLoad = fetch('/boards/data/cities.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var rows = (data && data.cities) || [];
        placeIndex = [];
        for (var i = 0; i < rows.length; i++) {
          // Row shape: [name, country, lat, lon, region?, alternates?]
          var r = rows[i];
          if (!r || r.length < 4) continue;
          var region = r[4] || '';
          var alternates = r[5] || [];
          var germanName = r[6] || '';
          var cName = countryName(r[1]);
          // The index stores GeoNames' language-neutral primary name, which
          // is usually the English one. The German page shows the German form
          // where the build found one; both remain searchable either way.
          var display = (LANG === 'de' && germanName) ? germanName : r[0];
          // Every spelling of the city, whichever one we happen to show.
          // Matching runs against all of them, so "Munich" and "München"
          // reach the same place on either language of the site.
          var forms = [r[0]];
          if (germanName) forms.push(germanName);
          for (var a = 0; a < alternates.length; a++) forms.push(alternates[a]);
          var others = forms.filter(function (f) { return f !== display; });
          placeIndex.push({
            name: display,
            country: r[1],
            countryName: cName,
            region: region,
            lat: r[2],
            lon: r[3],
            forms: forms,
            nName: normalizeText(display),
            nAlternates: others.map(normalizeText),
            nHay: normalizeText(forms.concat([region, cName]).filter(Boolean).join(' ')),
          });
        }
        placeState = 'ready';
        augmentVenueHaystacks();
        if (onReady) onReady();
      })
      .catch(function () {
        placeState = 'error';
        if (onReady) onReady();
      });
    return placeLoad;
  }

  // Teach the venue search the same city spellings the place index knows, so
  // a gym listed under "Munich" also answers to "München" and one listed
  // under "Praha" answers to "Prague". Without this the alternates would only
  // move the map, and the Gyms group would silently miss the very venues the
  // visitor was looking for. Runs once, right after the index arrives.
  function augmentVenueHaystacks() {
    var byName = {};   // any spelling → every spelling of that city
    for (var i = 0; i < placeIndex.length; i++) {
      var p = placeIndex[i];
      if (!p.nAlternates.length) continue;
      var forms = p.forms;
      var keys = [p.nName].concat(p.nAlternates);
      for (var k = 0; k < keys.length; k++) {
        // First writer wins: the index is population-sorted, so a big city
        // beats a namesake village when both spellings collide.
        if (!byName[keys[k]]) byName[keys[k]] = forms;
      }
    }
    for (var v = 0; v < venueRecords.length; v++) {
      var rec = venueRecords[v];
      var city = rec.city || rec.cityNearest;
      if (!city) continue;
      var forms2 = byName[normalizeText(city)];
      if (!forms2) continue;
      var extra = [];
      for (var f = 0; f < forms2.length; f++) {
        var norm = normalizeText(forms2[f]);
        if (rec.nHay.indexOf(norm) < 0) extra.push(norm);
      }
      if (extra.length) rec.nHay += ' ' + extra.join(' ');
    }
  }

  // Rank. An exact hit wins whether it landed on the primary name or on an
  // alternate spelling — typing "wien" means Vienna, not Wiener Neustadt,
  // and "münchen" means Munich, not Ottobrunn bei München. Only after that
  // do prefixes beat substrings. Ties fall back to file order, which the
  // build writes largest-population first, so "berlin" offers Berlin, DE
  // before Berlin, New Hampshire.
  function scorePlace(rec, q) {
    if (rec.nName === q) return 0;
    for (var i = 0; i < rec.nAlternates.length; i++) {
      if (rec.nAlternates[i] === q) return 0;
    }
    if (rec.nName.indexOf(q) === 0) return 1;
    for (var j = 0; j < rec.nAlternates.length; j++) {
      if (rec.nAlternates[j].indexOf(q) === 0) return 2;
    }
    if (rec.nName.indexOf(q) > 0) return 3;
    return 4;
  }

  function searchPlaces(q, terms) {
    if (placeState !== 'ready') return [];
    var out = [];
    for (var i = 0; i < placeIndex.length; i++) {
      var rec = placeIndex[i];
      var ok = true;
      for (var t = 0; t < terms.length; t++) {
        if (rec.nHay.indexOf(terms[t]) < 0) { ok = false; break; }
      }
      if (ok) out.push({ kind: 'place', rec: rec, score: scorePlace(rec, q), rank: i });
    }
    out.sort(function (a, b) { return a.score - b.score || a.rank - b.rank; });
    return out.slice(0, PLACE_MAX);
  }

  function placeLabel(rec) {
    var parts = [];
    if (rec.region) parts.push(rec.region);
    if (rec.countryName) parts.push(rec.countryName);
    return parts.join(', ');
  }

  // Move the map without opening a popup: the place itself is not the
  // answer, the boards around it are.
  function flyToPlace(rec) {
    if (!rec) return;
    map.setView([rec.lat, rec.lon], PLACE_ZOOM);
  }

  // ── Filter dimensions ─────────────────────────────────────────────
  // Three filter layers:
  //   1. Board type (top-level OR) — which board types to include.
  //   2. Universal filters (Country) — geo gate, applies to every venue.
  //   3. Per-board detail filters — Kilter walls, MoonBoard setup. Only
  //      visible when the corresponding board type is active in (1);
  //      state survives toggling the board off and back on.
  //
  // A venue is visible iff Country gate passes AND at least one active
  // board at the venue passes its own per-board constraints. Boards
  // without per-board filters (Tension, Aurora, Decoy, Grasshopper, So
  // iLL, Touchstone, 12climb) pass-through.
  var KILTER_LAYOUTS = [
    { key: 'Original', label: 'Original' },
    { key: 'Homewall', label: 'Homewall' },
  ];
  var ADJUSTABILITIES = [
    { key: 'adjustable', label: T.adjustable },
    { key: 'fixed',      label: T.fixed },
    { key: 'unknown',    label: T.unknown },
  ];
  var MOON_COMMERCIAL = [
    { key: 'commercial', label: T.commercial },
    { key: 'home',       label: T.homeSetup },
    { key: 'unknown',    label: T.unknown },
  ];
  var MOON_LED = [
    { key: 'led',     label: 'LED' },
    { key: 'no-led',  label: T.noLeds },
    { key: 'unknown', label: T.unknown },
  ];
  // Canonical MoonBoard variants. Order matches the upstream timeline so the
  // legend reads chronologically. ~35% of MoonBoard entries carry enough
  // detail in their description to be classified; the rest stay "unknown".
  var MOON_VARIANTS = [
    { key: 'mb2016',          label: '2016' },
    { key: 'mb2017-masters',  label: '2017 Masters' },
    { key: 'mb2019-masters',  label: '2019 Masters' },
    { key: 'mb2024',          label: '2024' },
    { key: 'mini-2020',       label: 'Mini 2020' },
    { key: 'school-room',     label: 'School Room' },
    { key: 'unknown',         label: T.unknown },
  ];
  var MOON_VARIANT_LABEL = Object.fromEntries(MOON_VARIANTS.map(function (v) { return [v.key, v.label]; }));

  function adjustabilityKey(w) {
    if (w.adjustable === true) return 'adjustable';
    if (w.adjustable === false) return 'fixed';
    return 'unknown';
  }
  function moonCommercialKey(e) {
    if (e.commercial === true) return 'commercial';
    if (e.commercial === false) return 'home';
    return 'unknown';
  }
  function moonLedKey(e) {
    if (e.led === true) return 'led';
    if (e.led === false) return 'no-led';
    return 'unknown';
  }
  function moonVariantKey(e) {
    return e.variant || 'unknown';
  }

  // egym Wellpass status (venue-level). Source: tools/wellpass.json baked
  // into the geojson by build-boards-data.mjs; unmarked venues fall through
  // to "unknown" so the filter degrades gracefully where coverage is unknown.
  var WELLPASS_STATES = [
    { key: 'yes',     label: T.inWellpass },
    { key: 'unknown', label: T.unknown },
    { key: 'no',      label: T.notInWellpass },
  ];
  function wellpassKey(rec) {
    if (rec.wellpass === true) return 'yes';
    if (rec.wellpass === false) return 'no';
    return 'unknown';
  }

  var venueRecords = [];
  // Active sets — full set = "no constraint", same UX as the app's chips.
  var activeBoards = new Set(BOARDS.map(function (b) { return b.id; }));
  var activeLayouts = new Set(KILTER_LAYOUTS.map(function (l) { return l.key; }));
  activeLayouts.add('other'); // unknown/legacy product_name bucket
  var activeAdj = new Set(ADJUSTABILITIES.map(function (a) { return a.key; }));
  var activeMoonCom = new Set(MOON_COMMERCIAL.map(function (a) { return a.key; }));
  var activeMoonLed = new Set(MOON_LED.map(function (a) { return a.key; }));
  var activeMoonVariants = new Set(MOON_VARIANTS.map(function (v) { return v.key; }));
  var activeWellpass = new Set(WELLPASS_STATES.map(function (w) { return w.key; }));
  // Sizes + Countries can have many options; null = "no constraint", any
  // first toggle materialises the full set so the user removes from it.
  var activeSizes = null;
  var activeCountries = null;

  // Apply any persisted filter snapshot over the all-on defaults, then keep
  // the stored map view in sync as the visitor pans and zooms.
  restoreFilters(savedState && savedState.filters);
  // A shared link states which board types it is about; that beats whatever
  // the recipient had selected before.
  if (hashState && hashState.boards) activeBoards = new Set(hashState.boards);
  map.on('moveend', persist);

  function kilterEntryMatches(entry) {
    var walls = entry.walls || [];
    if (!walls.length) {
      // Kilter listed without walls is rare; only pass when nothing wall-
      // level is constraining (otherwise we can't tell if it would match).
      return activeSizes === null
        && activeLayouts.size === KILTER_LAYOUTS.length + 1
        && activeAdj.size === ADJUSTABILITIES.length;
    }
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      var lkey = w.layout || 'other';
      if (!activeLayouts.has(lkey)) continue;
      if (!activeAdj.has(adjustabilityKey(w))) continue;
      if (activeSizes !== null) {
        if (w.size_id == null || !activeSizes.has(String(w.size_id))) continue;
      }
      return true;
    }
    return false;
  }

  function moonboardEntryMatches(entry) {
    if (!activeMoonCom.has(moonCommercialKey(entry))) return false;
    if (!activeMoonLed.has(moonLedKey(entry))) return false;
    if (!activeMoonVariants.has(moonVariantKey(entry))) return false;
    return true;
  }

  function entryMatches(entry) {
    if (entry.board === 'kilter') return kilterEntryMatches(entry);
    if (entry.board === 'moonboard') return moonboardEntryMatches(entry);
    return true; // other boards: no per-board filter dimensions
  }

  function venueVisible(rec) {
    // Universal gates first (cheap, reject quickly).
    if (activeCountries && !activeCountries.has(rec.country || 'unknown')) return false;
    if (!activeWellpass.has(wellpassKey(rec))) return false;
    // Then per-board OR: at least one active board with a matching entry.
    for (var i = 0; i < rec.boards.length; i++) {
      var b = rec.boards[i];
      if (!activeBoards.has(b.board)) continue;
      if (entryMatches(b)) return true;
    }
    return false;
  }

  function applyFilter() {
    for (var i = 0; i < venueRecords.length; i++) {
      var rec = venueRecords[i];
      var keep = venueVisible(rec);
      if (keep && !rec.visible) { cluster.addLayer(rec.marker); rec.visible = true; }
      else if (!keep && rec.visible) { cluster.removeLayer(rec.marker); rec.visible = false; }
    }
    updateStatusLine();
    // Filter changes can grow/shrink the in-view set; refresh the list if open.
    var wrap = document.querySelector('.legend-wrap.show-list');
    if (wrap) refreshVenueList(wrap.querySelector('.venue-list'));
    persist();
  }

  function updateStatusLine() {
    var el = document.querySelector('.legend .status');
    if (!el) return;
    var shown = 0;
    for (var i = 0; i < venueRecords.length; i++) if (venueRecords[i].visible) shown++;
    el.textContent = tf(T.statusOf, {
      shown: shown.toLocaleString(LANG),
      total: venueRecords.length.toLocaleString(LANG),
    });
  }

  function updateSectionVisibility() {
    document.querySelectorAll('.legend .board-section').forEach(function (el) {
      var b = el.dataset.board;
      el.classList.toggle('hidden', !activeBoards.has(b));
    });
  }

  function resetDetailFilters() {
    activeLayouts = new Set(KILTER_LAYOUTS.map(function (l) { return l.key; }));
    activeLayouts.add('other');
    activeAdj = new Set(ADJUSTABILITIES.map(function (a) { return a.key; }));
    activeMoonCom = new Set(MOON_COMMERCIAL.map(function (a) { return a.key; }));
    activeMoonLed = new Set(MOON_LED.map(function (a) { return a.key; }));
    activeMoonVariants = new Set(MOON_VARIANTS.map(function (v) { return v.key; }));
    activeWellpass = new Set(WELLPASS_STATES.map(function (w) { return w.key; }));
    activeSizes = null;
    activeCountries = null;
    document.querySelectorAll('.legend .chip[data-dim]').forEach(function (el) { el.classList.add('selected'); });
    applyFilter();
  }

  // ── Legend rendering ──────────────────────────────────────────────
  function chip(dim, key, label, count, selected) {
    return '<button type="button" class="chip' + (selected ? ' selected' : '') +
      '" data-dim="' + dim + '" data-key="' + escapeHtml(String(key)) + '">' +
      escapeHtml(label) +
      (count != null ? '<span class="chip-count">' + count.toLocaleString(LANG) + '</span>' : '') +
      '</button>';
  }

  function renderKilterSection(stats) {
    return (
      '<div class="board-section" data-board="kilter">' +
        '<hr>' +
        '<div class="subhdr">' + T.kilterWalls + '</div>' +
        '<div class="subhdr" style="margin-top:6px">' + T.layout + '</div>' +
        '<div class="chips">' +
          KILTER_LAYOUTS.map(function (l) {
            return chip('layout', l.key, l.label, stats.layoutCounts[l.key], activeLayouts.has(l.key));
          }).join('') +
          (stats.layoutCounts.other > 0 ? chip('layout', 'other', T.other, stats.layoutCounts.other, activeLayouts.has('other')) : '') +
        '</div>' +
        '<div class="subhdr">' + T.angle + '</div>' +
        '<div class="chips">' +
          ADJUSTABILITIES.map(function (a) {
            return chip('adj', a.key, a.label, stats.adjCounts[a.key], activeAdj.has(a.key));
          }).join('') +
        '</div>' +
        '<details class="subfilter">' +
          '<summary>' + tf(T.sizeHdr, { n: stats.sizeOptions.length }) + '</summary>' +
          '<div class="chips">' +
            stats.sizeOptions.map(function (s) {
              return chip('size', s.id, s.label, s.count, activeSizes === null || activeSizes.has(String(s.id)));
            }).join('') +
          '</div>' +
          '<div class="chip-bulk-row">' +
            '<button type="button" data-bulk="size" data-target="all">' + T.all + '</button>' +
            '<button type="button" data-bulk="size" data-target="none">' + T.none + '</button>' +
          '</div>' +
        '</details>' +
      '</div>'
    );
  }

  function renderMoonboardSection(stats) {
    return (
      '<div class="board-section" data-board="moonboard">' +
        '<hr>' +
        '<div class="subhdr">' + T.moonSetup + '</div>' +
        '<div class="subhdr" style="margin-top:6px">' + T.variant + '</div>' +
        '<div class="chips">' +
          MOON_VARIANTS.map(function (v) {
            return chip('moonVar', v.key, v.label, stats.moonVariantCounts[v.key], activeMoonVariants.has(v.key));
          }).join('') +
        '</div>' +
        '<div class="subhdr">' + T.type + '</div>' +
        '<div class="chips">' +
          MOON_COMMERCIAL.map(function (a) {
            return chip('moonCom', a.key, a.label, stats.moonComCounts[a.key], activeMoonCom.has(a.key));
          }).join('') +
        '</div>' +
        '<div class="subhdr">' + T.hardware + '</div>' +
        '<div class="chips">' +
          MOON_LED.map(function (a) {
            return chip('moonLed', a.key, a.label, stats.moonLedCounts[a.key], activeMoonLed.has(a.key));
          }).join('') +
        '</div>' +
      '</div>'
    );
  }

  function renderWellpassSection(stats) {
    return (
      '<hr>' +
      '<div class="subhdr">Wellpass</div>' +
      '<div class="subnote">' + T.wellpassNote + '</div>' +
      '<div class="chips">' +
        WELLPASS_STATES.map(function (w) {
          return chip('wellpass', w.key, w.label, stats.wellpassCounts[w.key], activeWellpass.has(w.key));
        }).join('') +
      '</div>'
    );
  }

  function renderCountrySection(stats) {
    if (!stats.countryOptions.length) return '';
    return (
      '<hr>' +
      '<details class="subfilter">' +
        '<summary>' + tf(T.countryHdr, { n: stats.countryOptions.length }) + '</summary>' +
        '<div class="subnote">' + T.countryNote + '</div>' +
        '<div class="chips">' +
          stats.countryOptions.map(function (c) {
            return chip('country', c.code, c.code, c.count, activeCountries === null || activeCountries.has(c.code));
          }).join('') +
        '</div>' +
        '<div class="chip-bulk-row">' +
          '<button type="button" data-bulk="country" data-target="all">' + T.all + '</button>' +
          '<button type="button" data-bulk="country" data-target="none">' + T.none + '</button>' +
        '</div>' +
      '</details>'
    );
  }

  // The list panel has two modes. Normally it mirrors the viewport ("boards
  // in view"). After a successful locate it switches to "nearest boards",
  // ranked by straight-line distance from the visitor — that list is anchored
  // to the person, not the map, so panning around deliberately leaves it
  // alone. Opening the panel from its own button returns it to view mode.
  var venueListMode = 'inview';   // 'inview' | 'nearest'
  var userLocation = null;        // L.LatLng once the browser has fixed one

  // Metres → a string a human reads at a glance. Below a kilometre the exact
  // metre is what tells you it is walkable; above it, one decimal is plenty.
  function formatDistance(metres) {
    if (metres < 1000) {
      return tf(T.distanceM, { n: (Math.round(metres / 10) * 10).toLocaleString(LANG) });
    }
    var km = metres / 1000;
    // Number() first: toFixed returns a string, and a string's toLocaleString
    // would quietly skip the decimal comma the German page needs.
    var n = km < 10 ? Number(km.toFixed(1)) : Math.round(km);
    return tf(T.distanceKm, { n: n.toLocaleString(LANG) });
  }

  function renderNearestList(target) {
    var MAX = 12;
    var scored = [];
    for (var i = 0; i < venueRecords.length; i++) {
      var rec = venueRecords[i];
      // Respect the active filters: a board the visitor filtered out should
      // not reappear just because it happens to be close.
      if (!rec.visible) continue;
      scored.push({ idx: i, rec: rec, m: map.distance(userLocation, L.latLng(rec.lat, rec.lon)) });
    }
    scored.sort(function (a, b) { return a.m - b.m; });
    var shown = scored.slice(0, MAX);

    var html = '<h4>' + escapeHtml(T.nearestBoards) + '</h4>';
    if (!shown.length) {
      html += '<div class="venue-list-empty">' + escapeHtml(T.noNearestBoards) + '</div>';
    } else {
      html += '<div class="venue-list-status">' + escapeHtml(T.nearestFromYou) + '</div>';
      html += shown.map(function (v) {
        return '<button type="button" class="venue-list-item" data-idx="' + v.idx + '">' +
          venueRowInner(v.rec, v.rec.country) +
          '<span class="venue-list-dist">' + escapeHtml(formatDistance(v.m)) + '</span>' +
          '</button>';
      }).join('');
    }
    target.innerHTML = html;
  }

  // Render the visible-venues list into the given element. Filters by
  // current map bounds + each record's `visible` flag (set by applyFilter).
  function refreshVenueList(target) {
    if (!target) return;
    if (venueListMode === 'nearest' && userLocation) {
      renderNearestList(target);
      return;
    }
    var bounds = map.getBounds();
    var visible = [];
    var MAX = 100;
    for (var i = 0; i < venueRecords.length; i++) {
      var rec = venueRecords[i];
      if (!rec.visible) continue;
      if (!bounds.contains([rec.lat, rec.lon])) continue;
      visible.push({ idx: i, rec: rec });
      if (visible.length > MAX + 1) break;
    }
    visible.sort(function (a, b) { return a.rec.name.localeCompare(b.rec.name); });

    var capped = visible.length > MAX;
    var shown = capped ? visible.slice(0, MAX) : visible;

    var html = '<h4>' + T.boardsInView + '</h4>';
    if (!shown.length) {
      html += '<div class="venue-list-empty">' + T.noBoardsInView + '</div>';
    } else {
      html += '<div class="venue-list-status">' + visible.length.toLocaleString(LANG) +
        (capped ? tf(T.inViewCapped, { max: MAX }) : T.inView) +
        '</div>';
      html += shown.map(function (v) {
        return '<button type="button" class="venue-list-item" data-idx="' + v.idx + '">' +
          venueRowInner(v.rec, v.rec.country) + '</button>';
      }).join('');
    }
    target.innerHTML = html;
  }

  function buildLegend(stats) {
    var ctl = L.control({ position: 'topright' });
    ctl.onAdd = function () {
      var wrap = L.DomUtil.create('div', 'legend-wrap');
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);

      var btnRow = L.DomUtil.create('div', 'panel-buttons', wrap);

      var searchBtn = L.DomUtil.create('button', 'panel-toggle', btnRow);
      searchBtn.setAttribute('type', 'button');
      searchBtn.setAttribute('aria-label', T.searchAria);
      searchBtn.setAttribute('aria-expanded', 'false');
      searchBtn.dataset.panel = 'search';
      searchBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.2" y2="16.2"/>' +
        '</svg>';

      var filterBtn = L.DomUtil.create('button', 'panel-toggle', btnRow);
      filterBtn.setAttribute('type', 'button');
      filterBtn.setAttribute('aria-label', T.toggleFilters);
      filterBtn.setAttribute('aria-expanded', 'false');
      filterBtn.dataset.panel = 'filter';
      filterBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>' +
        '</svg>';

      var listBtn = L.DomUtil.create('button', 'panel-toggle', btnRow);
      listBtn.setAttribute('type', 'button');
      listBtn.setAttribute('aria-label', T.showBoardsInView);
      listBtn.setAttribute('aria-expanded', 'false');
      listBtn.dataset.panel = 'list';
      listBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<line x1="8" y1="6"  x2="20" y2="6"/>' +
        '<line x1="8" y1="12" x2="20" y2="12"/>' +
        '<line x1="8" y1="18" x2="20" y2="18"/>' +
        '<circle cx="4" cy="6"  r="1"/>' +
        '<circle cx="4" cy="12" r="1"/>' +
        '<circle cx="4" cy="18" r="1"/>' +
        '</svg>';

      // Locating uses Leaflet's own map.locate(), which wraps the browser's
      // Geolocation API. Nothing is requested from a third party and the
      // coordinates never leave the page — the permission prompt is the
      // browser's, and declining it simply leaves the map where it was.
      var locateBtn = L.DomUtil.create('button', 'panel-toggle', btnRow);
      locateBtn.setAttribute('type', 'button');
      locateBtn.setAttribute('aria-label', T.locateAria);
      locateBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>' +
        '<line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/>' +
        '<line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/>' +
        '</svg>';

      var div = L.DomUtil.create('div', 'legend', wrap);
      var listPanel = L.DomUtil.create('div', 'venue-list', wrap);

      // A single polite live region for both the place jump and the locate
      // result, so a screen reader hears what the map just did.
      var statusEl = L.DomUtil.create('div', 'map-status', wrap);
      statusEl.setAttribute('role', 'status');
      statusEl.hidden = true;
      var statusTimer = null;
      function setStatus(text) {
        if (statusTimer) clearTimeout(statusTimer);
        statusEl.textContent = text;
        statusEl.hidden = !text;
        if (text) {
          statusTimer = setTimeout(function () {
            statusEl.textContent = '';
            statusEl.hidden = true;
          }, 8000);
        }
      }

      var locationMarker = null;
      var locationCircle = null;

      map.on('locationfound', function (e) {
        if (locationMarker) map.removeLayer(locationMarker);
        if (locationCircle) map.removeLayer(locationCircle);
        locationCircle = L.circle(e.latlng, {
          radius: e.accuracy,
          className: 'location-accuracy',
          interactive: false,
        }).addTo(map);
        locationMarker = L.circleMarker(e.latlng, {
          radius: 7,
          className: 'location-dot',
        }).addTo(map).bindPopup(escapeHtml(T.locateHere));
        locateBtn.classList.remove('busy');
        setStatus(tf(T.locateFound, { n: Math.round(e.accuracy).toLocaleString(LANG) }));

        // Knowing where you are is only half the answer; the other half is
        // what is near you. Switch the list to distance ranking and open it.
        userLocation = e.latlng;
        venueListMode = 'nearest';
        showPanel('list');
        refreshVenueList(listPanel);
      });

      map.on('locationerror', function (e) {
        locateBtn.classList.remove('busy');
        // 1 = permission denied; anything else is a failure to fix a position.
        setStatus(e && e.code === 1 ? T.locateDenied : T.locateFailed);
      });

      locateBtn.addEventListener('click', function () {
        if (!navigator.geolocation) {
          setStatus(T.locateUnsupported);
          return;
        }
        locateBtn.classList.add('busy');
        setStatus(T.locating);
        map.locate({ setView: true, maxZoom: 14, enableHighAccuracy: true, timeout: 10000 });
      });

      // ── Search panel ──────────────────────────────────────────────
      var searchPanel = L.DomUtil.create('div', 'search-panel', wrap);
      searchPanel.innerHTML =
        '<div class="search-box">' +
          '<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
          ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.2" y2="16.2"/></svg>' +
          '<input type="search" class="search-input" role="combobox" aria-autocomplete="list"' +
          ' aria-expanded="false" aria-controls="cc-search-results"' +
          ' autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"' +
          ' placeholder="' + escapeHtml(T.searchPlaceholder) + '"' +
          ' aria-label="' + escapeHtml(T.searchPlaceholder) + '">' +
        '</div>' +
        '<div class="search-results" id="cc-search-results" role="listbox"' +
        ' aria-label="' + escapeHtml(T.searchResultsLabel) + '"></div>';
      var searchInput = searchPanel.querySelector('.search-input');
      var searchResults = searchPanel.querySelector('.search-results');
      var searchData = [];     // currently rendered results: [{ rec, score }]
      var searchActive = -1;   // index of the keyboard-highlighted result

      function highlightActive() {
        var opts = searchResults.querySelectorAll('.venue-list-item');
        for (var i = 0; i < opts.length; i++) {
          var on = (i === searchActive);
          opts[i].classList.toggle('active', on);
          opts[i].setAttribute('aria-selected', on ? 'true' : 'false');
          if (on) {
            searchInput.setAttribute('aria-activedescendant', opts[i].id);
            opts[i].scrollIntoView({ block: 'nearest' });
          }
        }
        if (searchActive < 0) searchInput.removeAttribute('aria-activedescendant');
      }

      // One row template for both groups so the keyboard walks a single
      // list: searchData holds gyms first, then places, and data-pos indexes
      // straight into it.
      function optionHtml(entry, pos) {
        var inner = entry.kind === 'place'
          ? '<span class="place-list-pin" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
              ' stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/>' +
              '<circle cx="12" cy="10" r="2.4"/></svg></span>' +
              '<span class="venue-list-info">' +
                '<span class="venue-list-name">' + escapeHtml(entry.rec.name) + '</span>' +
                '<span class="venue-list-meta">' + escapeHtml(placeLabel(entry.rec)) + '</span>' +
              '</span>'
          : venueRowInner(entry.rec, entry.rec.countryName || entry.rec.country);
        return '<button type="button" class="venue-list-item' +
          (entry.kind === 'place' ? ' place-list-item' : '') + '" role="option"' +
          ' id="cc-search-opt-' + pos + '" aria-selected="false" data-pos="' + pos + '">' +
          inner + '</button>';
      }

      function runSearch() {
        var raw = searchInput.value.trim();
        var q = normalizeText(raw);
        searchActive = -1;
        searchInput.removeAttribute('aria-activedescendant');
        if (q.length < SEARCH_MIN) {
          searchData = [];
          searchInput.setAttribute('aria-expanded', 'false');
          searchResults.innerHTML = '<div class="search-hint">' + escapeHtml(T.searchHint) + '</div>';
          return;
        }
        // First real query pulls the place index in; the callback re-runs
        // this function so results appear without another keystroke.
        if (placeState === 'idle') loadPlaces(runSearch);

        var terms = q.split(/\s+/);
        var matches = [];
        for (var i = 0; i < venueRecords.length; i++) {
          var rec = venueRecords[i];
          var hay = rec.nHay;
          var ok = true;
          for (var t = 0; t < terms.length; t++) {
            if (hay.indexOf(terms[t]) < 0) { ok = false; break; }
          }
          if (ok) matches.push({ kind: 'venue', rec: rec, score: scoreRecord(rec, q) });
        }
        matches.sort(function (a, b) {
          return a.score - b.score || a.rec.name.localeCompare(b.rec.name);
        });
        var places = searchPlaces(q, terms);

        var total = matches.length;
        if (!total && !places.length) {
          searchData = [];
          searchInput.setAttribute('aria-expanded', 'false');
          searchResults.innerHTML = '<div class="venue-list-empty">' +
            tf(T.searchNoResults, { q: escapeHtml(raw) }) + '</div>' + placeNoteHtml();
          return;
        }

        var capped = total > SEARCH_MAX;
        var shownVenues = capped ? matches.slice(0, SEARCH_MAX) : matches;
        searchData = shownVenues.concat(places);

        var html = '';
        if (shownVenues.length) {
          var countStr = (total === 1
            ? T.searchMatchOne
            : tf(T.searchMatchMany, { n: total.toLocaleString(LANG) })) +
            (capped ? tf(T.searchCapped, { max: SEARCH_MAX }) : '');
          html += '<div class="search-group">' + escapeHtml(T.groupVenues) + '</div>';
          html += '<div class="venue-list-status">' + escapeHtml(countStr) + '</div>';
          html += shownVenues.map(function (v, n) { return optionHtml(v, n); }).join('');
        }
        if (places.length) {
          html += '<div class="search-group">' + escapeHtml(T.groupPlaces) + '</div>';
          html += places.map(function (v, n) {
            return optionHtml(v, shownVenues.length + n);
          }).join('');
        }
        html += placeNoteHtml();
        searchResults.innerHTML = html;
        searchInput.setAttribute('aria-expanded', 'true');
      }

      // Only speak up while the index is in flight or broken — a working
      // index needs no commentary.
      function placeNoteHtml() {
        if (placeState === 'loading') {
          return '<div class="search-note" role="status">' + escapeHtml(T.placesLoading) + '</div>';
        }
        if (placeState === 'error') {
          return '<div class="search-note" role="status">' + escapeHtml(T.placesError) + '</div>';
        }
        return '';
      }

      function pickResult(entry) {
        if (!entry) return;
        if (entry.kind === 'place') {
          flyToPlace(entry.rec);
          setStatus(tf(T.placeJump, { place: entry.rec.name }));
        } else {
          flyToRecord(entry.rec);
        }
      }

      searchInput.addEventListener('input', runSearch);
      searchInput.addEventListener('keydown', function (ev) {
        // Keep keystrokes from reaching Leaflet's map keyboard handler
        // (arrows would pan the map, +/- would zoom it while typing).
        ev.stopPropagation();
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          if (!searchData.length) return;
          ev.preventDefault();
          var n = searchData.length;
          if (searchActive < 0) searchActive = (ev.key === 'ArrowDown') ? 0 : n - 1;
          else searchActive = (ev.key === 'ArrowDown')
            ? Math.min(searchActive + 1, n - 1)
            : Math.max(searchActive - 1, 0);
          highlightActive();
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          var pick = searchActive >= 0 ? searchActive : 0;
          pickResult(searchData[pick]);
        } else if (ev.key === 'Escape' && searchInput.value) {
          ev.preventDefault();
          searchInput.value = '';
          runSearch();
        }
      });
      searchResults.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.venue-list-item');
        if (!btn) return;
        pickResult(searchData[+btn.dataset.pos]);
      });

      var panelBtns = { search: searchBtn, filter: filterBtn, list: listBtn };
      function setPanel(name) {
        var same = wrap.classList.contains('show-' + name);
        wrap.classList.remove('show-search', 'show-filter', 'show-list');
        Object.keys(panelBtns).forEach(function (k) {
          panelBtns[k].classList.remove('active');
          panelBtns[k].setAttribute('aria-expanded', 'false');
        });
        if (!same) {
          wrap.classList.add('show-' + name);
          panelBtns[name].classList.add('active');
          panelBtns[name].setAttribute('aria-expanded', 'true');
          if (name === 'list') refreshVenueList(listPanel);
          if (name === 'search') {
            runSearch();
            // Focus after the panel becomes visible so mobile keyboards open.
            setTimeout(function () { searchInput.focus(); }, 0);
          }
        }
      }
      // Open without toggling. setPanel() closes a panel that is already
      // showing, which is right for a button press but wrong for locate:
      // pressing the locate button twice must not hide the results.
      function showPanel(name) {
        if (!wrap.classList.contains('show-' + name)) setPanel(name);
      }

      searchBtn.addEventListener('click', function () { setPanel('search'); });
      filterBtn.addEventListener('click', function () { setPanel('filter'); });
      listBtn.addEventListener('click', function () {
        // Reaching for the list button means "what is on screen", so this is
        // also the way back out of the distance-ranked view.
        venueListMode = 'inview';
        setPanel('list');
      });

      // Refresh the list when the map moves/zooms — only if the list panel is
      // currently the open one (avoid DOM churn otherwise). The nearest list
      // is anchored to the visitor rather than the viewport, so panning must
      // not rewrite it; only a new location fix does.
      map.on('moveend', function () {
        if (venueListMode === 'nearest') return;
        if (wrap.classList.contains('show-list')) refreshVenueList(listPanel);
      });

      // Item click → jump to the marker and open its popup (flyToRecord
      // breaks out of any cluster the marker is inside before opening).
      listPanel.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.venue-list-item');
        if (!btn) return;
        flyToRecord(venueRecords[+btn.dataset.idx]);
      });

      var boardTypeSection =
        '<h3>' + T.boardType + '</h3>' +
        BOARDS.map(function (b) {
          return (
            '<label>' +
              '<input type="checkbox"' + (activeBoards.has(b.id) ? ' checked' : '') + ' data-board="' + b.id + '">' +
              '<span class="swatch" style="background:' + b.color + '"></span>' +
              '<span class="name">' + b.label + '</span>' +
              '<span class="count">' + (stats.perBoardCounts[b.id] || 0).toLocaleString(LANG) + '</span>' +
            '</label>'
          );
        }).join('') +
        '<div class="actions">' +
          '<button type="button" data-action="all">' + T.all + '</button>' +
          '<button type="button" data-action="none">' + T.none + '</button>' +
        '</div>';

      div.innerHTML =
        boardTypeSection +
        renderWellpassSection(stats) +
        renderKilterSection(stats) +
        renderMoonboardSection(stats) +
        renderCountrySection(stats) +
        '<button type="button" class="filter-reset">' + T.resetFilters + '</button>' +
        '<div class="status">' + tf(T.locations, { n: stats.totalVenues.toLocaleString(LANG) }) + '</div>';
      return wrap;
    };
    ctl.addTo(map);

    // Board-type checkboxes drive both filter + section visibility.
    document.querySelectorAll('.legend input[type=checkbox]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.checked) activeBoards.add(cb.dataset.board);
        else activeBoards.delete(cb.dataset.board);
        updateSectionVisibility();
        applyFilter();
      });
    });
    document.querySelectorAll('.legend [data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.dataset.action === 'all';
        document.querySelectorAll('.legend input[type=checkbox]').forEach(function (cb) {
          if (cb.checked !== target) { cb.checked = target; cb.dispatchEvent(new Event('change')); }
        });
      });
    });

    // Detail-filter chips.
    var SET_FOR_DIM = {
      layout: function () { return activeLayouts; },
      adj: function () { return activeAdj; },
      moonCom: function () { return activeMoonCom; },
      moonLed: function () { return activeMoonLed; },
      moonVar: function () { return activeMoonVariants; },
      wellpass: function () { return activeWellpass; },
    };
    document.querySelectorAll('.legend .chip[data-dim]').forEach(function (el) {
      el.addEventListener('click', function () {
        var dim = el.dataset.dim;
        var key = el.dataset.key;
        var set;
        if (dim === 'size') {
          if (activeSizes === null) activeSizes = new Set(stats.sizeOptions.map(function (s) { return String(s.id); }));
          set = activeSizes;
        } else if (dim === 'country') {
          if (activeCountries === null) activeCountries = new Set(stats.countryOptions.map(function (c) { return c.code; }));
          set = activeCountries;
        } else {
          set = SET_FOR_DIM[dim]();
        }
        if (set.has(key)) { set.delete(key); el.classList.remove('selected'); }
        else { set.add(key); el.classList.add('selected'); }
        applyFilter();
      });
    });

    document.querySelectorAll('.legend .filter-reset').forEach(function (btn) {
      btn.addEventListener('click', resetDetailFilters);
    });

    // Bulk All/None inside the many-option sub-sections (Country, Size).
    // "All" resets state to null (no constraint, same as fresh-page state);
    // "None" sets it to an empty Set (every venue fails the gate).
    document.querySelectorAll('.legend [data-bulk]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dim = btn.dataset.bulk;
        var allOn = btn.dataset.target === 'all';
        if (dim === 'country') activeCountries = allOn ? null : new Set();
        else if (dim === 'size') activeSizes = allOn ? null : new Set();
        else return;
        document.querySelectorAll('.legend .chip[data-dim="' + dim + '"]').forEach(function (chipEl) {
          chipEl.classList.toggle('selected', allOn);
        });
        applyFilter();
      });
    });

    updateSectionVisibility();
  }

  // ── Data load ─────────────────────────────────────────────────────
  fetch('/boards/data/boards.geojson')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var perBoardCounts = Object.fromEntries(BOARDS.map(function (b) { return [b.id, 0]; }));
      var layoutCounts = { Original: 0, Homewall: 0, other: 0 };
      var adjCounts = { adjustable: 0, fixed: 0, unknown: 0 };
      var moonComCounts = { commercial: 0, home: 0, unknown: 0 };
      var moonLedCounts = { led: 0, 'no-led': 0, unknown: 0 };
      var moonVariantCounts = Object.fromEntries(MOON_VARIANTS.map(function (v) { return [v.key, 0]; }));
      var wellpassCounts = { yes: 0, no: 0, unknown: 0 };
      var sizeMap = new Map();
      var countryMap = new Map();

      for (var i = 0; i < data.features.length; i++) {
        var f = data.features[i];
        var props = f.properties || {};
        var coords = f.geometry && f.geometry.coordinates;
        if (!coords || !Array.isArray(props.boards)) continue;
        var lon = coords[0], lat = coords[1];

        var boardSeen = new Set();
        for (var j = 0; j < props.boards.length; j++) {
          var bo = props.boards[j];
          if (!COLOR[bo.board]) continue;
          if (!boardSeen.has(bo.board)) {
            boardSeen.add(bo.board);
            perBoardCounts[bo.board] += 1;
          }
          if (bo.board === 'kilter' && Array.isArray(bo.walls)) {
            for (var k = 0; k < bo.walls.length; k++) {
              var wall = bo.walls[k];
              var lkey = wall.layout || 'other';
              if (layoutCounts[lkey] != null) layoutCounts[lkey]++;
              else layoutCounts.other++;
              adjCounts[adjustabilityKey(wall)]++;
              if (wall.size_id != null) {
                var sid = String(wall.size_id);
                if (!sizeMap.has(sid)) {
                  sizeMap.set(sid, { id: sid, label: wall.size_label || tf(T.sizeFallback, { id: sid }), count: 0 });
                }
                sizeMap.get(sid).count++;
              }
            }
          }
          if (bo.board === 'moonboard') {
            moonComCounts[moonCommercialKey(bo)]++;
            moonLedCounts[moonLedKey(bo)]++;
            moonVariantCounts[moonVariantKey(bo)]++;
          }
        }
        var country = props.country || null;
        if (country) countryMap.set(country, (countryMap.get(country) || 0) + 1);
        var wellpass = (props.wellpass === true || props.wellpass === false) ? props.wellpass : null;
        wellpassCounts[wellpass === true ? 'yes' : wellpass === false ? 'no' : 'unknown']++;

        var marker = buildMarker(lat, lon, props);
        cluster.addLayer(marker);
        // Precompute the normalized search fields once per venue so each
        // keystroke is a handful of indexOf() calls, not a re-normalize.
        var venueName = props.name || T.unnamed;
        var cName = countryName(country);
        var boardLabels = distinctBoards(props.boards).map(function (id) { return LABEL[id] || id; }).join(' ');
        venueRecords.push({
          marker: marker,
          visible: true,
          lat: lat,
          lon: lon,
          name: venueName,
          city: props.city || null,
          cityNearest: (LANG === 'de' && props.city_nearest_de)
            ? props.city_nearest_de
            : (props.city_nearest || null),
          boards: props.boards,
          country: country,            // ISO code — drives the country filter
          countryName: cName,          // localized name — for search + display
          wellpass: wellpass,
          website: props.website || null,
          hours: props.hours || null,
          hoursSrc: props.hours_src || null,
          nName: normalizeText(venueName),
          nCity: props.city ? normalizeText(props.city) : '',
          nCountry: cName ? normalizeText(cName) : '',
          nHay: normalizeText([venueName, props.city, props.city_nearest, props.city_nearest_de,
            cName, boardLabels].filter(Boolean).join(' ')),
        });
      }

      var sizeOptions = Array.from(sizeMap.values()).sort(function (a, b) {
        return b.count - a.count || a.label.localeCompare(b.label);
      });
      var countryOptions = Array.from(countryMap.entries())
        .map(function (e) { return { code: e[0], count: e[1] }; })
        .sort(function (a, b) { return b.count - a.count || a.code.localeCompare(b.code); });

      buildLegend({
        totalVenues: venueRecords.length,
        perBoardCounts: perBoardCounts,
        layoutCounts: layoutCounts,
        adjCounts: adjCounts,
        moonComCounts: moonComCounts,
        moonLedCounts: moonLedCounts,
        moonVariantCounts: moonVariantCounts,
        wellpassCounts: wellpassCounts,
        sizeOptions: sizeOptions,
        countryOptions: countryOptions,
      });
      // Restored filters may differ from "all on" — sync the markers now.
      applyFilter();
      var loading = document.getElementById('loading');
      if (loading) loading.remove();
    })
    .catch(function (err) {
      var loading = document.getElementById('loading');
      if (loading) {
        loading.className = 'loading error';
        loading.textContent = tf(T.loadError, { err: err.message });
      }
    });
})();
