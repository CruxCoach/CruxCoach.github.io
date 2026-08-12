import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOARD_TYPES, resolveBoardSelection } from '../competitions/app/protocol/board-catalog.mjs';

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
