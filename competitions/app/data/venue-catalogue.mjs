const DATA_URL = '/boards/data/boards.geojson';
const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 8;

let cataloguePromise = null;

export function normalizeVenueText(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').trim();
}

function firstAddress(boards, preferredBoard = '', venueAddress = '') {
  return venueAddress
    || boards.find((entry) => entry.id === preferredBoard && entry.address)?.address
    || boards.find((entry) => entry.address)?.address || '';
}

export function venueEntries(geojson) {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) return [];
  return geojson.features.flatMap((feature) => {
    const props = feature?.properties;
    if (!props || typeof props.name !== 'string' || !props.name.trim()) return [];
    const boards = Array.isArray(props.boards) ? props.boards.flatMap((board) => {
      if (!board || typeof board.board !== 'string') return [];
      const walls = Array.isArray(board.walls) ? board.walls.flatMap((wall) => (
        wall && typeof wall === 'object' ? [{
          layout: String(wall.layout || '').trim(),
          sizeId: Number.isInteger(wall.size_id) ? wall.size_id : null,
          sizeLabel: String(wall.size_label || '').trim(),
          angle: Number.isFinite(wall.angle) ? wall.angle : null,
          adjustable: wall.adjustable === true,
          minAngle: Number.isFinite(wall.min_angle) ? wall.min_angle : null,
          maxAngle: Number.isFinite(wall.max_angle) ? wall.max_angle : null,
        }] : []
      )) : [];
      return [{
        id: board.board,
        address: typeof board.address === 'string' ? board.address.trim() : '',
        variant: typeof board.variant === 'string' ? board.variant.trim() : '',
        angle: Number.isFinite(board.angle) ? board.angle : null,
        walls,
      }];
    }) : [];
    const city = String(props.city || props.city_nearest || '').trim();
    const country = String(props.country || '').trim();
    const name = props.name.trim();
    // Some map sources know an address for the venue itself, others attach it
    // to a specific installed board. Preserve both without synthesising one
    // from city/country when the source does not actually provide an address.
    const venueAddress = typeof props.address === 'string' ? props.address.trim() : '';
    const addresses = boards.map((entry) => entry.address).filter(Boolean);
    return [{
      name, city, country, boards, mapAddress: venueAddress,
      address: firstAddress(boards, '', venueAddress),
      searchName: normalizeVenueText(name),
      searchCity: normalizeVenueText(city),
      searchHaystack: normalizeVenueText([name, city, country, venueAddress, ...addresses].join(' ')),
    }];
  });
}

export function searchVenues(entries, query, preferredBoard = '', limit = DEFAULT_LIMIT) {
  const needle = normalizeVenueText(query);
  if (needle.length < MIN_QUERY_LENGTH) return [];
  return entries.flatMap((entry) => {
    const nameIndex = entry.searchName.indexOf(needle);
    const cityIndex = entry.searchCity.indexOf(needle);
    const haystackIndex = entry.searchHaystack.indexOf(needle);
    if (haystackIndex < 0) return [];
    const relevance = nameIndex === 0 ? 0 : nameIndex > 0 ? 1 : cityIndex === 0 ? 2 : cityIndex > 0 ? 3 : 4;
    const preferred = entry.boards.some((board) => board.id === preferredBoard) ? 0 : 1;
    return [{
      ...entry,
      address: firstAddress(entry.boards, preferredBoard, entry.mapAddress),
      score: relevance * 2 + preferred,
    }];
  }).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, limit);
}

export function loadVenueCatalogue(fetcher = globalThis.fetch) {
  if (!cataloguePromise) {
    cataloguePromise = Promise.resolve(fetcher(DATA_URL, { credentials: 'omit', referrerPolicy: 'no-referrer' }))
      .then((response) => {
        if (!response?.ok) throw new Error(`venue catalogue ${response?.status || 'unavailable'}`);
        return response.json();
      })
      .then(venueEntries)
      .catch((error) => {
        cataloguePromise = null;
        throw error;
      });
  }
  return cataloguePromise;
}
