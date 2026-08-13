/** Supported board choices, mirrored from the CruxCoach 0.2.2 board picker. */
const range = (from, to) => Array.from({ length: Math.floor((to - from) / 5) + 1 }, (_, i) => from + i * 5);
const sizes = (...entries) => entries.map((entry) => {
  const [label, preview] = Array.isArray(entry) ? entry : [entry, null];
  const images = Array.isArray(preview) ? preview : (preview ? [preview] : []);
  return { value: label, label, image: images[images.length - 1] || null, images };
});
const image = (name) => `/competitions/assets/boards/${name}`;

// Exact product-size rectangles consumed by KilterBoardVisualization in the
// Android app. They come from product_sizes.edge_* in the same signed board
// snapshots as the browser catalogue. The image and hold canvas both fill this
// rectangle, so normalising placements against anything else moves the LEDs.
const PRODUCT_SIZE_BOUNDS = new Map([
  ['kilter:1:7', [0, 144, 0, 180]], ['kilter:1:8', [24, 120, 0, 156]],
  ['kilter:1:10', [0, 144, 0, 156]], ['kilter:1:14', [28, 116, 36, 156]],
  ['kilter:1:27', [0, 144, 12, 156]], ['kilter:1:28', [-24, 168, 0, 156]],
  ['kilter:8:17', [-44, 44, 24, 144]], ['kilter:8:18', [-44, 44, 24, 144]],
  ['kilter:8:19', [-44, 44, 24, 144]], ['kilter:8:21', [-56, 56, 24, 144]],
  ['kilter:8:22', [-56, 56, 24, 144]], ['kilter:8:23', [-44, 44, -12, 144]],
  ['kilter:8:24', [-44, 44, -12, 144]], ['kilter:8:25', [-56, 56, -12, 144]],
  ['kilter:8:26', [-56, 56, -12, 144]], ['kilter:8:29', [-56, 56, 24, 144]],
  ['tension:9:1', [0, 96, 0, 156]], ['tension:9:2', [0, 96, 4, 156]],
  ['tension:9:3', [0, 96, 8, 156]], ['tension:9:4', [0, 96, 8, 132]],
  ['tension:9:5', [16, 80, 8, 132]],
  ['tension:10:6', [-68, 68, 0, 144]], ['tension:10:7', [-68, 68, 0, 120]],
  ['tension:10:8', [-44, 44, 0, 144]], ['tension:10:9', [-44, 44, 0, 120]],
  ['tension:11:6', [-68, 68, 0, 144]], ['tension:11:7', [-68, 68, 0, 120]],
  ['tension:11:8', [-44, 44, 0, 144]], ['tension:11:9', [-44, 44, 0, 120]],
  ['grasshopper:1:4', [-68, 68, 0, 144]], ['grasshopper:1:5', [-44, 44, 0, 144]],
  ['grasshopper:1:6', [-44, 44, 0, 120]],
  ['decoy:2:1', [-68, 68, 0, 144]], ['decoy:2:2', [-44, 44, 0, 144]],
  ['decoy:2:3', [-44, 44, 0, 120]],
  ['soill:1:1', [-48, 48, -16, 144]], ['soill:1:2', [-72, 72, -16, 144]],
  ['touchstone:1:1', [-72, 72, -12, 144]],
]);

// Android's MoonBoard renderer instead uses the measured JSON asset aspect.
const MOONBOARD_ASPECTS = new Map([
  [1, 0.65], [2, 0.7007], [3, 0.6143], [4, 0.6487],
  [5, 0.6497], [6, 1], [7, 0.9365994],
]);

function productSizeId(entry) {
  const preview = Array.isArray(entry) ? entry[1] : null;
  const last = Array.isArray(preview) ? preview[preview.length - 1] : preview;
  const match = String(last || '').match(/(?:^|\/)board_(\d+)(?:_|\.webp$)/);
  return match ? Number(match[1]) : null;
}

