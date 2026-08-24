// The venue report dialog.
//
// This is the only part of the board map that sends anything anywhere. It
// builds a `<dialog>` on demand, collects a report, and POSTs it to the
// first-party ingestion endpoint. It signs nothing, stores nothing, and holds
// no key — the encryption to the maintainer happens on the server, because a
// signing key in a static site is a published key.
//
// Loaded as a module (`type="module"`), so it is deferred and cannot block the
// map. `map.js` is a classic script that runs first and looks this up lazily at
// click time via `window.CruxCoachVenueReport`; if the module failed to load,
// the button simply is not added.
//
// Everything reaches the DOM through `textContent` and `createElement`. Venue
// names come from a fetched file and error text comes from a server response;
// neither has any business being parsed as markup.

import {
  ACCESS_VALUES,
  BOARDS,
  CATEGORIES,
  CATEGORIES_REQUIRING_BOARD,
  LIMITS,
  PROPOSAL_FIELDS_BY_CATEGORY,
  boardChoices,
  buildSubmission,
  describeFailure,
  format,
  newSubmissionId,
  resolveEndpoint,
  strings,
  validateForm,
} from './report-core.mjs';

const LANG = document.documentElement.lang === 'de' ? 'de' : 'en';
const T = strings(LANG);
const ENDPOINT = resolveEndpoint(window.location);

let dialog = null;
let elements = null;
let currentVenue = null;
let submitting = false;
let returnFocus = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function field(id, labelText, control, hintText) {
  const wrap = el('div', { class: 'vr-field' });
  const label = el('label', { for: id }, labelText);
  wrap.append(label, control);
  if (hintText) wrap.append(el('p', { class: 'vr-hint', id: `${id}-hint` }, hintText));
  wrap.append(el('p', { class: 'vr-error', id: `${id}-error`, role: 'alert', hidden: 'hidden' }));
  return wrap;
}

function select(id, options, { includeEmpty, emptyLabel } = {}) {
  const node = el('select', { id, name: id });
  if (includeEmpty) node.append(el('option', { value: '' }, emptyLabel ?? ''));
  for (const option of options) {
    node.append(el('option', { value: option.value }, option.label));
  }
  return node;
}

