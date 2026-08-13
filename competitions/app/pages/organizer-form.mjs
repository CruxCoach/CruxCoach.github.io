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
  BOARD_TYPES, boardType, resolveBoardSelection, resolveCatalogueSelection,
} from '../protocol/board-catalog.mjs';
import { loadCatalogueClimbs } from '../data/climb-catalogue.mjs';

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

const toEpoch = (value) => Math.floor(new Date(value).getTime() / 1000);

function defaultWhen(offsetHours) {
  const date = new Date(Date.now() + offsetHours * 3600 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function field(id, label, input, hint) {
  const required = input.getAttribute('required') !== null;
  const german = document.documentElement?.getAttribute?.('lang') === 'de';
  const marker = required ? (german ? 'Pflichtfeld' : 'Required') : (german ? 'Optional' : 'Optional');
  return el('label', { className: required ? 'field-required' : 'field-optional', attrs: { for: id } }, [
    el('span', {}, [
      el('span', { text: label }),
      el('span', {
        className: `field-marker ${required ? 'required' : 'optional'}`,
        text: marker,
      }),
    ]),
    hint ? el('span', { className: 'hint', text: hint }) : null,
    input,
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
  constructor({ t, pool, boardOf, onChange }) {
    this.t = t;
    this.pool = pool;
    this.boardOf = boardOf;
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
    }));
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
    return {
      uuid: ref.uuid,
      kind: ref.kind,
      naddr: ref.naddr,
      described,
      compatibility,
      labelInput,
      angleInput,
      pointsInput,
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
      el('div', { className: 'climb-fields' }, [
        field(row.labelInput.id, t('climb.label'), row.labelInput),
        field(row.angleInput.id, t('climb.angle'), row.angleInput),
        field(row.pointsInput.id, t('climb.points'), row.pointsInput, t('climb.points.hint')),
      ]),
    ]);
      }));
  }
}

/**
 * Build the whole create form.
 *
 * @returns {{node: HTMLElement, build: () => object}} `build` throws with a
 *   readable message when the form cannot make a valid competition.
 */