/** Stable app/catalogue size coordinate. It is used for matching only and never published. */
export function catalogueProductSizeId(size) {
  return productSizeId([size?.label, size?.image]);
}

export const BOARD_TYPES = [
  {
    id: 'kilter-original', label: 'Kilter Original', brand: 'kilter',
    models: [{
      value: 'kilterboard-og', label: 'Kilter Board Original', layoutId: 1,
      sizes: sizes(
        ['12x12, with Kickboard', image('kilter/board_10.webp')],
        ['12x16 Super Wide, with Kickboard', image('kilter/board_28.webp')],
        ['12x8, with Kickboard', image('kilter/board_8.webp')],
        ['14x12 Super Tall, with Kickboard', image('kilter/board_7.webp')],
        ['10x7, no Kickboard', image('kilter/board_14.webp')],
        ['12x12, no Kickboard', image('kilter/board_27.webp')],
      ),
      angles: range(0, 70), defaultSize: '12x12, with Kickboard', defaultAngle: 40,
    }],
  },
  {
    id: 'kilter-homewall', label: 'Kilter Homewall', brand: 'kilter',
    models: [{
      value: 'kilterboard-homewall', label: 'Kilter Board Homewall', layoutId: 8,
      sizes: sizes(
        ['Homewall 10x12 — Full Ride', image('kilter/board_25.webp')],
        ['Homewall 10x7 — Full Ride', image('kilter/board_17.webp')],
        ['Homewall 10x10 — Full Ride', image('kilter/board_21.webp')],
        ['Homewall 10x7 — Mainline', image('kilter/board_18.webp')],
        ['Homewall 12x8 — Full Ride', image('kilter/board_23.webp')],
        ['Homewall 12x8 — Mainline', image('kilter/board_24.webp')],
        ['Homewall 10x12 — Mainline', image('kilter/board_26.webp')],
        ['Homewall 10x10 — Mainline', image('kilter/board_22.webp')],
        ['Homewall 10x7 — Auxiliary', image('kilter/board_19.webp')],
        ['Homewall 10x10 — Auxiliary', image('kilter/board_29.webp')],
      ),
      angles: range(0, 70), defaultSize: 'Homewall 10x12 — Full Ride', defaultAngle: 40,
    }],
  },
  {
    id: 'moonboard', label: 'MoonBoard', brand: 'moonboard',
    models: [
      { value: 'moonboard-2016', label: 'MoonBoard 2016', layoutId: 2, sizes: sizes(['11x18', image('moonboard/moonboard_2016.webp')]), angles: [25, 40], defaultAngle: 40 },
      { value: 'moonboard-masters-2017', label: 'MoonBoard Masters 2017', layoutId: 4, sizes: sizes(['11x18', image('moonboard/moonboard_2017.webp')]), angles: [25, 40], defaultAngle: 40 },
      { value: 'moonboard-masters-2019', label: 'MoonBoard Masters 2019', layoutId: 5, sizes: sizes(['11x18', image('moonboard/moonboard_2019.webp')]), angles: [25, 40], defaultAngle: 40 },
      { value: 'mini-moonboard-2020', label: 'Mini MoonBoard 2020', layoutId: 6, sizes: sizes(['11x12', image('moonboard/mini_moonboard_2020.webp')]), angles: [40], defaultAngle: 40 },
      { value: 'moonboard-2024', label: 'MoonBoard 2024', layoutId: 3, sizes: sizes(['11x18', image('moonboard/moonboard_2024.webp')]), angles: [25, 40], defaultAngle: 40 },
      { value: 'mini-moonboard-2025', label: 'Mini MoonBoard 2025', layoutId: 7, sizes: sizes(['11x12', [
        image('moonboard/mini_moonboard_2025_base.png'), image('moonboard/mini_moonboard_2025_hold_set_f.png'),
        image('moonboard/mini_moonboard_2025_original_school_holds.png'), image('moonboard/mini_moonboard_2025_wooden_holds_b.png'),
        image('moonboard/mini_moonboard_2025_wooden_holds_c.png'),
      ]]), angles: [40], defaultAngle: 40 },
      { value: 'moonboard-2010', label: 'MoonBoard 2010', layoutId: 1, sizes: sizes(['11x18', [
        image('moonboard/moonboard_2010_base.png'), image('moonboard/moonboard_2010_original_school_holds.png'),
      ]]), angles: [40], defaultAngle: 40 },
    ],
  },
  {
    id: 'tension', label: 'Tension', brand: 'tension',
    models: [
      {
        value: 'tension-board-1', label: 'Tension Board', layoutId: 9,
        sizes: sizes(...['Full Wall', 'Half Kickboard', 'No Kickboard', 'Short', 'Short & Narrow']
          .map((label, index) => [label, image(`tension/board_${index + 1}.webp`)])),
        angles: range(0, 50), defaultSize: 'Full Wall', defaultAngle: 40,
      },
      {
        value: 'tension-board-2-mirror', label: 'Tension Board 2 (Mirror)', layoutId: 10,
        sizes: sizes(...['12 high x 12 wide', '10 high x 12 wide', '12 high x 8 wide', '10 high x 8 wide']
          .map((label, index) => [label, image(`tension/board_${index + 6}_10.webp`)])),
        angles: range(0, 65), defaultSize: '12 high x 12 wide', defaultAngle: 40,
      },
      {
        value: 'tension-board-2-spray', label: 'Tension Board 2 (Spray)', layoutId: 11,
        sizes: sizes(...['12 high x 12 wide', '10 high x 12 wide', '12 high x 8 wide', '10 high x 8 wide']
          .map((label, index) => [label, image(`tension/board_${index + 6}_11.webp`)])),
        angles: range(0, 65), defaultSize: '12 high x 12 wide', defaultAngle: 40,
      },
    ],
  },
  {
    id: 'grasshopper', label: 'Grasshopper', brand: 'grasshopper',
    models: [{
      value: 'grasshopper-board', label: 'Grasshopper Board', layoutId: 1,
      sizes: sizes(['GrandMaster (12 x 12)', image('grasshopper/board_4.webp')], ['Master (8 x 12)', image('grasshopper/board_5.webp')], ['Ninja (8 x 10)', image('grasshopper/board_6.webp')]),
      angles: range(-5, 60), defaultSize: 'GrandMaster (12 x 12)', defaultAngle: 40,
    }],
  },
  {
    id: 'decoy', label: 'Decoy', brand: 'decoy',
    models: [{ value: 'decoy', label: 'Decoy', layoutId: 2, sizes: sizes(['12 x 12', image('decoy/board_1_2.webp')], ['8 x 12', image('decoy/board_2_2.webp')], ['8 x 10', image('decoy/board_3_2.webp')]), angles: range(0, 65), defaultSize: '12 x 12', defaultAngle: 40 }],
  },
  {
    id: 'soill', label: 'So iLL', brand: 'soill',
    models: [{ value: 'soill-board', label: 'So iLL Board', layoutId: 1, sizes: sizes(['12 x 12', image('soill/board_2.webp')], ['8 x 12', image('soill/board_1.webp')]), angles: range(0, 70), defaultSize: '12 x 12', defaultAngle: 40 }],
  },
  {
    id: 'touchstone', label: 'Touchstone', brand: 'touchstone',
    models: [{ value: 'touchstone-board', label: 'Touchstone Board', layoutId: 1, sizes: sizes(['Full Size (12 x 12)', image('touchstone/board_1.webp')]), angles: [35, 40], defaultSize: 'Full Size (12 x 12)', defaultAngle: 40 }],
  },
];

