// The one definition of a venue's identity in this repo.
//
// Venues are identified by their rounded coordinate rather than by a name or
// an upstream id: names differ between sources and upstream ids are not
// stable, but a gym does not move. 4 decimals ≈ 11 m at the equator — tight
// enough to keep neighbouring gyms apart, loose enough to collapse the
// multi-board installations that share a coordinate.
//
// build-boards-data.mjs groups venues with it, tools/overrides.json and
// tools/wellpass.json are matched with it, and tools/osm-venues.json binds a
// curated OpenStreetMap object to a venue with it. Those four must agree, so
// the function lives here instead of being retyped in each of them.
export function venueKey(lat, lon) {
  return `${lat.toFixed(4)}|${lon.toFixed(4)}`;
}
