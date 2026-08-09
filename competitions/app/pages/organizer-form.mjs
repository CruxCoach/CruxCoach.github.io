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
  buildClimbList, checkBoardCompatibility, climbEventFilter, describeClimbEvent, parseClimbRef,
} from '../protocol/climb-ref.mjs';
import { newCompId, validateCompetitionConfig } from '../protocol/competition.mjs';
import { verifyEvent } from '../protocol/nostr-event.mjs';

const text = (id, value = '', attrs = {}) => el('input', { attrs: { type: 'text', id, value, ...attrs } });
const num = (id, value, attrs = {}) => el('input', { attrs: { type: 'number', id, value: String(value), ...attrs } });
const when = (id, value) => el('input', { attrs: { type: 'datetime-local', id, value } });
const area = (id, value = '', max = 2000) => {
  const node = el('textarea', { attrs: { id, maxlength: String(max) } });
  node.value = value;
  return node;
};
const select = (id, options, value) => el(
  'select',
  { attrs: { id } },
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
  return el('label', { attrs: { for: id } }, [
    el('span', { text: label }),
    hint ? el('span', { className: 'hint', text: hint }) : null,
    input,
  ]);
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
    replace(this.node, ...this.rows.map((row, index) => el('div', { className: 'card raised' }, [
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
      el('p', { className: 'small mono selectable', text: row.uuid }),
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
      field(row.labelInput.id, t('climb.label'), row.labelInput),
      field(row.angleInput.id, t('climb.angle'), row.angleInput),
      field(row.pointsInput.id, t('climb.points'), row.pointsInput, t('climb.points.hint')),
    ])));
  }
}

/**
 * Build the whole create form.
 *
 * @returns {{node: HTMLElement, build: () => object}} `build` throws with a
 *   readable message when the form cannot make a valid competition.
 */
