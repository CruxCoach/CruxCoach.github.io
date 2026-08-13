const INDEX_ROOT = '/competitions/data/climbs';
const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 160 * 1024 * 1024;
const MAX_RECORDS = 350000;

const hex = (bytes) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');

async function loadIndexMeta(board, fetchImpl) {
  const response = await fetchImpl(`${INDEX_ROOT}/manifest.json`, {
    cache: 'no-cache', credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('catalogue_unavailable');
  const manifest = await response.json().catch(() => null);
  if (manifest?.v !== 1 || !Array.isArray(manifest.indexes)) throw new Error('catalogue_invalid');
  const entry = manifest.indexes.find((candidate) => candidate?.brand === board.brand
    && candidate?.layout === board.layoutId);
  if (!entry || entry.file !== `${board.brand}-${board.layoutId}.ndjson.gz`
    || !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_COMPRESSED_BYTES
    || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('catalogue_invalid');
  return entry;
}

function validUuid(value) {
  return /^[0-9a-f]{32}$/.test(value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function parseRecord(line, board, header) {
  let row;
  try { row = JSON.parse(line); } catch { return null; }
  if (!Array.isArray(row) || ![5, 6].includes(row.length)) return null;
  const [uuid, label, setter, sizeIds] = row;
  const holds = row.length === 6 ? row[4] : [];
  const stats = row.length === 6 ? row[5] : row[4];
  if (!validUuid(uuid) || typeof label !== 'string' || !label.trim() || label.length > 200) return null;
  if (typeof setter !== 'string' || setter.length > 160 || !Array.isArray(sizeIds)
    || !Array.isArray(holds) || !Array.isArray(stats)) return null;
  if (board.productSizeId != null && !sizeIds.includes(board.productSizeId)) return null;
  const stat = stats.find((entry) => Array.isArray(entry) && entry[0] === board.angle);
  if (!stat) return null;
  const difficulty = Number(stat[1]);
  const quality = Number(stat[2]);
  const ascents = Number(stat[3]);
  return {
    uuid,
    label: label.trim(),
    setter: setter.trim(),
    brand: board.brand,
    boardLabel: board.modelLabel,
    layoutId: board.layoutId,
    angle: board.angle,
    difficulty: Number.isFinite(difficulty) ? difficulty : null,
    quality: Number.isFinite(quality) ? quality : null,
    ascents: Number.isInteger(ascents) && ascents >= 0 ? ascents : 0,
    holds: holds.filter((hold) => Array.isArray(hold) && hold.length === 4
      && hold.every(Number.isInteger) && hold[0] > 0).slice(0, 200),
    bounds: header?.size_bounds?.[String(board.productSizeId)] || header?.size_bounds?.default || null,
  };
}

/** Load the same catalogue snapshot the Android app imports from Blossom. */
export async function loadCatalogueClimbs(board, { fetchImpl = globalThis.fetch } = {}) {
  if (!board || typeof fetchImpl !== 'function' || typeof DecompressionStream === 'undefined'
    || !globalThis.crypto?.subtle) {
    throw new Error('catalogue_unavailable');
  }
  const meta = await loadIndexMeta(board, fetchImpl);
  const url = `${INDEX_ROOT}/${encodeURIComponent(meta.file)}`;
  const response = await fetchImpl(url, { cache: 'no-cache', credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new Error('catalogue_unavailable');
  const compressed = Number(response.headers.get('content-length'));
  if (Number.isFinite(compressed) && compressed > MAX_COMPRESSED_BYTES) throw new Error('catalogue_too_large');

  const packed = await response.arrayBuffer();
  if (packed.byteLength !== meta.bytes || packed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error('catalogue_invalid');
  }
  const digest = hex(await globalThis.crypto.subtle.digest('SHA-256', packed));
  if (digest !== meta.sha256) throw new Error('catalogue_invalid');

  const reader = new Blob([packed]).stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let pending = '';
  let bytes = 0;
  let header = null;
  const climbs = [];
  const consume = (line) => {
    if (!line) return;
    if (!header) {
      try { header = JSON.parse(line); } catch { throw new Error('catalogue_invalid'); }
      if (![1, 2].includes(header?.v) || header.brand !== board.brand || header.layout !== board.layoutId
        || !Number.isInteger(header.rows) || header.rows < 0 || header.rows > MAX_RECORDS) {
        throw new Error('catalogue_invalid');
      }
      return;
    }
    const climb = parseRecord(line, board, header);
    if (climb) climbs.push(climb);
  };

  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_DECOMPRESSED_BYTES) throw new Error('catalogue_too_large');
      pending += value;
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    }
    consume(pending);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  if (!header) throw new Error('catalogue_invalid');
  return { climbs, snapshotAt: header.snapshot_at, total: header.rows };
}
