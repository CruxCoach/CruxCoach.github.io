import { el } from './dom.mjs';
import { boardPreviewImages, boardRenderGeometry } from '../protocol/board-catalog.mjs?v=20260813-1';

const FONT_GRADES = [
  '4a', '4b', '4c', '5a', '5b', '5c', '6a', '6a+', '6b', '6b+', '6c', '6c+',
  '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a',
];
const V_GRADES = [
  'V0', 'V0', 'V0', 'V1', 'V1', 'V2', 'V3', 'V3', 'V4', 'V4', 'V5', 'V5',
  'V6', 'V7', 'V8', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17',
];
const GRADE_SCALE_KEY = 'cruxcoach:grade-scale:v1';

export function storedGradeScale(storage = globalThis.localStorage) {
  try { return storage?.getItem(GRADE_SCALE_KEY) === 'font' ? 'font' : 'v'; } catch { return 'v'; }
}

export function saveGradeScale(scale, storage = globalThis.localStorage) {
  try { storage?.setItem(GRADE_SCALE_KEY, scale === 'font' ? 'font' : 'v'); } catch { /* private mode */ }
}

/** Match the official difficulty table used by the Android app. */
export function gradeLabel(value, scale = 'v') {
  if (!Number.isFinite(value)) return '—';
  const grade = Math.floor(Number(value) + 0.5);
  const index = Math.max(0, Math.min(24, grade - 10));
  return (scale === 'font' ? FONT_GRADES : V_GRADES)[index];
}

/** Select values are exact internal difficulty boundaries; only human grades are exposed. */
export function gradeFilterOptions(scale = 'v', bound = 'min') {
  const labels = scale === 'font' ? FONT_GRADES : V_GRADES;
  const groups = [];
  labels.forEach((label, index) => {
    const difficulty = index + 10;
    const previous = groups.at(-1);
    if (previous?.label === label) previous.max = difficulty;
    else groups.push({ label, min: difficulty, max: difficulty });
  });
  return groups.map((group) => ({ label: group.label, value: String(bound === 'max' ? group.max : group.min) }));
}

const MOONBOARD_GEOMETRY_URL = '/competitions/data/moonboard-preview-geometry.json?v=20260813-2';
let measuredMoonBoardPromise = null;

function loadMeasuredMoonBoard(board) {
  if (board?.brand !== 'moonboard') return Promise.resolve(null);
  if (!measuredMoonBoardPromise) {
    measuredMoonBoardPromise = fetch(MOONBOARD_GEOMETRY_URL, {
      credentials: 'omit', referrerPolicy: 'no-referrer',
    }).then((response) => {
      if (!response.ok) throw new Error(`MoonBoard preview geometry ${response.status}`);
      return response.json();
    }).then((payload) => {
      if (payload?.v !== 1 || !payload.layouts || typeof payload.layouts !== 'object') {
        throw new Error('invalid MoonBoard preview geometry');
      }
      return payload.layouts;
    }).catch(() => null);
  }
  return measuredMoonBoardPromise.then((layouts) => {
    const source = layouts?.[String(Number(board.layout_id ?? board.layoutId))];
    if (!source || !Number.isFinite(source.aspect) || typeof source.holds !== 'object') return null;
    const holds = new Map(Object.entries(source.holds).flatMap(([id, point]) => (
      Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
        ? [[Number(id), point.map(Number)]] : []
    )));
    return holds.size ? { aspect: Number(source.aspect), holds } : null;
  });
}

/** Map catalogue placements into the exact Android board image/canvas rectangle. */
export function previewTransform(climb, board) {
  const geometry = boardRenderGeometry(board);
  if (!geometry) return null;
  const [minX, maxX, minY, maxY] = geometry.bounds || [];
  return {
    aspect: geometry.aspect,
    point(x, y) {
      if (!geometry.bounds) return null;
      const nx = (Number(x) - minX) / Math.max(1, maxX - minX);
      const ny = (Number(y) - minY) / Math.max(1, maxY - minY);
      return [nx, 1 - ny];
    },
  };
}