export function createCompetitionForm({
  t, pool, signerPubkey, defaultDisplayName, defaultLud16, relays,
  catalogueLoader = loadCatalogueClimbs,
}) {
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
    timezone: text('f-timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', { maxlength: '64', required: 'required' }),

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
    ], 'none'),
    progression: select('f-progression', [
      ['synchronous_rounds', t('org.mode.synchronous_rounds')],
      ['asynchronous_turns', t('org.mode.asynchronous_turns')],
    ], 'synchronous_rounds'),
    attempts: num('f-attempts', 3, { min: '1', max: '20' }),
    scoring: select('f-scoring', [
      ['tops_then_attempts', t('org.mode.tops_then_attempts')],
      ['points_sum', t('org.mode.points_sum')],
      ['hardest_n', t('org.mode.hardest_n')],
    ], 'tops_then_attempts'),

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
    const model = selectedModel() || type.models[0];
    const size = model.sizes.find((entry) => entry.value === f.size.value) || model.sizes[0];
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
        text: t('org.board.selected', {
          board: model.label,
          size: size?.label || '',
          angle: f.angle.value,
        }),
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
  const climbEditor = new ClimbEditor({ t, pool, boardOf });
  const climbInput = text('f-climb-ref', '', { placeholder: t('climb.paste.placeholder'), autocomplete: 'off' });
  const climbSection = el('div', {});
  const browserResults = el('div', { className: 'climb-browser-results' });
  const browserStatus = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
  const browserSearch = text('f-climb-search', '', {
    placeholder: t('climb.browser.search.placeholder'), autocomplete: 'off', type: 'search',
  });
  const browserSearchField = el('label', { attrs: { for: 'f-climb-search' } }, [
    el('span', { text: t('climb.browser.search') }),
    el('span', { className: 'hint', text: t('climb.browser.search.hint') }),
    browserSearch,
  ]);
  browserSearchField.setAttribute('hidden', 'hidden');
  let browserCandidates = [];

  onBoardChange = () => {
    browserCandidates = [];
    browserSearch.value = '';
    browserSearchField.setAttribute('hidden', 'hidden');
    replace(browserResults);
    browserStatus.textContent = t('climb.browser.board_changed');
    climbEditor.announceBoardChange();
  };

  const renderBrowserResults = () => {
    const needle = browserSearch.value.trim().toLocaleLowerCase();
    const allMatches = browserCandidates.filter(({ described }) => !needle
      || described.label.toLocaleLowerCase().includes(needle)
      || described.setter?.toLocaleLowerCase().includes(needle));
    const matches = allMatches.slice(0, 60);
    browserStatus.textContent = allMatches.length
      ? t('climb.browser.found', { count: allMatches.length, shown: matches.length })
      : t('climb.browser.empty_filter');
    replace(browserResults, ...matches.map(({ event, described, compatibility, source }) => {
      const selected = climbEditor.rows.some((row) => row.uuid === normalizeUuid(described.uuid));
      return el('article', { className: `climb-result-card${selected ? ' selected' : ''}` }, [
        el('div', {}, [
          el('strong', { text: described.label }),
          el('p', { className: 'small', text: t('climb.browser.meta', {
            angle: Number.isFinite(described.angle) ? described.angle : boardOf().angle,
            board: described.boardLabel || boardOf().model,
          }) }),
          compatibility.warnings.length
            ? el('p', { className: 'small', text: t('climb.warning', {
              warnings: compatibility.warnings.map((warning) => t(`climb.problem.${warning}`)).join(', '),
            }) }) : null,
        ]),
        el('button', {
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
        }),
      ]);
    }));
  };
  browserSearch.addEventListener('input', renderBrowserResults);

  const browseClimbs = async () => {
    browserStatus.textContent = t('climb.browser.loading_catalogue');
    replace(browserResults);
    try {
      const board = boardOf();
      const catalogueBoard = catalogueBoardOf();
      const { climbs } = await catalogueLoader(catalogueBoard);
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
      if (browserCandidates.length) {
        browserSearchField.removeAttribute('hidden');
        renderBrowserResults();
      } else {
        browserSearchField.setAttribute('hidden', 'hidden');
        browserStatus.textContent = t('climb.browser.empty');
      }
    } catch {
      browserStatus.textContent = t('climb.browser.error');
    }
  };
  const browseClimbsButton = el('button', {
    className: 'button-wide', text: t('climb.browser.open'), on: { click: browseClimbs },
  });

  const renderClimbSection = () => {
    const participantChoice = f.climbSource.value === 'participant_choice';
    replace(climbSection,
      el('h3', { text: participantChoice ? t('climb.pool.title') : t('climb.list.title') }),
      el('p', { className: 'small', text: participantChoice ? t('climb.pool.hint') : t('climb.list.hint') }),
      el('div', { className: 'climb-browser card raised' }, [
        el('h3', { text: t('climb.browser.title') }),
        el('p', { className: 'small', text: t('climb.browser.hint') }),
        browseClimbsButton,
        browserSearchField,
        browserStatus,
        browserResults,
      ]),
      el('details', { className: 'disclosure' }, [
        el('summary', { text: t('climb.manual.title') }),
      el('p', { className: 'small', text: t('climb.how') }),
      field('f-climb-ref', t('climb.paste'), climbInput, t('climb.paste.hint')),
      el('button', {
        text: t('climb.add'),
        on: {
          click: async () => {
            const ok = await climbEditor.add(climbInput.value);
            if (ok) climbInput.value = '';
          },
        },
      }),
      ]),
      climbEditor.status,
      climbEditor.node);
  };
  renderClimbSection();
  f.climbSource.addEventListener('change', () => { renderClimbSection(); renderModeNotes(); });

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
    if (f.scoring.value !== 'tops_then_attempts' && f.climbSource.value !== 'organizer_set') {
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
    const fee = Number(f.fee.value) * 1000;
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
      registration_opens_at: toEpoch(f.regOpens.value),
      registration_closes_at: toEpoch(f.regCloses.value),
      checkin_opens_at: toEpoch(f.checkinOpens.value),
      checkin_closes_at: toEpoch(f.checkinCloses.value),
      starts_at: toEpoch(f.starts.value),
      ends_at: toEpoch(f.ends.value),
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
      prizes: prizeRows.map((p) => (p.kind === 'cash'
        ? { rank: p.rank, kind: 'cash', value_msat: (p.value_sats || 0) * 1000, label: p.label.trim() }
        : { rank: p.rank, kind: 'non_cash', label: p.label.trim() })),
      rules: {
        climb_source: f.climbSource.value,
        climb_count: Number(f.climbCount.value),
        selection_uniqueness: f.uniqueness.value,
        progression: f.progression.value,
        attempts_per_climb: Number(f.attempts.value),
        turn_deadline_sec: Number(f.turnDeadline.value),
        attempt_deadline_sec: 0,
        min_rest_sec: Number(f.minRest.value),
        defer_budget_per_round: Number(f.deferBudget.value),
        max_consecutive_defers: Number(f.deferConsecutive.value),
        defer_slots: Number(f.deferSlots.value),
        scoring: f.scoring.value,
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
  const syncVenueRequirement = () => {
    const required = f.venueKind.value === 'physical';
    setFieldRequirement(venueField, f.venue, required, t);
    if (required) addressField.removeAttribute('hidden');
    else addressField.setAttribute('hidden', 'hidden');
  };
  f.venueKind.addEventListener('change', syncVenueRequirement);
  syncVenueRequirement();
  const uniquenessField = field('f-uniqueness', t('org.field.uniqueness'), f.uniqueness);
  const scoringField = field('f-scoring', t('org.field.scoring'), f.scoring);
  const syncFormatControls = () => {
    const participantChoice = f.climbSource.value === 'participant_choice';
    if (participantChoice) {
      uniquenessField.removeAttribute('hidden');
      f.scoring.value = 'tops_then_attempts';
      scoringField.setAttribute('hidden', 'hidden');
    } else {
      f.uniqueness.value = 'none';
      uniquenessField.setAttribute('hidden', 'hidden');
      scoringField.removeAttribute('hidden');
    }
    renderModeNotes();
  };
  f.climbSource.addEventListener('change', syncFormatControls);
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
      field('f-timezone', t('org.field.timezone'), f.timezone),
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
      venueField,
      addressField,
      el('h3', { text: t('org.board') }),
      el('p', { className: 'small', text: t('org.board.hint') }),
      boardPickerNode,
    ]),

    el('fieldset', { className: 'wizard-panel' }, [
      el('legend', { text: t('org.format') }),
      el('p', { className: 'wizard-intro', text: t('org.format.intro') }),
      field('f-climb-source', t('org.field.climb_source'), f.climbSource),
      field('f-climbs', t('org.field.climb_count'), f.climbCount, t('org.field.climb_count.hint')),
      uniquenessField,
      field('f-capacity', t('org.field.capacity'), f.capacity, t('org.field.capacity.hint')),
      field('f-progression', t('org.field.progression'), f.progression),
      field('f-attempts', t('org.field.attempts'), f.attempts),
      scoringField,
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
      el('label', { className: 'inline', attrs: { for: 'f-late-entry' } }, [
        f.lateEntry, el('span', { text: t('org.field.late_entry') }),
      ]),
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
  let currentStep = 0;
  let furthestStep = 0;
  const progress = el('ol', { className: 'wizard-progress', attrs: { 'aria-label': t('org.wizard.progress') } });
  const navigation = el('div', { className: 'wizard-navigation' });
  const reviewActions = el('div', { className: 'wizard-publish-actions' });
  const stepStatus = el('p', { className: 'wizard-step-status', attrs: { 'aria-live': 'polite' } });
  const stepError = el('p', { className: 'notice bad wizard-error', attrs: { role: 'alert', hidden: 'hidden' } });
  const nextButton = el('button', { className: 'primary', text: t('org.wizard.next') });
  const backButton = el('button', { text: t('org.wizard.back') });
  const showStep = (index) => {
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
        reviewCard(1, t('org.when'), `${f.starts.value} → ${f.ends.value}`,
          t('org.review.registration_window', { start: f.regOpens.value, end: f.regCloses.value })),
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
    replace(navigation, backButton, currentStep < steps.length - 1 ? nextButton : null);
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
  backButton.addEventListener('click', () => showStep(currentStep - 1));
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
      const ordered = [f.regOpens, f.regCloses, f.checkinOpens, f.checkinCloses, f.starts, f.ends]
        .map((control) => toEpoch(control.value));
      if (ordered.some((value) => !Number.isFinite(value))
        || ordered.some((value, index) => index > 0 && value < ordered[index - 1])) {
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
      el('span', { className: 'badge', text: t('org.wizard.autosave') }),
    ]),
    progress,
    stepError,
    ...steps,
    navigation,
    reviewActions,
  ]);
  showStep(0);

  // `climbs` is exposed so the climb list can be driven from outside the DOM —
  // by a test, and by the app-side handoff that adds a climb straight from the
  // board browser.
  return {
    node, build, climbs: climbEditor, reviewActions,
    validate: (config) => validateCompetitionConfig(config),
    showStep, get currentStep() { return currentStep; }, stepCount: steps.length,
  };
}