export function createCompetitionForm({ t, pool, signerPubkey, defaultDisplayName, defaultLud16, relays }) {
  const f = {
    title: text('f-title', '', { maxlength: '120', required: 'required' }),
    summary: text('f-summary', '', { maxlength: '140' }),
    description: area('f-description', '', 4000),
    organizerName: text('f-org', defaultDisplayName || '', { maxlength: '80' }),
    contact: text('f-contact', '', { maxlength: '120' }),
    visibility: select('f-visibility', [['public', t('org.visibility.public')], ['unlisted', t('org.visibility.unlisted')]], 'public'),

    regOpens: when('f-reg-open', defaultWhen(1)),
    regCloses: when('f-reg-close', defaultWhen(24)),
    checkinOpens: when('f-checkin-open', defaultWhen(25)),
    checkinCloses: when('f-checkin-close', defaultWhen(26)),
    starts: when('f-start', defaultWhen(26)),
    ends: when('f-end', defaultWhen(29)),
    timezone: text('f-timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', { maxlength: '64' }),

    venueKind: select('f-venue-kind', [['physical', t('org.venue.physical')], ['online', t('org.venue.online')]], 'physical'),
    venue: text('f-venue', '', { maxlength: '120' }),
    address: text('f-address', '', { maxlength: '160' }),

    brand: select('f-brand', [
      ['kilter', 'Kilter'], ['moonboard', 'MoonBoard'], ['tension', 'Tension'],
      ['grasshopper', 'Grasshopper'], ['decoy', 'Decoy'], ['soill', 'So iLL'], ['touchstone', 'Touchstone'],
    ], 'kilter'),
    model: text('f-board', 'kilterboard-og', { maxlength: '40' }),
    layoutId: num('f-layout', 1, { min: '0', max: '9999' }),
    size: text('f-size', '12x12', { maxlength: '20' }),
    angle: num('f-angle', 40, { min: '0', max: '70' }),

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
    fee: num('f-fee', 0, { min: '0', max: '1000000000' }),
    lnurl: text('f-lnurl', defaultLud16 || '', { maxlength: '120' }),

    turnDeadline: num('f-deadline', 120, { min: '30', max: '1800' }),
    deferBudget: num('f-defer-budget', 1, { min: '0', max: '5' }),
    deferConsecutive: num('f-defer-consecutive', 1, { min: '0', max: '5' }),
    deferSlots: num('f-defer-slots', 2, { min: '1', max: '10' }),
    minRest: num('f-rest', 0, { min: '0', max: '3600' }),
    lateEntry: el('input', { attrs: { type: 'checkbox', id: 'f-late-entry' } }),

    eligibility: area('f-eligibility'),
    waiver: area('f-waiver', 'I understand that climbing is dangerous and I take part at my own risk.'),
    instructions: area('f-instructions'),
    spectator: area('f-spectator'),
    refund: area('f-refund'),
  };

  // ── divisions ──
  const divisionRows = [{ id: 'open', label: 'Open' }];
  const divisionsNode = el('div', { className: 'stack' });
  const renderDivisions = () => {
    replace(divisionsNode, ...divisionRows.map((division, index) => {
      const idInput = text(`div-id-${index}`, division.id, { maxlength: '24' });
      const labelInput = text(`div-label-${index}`, division.label, { maxlength: '48' });
      idInput.addEventListener('input', () => { division.id = idInput.value.trim().toLowerCase(); });
      labelInput.addEventListener('input', () => { division.label = labelInput.value; });
      return el('div', { className: 'card raised' }, [
        el('div', { className: 'row between' }, [
          el('strong', { text: `${index + 1}` }),
          divisionRows.length > 1
            ? el('button', {
              className: 'quiet danger',
              text: t('action.remove'),
              on: { click: () => { divisionRows.splice(index, 1); renderDivisions(); } },
            })
            : null,
        ]),
        field(idInput.id, t('org.division.id'), idInput, t('org.division.id.hint')),
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
      const valueInput = num(`prize-value-${index}`, prize.value_msat || 0, { min: '0' });
      rankInput.addEventListener('input', () => { prize.rank = Number(rankInput.value); });
      kindInput.addEventListener('change', () => { prize.kind = kindInput.value; renderPrizes(); });
      labelInput.addEventListener('input', () => { prize.label = labelInput.value; });
      valueInput.addEventListener('input', () => { prize.value_msat = Number(valueInput.value); });
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
  const boardOf = () => ({
    brand: f.brand.value,
    model: f.model.value.trim(),
    layout_id: Number(f.layoutId.value),
    size: f.size.value.trim(),
    angle: Number(f.angle.value),
  });
  const climbEditor = new ClimbEditor({ t, pool, boardOf });
  const climbInput = text('f-climb-ref', '', { placeholder: t('climb.paste.placeholder'), autocomplete: 'off' });
  const climbSection = el('div', {});

  const renderClimbSection = () => {
    const participantChoice = f.climbSource.value === 'participant_choice';
    replace(climbSection,
      el('h3', { text: participantChoice ? t('climb.pool.title') : t('climb.list.title') }),
      el('p', { className: 'small', text: participantChoice ? t('climb.pool.hint') : t('climb.list.hint') }),
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

    const fee = Number(f.fee.value);
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
      board: boardOf(),
      divisions: divisionRows.map((d) => ({ id: d.id, label: d.label.trim() })),
      eligibility: f.eligibility.value.trim(),
      waiver: f.waiver.value.trim(),
      waiver_required: Boolean(f.waiver.value.trim()),
      participant_instructions: f.instructions.value.trim(),
      spectator_info: f.spectator.value.trim(),
      refund_policy: f.refund.value.trim(),
      fee_msat: fee,
      prizes: prizeRows.map((p) => (p.kind === 'cash'
        ? { rank: p.rank, kind: 'cash', value_msat: p.value_msat || 0, label: p.label.trim() }
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

  const node = el('section', { className: 'card' }, [
    el('h2', { text: t('org.create') }),

    el('fieldset', {}, [
      el('legend', { text: t('org.basics') }),
      field('f-title', t('org.field.title'), f.title),
      field('f-summary', t('org.field.summary'), f.summary),
      field('f-description', t('org.field.description'), f.description),
      field('f-org', t('org.field.organizer'), f.organizerName),
      field('f-contact', t('org.field.contact'), f.contact, t('org.field.contact.hint')),
      field('f-visibility', t('org.field.visibility'), f.visibility, t('org.field.visibility.hint')),
    ]),

    el('fieldset', {}, [
      el('legend', { text: t('org.when') }),
      field('f-timezone', t('org.field.timezone'), f.timezone),
      field('f-reg-open', t('org.field.reg_open'), f.regOpens),
      field('f-reg-close', t('org.field.reg_close'), f.regCloses),
      field('f-checkin-open', t('org.field.checkin_open'), f.checkinOpens),
      field('f-checkin-close', t('org.field.checkin_close'), f.checkinCloses),
      field('f-start', t('org.field.starts'), f.starts),
      field('f-end', t('org.field.ends'), f.ends),
    ]),

    el('fieldset', {}, [
      el('legend', { text: t('org.where') }),
      field('f-venue-kind', t('org.field.venue_kind'), f.venueKind),
      field('f-venue', t('org.field.venue'), f.venue),
      field('f-address', t('org.field.address'), f.address),
      el('h3', { text: t('org.board') }),
      el('p', { className: 'small', text: t('org.board.hint') }),
      field('f-brand', t('org.field.brand'), f.brand),
      field('f-board', t('org.field.model'), f.model),
      field('f-layout', t('org.field.layout'), f.layoutId, t('org.field.layout.hint')),
      field('f-size', t('org.field.size'), f.size),
      field('f-angle', t('org.field.angle'), f.angle),
    ]),

    el('fieldset', {}, [
      el('legend', { text: t('org.format') }),
      field('f-climb-source', t('org.field.climb_source'), f.climbSource),
      field('f-climbs', t('org.field.climb_count'), f.climbCount, t('org.field.climb_count.hint')),
      field('f-uniqueness', t('org.field.uniqueness'), f.uniqueness),
      field('f-progression', t('org.field.progression'), f.progression),
      field('f-attempts', t('org.field.attempts'), f.attempts),
      field('f-scoring', t('org.field.scoring'), f.scoring),
      modeNotes,
    ]),

    el('fieldset', {}, [el('legend', { text: t('climb.section') }), climbSection]),

    el('fieldset', {}, [
      el('legend', { text: t('org.entry') }),
      field('f-capacity', t('org.field.capacity'), f.capacity, t('org.field.capacity.hint')),
      el('label', { className: 'inline', attrs: { for: 'f-waitlist' } }, [
        f.waitlist, el('span', { text: t('org.field.waitlist') }),
      ]),
      field('f-fee', t('org.field.fee'), f.fee, t('org.field.fee.hint')),
      field('f-lnurl', t('org.field.lnurl'), f.lnurl, t('org.field.lnurl.hint')),
      el('h3', { text: t('org.divisions') }),
      el('p', { className: 'small', text: t('org.divisions.hint') }),
      divisionsNode,
      el('button', {
        text: t('org.divisions.add'),
        on: {
          click: () => {
            divisionRows.push({ id: `division_${divisionRows.length + 1}`, label: '' });
            renderDivisions();
          },
        },
      }),
      el('h3', { text: t('org.prizes') }),
      el('p', { className: 'small', text: t('org.prizes.hint') }),
      prizesNode,
      el('button', {
        text: t('org.prizes.add'),
        on: {
          click: () => {
            prizeRows.push({ rank: prizeRows.length + 1, kind: 'non_cash', label: '', value_msat: 0 });
            renderPrizes();
          },
        },
      }),
    ]),

    el('details', { className: 'disclosure' }, [
      el('summary', { text: t('org.text') }),
      field('f-eligibility', t('org.field.eligibility'), f.eligibility),
      field('f-waiver', t('org.field.waiver'), f.waiver, t('org.field.waiver.hint')),
      field('f-instructions', t('org.field.instructions'), f.instructions),
      field('f-spectator', t('org.field.spectator'), f.spectator),
      field('f-refund', t('org.field.refund'), f.refund),
    ]),

    el('details', { className: 'disclosure' }, [
      el('summary', { text: t('org.advanced') }),
      el('p', { className: 'small', text: t('org.advanced.hint') }),
      field('f-deadline', t('org.field.turn_deadline'), f.turnDeadline),
      field('f-defer-budget', t('org.field.defer_budget'), f.deferBudget),
      field('f-defer-consecutive', t('org.field.defer_consecutive'), f.deferConsecutive),
      field('f-defer-slots', t('org.field.defer_slots'), f.deferSlots),
      field('f-rest', t('org.field.min_rest'), f.minRest),
      el('label', { className: 'inline', attrs: { for: 'f-late-entry' } }, [
        f.lateEntry, el('span', { text: t('org.field.late_entry') }),
      ]),
    ]),
  ]);

  // `climbs` is exposed so the climb list can be driven from outside the DOM —
  // by a test, and by the app-side handoff that adds a climb straight from the
  // board browser.
  return { node, build, climbs: climbEditor, validate: (config) => validateCompetitionConfig(config) };
}
