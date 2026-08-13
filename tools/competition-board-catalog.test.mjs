import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  BOARD_TYPES, boardRenderGeometry, catalogueBoardKey, catalogueClimbMatches,
  resolveBoardSelection, resolveCatalogueSelection,
} from '../competitions/app/protocol/board-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the board picker only exposes unique supported type/model/layout tuples', () => {
  assert.deepEqual(BOARD_TYPES.map((entry) => entry.id), [
    'kilter-original', 'kilter-homewall', 'moonboard', 'tension',
    'grasshopper', 'decoy', 'soill', 'touchstone',
  ]);
  for (const type of BOARD_TYPES) {
    assert.ok(type.models.length > 0, type.id);
    for (const model of type.models) {
      assert.ok(Number.isInteger(model.layoutId), `${type.id}/${model.value}`);
      assert.ok(model.sizes.length > 0, `${type.id}/${model.value} sizes`);
      assert.ok(model.angles.length > 0, `${type.id}/${model.value} angles`);
      assert.equal(new Set(model.angles).size, model.angles.length);
    }
  }
});

test('a model cannot be combined with another board family', () => {
  assert.equal(resolveBoardSelection('moonboard', 'kilterboard-og', '11x18', 40), null);
  assert.equal(resolveBoardSelection('kilter-original', 'moonboard-2016', '12x12, with Kickboard', 40), null);
});

test('size and angle must belong to the selected model', () => {
  assert.equal(resolveBoardSelection('moonboard', 'mini-moonboard-2020', '11x12', 25), null);
  assert.equal(resolveBoardSelection('touchstone', 'touchstone-board', 'Full Size (12 x 12)', 45), null);
  assert.equal(resolveBoardSelection('tension', 'tension-board-1', '12 high x 12 wide', 40), null);
});

test('valid choices resolve their brand and layout without user-entered ids', () => {
  assert.deepEqual(
    resolveBoardSelection('moonboard', 'moonboard-2016', '11x18', 25),
    { brand: 'moonboard', model: 'moonboard-2016', layout_id: 2, size: '11x18', angle: 25 },
  );
  assert.deepEqual(
    resolveBoardSelection('kilter-homewall', 'kilterboard-homewall', 'Homewall 10x10 — Mainline', 40),
    { brand: 'kilter', model: 'kilterboard-homewall', layout_id: 8, size: 'Homewall 10x10 — Mainline', angle: 40 },
  );
});

test('the non-public Decoy R&D layout and phantom 16-wide TB2 size are absent', () => {
  const decoy = BOARD_TYPES.find((entry) => entry.id === 'decoy');
  assert.deepEqual(decoy.models.map((model) => model.layoutId), [2]);
  const tension = BOARD_TYPES.find((entry) => entry.id === 'tension');
  assert.equal(tension.models.some((model) => model.sizes.some((size) => /16 wide/i.test(size.value))), false);
});

test('every visual board choice has a bundled same-origin preview', () => {
  for (const type of BOARD_TYPES) {
    for (const model of type.models) {
      for (const size of model.sizes) {
        assert.ok(size.images.length > 0, `${model.label}: ${size.label}`);
        for (const image of size.images) {
          assert.match(image, /^\/competitions\/assets\/boards\//);
          assert.equal(fs.existsSync(path.join(root, image)), true, `${model.label}: ${size.label}`);
        }
      }
    }
  }
});

test('every supported image has deterministic Android render geometry', () => {
  for (const type of BOARD_TYPES) {
    for (const model of type.models) {
      for (const size of model.sizes) {
        const board = {
          brand: type.brand, model: model.value, layout_id: model.layoutId,
          size: size.value, angle: model.defaultAngle,
        };
        const geometry = boardRenderGeometry(board);
        assert.ok(geometry, `${type.brand}/${model.layoutId}/${size.value}`);
        assert.ok(geometry.aspect > 0, `${type.brand}/${model.layoutId}/${size.value} aspect`);
        if (type.brand !== 'moonboard') {
          assert.equal(geometry.bounds.length, 4);
          assert.ok(Number.isInteger(geometry.productSizeId));
        }
      }
    }
  }
});

test('catalogue identity includes brand, layout, size and angle and matches rows exactly', () => {
  const board = { brand: 'kilter', layoutId: 1, productSizeId: 10, angle: 40 };
  assert.equal(catalogueBoardKey(board), 'kilter:1:10:40');
  const row = { brand: 'kilter', layoutId: 1, productSizeId: 10, angle: 40 };
  assert.equal(catalogueClimbMatches(row, board), true);
  for (const changed of [
    { brand: 'moonboard' }, { layoutId: 8 }, { productSizeId: 8 }, { angle: 45 },
  ]) assert.equal(catalogueClimbMatches({ ...row, ...changed }, board), false);
});

test('Aurora-family render rectangles equal the signed app-catalogue size metadata', () => {
  const headers = new Map();
  for (const file of fs.readdirSync(path.join(root, 'competitions/data/climbs')).filter((name) => name.endsWith('.gz'))) {
    const header = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, 'competitions/data/climbs', file)))
      .toString('utf8').split('\n', 1)[0]);
    headers.set(`${header.brand}:${header.layout}`, header);
  }
  for (const type of BOARD_TYPES.filter(({ brand }) => brand !== 'moonboard')) {
    for (const model of type.models) {
      for (const size of model.sizes) {
        const catalogue = resolveCatalogueSelection(type.id, model.value, size.value, model.defaultAngle);
        const geometry = boardRenderGeometry({
          brand: type.brand, model: model.value, layout_id: model.layoutId,
          size: size.value, angle: model.defaultAngle,
        });
        assert.deepEqual(geometry.bounds,
          headers.get(`${type.brand}:${model.layoutId}`).size_bounds[String(catalogue.productSizeId)],
          `${type.brand}/${model.layoutId}/${catalogue.productSizeId}`);
      }
    }
  }
});