function build() {
  const form = el('form', { class: 'vr-form', novalidate: 'novalidate' });

  const heading = el('h2', { id: 'vr-title' }, T.title);
  const intro = el('p', { class: 'vr-intro' }, T.intro);

  const venueLine = el('p', { class: 'vr-venue' });
  const venueName = el('strong');
  const venueId = el('span', { class: 'vr-venue-id' });
  venueLine.append(el('span', { class: 'vr-label' }, `${T.venueLabel}: `), venueName, venueId);

  const boardSelect = select('vr-board-instance', [], {
    includeEmpty: true,
    emptyLabel: T.boardAll,
  });
  const boardField = field('vr-board-instance', T.boardLabel, boardSelect);

  const categorySelect = select(
    'vr-category',
    CATEGORIES.map((value) => ({ value, label: T.categories[value] })),
    { includeEmpty: true, emptyLabel: '—' },
  );
  const categoryField = field('vr-category', T.categoryLabel, categorySelect, T.categoryHint);

  // One container per conditional field, all built once and hidden. Rebuilding
  // the form on every category change would move focus out from under a
  // keyboard user mid-edit.
  const websiteInput = el('input', {
    id: 'vr-website',
    type: 'url',
    inputmode: 'url',
    maxlength: LIMITS.urlMaxChars,
    placeholder: 'https://',
    autocomplete: 'off',
  });
  const websiteField = field('vr-website', T.websiteLabel, websiteInput);

  const hoursInput = el('input', {
    id: 'vr-hours',
    type: 'text',
    maxlength: LIMITS.hoursMaxChars,
    autocomplete: 'off',
  });
  const hoursField = field('vr-hours', T.hoursLabel, hoursInput, T.hoursHint);

  const accessSelect = select(
    'vr-access',
    ACCESS_VALUES.map((value) => ({ value, label: T.accessValues[value] })),
    { includeEmpty: true, emptyLabel: '—' },
  );
  const accessField = field('vr-access', T.accessLabel, accessSelect);

  const latInput = el('input', { id: 'vr-lat', type: 'text', inputmode: 'decimal', autocomplete: 'off' });
  const lonInput = el('input', { id: 'vr-lon', type: 'text', inputmode: 'decimal', autocomplete: 'off' });
  const coordsField = field('vr-lat', T.latLabel, latInput, T.coordinatesHint);
  const lonField = field('vr-lon', T.lonLabel, lonInput);

  const boardTypeSelect = select(
    'vr-board',
    BOARDS.map((value) => ({ value, label: value })),
    { includeEmpty: true, emptyLabel: '—' },
  );
  const boardTypeField = field('vr-board', T.boardTypeLabel, boardTypeSelect);

  const duplicateInput = el('input', {
    id: 'vr-duplicate',
    type: 'text',
    maxlength: 32,
    placeholder: 'v1_',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const duplicateField = field('vr-duplicate', T.duplicateLabel, duplicateInput, T.duplicateHint);

  const detailInput = el('textarea', {
    id: 'vr-detail',
    rows: 4,
    maxlength: LIMITS.detailMaxChars,
    required: 'required',
  });
  const detailField = field(
    'vr-detail',
    T.detailLabel,
    detailInput,
    format(T.detailHint, { min: LIMITS.detailMinChars }),
  );
  const counter = el('p', { class: 'vr-counter', 'aria-live': 'polite' });
  detailField.append(counter);

  const evidenceInput = el('input', {
    id: 'vr-evidence',
    type: 'url',
    inputmode: 'url',
    maxlength: LIMITS.urlMaxChars,
    placeholder: 'https://',
    autocomplete: 'off',
  });
  const evidenceField = field('vr-evidence', T.evidenceLabel, evidenceInput, T.evidenceHint);

  const npubInput = el('input', {
    id: 'vr-npub',
    type: 'text',
    maxlength: LIMITS.npubMaxChars,
    placeholder: 'npub1…',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const npubField = field('vr-npub', T.npubLabel, npubInput, T.npubHint);

  const privacy = el('p', { class: 'vr-privacy' }, T.privacy);
  const status = el('p', { class: 'vr-status', role: 'status', 'aria-live': 'polite' });

  const submitButton = el('button', { type: 'submit', class: 'vr-submit' }, T.submit);
  const cancelButton = el('button', { type: 'button', class: 'vr-cancel' }, T.cancel);
  const actions = el('div', { class: 'vr-actions' });
  actions.append(submitButton, cancelButton);

  form.append(
    heading,
    intro,
    venueLine,
    boardField,
    categoryField,
    websiteField,
    hoursField,
    accessField,
    coordsField,
    lonField,
    boardTypeField,
    duplicateField,
    detailField,
    evidenceField,
    npubField,
    privacy,
    status,
    actions,
  );

  const node = el('dialog', { class: 'vr-dialog', 'aria-labelledby': 'vr-title' });
  node.append(form);
  document.body.append(node);

  elements = {
    form,
    venueName,
    venueId,
    boardField,
    boardSelect,
    categorySelect,
    conditional: {
      website: websiteField,
      hours: hoursField,
      access: accessField,
      lat: coordsField,
      lon: lonField,
      board: boardTypeField,
      duplicateOfVenueId: duplicateField,
    },
    inputs: {
      website: websiteInput,
      hours: hoursInput,
      access: accessSelect,
      lat: latInput,
      lon: lonInput,
      board: boardTypeSelect,
      duplicateOfVenueId: duplicateInput,
      detail: detailInput,
      evidenceUrl: evidenceInput,
      npub: npubInput,
      boardInstanceId: boardSelect,
      category: categorySelect,
    },
    counter,
    status,
    submitButton,
    cancelButton,
  };

  categorySelect.addEventListener('change', syncConditionalFields);
  detailInput.addEventListener('input', syncCounter);
  cancelButton.addEventListener('click', close);
  form.addEventListener('submit', onSubmit);
  node.addEventListener('close', onDialogClose);
  node.addEventListener('cancel', () => {
    // Escape reaches the dialog element, not the form; the close handler does
    // the focus restore either way.
  });

  return node;
}

function syncCounter() {
  const length = [...elements.inputs.detail.value].length;
  elements.counter.textContent = format(T.detailCounter, {
    n: length,
    max: LIMITS.detailMaxChars,
  });
}

function syncConditionalFields() {
  const category = elements.categorySelect.value;
  const needed = new Set(PROPOSAL_FIELDS_BY_CATEGORY[category] ?? []);
  for (const [name, node] of Object.entries(elements.conditional)) {
    const show = needed.has(name);
    node.hidden = !show;
    // A hidden control must also leave the tab order and the accessibility
    // tree, or a keyboard user tabs into a field they cannot see.
    const input = elements.inputs[name];
    if (input) input.disabled = !show;
  }
  // The board picker is optional in general and required for two categories;
  // say so rather than only failing on submit.
  const boardRequired = CATEGORIES_REQUIRING_BOARD.includes(category);
  elements.boardSelect.required = boardRequired;
  const label = elements.boardField.querySelector('label');
  if (label) label.textContent = boardRequired ? `${T.boardLabel} *` : T.boardLabel;
}

function clearErrors() {
  for (const node of elements.form.querySelectorAll('.vr-error')) {
    node.textContent = '';
    node.hidden = true;
  }
  for (const input of Object.values(elements.inputs)) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
  elements.status.textContent = '';
  elements.status.className = 'vr-status';
}

function showErrors(errors) {
  let first = null;
  for (const [name, message] of Object.entries(errors)) {
    const input = elements.inputs[name];
    const target = document.getElementById(`${input ? input.id : `vr-${name}`}-error`);
    if (target) {
      target.textContent = message;
      target.hidden = false;
    }
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (target) input.setAttribute('aria-describedby', target.id);
      if (!first) first = input;
    }
  }
  if (first && typeof first.focus === 'function') first.focus();
}

function readForm() {
  const choice = elements.boardSelect.selectedOptions
    ? elements.boardSelect.selectedOptions[0]
    : null;
  return {
    venue: currentVenue,
    category: elements.categorySelect.value,
    detail: elements.inputs.detail.value,
    website: elements.inputs.website.value,
    hours: elements.inputs.hours.value,
    access: elements.inputs.access.value,
    lat: elements.inputs.lat.value,
    lon: elements.inputs.lon.value,
    board: elements.inputs.board.value,
    duplicateOfVenueId: elements.inputs.duplicateOfVenueId.value,
    evidenceUrl: elements.inputs.evidenceUrl.value,
    npub: elements.inputs.npub.value,
    boardInstanceId: elements.boardSelect.value || null,
    boardInstanceBoard: choice ? choice.dataset.board : null,
    boardInstanceLabel: choice ? choice.textContent : null,
  };
}

function setBusy(busy) {
  submitting = busy;
  elements.submitButton.disabled = busy;
  elements.submitButton.textContent = busy ? T.sending : T.submit;
  elements.form.setAttribute('aria-busy', busy ? 'true' : 'false');
}

async function onSubmit(event) {
  event.preventDefault();
  if (submitting) return;
  clearErrors();

  const form = readForm();
  const { ok, errors } = validateForm(form, LANG);
  if (!ok) {
    showErrors(errors);
    return;
  }

  // Checked here rather than trusted: `navigator.onLine` is famously optimistic,
  // so a false negative still gets a real attempt and a network error below.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    fail(T.errors.offline);
    return;
  }

  setBusy(true);
  try {
    const ticket = await fetchTicket();
    const body = buildSubmission(form, {
      ticket,
      submissionId: newSubmissionId(),
      lang: LANG,
    });

    const response = await fetch(`${ENDPOINT}/v1/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No cookies, no credentials, no referrer. There is nothing about this
      // browser the endpoint needs, so it is not sent.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      fail(describeFailure(response.status, payload, LANG));
      return;
    }

    succeed();
  } catch {
    // Network failure, DNS failure, CORS refusal — all indistinguishable from
    // here, and all mean the same thing to a person: it did not go.
    fail(T.errors.failed);
  } finally {
    setBusy(false);
  }
}

async function fetchTicket() {
  const response = await fetch(`${ENDPOINT}/v1/reports/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    body: '{}',
  });
  if (!response.ok) {
    const error = new Error('ticket');
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  return payload.ticket;
}

function fail(message) {
  elements.status.textContent = message;
  elements.status.className = 'vr-status vr-status-error';
}

function succeed() {
  // Replace the form outright. Leaving a filled-in form behind a success
  // message invites a second identical send, and the reporter has no way to
  // tell whether the first one counted.
  const done = el('div', { class: 'vr-done' });
  done.append(el('h2', { id: 'vr-title' }, T.successTitle), el('p', {}, T.successBody));
  const closeButton = el('button', { type: 'button', class: 'vr-submit' }, T.close);
  closeButton.addEventListener('click', close);
  done.append(closeButton);
  elements.form.replaceChildren(done);
  closeButton.focus();
}

function resetForm() {
  elements.form.reset();
  clearErrors();
  syncConditionalFields();
  syncCounter();
}

function onDialogClose() {
  if (returnFocus && document.contains(returnFocus)) {
    try {
      returnFocus.focus({ preventScroll: true });
    } catch {
      returnFocus.focus();
    }
  }
  returnFocus = null;
}

function close() {
  if (dialog && dialog.open) dialog.close();
}

/**
 * Open the dialog for one venue.
 *
 * `properties` is the GeoJSON feature's properties as the map already holds it;
 * `lat`/`lon` come from the geometry. `trigger` is the element that opened it,
 * so focus can go back where it came from.
 */
export function open(properties, lat, lon, trigger) {
  if (!properties || typeof properties.venue_id !== 'string') return false;

  if (!dialog) dialog = build();
  // Rebuild the form body if a previous submission replaced it with the thank
  // you panel.
  if (!elements.form.contains(elements.categorySelect)) {
    dialog.remove();
    dialog = build();
  }

  currentVenue = {
    id: properties.venue_id,
    name: properties.name || '',
    lat,
    lon,
    country: typeof properties.country === 'string' && /^[A-Z]{2}$/.test(properties.country)
      ? properties.country
      : null,
  };

  elements.venueName.textContent = currentVenue.name;
  elements.venueId.textContent = ` (${currentVenue.id})`;

  const choices = boardChoices(properties, LANG);
  elements.boardSelect.replaceChildren(el('option', { value: '' }, T.boardAll));
  for (const choice of choices) {
    const option = el('option', { value: choice.instanceId }, choice.label);
    option.dataset.board = choice.board;
    elements.boardSelect.append(option);
  }
  elements.boardField.hidden = choices.length === 0;

  resetForm();
  returnFocus = trigger ?? null;

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'open');
  elements.categorySelect.focus();
  return true;
}

// The map is a classic script that runs before this module. It looks the API up
// at click time, so a module that failed to load means no button rather than a
// broken one.
window.CruxCoachVenueReport = { open, close, endpoint: ENDPOINT };
