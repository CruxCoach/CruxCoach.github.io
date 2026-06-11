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

  var savedState = loadState();

  var map = L.map('map', { worldCopyJump: true, zoomControl: true });
  var sv = savedState && savedState.view;
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
      if (boardObj.variant) tags.push(MOON_VARIANT_LABEL[boardObj.variant] || boardObj.variant);
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

  // Render the visible-venues list into the given element. Filters by
  // current map bounds + each record's `visible` flag (set by applyFilter).
  function refreshVenueList(target) {
    if (!target) return;
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
        var rec = v.rec;
        var distinct = distinctBoards(rec.boards);
        var dots = distinct.map(function (id) {
          return '<span class="venue-list-dot" style="background:' + (COLOR[id] || '#888') + '"></span>';
        }).join('');
        var metaParts = [];
        if (rec.city) metaParts.push(escapeHtml(rec.city));
        if (rec.country) metaParts.push(escapeHtml(rec.country));
        return (
          '<button type="button" class="venue-list-item" data-idx="' + v.idx + '">' +
            '<span class="venue-list-dots">' + dots + '</span>' +
            '<span class="venue-list-info">' +
              '<span class="venue-list-name">' + escapeHtml(rec.name) + '</span>' +
              (metaParts.length ? '<span class="venue-list-meta">' + metaParts.join(', ') + '</span>' : '') +
            '</span>' +
          '</button>'
        );
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

      var div = L.DomUtil.create('div', 'legend', wrap);
      var listPanel = L.DomUtil.create('div', 'venue-list', wrap);

      function setPanel(name) {
        var same = wrap.classList.contains('show-' + name);
        wrap.classList.remove('show-filter', 'show-list');
        filterBtn.classList.remove('active');
        listBtn.classList.remove('active');
        filterBtn.setAttribute('aria-expanded', 'false');
        listBtn.setAttribute('aria-expanded', 'false');
        if (!same) {
          wrap.classList.add('show-' + name);
          var btn = name === 'filter' ? filterBtn : listBtn;
          btn.classList.add('active');
          btn.setAttribute('aria-expanded', 'true');
          if (name === 'list') refreshVenueList(listPanel);
        }
      }
      filterBtn.addEventListener('click', function () { setPanel('filter'); });
      listBtn.addEventListener('click', function () { setPanel('list'); });

      // Refresh the list when the map moves/zooms — only if the list
      // panel is currently the open one (avoid DOM churn otherwise).
      map.on('moveend', function () {
        if (wrap.classList.contains('show-list')) refreshVenueList(listPanel);
      });

      // Item click → jump to the marker and open its popup. zoomToShowLayer
      // breaks out of any cluster the marker is inside before opening.
      listPanel.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.venue-list-item');
        if (!btn) return;
        var idx = +btn.dataset.idx;
        var rec = venueRecords[idx];
        if (!rec) return;
        cluster.zoomToShowLayer(rec.marker, function () {
          rec.marker.openPopup();
        });
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
        venueRecords.push({
          marker: marker,
          visible: true,
          lat: lat,
          lon: lon,
          name: props.name || T.unnamed,
          city: props.city || null,
          boards: props.boards,
          country: country,
          wellpass: wellpass,
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
