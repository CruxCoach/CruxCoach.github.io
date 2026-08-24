// Venue report form — everything that is not the DOM.
//
// The taxonomy, the client-side checks, the two string tables and the request
// body all live here, with no reference to `document`, `window` or `fetch`. That
// is what lets `node --test` drive the real thing instead of pattern-matching
// its source, and it is the same split `competitions/app/protocol/` uses for
// the same reason.
//
// Two rules this file exists to hold:
//
//   1. **The client never decides.** Every check here is repeated on the server,
//      because a check that only runs in a browser is a hint, not a rule. What
//      it buys is a person getting told what is wrong before they press send.
//   2. **Nothing is stored.** No draft in localStorage, no report in the URL, no
//      analytics dimension. A report is somebody telling us their gym closed;
//      it belongs in one encrypted DM to the operator and nowhere else. The
//      offline path fails loudly rather than queueing, because a queue would be
//      exactly that persistence.

export const CONTRACT = 'cruxcoach.venue-report';
export const CONTRACT_VERSION = 1;

export const CATEGORIES = [
  'website',
  'hours',
  'access',
  'coordinates',
  'board_added',
  'board_removed',
  'board_details',
  'closed',
  'duplicate',
  'other',
];

export const ACCESS_VALUES = ['public', 'restricted', 'private', 'closed', 'unknown'];

export const BOARDS = [
  'kilter',
  'tension',
  'grasshopper',
  'decoy',
  'soill',
  'touchstone',
  'aurora',
  'moonboard',
  '12climb',
];

export const LOCALES = ['en', 'de'];

export const LIMITS = {
  detailMinChars: 10,
  detailMaxChars: 1000,
  venueNameMaxChars: 120,
  boardLabelMaxChars: 120,
  hoursMaxChars: 200,
  urlMaxChars: 300,
  npubMaxChars: 70,
  coordinateDecimals: 6,
};

export const CATEGORIES_REQUIRING_PROPOSAL = [
  'website',
  'hours',
  'access',
  'coordinates',
  'board_added',
  'board_removed',
  'duplicate',
];

export const PROPOSAL_FIELDS_BY_CATEGORY = {
  website: ['website'],
  hours: ['hours'],
  access: ['access'],
  coordinates: ['lat', 'lon'],
  board_added: ['board'],
  board_removed: ['board'],
  board_details: [],
  closed: [],
  duplicate: ['duplicateOfVenueId'],
  other: [],
};

/** Categories that only make sense about one specific installation. */
export const CATEGORIES_REQUIRING_BOARD = ['board_removed', 'board_details'];

export const VENUE_ID_RE = /^v1_[0-9a-f]{12}$/;
export const BOARD_INSTANCE_ID_RE = /^b1_[0-9a-f]{12}$/;
const NPUB_RE = /^npub1[02-9ac-hj-np-z]{58}$/;

// ── Strings ─────────────────────────────────────────────────────────
//
// One table, both languages, every key present in both. A missing key would
// render as `undefined` in a dialog somebody is trying to use, so
// `report-form.test.mjs` asserts the two halves have identical key sets.