/** Brand-native role ids which Android folds to the semantic HAND class. */
export function zoneCandidateHolds(holds) {
  return (Array.isArray(holds) ? holds : []).filter((hold) => (
    Array.isArray(hold) && [2, 6, 13, 43].includes(Number(hold[1]))
  ));
}

function roleColor(brand, role) {
  if (brand === 'moonboard') return role === 42 ? '#2fb84a'
    : role === 43 ? '#2f6be0' : role === 44 ? '#e23b36' : '#ff8a48';
  const semantic = new Map([[1, 'start'], [5, 'start'], [12, 'start'], [42, 'start'],
    [2, 'hand'], [6, 'hand'], [13, 'hand'], [43, 'hand'],
    [3, 'finish'], [7, 'finish'], [14, 'finish'], [44, 'finish'],
    [4, 'foot'], [8, 'foot'], [15, 'foot'], [45, 'foot']]).get(role);
  if (brand === 'soill') return { start: '#00ff00', hand: '#ff00ff', finish: '#ffffff', foot: '#00ffff' }[semantic] || '#ff8a48';
  if (brand === 'kilter') return { start: '#00ff00', hand: '#00ffff', finish: '#ff00ff', foot: '#ffa500' }[semantic] || '#ff8a48';
  return { start: '#00ff00', hand: '#0000ff', finish: '#ff0000', foot: '#ff00ff' }[semantic] || '#ff8a48';
}

