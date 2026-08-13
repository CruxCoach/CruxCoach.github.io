import { el } from './dom.mjs';
import { boardPreviewImages } from '../protocol/board-catalog.mjs';

export function gradeLabel(value) {
  if (!Number.isFinite(value)) return '—';
  const grade = Math.floor(Number(value) + 0.5);
  const v = grade <= 12 ? 0 : grade <= 14 ? 1 : grade <= 15 ? 2 : grade <= 17 ? 3
    : grade <= 19 ? 4 : grade <= 21 ? 5 : Math.min(17, grade - 16);
  return `V${v}`;
}

function preview(climb, board, t, { zoneSelectable = false, onZone } = {}) {
  const images = boardPreviewImages(board);
  const holds = Array.isArray(climb.holds) ? climb.holds : [];
  const stage = el('div', {
    className: `climb-card-preview${zoneSelectable ? ' zone-selectable' : ''}`,
    attrs: { 'aria-label': t('climb.preview.alt', { label: climb.label }) },
  }, images.map((src, index) => el('img', {
    className: images.length > 1 ? 'board-preview-layer' : '',
    attrs: { src, alt: '', 'aria-hidden': 'true', loading: 'lazy', decoding: 'async' },
  })));
  if (!holds.length) {
    stage.append(el('span', { className: 'climb-preview-unavailable', text: t('climb.preview.unavailable') }));
    return stage;
  }
  const canvas = el('canvas', {
    className: 'climb-hold-overlay',
    attrs: { width: '320', height: '400', 'aria-hidden': 'true' },
  });
  const draw = () => {
    const context = canvas.getContext?.('2d');
    if (!context) return;
    const [minX, maxX, minY, maxY] = Array.isArray(climb.bounds) && climb.bounds.length === 4
      ? climb.bounds : [0, 10000, 0, 10000];
    context.clearRect(0, 0, 320, 400);
    for (const [placement, role, x, y] of holds) {
      const px = 24 + ((x - minX) / Math.max(1, maxX - minX)) * 272;
      const py = 376 - ((y - minY) / Math.max(1, maxY - minY)) * 352;
      context.beginPath(); context.arc(px, py, Number(climb.zone_hold) === placement ? 9 : 6, 0, Math.PI * 2);
      context.lineWidth = Number(climb.zone_hold) === placement ? 4 : 3;
      context.strokeStyle = Number(climb.zone_hold) === placement ? '#ffd54f'
        : ([12, 42].includes(role) ? '#4caf50' : [14, 44].includes(role) ? '#e84fd1' : role === 15 ? '#4aa3ff' : '#ff8a48');
      context.stroke();
    }
  };
  stage.append(canvas);
  draw();
  if (zoneSelectable) stage.append(el('p', { className: 'climb-zone-instruction', text: t('climb.zone.choose_below') }));
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