export const STRINGS = {
  en: {
    open: 'Report a correction',
    openAria: 'Report a correction for {venue}',
    title: 'Report a correction',
    intro:
      'Tell us what is wrong or missing here. A person reads every report; nothing you send changes the map automatically.',
    venueLabel: 'Venue',
    boardLabel: 'Which board? (optional)',
    boardAll: 'The venue as a whole',
    categoryLabel: 'What needs correcting?',
    categoryHint: 'Pick the closest match.',
    detailLabel: 'What should we know?',
    detailHint: 'At least {min} characters. Please say what you saw, and when.',
    detailCounter: '{n} of {max} characters',
    websiteLabel: 'Correct website (https)',
    hoursLabel: 'Opening hours',
    hoursHint: 'As written on the door or the venue’s own site.',
    accessLabel: 'Who can climb here?',
    latLabel: 'Correct latitude',
    lonLabel: 'Correct longitude',
    coordinatesHint: 'Decimal degrees, e.g. 48.11234 and 11.63456.',
    boardTypeLabel: 'Which board system?',
    duplicateLabel: 'Duplicate of which venue?',
    duplicateHint: 'The venue ID of the other entry — shown at the bottom of its popup.',
    evidenceLabel: 'Link that shows this (optional)',
    evidenceHint: 'We store the link and show it to a reviewer. Nothing opens it automatically.',
    npubLabel: 'Your Nostr key, if you want a reply (optional)',
    npubHint:
      'Leave empty to report anonymously — that is the normal way. With an npub we can ask a follow-up question.',
    privacy:
      'Sent encrypted to the maintainer. We store no IP address and nothing is saved in this browser.',
    submit: 'Send report',
    sending: 'Sending…',
    cancel: 'Cancel',
    close: 'Close',
    successTitle: 'Thank you.',
    successBody:
      'Your report reached the maintainer. If something changes on the map, it will be after a person has checked it.',
    accessValues: {
      public: 'Anyone can climb here',
      restricted: 'Members, guests or a fee',
      private: 'Private — not open to the public',
      closed: 'Permanently closed',
      unknown: 'Not verified',
    },
    categories: {
      website: 'The website link is wrong or missing',
      hours: 'The opening hours are wrong',
      access: 'Who may climb here is wrong',
      coordinates: 'The location on the map is wrong',
      board_added: 'A board is missing from this venue',
      board_removed: 'A listed board is no longer here',
      board_details: 'A board’s details are wrong',
      closed: 'This venue has closed',
      duplicate: 'This venue is listed twice',
      other: 'Something else',
    },
    errors: {
      category_required: 'Please choose what needs correcting.',
      detail_too_short: 'Please add at least {min} characters so a reviewer can act on it.',
      detail_too_long: 'Please shorten this to {max} characters or fewer.',
      website_required: 'Please give the correct website address.',
      website_invalid: 'That does not look like a web address. It must start with https://.',
      hours_required: 'Please give the opening hours.',
      hours_too_long: 'Please shorten the hours to {max} characters or fewer.',
      access_required: 'Please choose who can climb here.',
      coordinates_required: 'Please give both a latitude and a longitude.',
      coordinates_invalid: 'Latitude must be between -90 and 90, longitude between -180 and 180.',
      board_required: 'Please choose a board system.',
      board_instance_required: 'Please choose which board this is about.',
      duplicate_required: 'Please give the venue ID of the other entry.',
      duplicate_invalid: 'A venue ID looks like v1_ followed by 12 characters.',
      duplicate_self: 'That is this venue’s own ID.',
      evidence_invalid: 'That link could not be read. Leave it empty if you are unsure.',
      npub_invalid: 'That is not a valid npub. Leave it empty to report anonymously.',
      offline: 'You appear to be offline. Reports are not saved on your device — please try again later.',
      rate_limited: 'Too many reports from here just now. Please try again later.',
      rejected: 'The server would not accept this report. Please check the fields and try again.',
      stale: 'This form sat open too long. Close it and start again.',
      failed: 'The report could not be sent. Please try again in a moment.',
    },
  },
  de: {
    open: 'Korrektur melden',
    openAria: 'Korrektur für {venue} melden',
    title: 'Korrektur melden',
    intro:
      'Sag uns, was hier falsch ist oder fehlt. Jede Meldung liest ein Mensch; nichts davon ändert die Karte automatisch.',
    venueLabel: 'Ort',
    boardLabel: 'Welches Board? (optional)',
    boardAll: 'Der Ort insgesamt',
    categoryLabel: 'Was stimmt nicht?',
    categoryHint: 'Nimm das, was am ehesten passt.',
    detailLabel: 'Was sollten wir wissen?',
    detailHint: 'Mindestens {min} Zeichen. Sag am besten, was du gesehen hast — und wann.',
    detailCounter: '{n} von {max} Zeichen',
    websiteLabel: 'Richtige Website (https)',
    hoursLabel: 'Öffnungszeiten',
    hoursHint: 'So, wie sie an der Tür oder auf der eigenen Website stehen.',
    accessLabel: 'Wer darf hier klettern?',
    latLabel: 'Richtige Breite (Latitude)',
    lonLabel: 'Richtige Länge (Longitude)',
    coordinatesHint: 'Dezimalgrad, z. B. 48.11234 und 11.63456.',
    boardTypeLabel: 'Welches Board-System?',
    duplicateLabel: 'Doppelt zu welchem Ort?',
    duplicateHint: 'Die Venue-ID des anderen Eintrags — steht unten in dessen Popup.',
    evidenceLabel: 'Link, der das belegt (optional)',
    evidenceHint: 'Wir speichern den Link und zeigen ihn einem Menschen. Automatisch öffnet ihn nichts.',
    npubLabel: 'Dein Nostr-Schlüssel, falls du eine Antwort möchtest (optional)',
    npubHint:
      'Leer lassen heißt anonym melden — das ist der Normalfall. Mit npub können wir nachfragen.',
    privacy:
      'Verschlüsselt an den Maintainer. Wir speichern keine IP-Adresse, und in diesem Browser bleibt nichts zurück.',
    submit: 'Meldung senden',
    sending: 'Wird gesendet…',
    cancel: 'Abbrechen',
    close: 'Schließen',
    successTitle: 'Danke.',
    successBody:
      'Deine Meldung ist beim Maintainer angekommen. Wenn sich auf der Karte etwas ändert, dann erst, nachdem ein Mensch sie geprüft hat.',
    accessValues: {
      public: 'Alle dürfen hier klettern',
      restricted: 'Mitglieder, Gäste oder gegen Gebühr',
      private: 'Privat — nicht öffentlich zugänglich',
      closed: 'Dauerhaft geschlossen',
      unknown: 'Nicht geprüft',
    },
    categories: {
      website: 'Der Website-Link ist falsch oder fehlt',
      hours: 'Die Öffnungszeiten stimmen nicht',
      access: 'Wer hier klettern darf, stimmt nicht',
      coordinates: 'Der Ort auf der Karte stimmt nicht',
      board_added: 'Hier fehlt ein Board',
      board_removed: 'Ein gelistetes Board gibt es nicht mehr',
      board_details: 'Die Angaben zu einem Board stimmen nicht',
      closed: 'Dieser Ort ist geschlossen',
      duplicate: 'Dieser Ort ist doppelt eingetragen',
      other: 'Etwas anderes',
    },
    errors: {
      category_required: 'Bitte wähle aus, was nicht stimmt.',
      detail_too_short: 'Bitte schreib mindestens {min} Zeichen, damit jemand damit arbeiten kann.',
      detail_too_long: 'Bitte kürze das auf höchstens {max} Zeichen.',
      website_required: 'Bitte gib die richtige Website-Adresse an.',
      website_invalid: 'Das sieht nicht nach einer Web-Adresse aus. Sie muss mit https:// beginnen.',
      hours_required: 'Bitte gib die Öffnungszeiten an.',
      hours_too_long: 'Bitte kürze die Zeiten auf höchstens {max} Zeichen.',
      access_required: 'Bitte wähle aus, wer hier klettern darf.',
      coordinates_required: 'Bitte gib Breite und Länge an.',
      coordinates_invalid: 'Breite muss zwischen -90 und 90 liegen, Länge zwischen -180 und 180.',
      board_required: 'Bitte wähle ein Board-System.',
      board_instance_required: 'Bitte wähle, um welches Board es geht.',
      duplicate_required: 'Bitte gib die Venue-ID des anderen Eintrags an.',
      duplicate_invalid: 'Eine Venue-ID sieht aus wie v1_ und dann 12 Zeichen.',
      duplicate_self: 'Das ist die ID dieses Ortes selbst.',
      evidence_invalid: 'Der Link ließ sich nicht lesen. Lass ihn leer, wenn du unsicher bist.',
      npub_invalid: 'Das ist kein gültiger npub. Lass das Feld leer, um anonym zu melden.',
      offline:
        'Du scheinst offline zu sein. Meldungen werden nicht auf deinem Gerät gespeichert — bitte später erneut versuchen.',
      rate_limited: 'Gerade zu viele Meldungen von hier. Bitte später noch einmal versuchen.',
      rejected: 'Der Server hat die Meldung nicht angenommen. Bitte prüf die Felder und versuch es erneut.',
      stale: 'Das Formular war zu lange offen. Schließ es und fang neu an.',
      failed: 'Die Meldung konnte nicht gesendet werden. Bitte gleich noch einmal versuchen.',
    },
  },
};