function preview(climb, board, t, { zoneSelectable = false, onZone } = {}) {
  const images = boardPreviewImages(board);
  const holds = Array.isArray(climb.holds) ? climb.holds : [];
  const geometry = previewTransform(climb, board);
  const candidates = zoneCandidateHolds(holds);
  let selectedZone = Number(climb.zone_hold) || null;
  const visual = ({ enlarged = false } = {}) => {
    const stage = el(enlarged || zoneSelectable ? 'div' : 'button', {
      className: `climb-card-preview${zoneSelectable ? ' zone-selectable' : ''}`,
      attrs: {
        type: enlarged || zoneSelectable ? null : 'button',
        'aria-label': enlarged || zoneSelectable ? t('climb.preview.alt', { label: climb.label })
          : t('climb.preview.enlarge', { label: climb.label }),
      },
    }, images.map((src) => el('img', {
      className: images.length > 1 ? 'board-preview-layer' : '',
      attrs: { src, alt: '', 'aria-hidden': 'true', loading: 'lazy', decoding: 'async' },
    })));
    if (!holds.length || !geometry) {
      stage.append(el('span', { className: 'climb-preview-unavailable', text: t('climb.preview.unavailable') }));
      return stage;
    }
    const width = 1000;
    const height = Math.round(width / geometry.aspect);
    const canvas = el('canvas', {
      className: 'climb-hold-overlay',
      attrs: { width: String(width), height: String(height), 'aria-hidden': 'true' },
    });
    const geometryFailure = el('span', {
      className: 'climb-preview-unavailable',
      attrs: { hidden: 'hidden' },
      text: t('climb.preview.unavailable'),
    });
    let measuredGeometry = null;
    let focusedCandidate = 0;
    const pointFor = (hold) => measuredGeometry?.holds.get(Number(hold[0])) || geometry.point(hold[2], hold[3]);
    const draw = () => {
      const context = canvas.getContext?.('2d');
      if (!context) return;
      context.clearRect(0, 0, width, height);
      for (const [placement, role, x, y] of holds) {
        const point = measuredGeometry?.holds.get(Number(placement)) || geometry.point(x, y);
        if (!point) continue;
        const [nx, ny] = point;
        const px = nx * width;
        const py = ny * height;
        context.beginPath(); context.arc(px, py, selectedZone === placement ? 26 : 19, 0, Math.PI * 2);
        context.lineWidth = selectedZone === placement ? 10 : 7;
        context.strokeStyle = selectedZone === placement ? '#ffd54f' : roleColor(board?.brand, role);
        context.stroke();
      }
    };
    stage.append(canvas, geometryFailure);
    if (zoneSelectable && candidates.length) {
      const choose = (hold) => {
        selectedZone = Number(hold[0]);
        canvas.setAttribute('aria-label', t('climb.zone.selected_announcement', {
          hold: t('climb.zone.hold', { number: candidates.indexOf(hold) + 1, column: hold[2], row: hold[3] }),
        }));
        draw();
        onZone?.(selectedZone);
      };
      canvas.setAttribute('tabindex', '0');
      canvas.setAttribute('role', 'button');
      canvas.setAttribute('aria-label', t('climb.zone.image_control', { label: climb.label }));
      canvas.removeAttribute('aria-hidden');
      canvas.addEventListener('click', (event) => {
        const rect = canvas.getBoundingClientRect?.();
        if (!rect?.width || !rect?.height) return;
        const nx = (event.clientX - rect.left) / rect.width;
        const ny = (event.clientY - rect.top) / rect.height;
        const nearest = candidates.map((hold) => {
          const point = pointFor(hold);
          return { hold, distance: point ? Math.hypot(point[0] - nx, point[1] - ny) : Infinity };
        }).sort((a, b) => a.distance - b.distance)[0];
        if (nearest && nearest.distance <= 0.055) choose(nearest.hold);
      });
      canvas.addEventListener('keydown', (event) => {
        if (['ArrowRight', 'ArrowDown'].includes(event.key)) focusedCandidate = (focusedCandidate + 1) % candidates.length;
        else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) focusedCandidate = (focusedCandidate - 1 + candidates.length) % candidates.length;
        else if (event.key === 'Home') focusedCandidate = 0;
        else if (event.key === 'End') focusedCandidate = candidates.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault?.(); choose(candidates[focusedCandidate]); return; }
        else return;
        event.preventDefault?.();
        canvas.setAttribute('aria-label', t('climb.zone.focused_hold', {
          hold: t('climb.zone.hold', { number: focusedCandidate + 1, column: candidates[focusedCandidate][2], row: candidates[focusedCandidate][3] }),
        }));
      });
    }
    if (board?.brand === 'moonboard') loadMeasuredMoonBoard(board).then((measured) => {
      measuredGeometry = measured;
      if (measured) draw();
      else geometryFailure.removeAttribute('hidden');
    });
    else draw();
    return stage;
  };
  const stage = visual();
  const openLargePreview = () => {
    const trigger = document.activeElement;
    const onKeydown = (event) => { if (event.key === 'Escape') close(); };
    const close = () => {
      document.removeEventListener?.('keydown', onKeydown);
      dialog.parentNode?.removeChild(dialog);
      trigger?.focus?.();
    };
    const dialog = el('dialog', {
      className: 'climb-preview-dialog',
      attrs: { 'aria-label': t('climb.preview.dialog', { label: climb.label }) },
      on: {
        close,
        click: (event) => { if (event.target === dialog) { dialog.close?.(); close(); } },
      },
    }, [
      el('button', {
        className: 'climb-preview-close', text: '×',
        attrs: { type: 'button', 'aria-label': t('climb.preview.close') },
        on: { click: () => { dialog.close?.(); close(); } },
      }),
      visual({ enlarged: true }),
    ]);
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.setAttribute('open', 'open');
      document.addEventListener?.('keydown', onKeydown);
    }
    dialog.querySelector('.climb-preview-close')?.focus?.();
  };
  if (!zoneSelectable) stage.addEventListener('click', openLargePreview);
  if (!zoneSelectable) return stage;
  return el('div', { className: 'climb-preview-shell' }, [
    el('div', { className: `climb-zone-cue${selectedZone ? ' complete' : ''}` }, [
      el('span', { className: 'climb-zone-cue-dot', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: t(selectedZone ? 'climb.zone.cue_done' : 'climb.zone.cue_pick') }),
    ]),
    stage,
    el('button', {
      className: 'quiet climb-preview-enlarge', text: t('climb.preview.enlarge_short'),
      attrs: { type: 'button', 'aria-label': t('climb.preview.enlarge', { label: climb.label }) },
      on: { click: openLargePreview },
    }),
  ]);
}

