import test from 'node:test'
import assert from 'node:assert/strict'
import { projectPublicModel, validatePublicModel } from '../lib/public-model.mjs'

const model = () => ({
  version: 1,
  unit: 'm',
  extent: [5, 5],
  referenceHeight: 2.8,
  rooms: [
    {
      id: 'study',
      name: '书房',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
      ],
      label: [2, 2],
      surface: 'wood',
      source: 'PRIVATE_SOURCE',
      note: 'PRIVATE_NOTE',
      wallFinish: { material: 'tile', source: 'PRIVATE_WALL', note: 'PRIVATE_WALL_NOTE' },
    },
  ],
  walls: [
    {
      from: [0, 0],
      to: [4, 0],
      thickness: 0.2,
      source: 'PRIVATE_WALL',
      openings: [
        {
          offset: 1,
          width: 1,
          sill: 0,
          height: 2,
          kind: 'door',
          source: 'PRIVATE_PLAN',
          note: 'PRIVATE_NOTE',
        },
      ],
    },
  ],
  furniture: [
    {
      kind: 'desk',
      room: 'study',
      position: [2, 2],
      size: [1, 1, 1],
      label: 'PRIVATE_ITEM',
      source: 'PRIVATE_RECEIPT',
      dimensions: [],
      note: 'PRIVATE_NOTE',
    },
  ],
  objects: [{ evidence: ['PRIVATE_PHOTO'] }],
  panoramas: ['PRIVATE_VR'],
  sources: { private: 'PRIVATE_URL' },
  secretFutureField: 'PRIVATE_FUTURE',
})
test('public projection discards documentary, future and nested private fields', () => {
  const result = projectPublicModel(model())
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/)
  assert.deepEqual(result.objects, [])
  assert.deepEqual(result.rooms[0].wallFinish, { material: 'tile' })
  assert.deepEqual(result.furniture[0].position, [2, 2])
})
test('public reader rejects unreviewed fields at every level', () => {
  for (const mutate of [
    (m) => {
      m.sources = {}
    },
    (m) => {
      m.rooms[0].note = 'secret'
    },
    (m) => {
      m.rooms[0].wallFinish.source = 'secret'
    },
    (m) => {
      m.walls[0].openings[0].source = 'secret'
    },
    (m) => {
      m.furniture[0].label = 'secret'
    },
    (m) => {
      m.objects.push({})
    },
    (m) => {
      m.rooms[0].name = 'private address'
    },
    (m) => {
      m.furniture[0].position[0] = NaN
    },
  ]) {
    const safe = projectPublicModel(model())
    mutate(safe)
    assert.throws(() => validatePublicModel(safe))
  }
})