export function boardType(id) {
  return BOARD_TYPES.find((entry) => entry.id === id) || null;
}

export function resolveBoardSelection(typeId, modelValue, sizeValue, angleValue) {
  const type = boardType(typeId);
  const model = type?.models.find((entry) => entry.value === modelValue);
  const angle = Number(angleValue);
  if (!type || !model || !model.sizes.some((entry) => entry.value === sizeValue)
    || !model.angles.includes(angle)) return null;
  return { brand: type.brand, model: model.value, layout_id: model.layoutId, size: sizeValue, angle };
}

/** Internal catalogue coordinates. Product-size ids never enter the public competition document. */
export function resolveCatalogueSelection(typeId, modelValue, sizeValue, angleValue) {
  const type = boardType(typeId);
  const model = type?.models.find((entry) => entry.value === modelValue);
  const sourceSize = model?.sizes.find((entry) => entry.value === sizeValue);
  const originalEntry = model?.sizes.findIndex((entry) => entry.value === sizeValue);
  const angle = Number(angleValue);
  if (!type || !model || !sourceSize || !model.angles.includes(angle)) return null;
  // The image name intentionally mirrors the app's product_size_id. MoonBoard
  // has one physical size per layout and therefore needs no size filter.
  const configured = model.sizes[originalEntry];
  return {
    brand: type.brand,
    layoutId: model.layoutId,
    modelLabel: model.label,
    productSizeId: productSizeId([configured.label, configured.image]),
    angle,
  };
}