export function strings(lang) {
  return STRINGS[lang] ?? STRINGS.en;
}

export function format(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values ?? {}, key) ? String(values[key]) : match,
  );
}

// ── Endpoint ────────────────────────────────────────────────────────

export const PRODUCTION_ENDPOINT = 'https://api.cruxcoach.org';
export const DEV_ENDPOINT = 'http://127.0.0.1:3002';

/**
 * Where reports go.
 *
 * A first-party host on our own domain, exactly like the download counter — and
 * on loopback it points at a locally-run service instead, so `python3 -m
 * http.server` plus `pnpm dev:venue` is a working end-to-end setup with nothing
 * to configure. The check is on the *hostname*, never on a query parameter: a
 * URL-configurable endpoint would let any link decide where a stranger's report
 * is sent.
 */
export function resolveEndpoint(location) {
  const host = location && typeof location.hostname === 'string' ? location.hostname : '';
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
    return DEV_ENDPOINT;
  }
  return PRODUCTION_ENDPOINT;
}

// ── Validation ──────────────────────────────────────────────────────

function codePoints(value) {
  return [...String(value ?? '')];
}

export function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** Shape check only — the server repeats it and is the one that decides. */
export function looksLikeUrl(value, { httpsOnly = false } = {}) {
  const text = String(value ?? '').trim();
  if (text === '' || codePoints(text).length > LIMITS.urlMaxChars) return false;
  if (/[\s<>"'`\\^{|}\u0000-\u001F\u007F-\u009F]/.test(text)) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (httpsOnly ? url.protocol !== 'https:' : url.protocol !== 'https:' && url.protocol !== 'http:') {
    return false;
  }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}

export function looksLikeNpub(value) {
  return NPUB_RE.test(String(value ?? '').trim());
}

/**
 * Validate the whole form. Returns `{ ok, errors }` where `errors` maps a field
 * name to a *resolved* message in the form's language, so the caller never has
 * to know about the string table.
 */
export function validateForm(form, lang = 'en') {
  const t = strings(lang);
  const errors = {};
  const fail = (field, key, values) => {
    if (!errors[field]) errors[field] = format(t.errors[key], values);
  };

  if (!CATEGORIES.includes(form.category)) {
    fail('category', 'category_required');
    // Everything below depends on which category this is, so there is nothing
    // useful left to check.
    return { ok: false, errors };
  }

  const detail = cleanText(form.detail);
  const detailLength = codePoints(detail).length;
  if (detailLength < LIMITS.detailMinChars) {
    fail('detail', 'detail_too_short', { min: LIMITS.detailMinChars });
  } else if (detailLength > LIMITS.detailMaxChars) {
    fail('detail', 'detail_too_long', { max: LIMITS.detailMaxChars });
  }

  if (CATEGORIES_REQUIRING_BOARD.includes(form.category) && !form.boardInstanceId) {
    fail('boardInstanceId', 'board_instance_required');
  }
  if (form.boardInstanceId && !BOARD_INSTANCE_ID_RE.test(form.boardInstanceId)) {
    fail('boardInstanceId', 'board_instance_required');
  }

  for (const field of PROPOSAL_FIELDS_BY_CATEGORY[form.category]) {
    if (field === 'website') {
      const website = String(form.website ?? '').trim();
      if (website === '') fail('website', 'website_required');
      else if (!looksLikeUrl(website, { httpsOnly: true })) fail('website', 'website_invalid');
    }
    if (field === 'hours') {
      const hours = cleanText(form.hours);
      if (hours === '') fail('hours', 'hours_required');
      else if (codePoints(hours).length > LIMITS.hoursMaxChars) {
        fail('hours', 'hours_too_long', { max: LIMITS.hoursMaxChars });
      }
    }
    if (field === 'access' && !ACCESS_VALUES.includes(form.access)) {
      fail('access', 'access_required');
    }
    if (field === 'lat') {
      const lat = Number(form.lat);
      const lon = Number(form.lon);
      if (String(form.lat ?? '').trim() === '' || String(form.lon ?? '').trim() === '') {
        fail('lat', 'coordinates_required');
      } else if (
        !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180
      ) {
        fail('lat', 'coordinates_invalid');
      }
    }
    if (field === 'board' && !BOARDS.includes(form.board)) {
      fail('board', 'board_required');
    }
    if (field === 'duplicateOfVenueId') {
      const other = String(form.duplicateOfVenueId ?? '').trim();
      if (other === '') fail('duplicateOfVenueId', 'duplicate_required');
      else if (!VENUE_ID_RE.test(other)) fail('duplicateOfVenueId', 'duplicate_invalid');
      else if (other === form.venue?.id) fail('duplicateOfVenueId', 'duplicate_self');
    }
  }

  const evidence = String(form.evidenceUrl ?? '').trim();
  if (evidence !== '' && !looksLikeUrl(evidence)) fail('evidenceUrl', 'evidence_invalid');

  const npub = String(form.npub ?? '').trim();
  if (npub !== '' && !looksLikeNpub(npub)) fail('npub', 'npub_invalid');

  return { ok: Object.keys(errors).length === 0, errors };
}

function roundCoordinate(value) {
  return Number(Number(value).toFixed(LIMITS.coordinateDecimals));
}

function buildProposal(form) {
  const fields = PROPOSAL_FIELDS_BY_CATEGORY[form.category];
  if (fields.length === 0) return null;
  const proposal = {};
  for (const field of fields) {
    if (field === 'website') proposal.website = String(form.website).trim();
    if (field === 'hours') proposal.hours = cleanText(form.hours);
    if (field === 'access') proposal.access = form.access;
    if (field === 'lat') {
      proposal.lat = roundCoordinate(form.lat);
      proposal.lon = roundCoordinate(form.lon);
    }
    if (field === 'board') proposal.board = form.board;
    if (field === 'duplicateOfVenueId') {
      proposal.duplicateOfVenueId = String(form.duplicateOfVenueId).trim();
    }
  }
  return proposal;
}

/**
 * Build the request body. Assumes `validateForm` already passed — the server
 * validates again regardless, and the two agree because they are generated from
 * the same committed contract file.
 */
export function buildSubmission(form, { ticket, submissionId, lang }) {
  const board = form.boardInstanceId
    ? {
        instanceId: form.boardInstanceId,
        board: form.boardInstanceBoard,
        label: codePoints(form.boardInstanceLabel).slice(0, LIMITS.boardLabelMaxChars).join(''),
      }
    : null;

  const npub = String(form.npub ?? '').trim();

  return {
    contract: CONTRACT,
    version: CONTRACT_VERSION,
    ticket,
    locale: LOCALES.includes(lang) ? lang : 'en',
    venue: {
      id: form.venue.id,
      name: codePoints(form.venue.name).slice(0, LIMITS.venueNameMaxChars).join(''),
      lat: roundCoordinate(form.venue.lat),
      lon: roundCoordinate(form.venue.lon),
      country: form.venue.country ?? null,
    },
    board,
    category: form.category,
    detail: cleanText(form.detail),
    proposed: buildProposal(form),
    evidenceUrl: String(form.evidenceUrl ?? '').trim() || null,
    reporter: npub ? { npub } : null,
    clientSubmissionId: submissionId,
  };
}

/**
 * Turn a server response into the message a person sees.
 *
 * Deliberately coarse: the server's `field`/`reason` codes exist for logs and
 * for us, not to be pasted at a visitor who has already been told what the form
 * needs. The one distinction worth surfacing is "try again later" versus "this
 * will not work".
 */
export function describeFailure(status, body, lang = 'en') {
  const t = strings(lang);
  if (status === 429) return t.errors.rate_limited;
  if (status === 403 && body && body.error === 'ticket_rejected') return t.errors.stale;
  if (status === 400 || status === 403 || status === 413 || status === 415) return t.errors.rejected;
  return t.errors.failed;
}

/**
 * A v4 UUID for the idempotency key.
 *
 * Held in memory for one submission attempt only. It is not written anywhere,
 * so a reload starts a new one — which is correct: the point is to collapse
 * automatic retries of one send, not to deduplicate a person deciding to report
 * the same thing twice.
 */
export function newSubmissionId(cryptoObj) {
  const source = cryptoObj ?? (typeof globalThis !== 'undefined' ? globalThis.crypto : undefined);
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Every board installation at a venue, flattened into the choices the form
 * offers. A Kilter entry with three walls becomes three choices, because
 * "the middle wall's angle is wrong" is a thing people report.
 */
export function boardChoices(venueProperties, lang = 'en') {
  const choices = [];
  for (const board of venueProperties.boards ?? []) {
    const walls = Array.isArray(board.walls) ? board.walls : [];
    if (walls.length > 0) {
      for (const wall of walls) {
        if (!wall.instance_id) continue;
        const parts = [board.board];
        if (wall.wall_name) parts.push(wall.wall_name);
        else if (wall.size_label) parts.push(wall.size_label);
        else if (wall.layout) parts.push(wall.layout);
        choices.push({ instanceId: wall.instance_id, board: board.board, label: parts.join(' · ') });
      }
      continue;
    }
    if (!board.instance_id) continue;
    const parts = [board.board];
    if (board.variant) parts.push(String(board.variant));
    if (board.username) parts.push(`@${board.username}`);
    choices.push({ instanceId: board.instance_id, board: board.board, label: parts.join(' · ') });
  }
  // Deduplicate defensively: a malformed dataset must not produce two options
  // with the same value, which a <select> would silently collapse anyway.
  const seen = new Set();
  return choices.filter((choice) => {
    if (seen.has(choice.instanceId)) return false;
    seen.add(choice.instanceId);
    return codePoints(choice.label).length <= LIMITS.boardLabelMaxChars;
  });
}
