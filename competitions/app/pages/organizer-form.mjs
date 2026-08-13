/**
 * The create form.
 *
 * Everything an organizer must decide is on screen; everything with a defensible
 * default is behind a disclosure that says so. What is NOT here is a hidden
 * choice: divisions, prizes, venue kind, board identity, capacity and waitlist,
 * every mode axis and every piece of text an entrant reads are all editable.
 *
 * Climbs are real board climbs. The organizer pastes a CruxCoach share link, an
 * naddr or a catalogue uuid; a community climb is fetched and its label, angle,
 * board and size are shown before it is accepted, and anything incompatible
 * with the competition's board is refused rather than silently added.
 */
import { el, replace } from '../ui/dom.mjs';
import {
  buildClimbList, checkBoardCompatibility, climbEventFilter, describeClimbEvent, normalizeUuid, parseClimbRef,
} from '../protocol/climb-ref.mjs';
import { newCompId, validateCompetitionConfig } from '../protocol/competition.mjs';
import { naddrEncode, verifyEvent } from '../protocol/nostr-event.mjs';
import {
  BOARD_TYPES, boardType, catalogueProductSizeId, resolveBoardSelection, resolveCatalogueSelection,
} from '../protocol/board-catalog.mjs';
import { loadCatalogueClimbs } from '../data/climb-catalogue.mjs';
import { loadVenueCatalogue, searchVenues } from '../data/venue-catalogue.mjs';
import {
  climbCard, filterCatalogue, gradeFilterOptions, saveGradeScale, storedGradeScale,
} from '../ui/climb-card.mjs?v=20260813-2';

const text = (id, value = '', attrs = {}) => el('input', { attrs: { type: 'text', id, value, ...attrs } });
const num = (id, value, attrs = {}) => el('input', { attrs: { type: 'number', id, value: String(value), required: 'required', ...attrs } });
const when = (id, value) => el('input', { attrs: { type: 'datetime-local', id, value, required: 'required' } });
const area = (id, value = '', max = 2000) => {
  const node = el('textarea', { attrs: { id, maxlength: String(max) } });
  node.value = value;
  return node;
};
const select = (id, options, value) => el(
  'select',
  { attrs: { id, required: 'required' } },
  options.map(([v, label]) => el('option', { attrs: { value: v, selected: v === value }, text: label })),
);

const FALLBACK_TIME_ZONES = [
  'UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'America/Anchorage', 'America/Argentina/Buenos_Aires',
  'America/Chicago', 'America/Denver', 'America/Halifax', 'America/Los_Angeles', 'America/Mexico_City',
  'America/New_York', 'America/Phoenix', 'America/Sao_Paulo', 'America/Toronto', 'America/Vancouver',
  'Asia/Bangkok', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jerusalem', 'Asia/Kolkata', 'Asia/Seoul',
  'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Adelaide', 'Australia/Brisbane',
  'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney', 'Europe/Amsterdam', 'Europe/Athens',
  'Europe/Berlin', 'Europe/Helsinki', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid',
  'Europe/Oslo', 'Europe/Paris', 'Europe/Prague', 'Europe/Rome', 'Europe/Stockholm', 'Europe/Vienna',
  'Europe/Warsaw', 'Europe/Zurich', 'Pacific/Auckland', 'Pacific/Honolulu',
];

function normalizedTimeZone(value) {
  const zone = String(value || '').trim();
  return ['Etc/UTC', 'Etc/GMT', 'GMT'].includes(zone) ? 'UTC' : zone;
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch { return false; }
}

function offsetFromName(timeZone, date) {
  for (const timeZoneName of ['longOffset', 'shortOffset']) {
    try {
      const name = new Intl.DateTimeFormat('en-US', {
        timeZone, timeZoneName, hour: '2-digit', hourCycle: 'h23',
      }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;
      if (name === 'GMT' || name === 'UTC') return 0;
      const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(name || '');
      if (match) return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0));
    } catch { /* fall through to the universally supported parts formatter */ }
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return Math.round((representedAsUtc - date.getTime()) / 60000);
}

export function timeZoneUtcRelation(timeZone, at = new Date()) {
  const minutes = offsetFromName(normalizedTimeZone(timeZone), at);
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function timeZoneReference(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  return match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])))
    : new Date();
}

function timeZoneLabel(timeZone, at) {
  return `${timeZone.replaceAll('_', ' ').replaceAll('/', ' / ')} (${timeZoneUtcRelation(timeZone, at)})`;
}

function supportedTimeZones(selected) {
  const discovered = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone') : FALLBACK_TIME_ZONES;
  const values = new Set(['UTC', ...discovered.map(normalizedTimeZone)]);
  const normalizedSelected = normalizedTimeZone(selected);
  if (validTimeZone(normalizedSelected)) values.add(normalizedSelected);
  return [...values].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
}

function timeZonePicker(id, value, at) {
  const selected = validTimeZone(normalizedTimeZone(value)) ? normalizedTimeZone(value) : 'UTC';
  const node = el('select', { attrs: { id, required: 'required' } }, supportedTimeZones(selected).map(
    (zone) => el('option', {
      attrs: { value: zone, selected: zone === selected, 'data-timezone': zone },
      text: timeZoneLabel(zone, at),
    }),
  ));
  node.value = selected;
  return node;
}

function refreshTimeZonePicker(node, at) {
  for (const option of node.querySelectorAll('option')) {
    const zone = option.getAttribute('data-timezone') || option.value;
    option.textContent = timeZoneLabel(zone, at);
  }
}

function ensureTimeZoneOption(node, value, at) {
  const zone = normalizedTimeZone(value);
  if (!validTimeZone(zone)) return false;
  if (![...node.querySelectorAll('option')].some((option) => option.value === zone)) {
    node.append(el('option', {
      attrs: { value: zone, 'data-timezone': zone }, text: timeZoneLabel(zone, at),
    }));
  }
  return true;
}

/** Interpret a datetime-local value in the selected IANA zone, not the browser's zone. */
export function zonedLocalToEpoch(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  const zone = normalizedTimeZone(timeZone);
  if (!match || !validTimeZone(zone)) return NaN;
  const wallClockUtc = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]),
  );
  let instant = wallClockUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instant = wallClockUtc - offsetFromName(zone, new Date(instant)) * 60000;
  }
  const actual = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const reconstructed = `${actual.year}-${actual.month}-${actual.day}T${actual.hour}:${actual.minute}`;
  // A spring DST jump contains local wall-clock times that never happen.
  // Refuse those instead of silently moving the competition by an hour.
  if (reconstructed !== value) return NaN;
  return Math.floor(instant / 1000);
}