/** Public presentation assets for a validated competition board. */
export function boardPreviewImages(board) {
  const model = BOARD_TYPES.flatMap((type) => type.models)
    .find((entry) => entry.value === board?.model && entry.layoutId === board?.layout_id);
  return model?.sizes.find((entry) => entry.value === board?.size)?.images || [];
}

/** Exact Android image/canvas geometry for one validated public board choice. */
export function boardRenderGeometry(board) {
  const type = BOARD_TYPES.find((entry) => entry.brand === board?.brand
    && entry.models.some((model) => model.value === board?.model && model.layoutId === board?.layout_id));
  const model = type?.models.find((entry) => entry.value === board?.model
    && entry.layoutId === board?.layout_id);
  const size = model?.sizes.find((entry) => entry.value === board?.size);
  if (!type || !model || !size) return null;
  if (type.brand === 'moonboard') {
    const aspect = MOONBOARD_ASPECTS.get(model.layoutId);
    return Number.isFinite(aspect) ? { aspect, layoutId: model.layoutId, productSizeId: null } : null;
  }
  const sizeId = productSizeId([size.label, size.image]);
  const bounds = PRODUCT_SIZE_BOUNDS.get(`${type.brand}:${model.layoutId}:${sizeId}`);
  if (!bounds) return null;
  const [left, right, bottom, top] = bounds;
  return {
    aspect: (right - left) / (top - bottom), bounds: [...bounds],
    layoutId: model.layoutId, productSizeId: sizeId,
  };
}

/** Stable key for request/race isolation; every catalogue coordinate is included. */
export function catalogueBoardKey(board) {
  if (!board || typeof board.brand !== 'string' || !Number.isInteger(board.layoutId)
    || !Number.isInteger(board.angle)
    || (board.brand !== 'moonboard' && !Number.isInteger(board.productSizeId))) return '';
  return `${board.brand}:${board.layoutId}:${board.productSizeId ?? 'layout'}:${board.angle}`;
}

/** Fail-closed admission check for a decoded row from a board catalogue. */
export function catalogueClimbMatches(climb, board) {
  return Boolean(catalogueBoardKey(board)
    && climb?.brand === board.brand
    && climb?.layoutId === board.layoutId
    && climb?.angle === board.angle
    && (board.productSizeId == null || climb?.productSizeId === board.productSizeId));
}

export const __geometryTesting = { PRODUCT_SIZE_BOUNDS, MOONBOARD_ASPECTS };
