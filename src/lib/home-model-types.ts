export type ModelRoom = {
  id: string
  name: string
  polygon: [number, number][]
  label: [number, number]
  surface: 'wood' | 'tile' | 'stone'
  source: string
  finish?: 'herringbone'
  wallFinish?: { material: 'tile'; source: string; note: string }
  dimensions: { label: string; value: string }[]
  note: string
}
export type ModelObject = {
  id: string
  label: string
  category:
    | 'visible'
    | 'network'
    | 'diagramNetwork'
    | 'lighting'
    | 'switches'
    | 'water'
    | 'outlets'
    | 'cabling'
  role:
    | 'greenPipe'
    | 'orangePipe'
    | 'network'
    | 'fiber'
    | 'lighting'
    | 'switch'
    | 'waterPipe'
    | 'drainPipe'
    | 'outlet'
    | 'cableDuct'
  kind: 'region' | 'relationship' | 'box' | 'guide'
  path: [number, number, number][]
  guide?: 'direction' | 'connection'
  landmarks?: { index: number; label: string }[]
  signal?: 'ethernet' | 'tv' | 'fiber' | 'unidentified'
  endpoints?: [string, string]
  endpointBoxes?: [string | null, string | null]
  powerEndpoint?: true
  outletCount?: number
  keyCount?: number
  activation?: { source: string; note: string }
  route?: {
    path: [number, number, number][]
    sources: string[]
    references: string[]
    note: string
    rooms?: string[]
    to?: { object: string; end: 'first' | 'last' }
  }
  historical?: { source: string; note: string }
  links?: [string, string]
  rooms: string[]
  source: string
  evidence: string[]
  note: string
  surfaceColor?: 'green' | 'orange' | 'white' | 'red' | 'blue' | 'gray'
  displayDiameter?: number
  displaySize?: [number, number, number]
  mount?: 'floor' | 'wall' | 'ceiling'
  rotation?: number
  boxStyle?: 'open' | 'covered' | 'roundCap' | 'roundOpen'
  trace?: { panorama: string; direction: PanoramaDirection; pixels: [number, number][] }
}
export type PanoramaDirection = 'front' | 'back' | 'left' | 'right' | 'up' | 'down'
export type ModelPanorama = {
  id: string
  label: string
  room: string
  stem: string
  source: string
  note: string
  position?: [number, number, number]
  startDirection?: PanoramaDirection
  startUv?: [number, number]
  links?: { id: string; direction: [number, number, number] }[]
}
export type ModelView = {
  kind: 'overview' | 'reverse' | 'top' | 'focus' | 'walk' | 'photo' | 'object'
  serial: number
  room?: string
  viewpoint?: string
  object?: string
}
export type SourceStage = 'all' | 'onsite' | 'construction' | 'design' | 'delivery' | 'record'
export type WalkMotion = 'forward' | 'back' | 'left' | 'right' | null
export type ModelDiagram = {
  size: [number, number]
  sha256: string
  note: string
  marks: {
    id: string
    label: string
    pixel: [number, number]
    note: string
    historical?: ModelObject['historical']
  }[]
  lines: { id: string; label: string; segments: [number, number][][]; note: string }[]
  comparison?: {
    target: string
    size: [number, number]
    sha256: string
    matrix: number[]
    note: string
    anchors: {
      id: string
      label: string
      pixel: [number, number]
      targetPixel: [number, number]
      use: 'fit' | 'check'
      note: string
    }[]
  }
}
export type HomeModelData = {
  version: number
  unit: string
  extent: [number, number]
  referenceHeight: number
  heightNote: string
  geometryNote: string
  orientation: string
  appearanceNote: string
  routeNote: string
  sources: Record<
    string,
    {
      label: string
      kind: string
      date: string
      url: string
      asset?: string
      stage?: Exclude<SourceStage, 'all'>
      diagram?: ModelDiagram
    }
  >
  rooms: ModelRoom[]
  walls: {
    from: [number, number]
    to: [number, number]
    thickness: number
    openings: {
      offset: number
      width: number
      sill: number
      height: number
      kind: 'door' | 'window'
      treatment?: 'slatted'
      source?: string
      note?: string
    }[]
  }[]
  furniture: {
    kind: string
    label: string
    note: string
    room: string
    position: [number, number]
    size: [number, number, number]
    rotation?: number
    source: string
    finish?: 'olive' | 'white' | 'pink' | 'linen'
    variant?: 'carved' | 'low' | 'wardrobe' | 'shoe' | 'roman' | 'petal' | 'amber' | 'square'
    elevation?: number
    legSpacing?: number
    seatHeight?: number
    clearance?: number
    compartments?: [number, number]
    fixture?: 'sink' | 'cooktop'
    dimensions?: { label: string; value: string }[]
  }[]
  viewpoints?: {
    id: string
    label: string
    room: string
    position: [number, number, number]
    target: [number, number, number]
    source: string
    note: string
  }[]
  objects: ModelObject[]
  panoramas: ModelPanorama[]
  constructionModel: { file: string; note: string; source: string }
  powerSupply?: { box: string; source: string; note: string }
  constructionRegistration?: {
    source: string
    targetSource: string
    note: string
    rotation: number
    scale: [number, number, number]
    translation: [number, number, number]
    meshSha256: string
    bounds: [[number, number, number], [number, number, number]]
    anchors: { label: string; scan: [number, number]; plan: [number, number]; note: string }[]
  }
  observedContinuations?: {
    objects: [string, string]
    ends: [number, number]
    source: string
    evidence: string[]
    note: string
    bridge?: false
  }[]
  evidence: {
    id: string
    url: string
    caption: string
    panoramaId?: string
    direction?: PanoramaDirection
    focusUv?: [number, number]
  }[]
}

/** Geometry consumed by the shared renderer; documentary fields stay with the private reader. */
export type HomeSceneData = Pick<
  HomeModelData,
  | 'extent'
  | 'referenceHeight'
  | 'objects'
  | 'powerSupply'
  | 'constructionRegistration'
  | 'observedContinuations'
> & {
  rooms: (Pick<ModelRoom, 'id' | 'name' | 'polygon' | 'label' | 'surface' | 'finish'> & {
    wallFinish?: { material: 'tile' }
  })[]
  walls: (Omit<HomeModelData['walls'][number], 'openings'> & {
    openings: Pick<
      HomeModelData['walls'][number]['openings'][number],
      'offset' | 'width' | 'sill' | 'height' | 'kind' | 'treatment'
    >[]
  })[]
  furniture: Omit<HomeModelData['furniture'][number], 'source' | 'note' | 'dimensions' | 'label'>[]
  viewpoints?: Pick<
    NonNullable<HomeModelData['viewpoints']>[number],
    'id' | 'room' | 'position' | 'target'
  >[]
  constructionModel?: HomeModelData['constructionModel']
}
