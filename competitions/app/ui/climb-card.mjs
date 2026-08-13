import { el } from './dom.mjs';
import { boardPreviewImages } from '../protocol/board-catalog.mjs';

export function gradeLabel(value) {
  if (!Number.isFinite(value)) return '—';
  const grade = Math.floor(Number(value) + 0.5);
  const v = grade <= 12 ? 0 : grade <= 14 ? 1 : grade <= 15 ? 2 : grade <= 17 ? 3
    : grade <= 19 ? 4 : grade <= 21 ? 5 : Math.min(17, grade - 16);
  return `V${v}`;
}

const MOONBOARD_PREVIEW_GEOMETRY = new Map([
  [1, { aspect: 0.65, left: 0.143077, right: 0.912308, top: 0.0855, bottom: 0.9355 }],
  [2, { aspect: 0.7007, left: 0.1161, right: 0.83176, top: 0.07033, bottom: 0.96701 }],
  [3, { aspect: 0.6143, left: 0.06171, right: 0.93936, top: 0.03867, bottom: 0.96224 }],
  [4, { aspect: 0.6487, left: 0.13646, right: 0.90993, top: 0.08369, bottom: 0.93466 }],
  [5, { aspect: 0.6497, left: 0.14177, right: 0.90474, top: 0.09495, bottom: 0.94131 }],
  [6, { aspect: 1, left: 0.14077, right: 0.92245, top: 0.10673, bottom: 0.94376 }],
  [7, { aspect: 0.9365994, left: 0.143077, right: 0.912308, top: 0.113112, bottom: 0.90562 }],
]);
const MOONBOARD_GEOMETRY_URL = '/competitions/data/moonboard-preview-geometry.json?v=20260813-1';
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

/** Map catalogue coordinates into the exact rectangle occupied by the board image. */
export function previewTransform(climb, board) {
  const [minX, maxX, minY, maxY] = Array.isArray(climb.bounds) && climb.bounds.length === 4
    ? climb.bounds.map(Number) : [0, 1, 0, 1];
  const moon = board?.brand === 'moonboard'
    ? MOONBOARD_PREVIEW_GEOMETRY.get(Number(board.layout_id ?? board.layoutId)) : null;
  const aspect = moon?.aspect || Math.max(0.35, Math.min(1.5,
    (maxX - minX) / Math.max(1, maxY - minY)));
  return {
    aspect,
    point(x, y) {
      const nx = (Number(x) - minX) / Math.max(1, maxX - minX);
      const ny = (Number(y) - minY) / Math.max(1, maxY - minY);
      return moon
        ? [moon.left + nx * (moon.right - moon.left), moon.bottom - ny * (moon.bottom - moon.top)]
        : [nx, 1 - ny];
    },
  };
}

function preview(climb, board, t, { zoneSelectable = false, onZone } = {}) {
  const images = boardPreviewImages(board);
  const holds = Array.isArray(climb.holds) ? climb.holds : [];
  const geometry = previewTransform(climb, board);
  const visual = ({ enlarged = false } = {}) => {
    const stage = el(enlarged ? 'div' : 'button', {
      className: `climb-card-preview${zoneSelectable ? ' zone-selectable' : ''}`,
      attrs: {
        type: enlarged ? null : 'button',
        'aria-label': enlarged ? t('climb.preview.alt', { label: climb.label })
          : t('climb.preview.enlarge', { label: climb.label }),
        style: `--preview-aspect:${geometry.aspect}`,
      },
    }, images.map((src) => el('img', {
      className: images.length > 1 ? 'board-preview-layer' : '',
      attrs: { src, alt: '', 'aria-hidden': 'true', loading: 'lazy', decoding: 'async' },
    })));
    if (!holds.length) {
      stage.append(el('span', { className: 'climb-preview-unavailable', text: t('climb.preview.unavailable') }));
      return stage;
    }
    const width = 1000;
    const height = Math.round(width / geometry.aspect);
    const canvas = el('canvas', {
      className: 'climb-hold-overlay',
      attrs: { width: String(width), height: String(height), 'aria-hidden': 'true' },
    });
    const draw = (measured = null) => {
      const context = canvas.getContext?.('2d');
      if (!context) return;
      context.clearRect(0, 0, width, height);
      for (const [placement, role, x, y] of holds) {
        const [nx, ny] = measured?.holds.get(Number(placement)) || geometry.point(x, y);
        const px = nx * width;
        const py = ny * height;
        context.beginPath(); context.arc(px, py, Number(climb.zone_hold) === placement ? 26 : 19, 0, Math.PI * 2);
        context.lineWidth = Number(climb.zone_hold) === placement ? 10 : 7;
        context.strokeStyle = Number(climb.zone_hold) === placement ? '#ffd54f'
          : board?.brand === 'moonboard'
            ? (role === 42 ? '#2fb84a' : role === 43 ? '#2f6be0' : role === 44 ? '#e23b36' : '#ff8a48')
            : (role === 12 ? '#4caf50' : role === 14 ? '#e84fd1' : role === 15 ? '#4aa3ff' : '#ff8a48');
        context.stroke();
      }
    };
    stage.append(canvas);
    if (board?.brand === 'moonboard') loadMeasuredMoonBoard(board).then((measured) => draw(measured));
    else draw();
    if (zoneSelectable) stage.append(el('p', { className: 'climb-zone-instruction', text: t('climb.zone.choose_below') }));
    return stage;
  };
  const stage = visual();
  const openLargePreview = () => {
    const close = () => dialog.parentNode?.removeChild(dialog);
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
    else dialog.setAttribute('open', 'open');
    dialog.querySelector('.climb-preview-close')?.focus?.();
  };
  stage.addEventListener('click', openLargePreview);
  return stage;
}

export function climbCard({ climb, board, t, selected = false, taken = false,
  action = null, zoneSelectable = false, onZone = null }) {
  const meta = [
    t('climb.card.grade', { grade: gradeLabel(climb.difficulty) }),
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