function defaultWhen(offsetHours) {
  const date = new Date(Date.now() + offsetHours * 3600 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function infoTip(id, label, explanation) {
  if (!explanation) return null;
  return el('span', {
    className: 'info-tip',
    attrs: { tabindex: '0', 'aria-label': `${label}: ${explanation}`, 'aria-describedby': `${id}-explanation` },
  }, [
    el('span', { className: 'info-tip-icon', attrs: { 'aria-hidden': 'true' }, text: 'i' }),
    el('span', { className: 'info-popover', attrs: { id: `${id}-explanation`, role: 'tooltip' }, text: explanation }),
  ]);
}

function field(id, label, input, hint, explanation) {
  const required = input.getAttribute('required') !== null;
  const german = document.documentElement?.getAttribute?.('lang') === 'de';
  const marker = required ? (german ? 'Pflichtfeld' : 'Required') : (german ? 'Optional' : 'Optional');
  return el('label', { className: required ? 'field-required' : 'field-optional', attrs: { for: id } }, [
    el('span', {}, [
      el('span', { text: label }),
      infoTip(id, label, explanation),
      el('span', {
        className: `field-marker ${required ? 'required' : 'optional'}`,
        text: marker,
      }),
    ]),
    hint ? el('span', { className: 'hint', text: hint }) : null,
    input,
  ]);
}

/** Catalogue filters are refinements, never required competition fields. */
function filterField(id, label, input) {
  input.removeAttribute('required');
  return el('label', { className: 'catalogue-filter-field', attrs: { for: id } }, [
    el('span', { text: label }), input,
  ]);
}

function setFieldRequirement(wrapper, input, required, t) {
  if (required) input.setAttribute('required', 'required');
  else input.removeAttribute('required');
  wrapper.className = required ? 'field-required' : 'field-optional';
  const marker = wrapper.querySelector('.field-marker');
  if (marker) {
    marker.className = `field-marker ${required ? 'required' : 'optional'}`;
    marker.textContent = required ? t('field.required') : t('field.optional');
  }
}

/** Strict admission contract for the broad relay-backed browser query. */
export function isBrowsableClimbEvent(event, described, board) {
  const dTag = (event?.tags || []).find((tag) => tag[0] === 'd')?.[1] || '';
  if (!dTag.startsWith(`cruxcoach:climb:${String(event?.pubkey || '').slice(0, 8)}:`)) return false;
  const uuid = normalizeUuid(described?.uuid);
  if (!uuid || normalizeUuid(dTag.split(':').at(-1)) !== uuid || !described?.label) return false;
  // Unlike a pasted address, a discovery result has no prior identity. Missing
  // board metadata is therefore not "unknown but maybe fine": it is ineligible.
  if (!described.brand || described.brand !== board?.brand) return false;
  if (!Number.isFinite(described.layoutId) || described.layoutId !== board?.layout_id) return false;
  return checkBoardCompatibility(described, board).compatible;
}

/**
 * The climb list editor.
 *
 * Owns its own rows so the caller does not have to thread state through the
 * form. `entries()` returns what has been accepted, which is only ever climbs
 * that resolved to a real id.
 */
class ClimbEditor {
  constructor({ t, pool, boardOf, gradeScaleOf = storedGradeScale, onChange }) {
    this.t = t;
    this.pool = pool;
    this.boardOf = boardOf;
    this.gradeScaleOf = gradeScaleOf;
    this.onChange = onChange || (() => {});
    this.rows = [];
    this.node = el('div', { className: 'stack' });
    this.status = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  }

  entries() {
    return this.rows.map((row) => ({
      uuid: row.uuid,
      label: row.labelInput.value.trim(),
      angle: Number(row.angleInput.value),
      points: Number(row.pointsInput.value),
      kind: row.kind,
      naddr: row.naddr,
      zoneHold: Number(row.zoneInput?.value) || undefined,
      setter: row.described?.setter,
      difficulty: row.described?.difficulty,
      quality: row.described?.quality,
      ascents: row.described?.ascents,
    }));
  }

  /** Restore a local, unpublished draft without doing network lookups again. */
  restore(entries = []) {
    this.rows = [];
    for (const entry of entries) {
      const uuid = normalizeUuid(entry?.uuid);
      if (!uuid || this.rows.some((row) => row.uuid === uuid)) continue;
      const kind = entry.kind === 'community' ? 'community' : 'catalogue';
      const row = this.buildRow({ uuid, kind, naddr: entry.naddr }, null, null);
      row.labelInput.value = String(entry.label || '').slice(0, 60);
      row.angleInput.value = String(Number.isFinite(Number(entry.angle)) ? Number(entry.angle) : 40);
      row.pointsInput.value = String(Number.isFinite(Number(entry.points)) ? Number(entry.points) : 100);
      if (row.zoneInput) row.zoneInput.value = String(Number(entry.zoneHold) || '');
      this.rows.push(row);
    }
    this.render();
  }

  /** Re-check selected relay climbs after the organizer changes the wall. */
  boardProblems() {
    const board = this.boardOf();
    return this.rows.filter((row) => row.described
      && !checkBoardCompatibility(row.described, board).compatible);
  }

  announceBoardChange() {
    const problems = this.boardProblems();
    if (problems.length) {
      this.status.textContent = this.t('climb.board_changed', { count: problems.length });
    }
    this.render();
    this.onChange();
  }

  /** Accept a pasted reference, fetching a community climb to describe it. */
  async add(input) {
    const { t } = this;
    const ref = parseClimbRef(input);
    if (!ref.ok) {
      this.status.textContent = t(`climb.error.${ref.error}`);
      return false;
    }
    if (this.rows.some((row) => row.uuid === ref.uuid)) {
      this.status.textContent = t('climb.error.duplicate');
      return false;
    }

    let described = null;
    if (ref.kind === 'community') {
      this.status.textContent = t('climb.looking_up');
      const { events } = await this.pool.query([climbEventFilter(ref)], { timeoutMs: 6000 });
      const verified = [];
      for (const event of events) {
        // A relay can hand back a validly signed envelope whose tags it
        // swapped, and those tags are what we are about to describe.
        // eslint-disable-next-line no-await-in-loop
        if (await verifyEvent(event).catch(() => false)) verified.push(event);
      }
      if (verified.length > 0) {
        const newest = verified.reduce((best, e) => (e.created_at > best.created_at ? e : best));
        described = describeClimbEvent(newest);
        const dTag = (newest.tags || []).find((tag) => tag[0] === 'd')?.[1] || '';
        if (normalizeUuid(described.uuid) !== ref.uuid
          || !dTag.startsWith(`cruxcoach:climb:${newest.pubkey.slice(0, 8)}:`)) {
          this.status.textContent = t('climb.error.identity_mismatch');
          return false;
        }
      } else {
        // Not fatal: a very fresh climb may not have propagated. The organizer
        // fills in the label and angle instead, and is told why.
        this.status.textContent = t('climb.not_found');
      }
    }

    const board = this.boardOf();
    const compatibility = described ? checkBoardCompatibility(described, board) : null;
    if (compatibility && !compatibility.compatible) {
      // Never silently add a climb the board cannot light up.
      this.status.textContent = t('climb.error.incompatible', {
        problems: compatibility.problems.map((p) => t(`climb.problem.${p}`)).join(', '),
      });
      return false;
    }

    this.rows.push(this.buildRow(ref, described, compatibility));
    this.status.textContent = described
      ? t('climb.added', { label: described.label || ref.uuid.slice(0, 8) })
      : t('climb.added_manual');
    this.render();
    this.onChange();
    return true;
  }

  /** Add a relay result selected in the embedded browser. */
  addEvent(event) {
    const described = describeClimbEvent(event);
    const uuid = normalizeUuid(described.uuid);
    if (!uuid || this.rows.some((row) => row.uuid === uuid)) {
      this.status.textContent = this.t(uuid ? 'climb.error.duplicate' : 'climb.error.not_a_climb');
      return false;
    }
    const compatibility = checkBoardCompatibility(described, this.boardOf());
    if (!compatibility.compatible) return false;
    const dTag = (event.tags || []).find((tag) => tag[0] === 'd')?.[1];
    if (!dTag) return false;
    const ref = {
      kind: 'community', uuid,
      naddr: naddrEncode({ identifier: dTag, pubkey: event.pubkey, kind: event.kind }),
    };
    this.rows.push(this.buildRow(ref, described, compatibility));
    this.status.textContent = this.t('climb.added', { label: described.label || uuid.slice(0, 8) });
    this.render();
    this.onChange();
    return true;
  }

  /** Add an entry from the app's Blossom-backed catalogue snapshot. */
  addCatalogue(described) {
    const uuid = normalizeUuid(described?.uuid);
    if (!uuid || this.rows.some((row) => row.uuid === uuid)) {
      this.status.textContent = this.t(uuid ? 'climb.error.duplicate' : 'climb.error.not_a_climb');
      return false;
    }
    const compatibility = checkBoardCompatibility(described, this.boardOf());
    if (!compatibility.compatible) return false;
    this.rows.push(this.buildRow({ kind: 'catalogue', uuid }, described, compatibility));
    this.status.textContent = this.t('climb.added', { label: described.label });
    this.render();
    this.onChange();
    return true;
  }

  buildRow(ref, described, compatibility) {
    const { t } = this;
    const labelInput = text(`climb-label-${this.rows.length}`, described?.label || '', { maxlength: '60' });
    const angleInput = num(
      `climb-angle-${this.rows.length}`,
      Number.isFinite(described?.angle) ? described.angle : (this.boardOf()?.angle ?? 40),
      { min: '0', max: '70' },
    );
    const pointsInput = num(`climb-points-${this.rows.length}`, 100, { min: '0', max: '10000' });
    const holds = (Array.isArray(described?.holds) ? described.holds : [])
      .filter(([, role]) => [13, 43].includes(role));
    const zoneInput = select(`climb-zone-${this.rows.length}`, [
      ['', t('climb.zone.choose')],
      ...holds.map(([placement, , x, y], index) => [String(placement), t('climb.zone.hold', {
        number: index + 1, column: x, row: y,
      })]),
    ], '');
    zoneInput.removeAttribute('required');
    return {
      uuid: ref.uuid,
      kind: ref.kind,
      naddr: ref.naddr,
      described,
      compatibility,
      labelInput,
      angleInput,
      pointsInput,
      zoneInput,
      zoneCandidates: holds,
    };
  }

  render() {
    const { t } = this;
    replace(this.node,
      this.rows.length ? el('p', {
        className: 'selection-count',
        text: t('climb.selected_count', { count: this.rows.length }),
      }) : null,
      ...this.rows.map((row, index) => {
        const currentCompatibility = row.described
          ? checkBoardCompatibility(row.described, this.boardOf()) : row.compatibility;
        const redrawZone = () => { this.render(); this.onChange(); };
        row.zoneInput.addEventListener('change', redrawZone, { once: true });
        return el('div', {
          className: `selected-climb${currentCompatibility && !currentCompatibility.compatible ? ' invalid' : ''}`,
        }, [
      el('div', { className: 'row between' }, [
        el('strong', { text: `${index + 1}. ${row.described?.label || row.labelInput.value || row.uuid.slice(0, 8)}` }),
        el('button', {
          className: 'quiet danger',
          text: t('action.remove'),
          on: {
            click: () => {
              this.rows.splice(index, 1);
              this.render();
              this.onChange();
            },
          },
        }),
        ]),
      el('p', {
        className: 'small',
        text: row.kind === 'community'
          ? t('climb.source.community', {
            board: row.described?.boardLabel || row.described?.brand || '—',
            size: row.described?.size || '—',
          })
          : t('climb.source.catalogue'),
      }),
      row.compatibility?.warnings?.length
        ? el('p', {
          className: 'small',
          text: t('climb.warning', {
            warnings: row.compatibility.warnings.map((w) => t(`climb.problem.${w}`)).join(', '),
          }),
        })
        : null,
      currentCompatibility && !currentCompatibility.compatible
        ? el('p', { className: 'notice bad', text: t('climb.selected_incompatible') }) : null,
      row.described ? climbCard({
        climb: { ...row.described, zone_hold: Number(row.zoneInput.value) || undefined },
        board: this.boardOf(), t, selected: true, gradeScale: this.gradeScaleOf(),
      }) : null,
      el('div', { className: 'climb-fields' }, [
        field(row.labelInput.id, t('climb.label'), row.labelInput),
        field(row.angleInput.id, t('climb.angle'), row.angleInput),
        field(row.pointsInput.id, t('climb.points'), row.pointsInput, t('climb.points.hint')),
        row.zoneInput && row.described?.holds?.length
          ? field(row.zoneInput.id, t('climb.zone'), row.zoneInput, t('climb.zone.hint')) : null,
        !row.zoneCandidates.length ? el('p', { className: 'notice warn', text: t('climb.zone.unavailable') }) : null,
      ]),
    ]);
      }));
  }
}

const MOONBOARD_VARIANTS = new Map([
  ['mb2016', 'moonboard-2016'],
  ['mb2017-masters', 'moonboard-masters-2017'],
  ['mb2019-masters', 'moonboard-masters-2019'],
  ['mini-2020', 'mini-moonboard-2020'],
  ['mb2024', 'moonboard-2024'],
]);

function venueBoardChoices(venue) {
  return venue.boards.flatMap((source) => {
    let type = BOARD_TYPES.find((entry) => entry.brand === source.id) || null;
    if (!type) return [];

    if (source.id === 'kilter' && source.walls.length) {
      return source.walls.flatMap((wall) => {
        const typeId = wall.layout.toLowerCase().includes('homewall') ? 'kilter-homewall'
          : wall.layout.toLowerCase().includes('original') ? 'kilter-original' : '';
        type = boardType(typeId);
        const model = type?.models[0];
        const size = model?.sizes.find((entry) => (
          (wall.sizeId != null && catalogueProductSizeId(entry) === wall.sizeId)
            || entry.value === wall.sizeLabel
        ));
        if (!type || !model || !size) return [];
        const angle = model.angles.includes(wall.angle) ? wall.angle
          : model.angles.length === 1 ? model.angles[0] : null;
        return [{
          typeId, model: model.value, size: size.value, angle,
          label: [model.label, size.label, angle == null ? null : `${angle}°`].filter(Boolean).join(' · '),
          address: source.address, exact: angle != null,
        }];
      });
    }

    if (source.id === 'moonboard' && !MOONBOARD_VARIANTS.has(source.variant)) {
      return [{
        typeId: type.id, model: null, size: null, angle: null,
        label: type.label, address: source.address, exact: false,
      }];
    }

    let model = type.models.length === 1 ? type.models[0] : null;
    if (source.id === 'moonboard' && MOONBOARD_VARIANTS.has(source.variant)) {
      model = type.models.find((entry) => entry.value === MOONBOARD_VARIANTS.get(source.variant)) || null;
    }
    if (!model) {
      return [{
        typeId: type.id, model: null, size: null, angle: null,
        label: type.label, address: source.address, exact: false,
      }];
    }
    const size = model.sizes.length === 1 ? model.sizes[0] : null;
    const angle = model.angles.includes(source.angle) ? source.angle
      : model.angles.length === 1 ? model.angles[0] : null;
    return [{
      typeId: type.id, model: model.value, size: size?.value || null, angle,
      label: [model.label, size?.label, angle == null ? null : `${angle}°`].filter(Boolean).join(' · '),
      address: source.address,
      exact: size != null && angle != null,
    }];
  }).filter((choice, index, all) => all.findIndex((candidate) => (
    candidate.typeId === choice.typeId && candidate.model === choice.model
      && candidate.size === choice.size && candidate.angle === choice.angle
  )) === index);
}

/**
 * Build the whole create form.
 *
 * @returns {{node: HTMLElement, build: () => object}} `build` throws with a
 *   readable message when the form cannot make a valid competition.
 */
export function createCompetitionForm({
  t, pool, signerPubkey, defaultDisplayName, defaultLud16, relays,
  catalogueLoader = loadCatalogueClimbs, initialDraft = null, onDraftChange = () => {},
  venueLoader = loadVenueCatalogue,
  persistDraft = true, onDraftDiscard = null, initialStep = null,
  onStepChange = () => {}, onStepBack = null,
}) {
  let notifyDraftChange = () => {};
  const f = {
    title: text('f-title', '', { maxlength: '120', required: 'required' }),
    summary: text('f-summary', '', { maxlength: '140' }),
    description: area('f-description', '', 4000),
    organizerName: text('f-org', defaultDisplayName || '', { maxlength: '80', required: 'required' }),
    contact: text('f-contact', '', { maxlength: '120' }),
    visibility: select('f-visibility', [['public', t('org.visibility.public')], ['unlisted', t('org.visibility.unlisted')]], 'public'),

    regOpens: when('f-reg-open', defaultWhen(1)),
    regCloses: when('f-reg-close', defaultWhen(24)),
    checkinOpens: when('f-checkin-open', defaultWhen(25)),
    checkinCloses: when('f-checkin-close', defaultWhen(26)),
    starts: when('f-start', defaultWhen(26)),
    ends: when('f-end', defaultWhen(29)),
    timezone: timeZonePicker(
      'f-timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', timeZoneReference(defaultWhen(26)),
    ),

    venueKind: select('f-venue-kind', [['physical', t('org.venue.physical')], ['online', t('org.venue.online')]], 'physical'),
    venue: text('f-venue', '', { maxlength: '120', required: 'required' }),
    address: text('f-address', '', { maxlength: '160' }),

    brand: select('f-brand', BOARD_TYPES.map((entry) => [entry.id, entry.label]), 'kilter-original'),
    model: select('f-board', [], ''),
    layoutId: el('input', { attrs: { type: 'hidden', id: 'f-layout' } }),
    size: select('f-size', [], ''),
    angle: select('f-angle', [], ''),

    climbSource: select('f-climb-source', [
      ['organizer_set', t('org.mode.organizer_set')],
      ['participant_choice', t('org.mode.participant_choice')],
    ], 'organizer_set'),
    climbCount: num('f-climbs', 4, { min: '1', max: '40' }),
    uniqueness: select('f-uniqueness', [
      ['none', t('org.mode.none')],
      ['unique_per_competition', t('org.mode.unique_per_competition')],
    ], 'unique_per_competition'),
    progression: select('f-progression', [
      ['synchronous_rounds', t('org.mode.synchronous_rounds')],
      ['asynchronous_turns', t('org.mode.asynchronous_turns')],
    ], 'synchronous_rounds'),
    attempts: num('f-attempts', 3, { min: '1', max: '20' }),
    scoring: select('f-scoring', [
      ['tops_then_attempts', t('org.mode.tops_then_attempts')],
      ['achievement_points', t('org.mode.achievement_points')],
      ['points_sum', t('org.mode.points_sum')],
      ['hardest_n', t('org.mode.hardest_n')],
    ], 'tops_then_attempts'),
    zonePoints: num('f-zone-points', 10, { min: '0', max: '10000' }),
    topPoints: num('f-top-points', 15, { min: '0', max: '10000' }),
    flashPoints: num('f-flash-points', 5, { min: '0', max: '10000' }),

    capacity: num('f-capacity', 20, { min: '0', max: '500' }),
    waitlist: el('input', { attrs: { type: 'checkbox', id: 'f-waitlist', checked: true } }),
    fee: num('f-fee', 0, { min: '0', max: '1000000', step: '1', inputmode: 'numeric' }),
    lnurl: text('f-lnurl', defaultLud16 || '', { maxlength: '120' }),

    turnDeadline: num('f-deadline', 120, { min: '30', max: '1800' }),
    deferBudget: num('f-defer-budget', 1, { min: '0', max: '5' }),
    deferConsecutive: num('f-defer-consecutive', 1, { min: '0', max: '5' }),
    deferSlots: num('f-defer-slots', 2, { min: '1', max: '10' }),
    minRest: num('f-rest', 0, { min: '0', max: '3600' }),
    lateEntry: el('input', { attrs: { type: 'checkbox', id: 'f-late-entry' } }),

    eligibility: area('f-eligibility'),
    waiver: area('f-waiver'),
    instructions: area('f-instructions'),
    spectator: area('f-spectator'),
    refund: area('f-refund'),
  };

  // ── divisions ──
  const divisionRows = [{ label: t('org.division.open') }];
  const divisionId = (label, index) => {
    const slug = String(label || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
    return `${slug || 'division'}_${index + 1}`.slice(0, 24);
  };
  const divisionsNode = el('div', { className: 'stack' });
  const renderDivisions = () => {
    replace(divisionsNode, ...divisionRows.map((division, index) => {
      const labelInput = text(`div-label-${index}`, division.label, { maxlength: '48', required: 'required' });
      labelInput.addEventListener('input', () => { division.label = labelInput.value; });
      return el('div', { className: 'compact-editor-row' }, [
        el('div', { className: 'row between' }, [
          el('strong', { text: t('org.division.number', { n: index + 1 }) }),
          divisionRows.length > 1
            ? el('button', {
              className: 'quiet danger',
              text: t('action.remove'),
              on: { click: () => { divisionRows.splice(index, 1); renderDivisions(); } },
            })
            : null,
        ]),
        field(labelInput.id, t('org.division.label'), labelInput),
      ]);
    }));
  };
  renderDivisions();

  // ── prizes ──
  const prizeRows = [];
  const prizesNode = el('div', { className: 'stack' });
  const renderPrizes = () => {
    replace(prizesNode, ...prizeRows.map((prize, index) => {
      const rankInput = num(`prize-rank-${index}`, prize.rank, { min: '1', max: '50' });
      const kindInput = select(`prize-kind-${index}`, [
        ['non_cash', t('org.prize.goods')], ['cash', t('org.prize.cash')],
      ], prize.kind);
      const labelInput = text(`prize-label-${index}`, prize.label, { maxlength: '80' });
      const valueInput = num(`prize-value-${index}`, prize.value_sats || 0, { min: '0', step: '1' });
      rankInput.addEventListener('input', () => { prize.rank = Number(rankInput.value); });
      kindInput.addEventListener('change', () => { prize.kind = kindInput.value; renderPrizes(); });
      labelInput.addEventListener('input', () => { prize.label = labelInput.value; });
      valueInput.addEventListener('input', () => { prize.value_sats = Number(valueInput.value); });
      return el('div', { className: 'card raised' }, [
        el('div', { className: 'row between' }, [
          el('strong', { text: t('org.prize.rank', { n: prize.rank }) }),
          el('button', {
            className: 'quiet danger',
            text: t('action.remove'),
            on: { click: () => { prizeRows.splice(index, 1); renderPrizes(); } },
          }),
        ]),
        field(rankInput.id, t('org.prize.place'), rankInput),
        field(kindInput.id, t('org.prize.kind'), kindInput),
        field(labelInput.id, t('org.prize.description'), labelInput),
        prize.kind === 'cash'
          ? field(valueInput.id, t('org.prize.value'), valueInput, t('org.prize.value.hint'))
          : null,
      ]);
    }));
  };

  // ── climbs ──
  const replaceSelectOptions = (node, options, preferred) => {
    replace(node, ...options.map(([value, label]) => el('option', {
      attrs: { value, selected: value === preferred }, text: label,
    })));
    node.value = options.some(([value]) => value === preferred) ? preferred : (options[0]?.[0] || '');
  };
  const boardPickerNode = el('div', { className: 'board-picker' });
  let onBoardChange = () => {};
  const selectedModel = () => boardType(f.brand.value)?.models.find((entry) => entry.value === f.model.value);
  const syncBoardDetails = ({ resetModel = false, resetSize = false } = {}) => {
    const type = boardType(f.brand.value) || BOARD_TYPES[0];
    const oldModel = resetModel ? '' : f.model.value;
    replaceSelectOptions(f.model, type.models.map((entry) => [entry.value, entry.label]), oldModel);
    const model = selectedModel() || type.models[0];
    const oldSize = resetSize ? '' : f.size.value;
    replaceSelectOptions(f.size, model.sizes.map((entry) => [entry.value, entry.label]),
      oldSize || model.defaultSize || model.sizes[0]?.value);
    replaceSelectOptions(f.angle, model.angles.map((angle) => [String(angle), `${angle}°`]),
      String(model.defaultAngle ?? model.angles[0]));
    f.layoutId.value = String(model.layoutId);
    f.model.disabled = type.models.length === 1;
    f.size.disabled = model.sizes.length === 1;
    f.angle.disabled = model.angles.length === 1;
  };
  const choiceTier = (title, choices, selected, onSelect) => el('div', { className: 'board-tier' }, [
    el('div', { className: 'small board-step', text: title }),
    el('div', { className: 'board-choices', attrs: { role: 'group', 'aria-label': title } },
      choices.map((choice) => el('button', {
        className: `board-choice${choice.value === selected ? ' selected' : ''}`,
        text: choice.label,
        attrs: { type: 'button', 'aria-pressed': String(choice.value === selected) },
        on: { click: () => onSelect(choice.value) },
      }))),
  ]);
  const renderBoardPicker = () => {
    const type = boardType(f.brand.value) || BOARD_TYPES[0];
    const model = selectedModel();
    if (!model) {
      replace(boardPickerNode,
        field('f-brand', `1. ${t('org.board.step.type')}`, f.brand, t('org.board.step.type.hint')),
        choiceTier(`2. ${t('org.board.step.variant')}`, type.models, '', (value) => {
          f.model.value = value;
          syncBoardDetails({ resetSize: true });
          const chosen = selectedModel();
          if (chosen?.sizes.length > 1) replaceSelectOptions(f.size, [
            ['', t('org.board.choose_size')], ...chosen.sizes.map((entry) => [entry.value, entry.label]),
          ], '');
          if (chosen?.angles.length > 1) replaceSelectOptions(f.angle, [
            ['', t('org.board.choose_angle')], ...chosen.angles.map((angle) => [String(angle), `${angle}°`]),
          ], '');
          renderBoardPicker();
          onBoardChange();
        }),
        el('p', { className: 'board-selection-summary', text: t('org.board.choose_variant') }),
        el('div', { attrs: { hidden: 'hidden' } }, [f.model, f.size, f.layoutId]),
      );
      return;
    }
    const size = model.sizes.find((entry) => entry.value === f.size.value) || null;
    const tiers = [];
    let step = 2;
    if (type.models.length > 1) {
      tiers.push(choiceTier(`${step++}. ${t('org.board.step.variant')}`, type.models, model.value, (value) => {
        f.model.value = value;
        syncBoardDetails({ resetSize: true });
        renderBoardPicker();
        onBoardChange();
      }));
    }
    if (model.sizes.length > 1) {
      tiers.push(choiceTier(`${step++}. ${t('org.board.step.size')}`, model.sizes, size?.value, (value) => {
        f.size.value = value;
        renderBoardPicker();
        onBoardChange();
      }));
    }
    replace(boardPickerNode,
      el('div', { className: 'board-preview' }, [
        ...(size?.images || []).map((src, index) => el('img', {
          className: size.images.length > 1 ? 'board-preview-layer' : '',
          attrs: {
            src,
            alt: index === size.images.length - 1
              ? t('org.board.preview.alt', { board: model.label, size: size.label }) : '',
            'aria-hidden': index === size.images.length - 1 ? 'false' : 'true',
            loading: 'lazy', decoding: 'async',
          },
        })),
      ]),
      field('f-brand', `1. ${t('org.board.step.type')}`, f.brand, t('org.board.step.type.hint')),
      ...tiers,
      field('f-angle', `${step}. ${t('org.board.step.angle')}`, f.angle),
      el('p', {
        className: 'board-selection-summary',
        text: !size ? t('org.board.choose_size')
          : !f.angle.value ? t('org.board.choose_angle')
            : t('org.board.selected', { board: model.label, size: size.label, angle: f.angle.value }),
      }),
      // These values are protocol state, not concepts a person should have to
      // understand. They remain form controls for validation and tests, but are
      // never exposed in the picker UI.
      el('div', { attrs: { hidden: 'hidden' } }, [f.model, f.size, f.layoutId]),
    );
  };
  f.brand.addEventListener('change', () => {
    syncBoardDetails({ resetModel: true, resetSize: true });
    renderBoardPicker();
    onBoardChange();
  });
  f.model.addEventListener('change', () => {
    syncBoardDetails({ resetSize: true });
    renderBoardPicker();
    onBoardChange();
  });
  f.size.addEventListener('change', () => { renderBoardPicker(); onBoardChange(); });
  f.angle.addEventListener('change', () => { renderBoardPicker(); onBoardChange(); });
  syncBoardDetails({ resetModel: true, resetSize: true });
  renderBoardPicker();

  const boardOf = () => resolveBoardSelection(f.brand.value, f.model.value, f.size.value, f.angle.value);
  const catalogueBoardOf = () => resolveCatalogueSelection(
    f.brand.value, f.model.value, f.size.value, f.angle.value,
  );
  let browserGradeScale = storedGradeScale();
  const climbEditor = new ClimbEditor({
    t, pool, boardOf, gradeScaleOf: () => browserGradeScale, onChange: () => notifyDraftChange(),
  });
  const climbInput = text('f-climb-ref', '', { placeholder: t('climb.paste.placeholder'), autocomplete: 'off' });
  const climbSection = el('div', {});
  const browserResults = el('div', { className: 'climb-browser-results' });
  const browserStatus = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  const browserSearch = text('f-climb-search', '', {
    placeholder: t('climb.browser.search.placeholder'), autocomplete: 'off', type: 'search',
  });
  const difficultyMin = select('f-climb-min-grade', [], '');
  const difficultyMax = select('f-climb-max-grade', [], '');
  const minAscents = select('f-climb-min-ascents', [
    ['0', t('climb.filter.any_sends')], ['10', '10+'], ['100', '100+'], ['1000', '1,000+'],
  ], '0');
  const browserSort = select('f-climb-sort', [
    ['popular', t('climb.filter.popular')], ['quality', t('climb.filter.quality')],
    ['easiest', t('climb.filter.easiest')], ['hardest', t('climb.filter.hardest')],
  ], 'popular');
  const gradeScaleButtons = el('div', {
    className: 'segmented-control', attrs: { role: 'group', 'aria-label': t('climb.filter.grade_scale') },
  });
  const updateGradeControls = () => {
    const minValue = difficultyMin.value;
    const maxValue = difficultyMax.value;
    replaceSelectOptions(difficultyMin, [
      ['', t('climb.filter.any_grade')],
      ...gradeFilterOptions(browserGradeScale, 'min').map(({ value, label }) => [value, label]),
    ], minValue);
    replaceSelectOptions(difficultyMax, [
      ['', t('climb.filter.any_grade')],
      ...gradeFilterOptions(browserGradeScale, 'max').map(({ value, label }) => [value, label]),
    ], maxValue);
    replace(gradeScaleButtons, ...[
      ['v', t('climb.filter.grade_scale.v')], ['font', t('climb.filter.grade_scale.font')],
    ].map(([value, label]) => el('button', {
      className: browserGradeScale === value ? 'active' : '', text: label,
      attrs: { type: 'button', 'aria-pressed': String(browserGradeScale === value) },
      on: { click: () => {
        if (browserGradeScale === value) return;
        browserGradeScale = value;
        saveGradeScale(value);
        updateGradeControls();
        climbEditor.render();
        renderBrowserResults();
      } },
    })));
  };
  updateGradeControls();
  const browserSearchField = el('label', { attrs: { for: 'f-climb-search' } }, [
    el('span', { text: t('climb.browser.search') }),
    el('span', { className: 'hint', text: t('climb.browser.search.hint') }),
    browserSearch,
  ]);
  browserSearchField.setAttribute('hidden', 'hidden');
  let browserCandidates = [];
  let browserLoading = false;
  let browserState = 'idle';
  let browserLoadToken = 0;
  const catalogueActionStatus = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  const selectionLimit = () => f.climbSource.value === 'organizer_set' ? Number(f.climbCount.value) : 60;
  let addManualButton;
  let retryCatalogueButton;
  const refreshCatalogueActions = () => {
    const noBoard = !boardOf();
    const atLimit = climbEditor.rows.length >= selectionLimit();
    retryCatalogueButton.hidden = browserState !== 'error';
    retryCatalogueButton.disabled = noBoard || browserLoading || atLimit;
    addManualButton.disabled = noBoard || browserLoading || atLimit;
    catalogueActionStatus.textContent = noBoard ? t('climb.action.no_board')
      : browserLoading ? t('climb.action.loading')
        : atLimit ? t('climb.action.limit', { count: selectionLimit() }) : '';
  };

  onBoardChange = () => {
    browserLoadToken += 1;
    browserState = 'idle';
    browserLoading = false;
    browserCandidates = [];
    browserSearch.value = '';
    browserSearchField.setAttribute('hidden', 'hidden');
    replace(browserResults);
    browserStatus.textContent = t('climb.browser.board_changed');
    climbEditor.announceBoardChange();
    refreshCatalogueActions();
    void browseClimbs();
  };

  const renderBrowserResults = () => {
    const needle = browserSearch.value.trim().toLocaleLowerCase();
    const allMatches = filterCatalogue(browserCandidates, {
      query: needle, minDifficulty: difficultyMin.value, maxDifficulty: difficultyMax.value,
      minAscents: minAscents.value, sort: browserSort.value,
    });
    const matches = allMatches.slice(0, 60);
    browserStatus.textContent = allMatches.length
      ? t('climb.browser.found', { count: allMatches.length, shown: matches.length })
      : t('climb.browser.empty_filter');
    replace(browserResults, ...matches.map(({ event, described, compatibility, source }) => {
      const selected = climbEditor.rows.some((row) => row.uuid === normalizeUuid(described.uuid));
      const action = el('button', {
          className: selected ? '' : 'primary',
          text: selected ? t('climb.browser.added') : t('climb.browser.choose'),
          attrs: { disabled: selected ? 'disabled' : null },
          on: {
            click: () => {
              const added = source === 'community'
                ? climbEditor.addEvent(event) : climbEditor.addCatalogue(described);
              if (added) renderBrowserResults();
            },
          },
        });
      return climbCard({
        climb: described, board: boardOf(), t, selected, action, gradeScale: browserGradeScale,
      });
    }));
  };
  browserSearch.addEventListener('input', renderBrowserResults);
  for (const control of [difficultyMin, difficultyMax, minAscents, browserSort]) {
    control.addEventListener('input', renderBrowserResults);
    control.addEventListener('change', renderBrowserResults);
  }

  const browseClimbs = async () => {
    const board = boardOf();
    const catalogueBoard = catalogueBoardOf();
    if (!board || !catalogueBoard) {
      browserState = 'idle';
      browserLoading = false;
      refreshCatalogueActions();
      return;
    }
    const token = ++browserLoadToken;
    browserState = 'loading';
    browserLoading = true; refreshCatalogueActions();
    browserStatus.textContent = t('climb.browser.loading_catalogue');
    replace(browserResults);
    try {
      const { climbs } = await catalogueLoader(catalogueBoard);
      if (token !== browserLoadToken) return;
      const candidates = climbs.map((described) => ({
        described,
        compatibility: checkBoardCompatibility(described, board),
        source: 'catalogue',
      }));

      // Relay events supplement the daily Blossom snapshot, so a newly shared
      // community climb can appear before the next catalogue sync.
      if (pool) {
        browserStatus.textContent = t('climb.browser.loading_recent');
        const { events } = await pool.query([{ kinds: [30078], limit: 120 }], { timeoutMs: 7000 })
          .catch(() => ({ events: [] }));
        if (token !== browserLoadToken) return;
        for (const event of events) {
          // eslint-disable-next-line no-await-in-loop
          if (!await verifyEvent(event).catch(() => false)) continue;
          const described = describeClimbEvent(event);
          if (!isBrowsableClimbEvent(event, described, board)) continue;
          candidates.push({
            event, described, compatibility: checkBoardCompatibility(described, board), source: 'community',
          });
        }
      }
      browserCandidates = [...new Map(candidates.map(
        (candidate) => [candidate.described.uuid, candidate],
      )).values()].sort((a, b) => (b.described.ascents || 0) - (a.described.ascents || 0)
        || a.described.label.localeCompare(b.described.label));
      browserState = 'ready';
      if (browserCandidates.length) {
        browserSearchField.removeAttribute('hidden');
        renderBrowserResults();
      } else {
        browserSearchField.setAttribute('hidden', 'hidden');
        browserStatus.textContent = t('climb.browser.empty');
      }
    } catch {
      if (token !== browserLoadToken) return;
      browserState = 'error';
      browserStatus.textContent = t('climb.browser.error');
    } finally {
      if (token === browserLoadToken) {
        browserLoading = false;
        refreshCatalogueActions();
      }
    }
  };
  retryCatalogueButton = el('button', {
    className: 'button-wide', text: t('select.catalogue.retry'), attrs: { hidden: 'hidden' },
    on: { click: browseClimbs },
  });

  const renderClimbSection = () => {
    const participantChoice = f.climbSource.value === 'participant_choice';
    replace(climbSection,
      el('h3', { text: participantChoice ? t('climb.pool.title') : t('climb.list.title') }),
      el('p', { className: 'small', text: participantChoice ? t('climb.pool.hint') : t('climb.list.hint') }),
      el('div', { className: 'climb-browser card raised' }, [
        el('h3', { text: t('climb.browser.title') }),
        el('p', { className: 'small', text: t('climb.browser.hint') }),
        retryCatalogueButton,
        browserSearchField,
        el('div', { className: 'catalogue-toolbar' }, [
          el('span', { className: 'small', text: t('climb.filter.grade_scale') }), gradeScaleButtons,
          el('button', {
            className: 'quiet', text: t('climb.filter.reset'), attrs: { type: 'button' },
            on: { click: () => {
              browserSearch.value = '';
              difficultyMin.value = '';
              difficultyMax.value = '';
              minAscents.value = '0';
              browserSort.value = 'popular';
              renderBrowserResults();
            } },
          }),
        ]),
        el('div', { className: 'climb-filter-grid' }, [
          filterField(difficultyMin.id, t('climb.filter.min_grade'), difficultyMin),
          filterField(difficultyMax.id, t('climb.filter.max_grade'), difficultyMax),
          filterField(minAscents.id, t('climb.filter.min_ascents'), minAscents),
          filterField(browserSort.id, t('climb.filter.sort'), browserSort),
        ]),
        browserStatus,
        browserResults,
      ]),
      catalogueActionStatus,
      el('details', { className: 'disclosure' }, [
        el('summary', { text: t('climb.manual.title') }),
      el('p', { className: 'small', text: t('climb.how') }),
      field('f-climb-ref', t('climb.paste'), climbInput, t('climb.paste.hint')),
      (addManualButton = el('button', {
        text: t('climb.add'),
        on: {
          click: async () => {
            const ok = await climbEditor.add(climbInput.value);
            if (ok) climbInput.value = '';
          },
        },
      })),
      ]),
      climbEditor.status,
      climbEditor.node);
  };
  renderClimbSection();
  refreshCatalogueActions();
  void browseClimbs();
  f.climbSource.addEventListener('change', () => {
    renderClimbSection();
    refreshCatalogueActions();
    renderBrowserResults();
    renderModeNotes();
  });

  const modeNotes = el('div', {});
  const renderModeNotes = () => {
    const notes = [];
    if (f.climbSource.value === 'participant_choice') {
      notes.push(t('org.mode.note.participant_choice'));
      if (f.uniqueness.value === 'unique_per_competition') notes.push(t('org.mode.note.unique'));
    } else if (f.uniqueness.value === 'unique_per_competition') {
      notes.push(t('org.mode.note.unique_needs_choice'));
    }
    if (f.progression.value === 'asynchronous_turns') notes.push(t('org.mode.note.async'));
    if (['points_sum', 'hardest_n'].includes(f.scoring.value)
      && f.climbSource.value !== 'organizer_set') {
      notes.push(t('org.mode.note.points_needs_list'));
    }
    replace(modeNotes, ...notes.map((note) => el('p', { className: 'small', text: note })));
  };
  renderModeNotes();
  for (const control of [f.uniqueness, f.progression, f.scoring]) {
    control.addEventListener('change', renderModeNotes);
  }

  const build = () => {
    const participantChoice = f.climbSource.value === 'participant_choice';
    const { climbs, errors: climbErrors } = buildClimbList(climbEditor.entries());
    if (climbErrors.length) {
      throw new Error(climbErrors.map((e) => t(`climb.error.${e.error}`)).join(' '));
    }

    const board = boardOf();
    if (!board) throw new Error(t('org.board.invalid'));
    for (const row of climbEditor.rows) {
      const compatibility = row.described ? checkBoardCompatibility(row.described, board) : null;
      if (compatibility && !compatibility.compatible) {
        throw new Error(t('climb.error.incompatible', {
          problems: compatibility.problems.map((p) => t(`climb.problem.${p}`)).join(', '),
        }));
      }
    }
    const zoneRequired = f.scoring.value === 'tops_then_attempts'
      || (f.scoring.value === 'achievement_points' && Number(f.zonePoints.value) > 0);
    const missingZones = zoneRequired
      ? climbEditor.rows.filter((row) => !Number(row.zoneInput?.value)) : [];
    if (missingZones.length) {
      throw new Error(t('climb.zone.required_named', {
        climbs: missingZones.map((row) => row.labelInput.value.trim() || row.uuid.slice(0, 8)).join(', '),
      }));
    }
    const fee = Number(f.fee.value) * 1000;
    // Computed before the config literal so the prizes can name the divisions
    // they belong to; with one division a prize needs no division at all.
    const divisions = divisionRows.map((d, index) => ({
      id: divisionId(d.label, index),
      label: d.label.trim(),
    }));
    const multiDivision = divisions.length > 1;
    const config = {
      comp_id: newCompId(),
      authority: signerPubkey,
      authority_epoch: 1,
      title: f.title.value.trim(),
      summary: f.summary.value.trim(),
      description: f.description.value.trim(),
      organizer: { name: f.organizerName.value.trim(), contact: f.contact.value.trim() },
      visibility: f.visibility.value,
      status: 'draft',
      timezone: f.timezone.value.trim() || 'UTC',
      registration_opens_at: zonedLocalToEpoch(f.regOpens.value, f.timezone.value),
      registration_closes_at: zonedLocalToEpoch(f.regCloses.value, f.timezone.value),
      checkin_opens_at: zonedLocalToEpoch(f.checkinOpens.value, f.timezone.value),
      checkin_closes_at: zonedLocalToEpoch(f.checkinCloses.value, f.timezone.value),
      starts_at: zonedLocalToEpoch(f.starts.value, f.timezone.value),
      ends_at: zonedLocalToEpoch(f.ends.value, f.timezone.value),
      capacity: Number(f.capacity.value),
      waitlist_enabled: f.waitlist.checked,
      venue: f.venueKind.value === 'online'
        ? { kind: 'online', name: f.venue.value.trim() }
        : { kind: 'physical', name: f.venue.value.trim(), address: f.address.value.trim() },
      board,
      divisions: divisionRows.map((d, index) => ({ id: divisionId(d.label, index), label: d.label.trim() })),
      eligibility: f.eligibility.value.trim(),
      waiver: f.waiver.value.trim(),
      waiver_required: Boolean(f.waiver.value.trim()),
      participant_instructions: f.instructions.value.trim(),
      spectator_info: f.spectator.value.trim(),
      refund_policy: f.refund.value.trim(),
      fee_msat: fee,
      // A stable id per prize, because a claim names the prize it is for. Derived
      // from the slot it occupies, which is what actually identifies it: second
      // place in the open division stays second place in the open division
      // however the list is reordered.
      prizes: prizeRows.map((p) => ({
        id: prizeId(p, multiDivision),
        rank: p.rank,
        kind: p.kind === 'cash' ? 'cash' : 'non_cash',
        ...(p.kind === 'cash' ? { value_msat: (p.value_sats || 0) * 1000 } : {}),
        ...(multiDivision && p.division ? { division: p.division } : {}),
        label: p.label.trim(),
      })),
      rules: {
        climb_source: f.climbSource.value,
        climb_count: Number(f.climbCount.value),
        selection_uniqueness: participantChoice ? f.uniqueness.value : 'none',
        progression: f.progression.value,
        attempts_per_climb: Number(f.attempts.value),
        turn_deadline_sec: Number(f.turnDeadline.value),
        attempt_deadline_sec: 0,
        min_rest_sec: Number(f.minRest.value),
        defer_budget_per_round: Number(f.deferBudget.value),
        max_consecutive_defers: Number(f.deferConsecutive.value),
        defer_slots: Number(f.deferSlots.value),
        scoring: f.scoring.value,
        ...(f.scoring.value === 'achievement_points' ? {
          score_points: {
            zone: Number(f.zonePoints.value),
            top: Number(f.topPoints.value),
            flash: Number(f.flashPoints.value),
          },
        } : {}),
        tiebreaks: ['fewest_attempts', 'most_zones', 'earliest_finish', 'seed_order'],
        late_entry_allowed: f.lateEntry.checked,
      },
      relays,
      created_at: Math.floor(Date.now() / 1000),
      revision: 1,
    };
    if (fee > 0) config.fee_lnurl = f.lnurl.value.trim();
    if (participantChoice) {
      config.climb_pool = {
        source: 'organizer_list',
        options: climbs.map((climb) => ({
          id: climb.id,
          climb_uuid: climb.climb_uuid,
          angle: climb.angle,
          label: climb.label,
          points: climb.points,
          ...(climb.naddr ? { naddr: climb.naddr } : {}),
          ...(climb.zone_hold ? { zone_hold: climb.zone_hold } : {}),
        })),
      };
    } else {
      config.climbs = climbs;
    }
    return config;
  };

  const reviewNode = el('div', { className: 'review-grid' });
  const venueField = field('f-venue', t('org.field.venue'), f.venue);
  const addressField = field('f-address', t('org.field.address'), f.address);
  const venueStatus = el('p', {
    className: 'venue-suggestion-status hint',
    attrs: { id: 'venue-suggestion-status', role: 'status', 'aria-live': 'polite' },
    text: t('org.venue.suggest.hint'),
  });
  const venueSuggestions = el('div', {
    className: 'venue-suggestions',
    attrs: { id: 'venue-suggestions', role: 'listbox', hidden: 'hidden' },
  });
  const venuePicker = el('div', { className: 'venue-picker' }, [venueField, venueStatus, venueSuggestions]);
  for (const [name, value] of Object.entries({
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-controls': 'venue-suggestions',
    'aria-expanded': 'false', autocomplete: 'off', spellcheck: 'false',
  })) f.venue.setAttribute(name, value);

  let venueSearchToken = 0;
  let activeVenueOption = -1;
  let shownVenues = [];
  const closeVenueSuggestions = () => {
    activeVenueOption = -1;
    shownVenues = [];
    venueSuggestions.setAttribute('hidden', 'hidden');
    f.venue.setAttribute('aria-expanded', 'false');
    f.venue.removeAttribute('aria-activedescendant');
  };
  const venueBoardLabel = (id) => {
    if (id === 'kilter') return 'Kilter';
    if (id === 'soill') return 'So iLL';
    return BOARD_TYPES.find((entry) => entry.brand === id)?.label || id;
  };
  const selectVenueBoard = (choice) => {
    if (!choice) return;
    f.brand.value = choice.typeId;
    syncBoardDetails({ resetModel: true, resetSize: true });
    if (!choice.model) {
      f.model.value = '';
      f.size.value = '';
      f.angle.value = '';
      f.layoutId.value = '';
      renderBoardPicker();
      onBoardChange();
      return;
    }
    f.model.value = choice.model;
    syncBoardDetails({ resetSize: true });
    const model = selectedModel();
    if (choice.size == null && model?.sizes.length > 1) replaceSelectOptions(f.size, [
      ['', t('org.board.choose_size')], ...model.sizes.map((entry) => [entry.value, entry.label]),
    ], '');
    else f.size.value = choice.size || model?.sizes[0]?.value || '';
    if (choice.angle == null && model?.angles.length > 1) replaceSelectOptions(f.angle, [
      ['', t('org.board.choose_angle')], ...model.angles.map((angle) => [String(angle), `${angle}°`]),
    ], '');
    else f.angle.value = String(choice.angle ?? model?.angles[0] ?? '');
    f.layoutId.value = String(selectedModel()?.layoutId || '');
    renderBoardPicker();
    onBoardChange();
  };
  const chooseVenue = ({ venue, board = null }) => {
    f.venue.value = venue.name;
    const address = board?.address || venue.address;
    // Selecting another mapped venue must never leave the previous venue's
    // address behind. An empty field truthfully means the map has none.
    f.address.value = address || '';
    selectVenueBoard(board);
    venueStatus.textContent = board
      ? t(board.exact ? 'org.venue.suggest.selected_board' : 'org.venue.suggest.selected_board_check', {
        name: venue.name, board: board.label,
      })
      : t('org.venue.suggest.selected', { name: venue.name });
    closeVenueSuggestions();
    notifyDraftChange();
  };
  const highlightVenueOption = (index) => {
    const options = venueSuggestions.querySelectorAll('.venue-suggestion');
    if (!options.length) return;
    activeVenueOption = (index + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      option.className = `venue-suggestion${optionIndex === activeVenueOption ? ' active' : ''}`;
      option.setAttribute('aria-selected', String(optionIndex === activeVenueOption));
    });
    f.venue.setAttribute('aria-activedescendant', options[activeVenueOption].id);
  };
  const renderVenueSuggestions = (venues) => {
    shownVenues = venues.flatMap((venue) => {
      const boards = venueBoardChoices(venue);
      return boards.length ? boards.map((board) => ({ venue, board })) : [{ venue, board: null }];
    });
    activeVenueOption = -1;
    replace(venueSuggestions, ...shownVenues.map(({ venue, board }, index) => el('button', {
      className: 'venue-suggestion',
      attrs: { type: 'button', id: `venue-suggestion-${index}`, role: 'option', 'aria-selected': 'false' },
      on: {
        pointerdown: (event) => event.preventDefault(),
        click: () => chooseVenue({ venue, board }),
      },
    }, [
      el('strong', { text: venue.name }),
      el('span', {
        text: [venue.city, venue.country, board?.label
          || [...new Set(venue.boards.map((entry) => venueBoardLabel(entry.id)))].join(' · ')]
          .filter(Boolean).join(' · '),
      }),
    ])));
    if (shownVenues.length) {
      venueSuggestions.removeAttribute('hidden');
      f.venue.setAttribute('aria-expanded', 'true');
      venueStatus.textContent = t('org.venue.suggest.results', { count: venues.length });
    } else {
      closeVenueSuggestions();
      venueStatus.textContent = t('org.venue.suggest.none');
    }
  };
  const updateVenueSuggestions = async () => {
    const token = ++venueSearchToken;
    const query = f.venue.value.trim();
    if (f.venueKind.value !== 'physical' || query.length < 2) {
      closeVenueSuggestions();
      venueStatus.textContent = t('org.venue.suggest.hint');
      return;
    }
    venueStatus.textContent = t('org.venue.suggest.loading');
    try {
      const catalogue = await venueLoader();
      if (token !== venueSearchToken) return;
      renderVenueSuggestions(searchVenues(catalogue, query, boardType(f.brand.value)?.brand || ''));
    } catch {
      if (token !== venueSearchToken) return;
      closeVenueSuggestions();
      venueStatus.textContent = t('org.venue.suggest.unavailable');
    }
  };
  f.venue.addEventListener('input', updateVenueSuggestions);
  f.venue.addEventListener('keydown', (event) => {
    if (!shownVenues.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault(); highlightVenueOption(activeVenueOption + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); highlightVenueOption(activeVenueOption - 1);
    } else if (event.key === 'Enter' && activeVenueOption >= 0) {
      event.preventDefault(); chooseVenue(shownVenues[activeVenueOption]);
    } else if (event.key === 'Escape') {
      event.preventDefault(); closeVenueSuggestions();
    }
  });
  f.venue.addEventListener('blur', () => setTimeout(closeVenueSuggestions, 150));
  const syncVenueRequirement = () => {
    const required = f.venueKind.value === 'physical';
    setFieldRequirement(venueField, f.venue, required, t);
    if (required) addressField.removeAttribute('hidden');
    else {
      addressField.setAttribute('hidden', 'hidden');
      closeVenueSuggestions();
    }
  };
  f.venueKind.addEventListener('change', syncVenueRequirement);
  syncVenueRequirement();
  const uniquenessField = field(
    'f-uniqueness', t('org.field.uniqueness'), f.uniqueness, null, t('org.field.uniqueness.info'),
  );
  const scoringField = field(
    'f-scoring', t('org.field.scoring'), f.scoring, null, t('org.field.scoring.info'),
  );
  const scoringPreview = el('div', { className: 'scoring-preview', attrs: { role: 'status', 'aria-live': 'polite' } });
  const achievementFields = el('section', { className: 'subcard achievement-points', attrs: { hidden: 'hidden' } }, [
    el('h3', { text: t('org.scoring.achievement.title') }),
    el('p', { className: 'small', text: t('org.scoring.achievement.hint') }),
    el('div', { className: 'three-columns' }, [
      field('f-zone-points', t('org.field.zone_points'), f.zonePoints, null, t('org.field.zone_points.info')),
      field('f-top-points', t('org.field.top_points'), f.topPoints, null, t('org.field.top_points.info')),
      field('f-flash-points', t('org.field.flash_points'), f.flashPoints, null, t('org.field.flash_points.info')),
    ]),
    scoringPreview,
  ]);
  const renderScoringPreview = () => {
    const mode = f.scoring.value;
    if (mode === 'achievement_points') {
      achievementFields.removeAttribute('hidden');
      const zone = Number(f.zonePoints.value) || 0;
      const top = Number(f.topPoints.value) || 0;
      const flash = Number(f.flashPoints.value) || 0;
      scoringPreview.textContent = t('org.scoring.achievement.preview', {
        zone, top: zone + top, flash: zone + top + flash,
      });
    } else {
      achievementFields.setAttribute('hidden', 'hidden');
      scoringPreview.textContent = '';
    }
  };
  const syncFormatControls = () => {
    const participantChoice = f.climbSource.value === 'participant_choice';
    for (const option of f.scoring.querySelectorAll('option')) {
      if (['points_sum', 'hardest_n'].includes(option.value) && participantChoice) {
        option.setAttribute('disabled', 'disabled');
      } else {
        option.removeAttribute('disabled');
      }
    }
    if (participantChoice) {
      uniquenessField.removeAttribute('hidden');
      if (['points_sum', 'hardest_n'].includes(f.scoring.value)) f.scoring.value = 'tops_then_attempts';
    } else {
      uniquenessField.setAttribute('hidden', 'hidden');
    }
    scoringField.removeAttribute('hidden');
    renderScoringPreview();
    renderModeNotes();
  };
  f.climbSource.addEventListener('change', syncFormatControls);
  f.scoring.addEventListener('change', renderScoringPreview);
  for (const control of [f.zonePoints, f.topPoints, f.flashPoints]) {
    control.addEventListener('input', renderScoringPreview);
  }
  syncFormatControls();

  const lnurlField = field('f-lnurl', t('org.field.lnurl'), f.lnurl, t('org.field.lnurl.hint'));
  const syncFeeControls = () => {
    const paid = Number(f.fee.value) > 0;
    if (paid) {
      lnurlField.removeAttribute('hidden');
      setFieldRequirement(lnurlField, f.lnurl, true, t);
    } else {
      lnurlField.setAttribute('hidden', 'hidden');
      setFieldRequirement(lnurlField, f.lnurl, false, t);
    }
  };
  f.fee.addEventListener('input', syncFeeControls);
  syncFeeControls();

  const basicExtras = el('details', { className: 'disclosure' }, [
    el('summary', { text: t('org.basics.optional') }),
    field('f-summary', t('org.field.summary'), f.summary),
    field('f-description', t('org.field.description'), f.description),
    field('f-contact', t('org.field.contact'), f.contact, t('org.field.contact.hint')),
  ]);
  const advancedTiming = el('details', { className: 'disclosure' }, [
    el('summary', { text: t('org.advanced') }),
    el('p', { className: 'small', text: t('org.advanced.hint') }),
    field('f-deadline', t('org.field.turn_deadline'), f.turnDeadline),
    field('f-defer-budget', t('org.field.defer_budget'), f.deferBudget),
    field('f-defer-consecutive', t('org.field.defer_consecutive'), f.deferConsecutive),
    field('f-defer-slots', t('org.field.defer_slots'), f.deferSlots),
    field('f-rest', t('org.field.min_rest'), f.minRest),
  ]);
  const syncProgressionControls = () => {
    if (f.progression.value === 'asynchronous_turns') advancedTiming.removeAttribute('hidden');
    else advancedTiming.setAttribute('hidden', 'hidden');
  };
  f.progression.addEventListener('change', syncProgressionControls);
  syncProgressionControls();

  const syncTimeZoneOffsets = () => refreshTimeZonePicker(f.timezone, timeZoneReference(f.starts.value));
  f.starts.addEventListener('input', syncTimeZoneOffsets);
  f.starts.addEventListener('change', syncTimeZoneOffsets);
  syncTimeZoneOffsets();

  // Restore only known controls. The protocol-only layout id is always
  // derived again from the validated board catalogue.
  if (initialDraft && typeof initialDraft === 'object') {
    const values = initialDraft.fields && typeof initialDraft.fields === 'object' ? initialDraft.fields : {};
    const restoredTimeZone = ensureTimeZoneOption(
      f.timezone, values.timezone, timeZoneReference(values.starts),
    ) ? normalizedTimeZone(values.timezone) : null;
    for (const [name, control] of Object.entries(f)) {
      if (!(name in values) || name === 'layoutId' || ['brand', 'model', 'size', 'angle'].includes(name)) continue;
      if (control.getAttribute('type') === 'checkbox') control.checked = Boolean(values[name]);
      else if (name === 'timezone') control.value = restoredTimeZone || control.value;
      else control.value = String(values[name] ?? '');
    }
    if (typeof values.brand === 'string' && boardType(values.brand)) f.brand.value = values.brand;
    syncBoardDetails({ resetModel: true, resetSize: true });
    if ([...f.model.querySelectorAll('option')].some((option) => option.value === values.model)) f.model.value = values.model;
    syncBoardDetails({ resetSize: true });
    if ([...f.size.querySelectorAll('option')].some((option) => option.value === values.size)) f.size.value = values.size;
    if ([...f.angle.querySelectorAll('option')].some((option) => option.value === String(values.angle))) f.angle.value = String(values.angle);
    f.layoutId.value = String(selectedModel()?.layoutId || '');
    if (Array.isArray(initialDraft.divisions) && initialDraft.divisions.length) {
      divisionRows.splice(0, divisionRows.length, ...initialDraft.divisions.slice(0, 20).map(
        (label) => ({ label: String(label || '').slice(0, 48) }),
      ));
      renderDivisions();
    }
    if (Array.isArray(initialDraft.prizes)) {
      prizeRows.splice(0, prizeRows.length, ...initialDraft.prizes.slice(0, 50).map((prize, index) => ({
        rank: Number(prize?.rank) || index + 1,
        kind: prize?.kind === 'cash' ? 'cash' : 'non_cash',
        label: String(prize?.label || '').slice(0, 80),
        value_sats: Number(prize?.value_sats) || 0,
      })));
      renderPrizes();
    }
    climbEditor.restore(initialDraft.climbs);
    renderBoardPicker();
    syncVenueRequirement();
    syncFormatControls();
    syncFeeControls();
    syncProgressionControls();
    syncTimeZoneOffsets();
  }
  const steps = [
    el('fieldset', { className: 'wizard-panel' }, [
      el('legend', { text: t('org.basics') }),
      el('p', { className: 'wizard-intro', text: t('org.basics.intro') }),
      field('f-title', t('org.field.title'), f.title),
      field('f-org', t('org.field.organizer'), f.organizerName),
      field('f-visibility', t('org.field.visibility'), f.visibility, t('org.field.visibility.hint')),
      basicExtras,
    ]),

    el('fieldset', { className: 'wizard-panel' }, [
      el('legend', { text: t('org.when') }),
      el('p', { className: 'wizard-intro', text: t('org.when.intro') }),
      field('f-timezone', t('org.field.timezone'), f.timezone, t('org.field.timezone.hint'), t('org.field.timezone.info')),
      el('div', { className: 'schedule-grid' }, [
        el('section', { className: 'subcard' }, [
          el('h3', { text: t('org.schedule.registration') }),
          field('f-reg-open', t('org.field.reg_open'), f.regOpens),
          field('f-reg-close', t('org.field.reg_close'), f.regCloses),
        ]),
        el('section', { className: 'subcard' }, [
          el('h3', { text: t('org.schedule.checkin') }),
          field('f-checkin-open', t('org.field.checkin_open'), f.checkinOpens),
          field('f-checkin-close', t('org.field.checkin_close'), f.checkinCloses),
          el('label', { className: 'inline', attrs: { for: 'f-late-entry' } }, [
            f.lateEntry, el('span', {}, [
              el('span', { text: t('org.field.late_entry') }),
              el('span', { className: 'hint', text: t('org.field.late_entry.hint') }),
            ]),
          ]),
        ]),
        el('section', { className: 'subcard' }, [
          el('h3', { text: t('org.schedule.competition') }),
          field('f-start', t('org.field.starts'), f.starts),
          field('f-end', t('org.field.ends'), f.ends),
        ]),
      ]),
    ]),

    el('fieldset', { className: 'wizard-panel' }, [
      el('legend', { text: t('org.where') }),
      el('p', { className: 'wizard-intro', text: t('org.where.intro') }),
      field('f-venue-kind', t('org.field.venue_kind'), f.venueKind),
      venuePicker,
      addressField,
      el('h3', { text: t('org.board') }),
      el('p', { className: 'small', text: t('org.board.hint') }),
      boardPickerNode,
    ]),

    el('fieldset', { className: 'wizard-panel' }, [
      el('legend', { text: t('org.format') }),
      el('p', { className: 'wizard-intro', text: t('org.format.intro') }),
      field('f-climb-source', t('org.field.climb_source'), f.climbSource, null, t('org.field.climb_source.info')),
      field('f-climbs', t('org.field.climb_count'), f.climbCount, t('org.field.climb_count.hint'), t('org.field.climb_count.info')),
      uniquenessField,
      field('f-capacity', t('org.field.capacity'), f.capacity, t('org.field.capacity.hint'), t('org.field.capacity.info')),
      field('f-progression', t('org.field.progression'), f.progression, null, t('org.field.progression.info')),
      field('f-attempts', t('org.field.attempts'), f.attempts, null, t('org.field.attempts.info')),
      scoringField,
      achievementFields,
      modeNotes,
    ]),

    el('fieldset', { className: 'wizard-panel' }, [
      el('legend', {}, [el('span', { text: t('climb.section') }), el('span', { className: 'field-marker required', text: t('field.required') })]),
      climbSection,
    ]),

    el('fieldset', { className: 'wizard-panel' }, [
      el('legend', { text: t('org.entry') }),
      el('p', { className: 'wizard-intro', text: t('org.entry.intro') }),
      el('label', { className: 'inline', attrs: { for: 'f-waitlist' } }, [
        f.waitlist, el('span', { text: t('org.field.waitlist') }),
      ]),
      field('f-fee', t('org.field.fee'), f.fee, t('org.field.fee.hint')),
      lnurlField,
      // Said where the number is typed, not buried in terms. CruxCoach holds
      // none of this money and could not refund it if it wanted to.
      el('p', { className: 'notice small', text: t('money.no_custody') }),
      el('details', { className: 'disclosure' }, [
        el('summary', { text: t('org.divisions') }),
        el('p', { className: 'small', text: t('org.divisions.hint') }),
        divisionsNode,
        el('button', {
          text: t('org.divisions.add'),
          on: {
            click: () => {
              divisionRows.push({ label: '' });
              renderDivisions();
            },
          },
        }),
      ]),
      el('details', { className: 'disclosure' }, [
        el('summary', { text: t('org.prizes') }),
        el('p', { className: 'small', text: t('org.prizes.hint') }),
        // A prize is a promise. Entry fees are not set aside for it, and
        // saying so at the point of promising is the only honest place.
        el('p', { className: 'notice small', text: t('money.prize_not_funded') }),
        prizesNode,
        el('button', {
          text: t('org.prizes.add'),
          on: {
            click: () => {
              prizeRows.push({ rank: prizeRows.length + 1, kind: 'non_cash', label: '', value_sats: 0 });
              renderPrizes();
            },
          },
        }),
      ]),
    ]),

    el('fieldset', { className: 'wizard-panel' }, [
      el('legend', { text: t('org.optional.title') }),
      el('p', { className: 'small', text: t('org.optional.hint') }),
      el('details', { className: 'disclosure' }, [
      el('summary', { text: t('org.text') }),
      field('f-eligibility', t('org.field.eligibility'), f.eligibility),
      field('f-waiver', t('org.field.waiver'), f.waiver, t('org.field.waiver.hint')),
      field('f-instructions', t('org.field.instructions'), f.instructions),
      field('f-spectator', t('org.field.spectator'), f.spectator),
      field('f-refund', t('org.field.refund'), f.refund),
      ]),

      advancedTiming,
    ]),
    el('fieldset', { className: 'wizard-panel' }, [
      el('legend', { text: t('org.review.title') }),
      el('p', { className: 'small', text: t('org.review.hint') }),
      reviewNode,
    ]),
  ];

  const stepTitles = [
    t('org.basics'), t('org.when'), t('org.where'), t('org.format'),
    t('climb.section'), t('org.entry'), t('org.optional.title'), t('org.review.title'),
  ];
  let currentStep = Math.max(0, Math.min(
    Number.isInteger(initialStep) ? initialStep : (Number(initialDraft?.currentStep) || 0),
    steps.length - 1,
  ));
  let furthestStep = currentStep;
  const progress = el('ol', { className: 'wizard-progress', attrs: { 'aria-label': t('org.wizard.progress') } });
  const navigation = el('div', { className: 'wizard-navigation' });
  const reviewActions = el('div', { className: 'wizard-publish-actions' });
  const stepStatus = el('p', { className: 'wizard-step-status', attrs: { 'aria-live': 'polite' } });
  const stepError = el('p', { className: 'notice bad wizard-error', attrs: { role: 'alert', hidden: 'hidden' } });
  const nextButton = el('button', { className: 'primary', text: t('org.wizard.next') });
  const backButton = el('button', { text: t('org.wizard.back') });
  const climbReadiness = () => {
    if (currentStep !== 4) return null;
    const count = Number(f.climbCount.value);
    const unique = f.climbSource.value === 'participant_choice'
      && f.uniqueness.value === 'unique_per_competition';
    const needed = unique && Number(f.capacity.value) > 0 ? Number(f.capacity.value) * count : count;
    if (!boardOf()) return t('org.wizard.climb_board_error');
    if (climbEditor.rows.length < needed) return t('org.wizard.climbs_more', { count: needed - climbEditor.rows.length });
    if (f.climbSource.value === 'organizer_set' && climbEditor.rows.length > needed) {
      return t('org.wizard.climb_count_remove', { count: climbEditor.rows.length - needed });
    }
    const zoneRequired = f.scoring.value === 'tops_then_attempts'
      || (f.scoring.value === 'achievement_points' && Number(f.zonePoints.value) > 0);
    const missing = zoneRequired ? climbEditor.rows.filter((row) => !Number(row.zoneInput.value)) : [];
    if (missing.length) return t('climb.zone.required_named', {
      climbs: missing.map((row) => row.labelInput.value.trim() || row.uuid.slice(0, 8)).join(', '),
    });
    return '';
  };
  const refreshWizardReadiness = () => {
    const reason = climbReadiness();
    nextButton.disabled = Boolean(reason);
    if (reason !== null) stepStatus.textContent = reason || t('org.wizard.climbs_ready');
  };
  const showStep = (index, { recordHistory = true } = {}) => {
    const previousStep = currentStep;
    currentStep = Math.max(0, Math.min(index, steps.length - 1));
    furthestStep = Math.max(furthestStep, currentStep);
    stepError.setAttribute('hidden', 'hidden');
    stepError.textContent = '';
    node?.setAttribute('data-ready', String(currentStep === steps.length - 1));
    if (currentStep === steps.length - 1) {
      const board = boardOf();
      replace(reviewNode,
        reviewCard(0, t('org.basics'), f.title.value || t('org.review.missing'),
          `${f.organizerName.value} · ${t(`org.visibility.${f.visibility.value}`)}`),
        reviewCard(1, t('org.when'), `${f.starts.value} → ${f.ends.value} · ${timeZoneLabel(f.timezone.value, timeZoneReference(f.starts.value))}`,
          [
            t('org.review.registration_window', { start: f.regOpens.value, end: f.regCloses.value }),
            t('org.review.checkin_window', { start: f.checkinOpens.value, end: f.checkinCloses.value }),
            f.lateEntry.checked ? t('org.review.late_arrivals') : '',
          ].filter(Boolean).join(' · ')),
        reviewCard(2, t('org.board'), board
          ? `${boardType(f.brand.value)?.label || board.brand} · ${selectedModel()?.label || board.model}` : '—',
        `${board?.size || '—'} · ${board?.angle || '—'}° · ${f.venue.value || t(`org.venue.${f.venueKind.value}`)}`),
        reviewCard(3, t('org.format'), t(`org.mode.${f.climbSource.value}`),
          `${t(`org.mode.${f.progression.value}`)} · ${t(`org.mode.${f.scoring.value}`)}`),
        reviewCard(4, t('climb.section'), t('org.review.climbs', { count: climbEditor.rows.length }),
          climbEditor.rows.map((row) => row.labelInput.value.trim()).filter(Boolean).join(' · ')),
        reviewCard(5, t('org.entry'), t('org.review.capacity', { count: f.capacity.value }),
          Number(f.fee.value) > 0 ? `${f.fee.value} sats` : t('pay.not_required')),
        reviewCard(6, t('org.optional.title'), t('org.review.optional_value', {
          count: [f.eligibility, f.waiver, f.instructions, f.spectator, f.refund]
            .filter((input) => input.value.trim()).length,
        }), t('org.review.divisions', { count: divisionRows.length })),
      );
    }
    steps.forEach((panel, panelIndex) => {
      if (panelIndex === currentStep) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', 'hidden');
    });
    replace(progress, ...stepTitles.map((title, stepIndex) => el('li', {
      className: stepIndex === currentStep ? 'current' : (stepIndex <= furthestStep ? 'done' : ''),
      attrs: { 'aria-current': stepIndex === currentStep ? 'step' : 'false' },
    }, [el('button', {
      className: 'wizard-progress-button',
      text: `${stepIndex + 1}. ${title}`,
      attrs: { type: 'button', disabled: stepIndex > furthestStep ? 'disabled' : null },
      on: { click: () => { if (stepIndex <= furthestStep) showStep(stepIndex); } },
    })])));
    stepStatus.textContent = t('org.wizard.step', {
      current: currentStep + 1, total: steps.length, title: stepTitles[currentStep],
    });
    backButton.disabled = currentStep === 0;
    nextButton.textContent = currentStep === steps.length - 2 ? t('org.wizard.review') : t('org.wizard.next');
    refreshWizardReadiness();
    replace(navigation, backButton, currentStep < steps.length - 1 ? nextButton : null);
    notifyDraftChange();
    if (recordHistory && currentStep !== previousStep) onStepChange(currentStep);
    if (currentStep !== previousStep) {
      node?.scrollIntoView?.({
        behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth',
        block: 'start',
      });
    }
  };
  const reviewCard = (stepIndex, title, value, detail) => el('article', { className: 'review-card' }, [
    el('div', { className: 'row between' }, [
      el('h3', { text: title }),
      el('button', {
        className: 'quiet review-edit', text: t('org.review.change'),
        on: { click: () => showStep(stepIndex) },
      }),
    ]),
    el('strong', { text: value }),
    detail ? el('p', { className: 'small', text: detail }) : null,
  ]);
  backButton.addEventListener('click', () => {
    if (currentStep > 0 && onStepBack) onStepBack();
    else showStep(currentStep - 1);
  });
  const invalidControl = () => {
    const controls = [
      ...steps[currentStep].querySelectorAll('input'),
      ...steps[currentStep].querySelectorAll('select'),
      ...steps[currentStep].querySelectorAll('textarea'),
    ];
    return controls.find((control) => {
      if (control.getAttribute('hidden') !== null || control.disabled) return false;
      const value = String(control.value || '').trim();
      if (control.getAttribute('required') !== null && !value) return true;
      if (control.getAttribute('type') === 'number' && value) {
        const number = Number(value);
        const min = Number(control.getAttribute('min'));
        const max = Number(control.getAttribute('max'));
        if (!Number.isFinite(number)) return true;
        if (control.getAttribute('min') !== null && number < min) return true;
        if (control.getAttribute('max') !== null && number > max) return true;
      }
      return false;
    });
  };
  nextButton.addEventListener('click', () => {
    for (const control of [
      ...steps[currentStep].querySelectorAll('input'),
      ...steps[currentStep].querySelectorAll('select'),
      ...steps[currentStep].querySelectorAll('textarea'),
    ]) control.removeAttribute('aria-invalid');
    const invalid = invalidControl();
    if (invalid) {
      stepError.textContent = t('org.wizard.required_error');
      stepError.removeAttribute('hidden');
      invalid.setAttribute('aria-invalid', 'true');
      let ancestor = invalid.parentNode;
      while (ancestor && ancestor !== steps[currentStep]) {
        if (ancestor.tagName === 'DETAILS') ancestor.setAttribute('open', 'open');
        ancestor = ancestor.parentNode;
      }
      invalid.focus?.();
      return;
    }
    if (currentStep === 1) {
      const times = Object.fromEntries(Object.entries({
        regOpen: f.regOpens, regClose: f.regCloses,
        checkinOpen: f.checkinOpens, checkinClose: f.checkinCloses,
        start: f.starts, end: f.ends,
      }).map(([name, control]) => [name, zonedLocalToEpoch(control.value, f.timezone.value)]));
      const pairs = [
        ['regOpen', 'regClose'], ['checkinOpen', 'checkinClose'],
        ['regOpen', 'start'], ['checkinOpen', 'start'], ['start', 'end'],
        ['regClose', 'end'], ['checkinClose', 'end'],
      ];
      if (!f.lateEntry.checked) pairs.push(['regClose', 'start'], ['checkinClose', 'start']);
      if (Object.values(times).some((value) => !Number.isFinite(value))
        || pairs.some(([before, after]) => times[before] > times[after])) {
        stepError.textContent = t('org.wizard.time_error');
        stepError.removeAttribute('hidden');
        return;
      }
    }
    if (currentStep === 3 && f.climbSource.value === 'participant_choice'
      && f.uniqueness.value === 'unique_per_competition' && Number(f.capacity.value) === 0) {
      stepError.textContent = t('org.wizard.unique_capacity_error');
      stepError.removeAttribute('hidden');
      return;
    }
    if (currentStep === 4) {
      const count = Number(f.climbCount.value);
      const unique = f.climbSource.value === 'participant_choice'
        && f.uniqueness.value === 'unique_per_competition';
      const needed = unique && Number(f.capacity.value) > 0 ? Number(f.capacity.value) * count : count;
      if (needed > 60) {
        stepError.textContent = t('org.wizard.unique_pool_error', { count: needed });
        stepError.removeAttribute('hidden');
        return;
      }
      if (climbEditor.rows.length < needed) {
        stepError.textContent = t('org.wizard.climb_count_error', { count: needed });
        stepError.removeAttribute('hidden');
        return;
      }
      if (f.climbSource.value === 'organizer_set' && climbEditor.rows.length > needed) {
        stepError.textContent = t('org.wizard.climb_count_remove', { count: climbEditor.rows.length - needed });
        stepError.removeAttribute('hidden');
        return;
      }
    }
    if (currentStep === 4 && climbEditor.boardProblems().length) {
      stepError.textContent = t('org.wizard.climb_board_error');
      stepError.removeAttribute('hidden');
      return;
    }
    if (currentStep === 6
      && Number(f.deferConsecutive.value) > Number(f.deferBudget.value)) {
      stepError.textContent = t('org.wizard.defer_error');
      stepError.removeAttribute('hidden');
      return;
    }
    if (currentStep === steps.length - 2) {
      try {
        const validation = validateCompetitionConfig(build());
        if (!validation.ok) {
          stepError.textContent = t('org.wizard.config_error');
          stepError.removeAttribute('hidden');
          return;
        }
      } catch (error) {
        stepError.textContent = error.message || t('org.wizard.config_error');
        stepError.removeAttribute('hidden');
        return;
      }
    }
    showStep(currentStep + 1);
  });

  let node = el('section', { className: 'card competition-wizard', attrs: { 'data-ready': 'false' } }, [
    el('div', { className: 'wizard-heading' }, [
      el('div', {}, [el('h2', { text: t('org.create') }), stepStatus]),
      el('div', { className: 'row' }, [
        el('span', {
          className: 'badge',
          text: t(persistDraft ? 'org.wizard.autosave' : 'org.wizard.session_only'),
        }),
        initialDraft && onDraftDiscard ? el('button', {
          className: 'quiet', text: t('org.wizard.discard'),
          on: { click: () => { if (confirm(t('org.wizard.discard.confirm'))) onDraftDiscard(); } },
        }) : null,
      ]),
    ]),
    progress,
    stepError,
    ...steps,
    navigation,
    reviewActions,
  ]);
  const draftSnapshot = () => ({
    fields: Object.fromEntries(Object.entries(f).map(([name, control]) => [
      name,
      control.getAttribute('type') === 'checkbox' ? Boolean(control.checked) : control.value,
    ])),
    divisions: divisionRows.map((division) => division.label),
    prizes: prizeRows.map((prize) => ({ ...prize })),
    climbs: climbEditor.entries(),
    currentStep,
  });
  notifyDraftChange = () => { refreshWizardReadiness(); refreshCatalogueActions(); onDraftChange(draftSnapshot()); };
  node.addEventListener('input', notifyDraftChange);
  node.addEventListener('change', notifyDraftChange);
  node.addEventListener('click', () => queueMicrotask(notifyDraftChange));
  showStep(currentStep, { recordHistory: false });
  notifyDraftChange();

  // `climbs` is exposed so the climb list can be driven from outside the DOM —
  // by a test, and by the app-side handoff that adds a climb straight from the
  // board browser.
  return {
    node, build, climbs: climbEditor, reviewActions,
    validate: (config) => validateCompetitionConfig(config),
    showStep, get currentStep() { return currentStep; }, stepCount: steps.length,
  };
}