export function climbCard({ climb, board, t, selected = false, taken = false,
  action = null, zoneSelectable = false, onZone = null, gradeScale = storedGradeScale() }) {
  const geometry = boardRenderGeometry(board);
  const mismatched = !geometry
    || (climb?.brand && climb.brand !== board?.brand)
    || (Number.isInteger(climb?.layoutId) && climb.layoutId !== board?.layout_id)
    || (Number.isInteger(climb?.angle) && climb.angle !== board?.angle)
    || (climb?.size && board?.size && climb.size !== board.size)
    || (Number.isInteger(climb?.productSizeId) && Number.isInteger(geometry.productSizeId)
      && climb.productSizeId !== geometry.productSizeId);
  if (mismatched) {
    return el('article', { className: 'climb-result-card rich invalid' }, [
      el('div', { className: 'notice bad', attrs: { role: 'alert' }, text: t('climb.browser.mismatch') }),
    ]);
  }
  const meta = [
    t('climb.card.grade', { grade: gradeLabel(climb.difficulty, gradeScale) }),
    t('climb.card.ascents', { count: climb.ascents || 0 }),
    Number.isFinite(climb.quality) ? t('climb.card.quality', { quality: Number(climb.quality).toFixed(1) }) : null,
  ].filter(Boolean);
  return el('article', {
    className: `climb-result-card rich${selected ? ' selected' : ''}${taken ? ' taken' : ''}`,
  }, [
    preview(climb, board, t, { zoneSelectable, onZone }),
    el('div', { className: 'climb-card-copy' }, [
      el('strong', { text: climb.label }),
      climb.setter ? el('p', { className: 'small', text: t('climb.card.setter', { setter: climb.setter }) }) : null,
      el('div', { className: 'climb-card-stats' }, meta.map((value) => el('span', { text: value }))),
      Number.isInteger(climb.zone_hold)
        ? el('p', { className: 'small zone-label', text: t('climb.zone.marked') }) : null,
      taken ? el('p', { className: 'small', text: t('select.taken') }) : null,
    ]),
    action,
  ]);
}

export function filterCatalogue(climbs, { query = '', minDifficulty = '', maxDifficulty = '', minAscents = '', sort = 'popular' } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  const min = minDifficulty === '' ? -Infinity : Number(minDifficulty);
  const max = maxDifficulty === '' ? Infinity : Number(maxDifficulty);
  const sends = minAscents === '' ? 0 : Number(minAscents);
  return climbs.filter(({ described = {} }) => (!needle
      || described.label?.toLocaleLowerCase().includes(needle)
      || described.setter?.toLocaleLowerCase().includes(needle))
    && (!Number.isFinite(described.difficulty) || (described.difficulty >= min && described.difficulty <= max))
    && (described.ascents || 0) >= sends).sort((a, b) => {
    if (sort === 'hardest') return (b.described.difficulty ?? -Infinity) - (a.described.difficulty ?? -Infinity);
    if (sort === 'easiest') return (a.described.difficulty ?? Infinity) - (b.described.difficulty ?? Infinity);
    if (sort === 'quality') return (b.described.quality || 0) - (a.described.quality || 0);
    return (b.described.ascents || 0) - (a.described.ascents || 0);
  });
}

export function selectionReadiness({ catalogueState, chosen, needed }) {
  if (catalogueState !== 'ready') return { ready: false, reason: 'catalogue' };
  if (chosen < needed) return { ready: false, reason: 'missing', count: needed - chosen };
  if (chosen > needed) return { ready: false, reason: 'too_many', count: chosen - needed };
  return { ready: true, reason: 'complete', count: 0 };
}
