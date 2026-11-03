/** Public data is a positive projection. New private fields never become public by default. */
const fields = {
  root: ['version', 'unit', 'extent', 'referenceHeight', 'rooms', 'walls', 'furniture', 'objects'],
  room: ['id', 'name', 'polygon', 'label', 'surface', 'finish', 'wallFinish'],
  wall: ['from', 'to', 'thickness', 'openings'],
  opening: ['offset', 'width', 'sill', 'height', 'kind', 'treatment'],
  furniture: [
    'kind',
    'room',
    'position',
    'size',
    'rotation',
    'finish',
    'variant',
    'elevation',
    'legSpacing',
    'seatHeight',
    'clearance',
    'compartments',
    'fixture',
  ],
}
const pick = (value, keys) =>
  Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]))

export function projectPublicModel(model) {
  const result = {
    version: 1,
    unit: 'm',
    extent: model.extent,
    referenceHeight: model.referenceHeight,
    rooms: model.rooms.map((room) => ({
      ...pick(
        room,
        fields.room.filter((key) => key !== 'wallFinish'),
      ),
      ...(room.wallFinish ? { wallFinish: { material: room.wallFinish.material } } : {}),
    })),
    walls: model.walls.map((wall) => ({
      ...pick(wall, fields.wall),
      openings: wall.openings.map((opening) => pick(opening, fields.opening)),
    })),
    furniture: model.furniture.map((item) => pick(item, fields.furniture)),
    objects: [],
  }
  validatePublicModel(result)
  return result
}

export function validatePublicModel(model) {
  const fail = (message) => {
    throw new Error(`Public model: ${message}`)
  }
  const keys = (value, allowed) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected object')
    for (const key of Object.keys(value))
      if (!allowed.includes(key)) fail(`unexpected field ${key}`)
  }
  const number = (value) => {
    if (!Number.isFinite(value)) fail('expected finite number')
  }
  const point = (value, length) => {
    if (!Array.isArray(value) || value.length !== length) fail('invalid coordinate')
    value.forEach(number)
  }
  const choice = (value, allowed) => {
    if (!allowed.includes(value)) fail('unexpected value')
  }
  const identifier = (value) => {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,50}$/.test(value))
      fail('invalid identifier')
  }
  keys(model, fields.root)
  if (model.version !== 1 || model.unit !== 'm') fail('unsupported version or unit')
  point(model.extent, 2)
  number(model.referenceHeight)
  if (!Array.isArray(model.objects) || model.objects.length) fail('private objects are forbidden')
  if (
    !Array.isArray(model.rooms) ||
    !model.rooms.length ||
    !Array.isArray(model.walls) ||
    !Array.isArray(model.furniture)
  )
    fail('missing geometry')
  const ids = new Set()
  for (const room of model.rooms) {
    keys(room, fields.room)
    identifier(room.id)
    if (ids.has(room.id)) fail('duplicate room')
    ids.add(room.id)
    choice(room.name, [
      '玄关',
      '客厅',
      '餐厅',
      '厨房',
      '主卧',
      '次卧',
      '次卧（宝宝房）',
      '书房',
      '卫生间',
      '阳台',
      '过道',
      '走廊',
      '干区',
    ])
    point(room.label, 2)
    if (!Array.isArray(room.polygon) || room.polygon.length < 3) fail('invalid polygon')
    room.polygon.forEach((p) => point(p, 2))
    choice(room.surface, ['wood', 'tile', 'stone'])
    if (room.finish !== undefined) choice(room.finish, ['herringbone'])
    if (room.wallFinish !== undefined) {
      keys(room.wallFinish, ['material'])
      choice(room.wallFinish.material, ['tile'])
    }
  }
  for (const wall of model.walls) {
    keys(wall, fields.wall)
    point(wall.from, 2)
    point(wall.to, 2)
    number(wall.thickness)
    if (!Array.isArray(wall.openings)) fail('invalid openings')
    for (const opening of wall.openings) {
      keys(opening, fields.opening)
      for (const key of ['offset', 'width', 'sill', 'height']) number(opening[key])
      choice(opening.kind, ['door', 'window'])
      if (opening.treatment !== undefined) choice(opening.treatment, ['slatted'])
    }
  }
  for (const item of model.furniture) {
    keys(item, fields.furniture)
    choice(item.kind, [
      'liftingDesk',
      'sofa',
      'shelf',
      'drawer',
      'computer',
      'chair',
      'bed',
      'cabinet',
      'rug',
      'coffee',
      'screen',
      'dining',
      'sideboard',
      'airFryer',
      'soyMilkMaker',
      'refrigerator',
      'counter',
      'waterHeater',
      'dishRack',
      'hangingBin',
      'basin',
      'toilet',
      'curtain',
      'ceiling',
      'chandelier',
      'fanLight',
      'airConditioner',
      'pendant',
      'table',
      'flushLight',
      'laundry',
      'door',
      'hood',
      'mirror',
      'shower',
      'desk',
    ])
    if (!ids.has(item.room)) fail('unknown furniture room')
    point(item.position, 2)
    point(item.size, 3)
    for (const key of ['rotation', 'elevation', 'legSpacing', 'seatHeight', 'clearance'])
      if (item[key] !== undefined) number(item[key])
    if (item.compartments !== undefined) point(item.compartments, 2)
    if (item.finish !== undefined) choice(item.finish, ['olive', 'white', 'pink', 'linen'])
    if (item.variant !== undefined)
      choice(item.variant, [
        'carved',
        'low',
        'wardrobe',
        'shoe',
        'roman',
        'petal',
        'amber',
        'square',
      ])
    if (item.fixture !== undefined) choice(item.fixture, ['sink', 'cooktop'])
  }
  return model
}
