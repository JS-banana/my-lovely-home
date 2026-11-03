'use client'

import { useEffect, useRef } from 'react'
import type * as Three from 'three'

import type { HomeSceneData, ModelObject, ModelView, WalkMotion } from '@/lib/home-model-types'
import { Button } from './ui/button'
import styles from './HomeModel.module.css'
import { sceneKeyBlocked } from '@/lib/interaction'
import { createMaterialContextUpdater, updateContinuationVisibility } from '@/lib/home-scene-state'
import { createSurfaceCanvas, createTextileCanvases } from '@/lib/home-scene-patterns'

type Props = {
  model: HomeSceneData
  mode: 'home' | 'pipes'
  visibleObjects: ModelObject[]
  primaryObjects: ModelObject[]
  powerTarget?: string
  showPowerSupply: boolean
  showRoutes: boolean
  selected: string
  wallCut: number
  furniture: boolean
  structure: boolean
  roomLabels: boolean
  view: ModelView
  motion: WalkMotion
  onBlocked: (blocked: boolean) => void
  onStructureBase: (base: 'model' | 'loading' | 'scan') => void
  onSelect: (id: string) => void
  onRoomChange: (id: string) => void
  onStatus: (status: 'loading' | 'ready' | 'error') => void
}

export default function HomeModelScene(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const labels = useRef(new Map<string, HTMLButtonElement>())
  const powerLabel = useRef<HTMLButtonElement>(null)
  const powerTargetLabel = useRef<HTMLButtonElement>(null)
  const endpointLabels = useRef<(HTMLButtonElement | null)[]>([])
  const guideLabels = useRef(new Map<string, HTMLButtonElement>())
  const latest = useRef(props)
  const refresh = useRef<(() => void) | null>(null)
  latest.current = props

  useEffect(() => {
    const element = host.current!
    let stopped = false
    let dispose = () => {}
    latest.current.onStatus('loading')

    async function start() {
      const THREE = await import('three')
      const [
        { OrbitControls },
        { RoundedBoxGeometry },
        { Line2 },
        { LineGeometry },
        { LineMaterial },
        { createHomeOcclusion },
        { RoomEnvironment },
      ] = await Promise.all([
        import('three/addons/controls/OrbitControls.js'),
        import('three/addons/geometries/RoundedBoxGeometry.js'),
        import('three/addons/lines/Line2.js'),
        import('three/addons/lines/LineGeometry.js'),
        import('three/addons/lines/LineMaterial.js'),
        import('@/lib/home-scene-occlusion'),
        import('three/addons/environments/RoomEnvironment.js'),
      ])
      if (stopped) return
      const model = latest.current.model
      const updateMaterialContext = createMaterialContextUpdater()
      const root = element.closest(`.${styles.viewer}`)!
      const readColor = (role: string) =>
        getComputedStyle(root).getPropertyValue(`--model-${role}`).trim()
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(readColor('background'))
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80)
      // A failed initialization still owns every resource acquired before the failure.
      let renderer: Three.WebGLRenderer
      let controls: InstanceType<typeof OrbitControls>
      let homeOcclusion: ReturnType<typeof createHomeOcclusion>
      let studioLight: Three.WebGLRenderTarget
      const materials = new Set<Three.Material>()
      const textures = new Set<Three.Texture>()
      let frame = 0,
        viewSerial = -1,
        disposed = false,
        readyReported = false
      let currentFraming: (() => void) | null = null
      let relocationAnimation: Animation | null = null
      let resizeObserver: ResizeObserver | undefined
      let themeObserver: MutationObserver | undefined
      let shadowLight: Three.DirectionalLight | undefined
      let scanBase: Three.Group | undefined,
        scanAttempted = false
      const events = new AbortController()
      dispose = () => {
        if (disposed) return
        disposed = true
        refresh.current = null
        cancelAnimationFrame(frame)
        relocationAnimation?.cancel()
        resizeObserver?.disconnect()
        themeObserver?.disconnect()
        controls?.dispose()
        events.abort()
        for (const button of labels.current.values()) button.style.display = 'none'
        if (powerLabel.current) powerLabel.current.style.display = 'none'
        if (powerTargetLabel.current) powerTargetLabel.current.style.display = 'none'
        for (const label of endpointLabels.current) if (label) label.style.display = 'none'
        for (const label of guideLabels.current.values()) label.style.display = 'none'
        scene.traverse((object) => {
          ;(object as Three.Mesh).geometry?.dispose()
        })
        for (const mat of materials) mat.dispose()
        for (const texture of textures) {
          texture.dispose()
          const bitmap = texture.source.data
          if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) bitmap.close()
        }
        shadowLight?.shadow.dispose()
        homeOcclusion?.dispose()
        studioLight?.dispose()
        renderer?.dispose()
        renderer?.domElement.remove()
      }
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFShadowMap
      renderer.localClippingEnabled = true
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05
      renderer.outputColorSpace = THREE.SRGBColorSpace
      homeOcclusion = createHomeOcclusion(renderer, scene, camera)
      const studio = new RoomEnvironment()
      let environmentGenerator: Three.PMREMGenerator | undefined
      try {
        environmentGenerator = new THREE.PMREMGenerator(renderer)
        studioLight = environmentGenerator.fromScene(studio, 0.04)
      } finally {
        studio.dispose()
        environmentGenerator?.dispose()
      }
      renderer.domElement.setAttribute('aria-label', '三维房屋场景，可拖动旋转、缩放或选择房间')
      renderer.domElement.setAttribute('role', 'img')
      renderer.domElement.tabIndex = 0
      renderer.domElement.style.touchAction = 'none'
      element.appendChild(renderer.domElement)
      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = false
      controls.minDistance = 2
      controls.maxDistance = 60
      controls.maxPolarAngle = Math.PI / 2 - 0.08
      controls.minPolarAngle = 0.025
      controls.enablePan = true
      const group = new THREE.Group()
      group.position.set(-model.extent[0] / 2, 0, -model.extent[1] / 2)
      scene.add(group)
      const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), latest.current.wallCut)
      // Room focus is a display cutaway; source walls, furniture and walk geometry stay intact.
      const roomBackCut = new THREE.Plane(new THREE.Vector3(0, -1, 0), model.referenceHeight)
      const roomFrontCut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.12)
      const roomSides = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0)),
        new THREE.Plane(new THREE.Vector3(-1, 0, 0)),
        new THREE.Plane(new THREE.Vector3(0, 0, 1)),
        new THREE.Plane(new THREE.Vector3(0, 0, -1)),
      ]
      const roomWallFinishes = new Map<Three.Material, [Three.Material, Three.Material]>()
      const roomWalls: {
        group: Three.Group
        midpoint: Three.Vector2
        normal: Three.Vector2
        length: number
        thickness: number
      }[] = []
      let focusedRoom: HomeSceneData['rooms'][number] | undefined
      const wallGroup = new THREE.Group()
      const furnitureGroup = new THREE.Group()
      const ceilingGroup = new THREE.Group()
      group.add(wallGroup, furnitureGroup, ceilingGroup)
      const roleMaterials: { material: Three.Material & { color: Three.Color }; role: string }[] =
        []
      const floorMeshes = new Map<
        string,
        Three.Mesh<Three.BufferGeometry, Three.MeshStandardMaterial>
      >()
      const furnitureMeshes = new Map<number, Three.Group>()
      const wallCaps: { mesh: Three.Mesh; bottom: number; top: number; wall: Three.Group }[] = []
      const objectGroups = new Map<string, Three.Group>()
      const baseGroups = new Map<string, Three.Group>()
      const routeGroups = new Map<string, { group: Three.Group; highlight: Three.Group }>()
      const objectHighlights = new Map<string, Three.Group>()
      const pickable: Three.Object3D[] = []
      const material = (
        role: string,
        extra: Three.MeshStandardMaterialParameters = {},
        themeSensitive = true,
      ) => {
        const value = new THREE.MeshStandardMaterial({
          color: readColor(role),
          roughness: 0.82,
          ...extra,
        })
        materials.add(value)
        if (themeSensitive) roleMaterials.push({ material: value, role })
        return value
      }
      const wallMaterial = material('wall', {
        clippingPlanes: [cut],
        clipShadows: true,
        transparent: true,
      })
      const edgeMaterial = material('frame', {
        clippingPlanes: [cut],
        clipShadows: true,
        transparent: true,
      })
      const trim = material('trim', { clippingPlanes: [cut], clipShadows: true, transparent: true })
      const capMaterial = material('wall-edge')
      const glassMaterial = material(
        'glass',
        {
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          clippingPlanes: [cut],
          roughness: 0.12,
          metalness: 0.15,
        },
        false,
      )
      const wood = material('furniture', { roughness: 0.62 }, false)
      const [fabric, olive, pink, linen, rust] = [
        'fabric',
        'fabric-olive',
        'fabric-pink',
        'fabric-linen',
        'fabric-rust',
      ].map((role) => {
        const textile = new THREE.MeshPhysicalMaterial({
          color: readColor(role),
          roughness: 0.94,
          sheen: 0.35,
          sheenColor: readColor('light'),
          sheenRoughness: 0.8,
        })
        materials.add(textile)
        return textile
      })
      const pale = material('ceramic', { roughness: 0.55 }, false)
      const dark = material('metal', { metalness: 0.2, roughness: 0.62 }, false)
      const steel = material('steel', { metalness: 0.65, roughness: 0.34 }, false)
      const applianceDark = material('appliance-dark', { metalness: 0.15, roughness: 0.28 }, false)
      const yellowHose = material('yellow-hose', { roughness: 0.8 }, false)
      const white = material('trim', { roughness: 0.78 }, false)
      const cabinetRecess = material('cabinet-recess', { roughness: 0.9 }, false)
      const ceilingMaterial = material('trim', { roughness: 0.84, side: THREE.DoubleSide }, false)
      const screen = material('screen', { roughness: 0.18, metalness: 0.12 }, false)
      const blinds = material(
        'blind',
        { clippingPlanes: [cut], clipShadows: true, transparent: true },
        false,
      )
      const blindTapes = material(
        'furniture',
        { roughness: 0.9, clippingPlanes: [cut], clipShadows: true, transparent: true },
        false,
      )
      const brass = material('brass', { metalness: 0.72, roughness: 0.25 }, false)
      const warmGlass = material(
        'amber',
        { transparent: true, opacity: 0.72, depthWrite: false, roughness: 0.12, metalness: 0.08 },
        false,
      )
      const textileMaterials = new Set<Three.Material>([fabric, olive, pink, linen, rust])
      const textileWorldSize = 0.04,
        textileFallbackRepeat = 8
      const paddedSeamMaterials = new Map<Three.Material, Three.MeshPhysicalMaterial>()
      const paddedSeamMaterial = (mat: Three.Material) => {
        const existing = paddedSeamMaterials.get(mat)
        if (existing) return existing
        const seam = mat.clone() as Three.MeshPhysicalMaterial
        seam.color.multiplyScalar(0.76)
        seam.sheen *= 0.45
        seam.bumpMap = null
        seam.bumpScale = 0
        materials.add(seam)
        paddedSeamMaterials.set(mat, seam)
        return seam
      }

      const box = (
        parent: Three.Group,
        size: number[],
        position: number[],
        mat: Three.Material,
        rotation = 0,
        radius = 0,
        padded: boolean | number = false,
      ) => {
        const geometry = padded
          ? new THREE.BoxGeometry(size[0], size[1], size[2], 12, 8, 12)
          : radius > 0
            ? new RoundedBoxGeometry(
                size[0],
                size[1],
                size[2],
                3,
                Math.min(radius, ...size.map((n) => n / 2)),
              )
            : new THREE.BoxGeometry(...(size as [number, number, number]))
        if (padded) {
          // A soft, sewn volume inside the original bounds; no change to the item footprint.
          const points = geometry.getAttribute('position'),
            normals = geometry.getAttribute('normal'),
            exponent = typeof padded === 'number' ? padded : 6
          for (let i = 0; i < points.count; i++) {
            const x = (points.getX(i) * 2) / size[0],
              y = (points.getY(i) * 2) / size[1],
              z = (points.getZ(i) * 2) / size[2],
              scale = Math.pow(
                Math.abs(x) ** exponent + Math.abs(y) ** exponent + Math.abs(z) ** exponent,
                -1 / exponent,
              )
            points.setXYZ(
              i,
              (x * scale * size[0]) / 2,
              (y * scale * size[1]) / 2,
              (z * scale * size[2]) / 2,
            )
            const normal = new THREE.Vector3(
              (Math.sign(x) * Math.abs(x) ** (exponent - 1)) / size[0],
              (Math.sign(y) * Math.abs(y) ** (exponent - 1)) / size[1],
              (Math.sign(z) * Math.abs(z) ** (exponent - 1)) / size[2],
            ).normalize()
            normals.setXYZ(i, normal.x, normal.y, normal.z)
          }
        }
        const mesh = new THREE.Mesh(geometry, mat)
        mesh.position.set(...(position as [number, number, number]))
        mesh.rotation.y = rotation
        mesh.castShadow = true
        mesh.receiveShadow = true
        if (padded && textileMaterials.has(mat)) {
          // A continuous welt follows the cushion surface, around its broad face.
          const exponent = typeof padded === 'number' ? padded : 6
          const thin = size.indexOf(Math.min(...size))
          const axes = [0, 1, 2].filter((axis) => axis !== thin)
          const radius = Math.min(0.0015, Math.min(...size) * 0.008)
          const section = Math.pow(1 - 0.7 ** exponent, 1 / exponent)
          const path = new (class extends THREE.Curve<Three.Vector3> {
            constructor() {
              super()
            }
            getPoint(t: number, target = new THREE.Vector3()) {
              const coordinates = [0, 0, 0]
              coordinates[thin] = size[thin] * 0.35
              for (const [index, axis] of axes.entries()) {
                const trig = index === 0 ? Math.cos(t * Math.PI * 2) : Math.sin(t * Math.PI * 2)
                const position =
                  (Math.sign(trig) * Math.abs(trig) ** (2 / exponent) * section * size[axis]) / 2
                coordinates[axis] = THREE.MathUtils.clamp(
                  position,
                  -size[axis] / 2 + radius,
                  size[axis] / 2 - radius,
                )
              }
              return target.set(coordinates[0], coordinates[1], coordinates[2])
            }
          })()
          const seam = new THREE.Mesh(
            new THREE.TubeGeometry(path, 80, radius, 4, true),
            paddedSeamMaterial(mat),
          )
          seam.receiveShadow = true
          mesh.add(seam)
        }
        if (mat === wood) {
          // Meter-based veneer grain follows the longer axis of each box face.
          const uv = geometry.getAttribute('uv'),
            original = uv.clone()
          // Keep RoundedBoxGeometry's arc-length UVs continuous within each original face.
          for (const face of geometry.groups) {
            const side = face.materialIndex ?? 0,
              along = side < 2 ? size[2] : size[0],
              across = side === 2 || side === 3 ? size[2] : size[1]
            for (let i = face.start; i < face.start + face.count; i++) {
              const vertex = geometry.index?.getX(i) ?? i,
                u = original.getX(vertex) * along,
                v = original.getY(vertex) * across
              uv.setXY(vertex, (along >= across ? u : v) / 0.9, (along >= across ? v : u) / 0.24)
            }
          }
        } else if (textileMaterials.has(mat)) {
          // Preserve RoundedBoxGeometry's per-face arc-length UVs, then map the weave in meters.
          const uv = geometry.getAttribute('uv'),
            original = uv.clone()
          for (const face of geometry.groups) {
            const side = face.materialIndex ?? 0,
              along = side < 2 ? size[2] : size[0],
              across = side === 2 || side === 3 ? size[2] : size[1]
            for (let i = face.start; i < face.start + face.count; i++) {
              const vertex = geometry.index?.getX(i) ?? i
              uv.setXY(
                vertex,
                (original.getX(vertex) * along) / (textileWorldSize * textileFallbackRepeat),
                (original.getY(vertex) * across) / (textileWorldSize * textileFallbackRepeat),
              )
            }
          }
        }
        parent.add(mesh)
        return mesh
      }
      const rounded = (
        parent: Three.Group,
        size: number[],
        position: number[],
        mat: Three.Material,
      ) => box(parent, size, position, mat, 0, 0.035)
      const cushion = (
        parent: Three.Group,
        size: number[],
        position: number[],
        mat: Three.Material,
        exponent = 8,
      ) => box(parent, size, position, mat, 0, 0, exponent)
      const sphere = (
        parent: Three.Group,
        size: number[],
        position: number[],
        mat: Three.Material,
      ) => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat)
        mesh.scale.set(size[0] / 2, size[1] / 2, size[2] / 2)
        if (mat === wood) {
          // Planar veneer on oval tabletops avoids the latitude rings of sphere UVs.
          const points = mesh.geometry.getAttribute('position'),
            uv = mesh.geometry.getAttribute('uv')
          for (let i = 0; i < points.count; i++)
            uv.setXY(i, (points.getX(i) * size[0]) / 1.8, (points.getZ(i) * size[2]) / 0.48)
        }

        mesh.position.set(...(position as [number, number, number]))
        mesh.castShadow = true
        mesh.receiveShadow = true
        parent.add(mesh)
        return mesh
      }
      const rod = (
        parent: Three.Group,
        a: number[],
        b: number[],
        radius: number,
        mat: Three.Material,
      ) => {
        const from = new THREE.Vector3(...(a as [number, number, number])),
          to = new THREE.Vector3(...(b as [number, number, number]))
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 10),
          mat,
        )
        mesh.position.copy(from).add(to).multiplyScalar(0.5)
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
        mesh.castShadow = true
        parent.add(mesh)
        return mesh
      }
      const shapeExtrusion = (
        parent: Three.Group,
        shape: Three.Shape,
        depth: number,
        position: number[],
        mat: Three.Material,
        bevel = 0,
      ) => {
        const mesh = new THREE.Mesh(
          new THREE.ExtrudeGeometry(shape, {
            depth,
            bevelEnabled: bevel > 0,
            bevelSegments: 2,
            steps: 1,
            bevelSize: bevel,
            bevelThickness: bevel,
          }),
          mat,
        )
        mesh.position.set(...(position as [number, number, number]))
        mesh.castShadow = true
        mesh.receiveShadow = true
        parent.add(mesh)
        return mesh
      }
      // Procedural finishes explain appearance; they are not scans of installed materials.
      const pattern = (surface: 'wood' | 'tile' | 'stone' | 'herringbone') => {
        const canvas = createSurfaceCanvas(surface, {
          base: readColor('texture-base'),
          grain: readColor('furniture'),
        })
        const texture = new THREE.CanvasTexture(canvas)
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping
        texture.repeat.set(0.8, 0.8)
        if (surface === 'herringbone') texture.rotation = Math.PI / 4
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        textures.add(texture)
        return texture
      }
      const maps = {
        wood: pattern('wood'),
        tile: pattern('tile'),
        stone: pattern('stone'),
        herringbone: pattern('herringbone'),
      }
      const wallTileMaterial = material('wall-tile', {
        map: maps.tile,
        clippingPlanes: [cut],
        clipShadows: true,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.58,
      })
      const { color: textileCanvas, bump: weaveCanvas } = createTextileCanvases()
      const textileColor = new THREE.CanvasTexture(textileCanvas)
      textileColor.wrapS = textileColor.wrapT = THREE.RepeatWrapping
      textileColor.repeat.set(textileFallbackRepeat, textileFallbackRepeat)
      textileColor.colorSpace = THREE.SRGBColorSpace
      textileColor.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
      textures.add(textileColor)
      for (const textile of [fabric, olive, pink, linen, rust]) textile.map = textileColor

      const weave = new THREE.CanvasTexture(weaveCanvas)
      weave.wrapS = weave.wrapT = THREE.RepeatWrapping
      // Keep the old repeat for non-box cloth as a safe fallback; box UVs compensate it
      // with a world-size scale so cushions and upholstery share the same weave size.
      weave.repeat.set(textileFallbackRepeat, textileFallbackRepeat)
      weave.colorSpace = THREE.NoColorSpace
      weave.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
      textures.add(weave)
      fabric.bumpMap = olive.bumpMap = linen.bumpMap = pink.bumpMap = rust.bumpMap = weave
      fabric.bumpScale =
        olive.bumpScale =
        linen.bumpScale =
        pink.bumpScale =
        rust.bumpScale =
          0.00015
      const grain = maps.wood.clone()
      grain.repeat.set(1, 1)
      textures.add(grain)
      wood.map = grain
      const grainRelief = grain.clone()
      grainRelief.colorSpace = THREE.NoColorSpace
      textures.add(grainRelief)
      wood.bumpMap = grainRelief
      wood.bumpScale = 0.0007
      const modeledCeilings = new Set(
        model.furniture.filter((item) => item.kind === 'ceiling').map((item) => item.room),
      )
      for (const room of model.rooms) {
        const shape = new THREE.Shape()
        room.polygon.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)))
        shape.closePath()
        const mat = material(
          `floor-${room.surface}`,
          {
            map: maps[room.finish ?? room.surface],
            transparent: true,
            roughness: room.surface === 'wood' ? 0.74 : 0.62,
          },
          false,
        )
        const mesh = new THREE.Mesh(
          new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }),
          mat,
        )
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = -0.12
        mesh.receiveShadow = true
        mesh.userData.selection = `room:${room.id}`
        mesh.userData.walkSurface = true
        group.add(mesh)
        floorMeshes.set(room.id, mesh)
        pickable.push(mesh)
        if (!modeledCeilings.has(room.id)) {
          const ceilingShape = new THREE.Shape()
          room.polygon.forEach(([x, z], i) =>
            i ? ceilingShape.lineTo(x, -z) : ceilingShape.moveTo(x, -z),
          )
          ceilingShape.closePath()
          const ceiling = new THREE.Mesh(
            new THREE.ExtrudeGeometry(ceilingShape, { depth: 0.018, bevelEnabled: false }),
            ceilingMaterial,
          )
          ceiling.rotation.x = -Math.PI / 2
          ceiling.position.y = model.referenceHeight - 0.018
          ceiling.receiveShadow = true
          ceilingGroup.add(ceiling)
        }
      }

      const inside = (x: number, z: number, polygon: [number, number][]) => {
        let hit = false
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const [xi, zi] = polygon[i],
            [xj, zj] = polygon[j]
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
        }
        return hit
      }
      const barriers: { a: number[]; b: number[]; radius: number }[] = []
      for (const wall of model.walls) {
        const wallRoot = new THREE.Group()
        wallGroup.add(wallRoot)
        const dx = wall.to[0] - wall.from[0],
          dz = wall.to[1] - wall.from[1]
        const length = Math.hypot(dx, dz),
          angle = -Math.atan2(dz, dx)
        roomWalls.push({
          group: wallRoot,
          midpoint: new THREE.Vector2(
            (wall.from[0] + wall.to[0]) / 2,
            (wall.from[1] + wall.to[1]) / 2,
          ),
          normal: new THREE.Vector2(dz / length, -dx / length),
          length,
          thickness: wall.thickness,
        })
        const segment = (start: number, end: number, bottom: number, top: number) => {
          if (end - start <= 0.001 || top - bottom <= 0.001) return
          const middle = (start + end) / 2,
            x = wall.from[0] + (dx * middle) / length,
            z = wall.from[1] + (dz * middle) / length
          box(
            wallRoot,
            [end - start, top - bottom, wall.thickness],
            [x, (bottom + top) / 2, z],
            wallMaterial,
            angle,
          )
          for (const side of [-1, 1]) {
            const offset = side * (wall.thickness / 2 + 0.011)
            const tileRoom = model.rooms.find(
              (room) =>
                room.wallFinish?.material === 'tile' &&
                inside(x - (dz / length) * offset, z + (dx / length) * offset, room.polygon),
            )
            if (tileRoom)
              box(
                wallRoot,
                [end - start, top - bottom, 0.014],
                [x - (dz / length) * offset, (bottom + top) / 2, z + (dx / length) * offset],
                wallTileMaterial,
                angle,
              )
          }
          const cap = box(
            wallRoot,
            [end - start, 0.014, wall.thickness],
            [x, top, z],
            capMaterial,
            angle,
          )
          cap.castShadow = false
          wallCaps.push({ mesh: cap, bottom, top, wall: wallRoot })
          if (bottom === 0)
            for (const side of [-1, 1]) {
              const offset = side * (wall.thickness / 2 + 0.008)
              box(
                wallRoot,
                [end - start, 0.085, 0.016],
                [x - (dz / length) * offset, 0.0425, z + (dx / length) * offset],
                trim,
                angle,
              )
            }
        }
        let last = 0
        for (const opening of [...wall.openings].sort((a, b) => a.offset - b.offset)) {
          segment(last, opening.offset, 0, model.referenceHeight)
          segment(opening.offset, opening.offset + opening.width, 0, opening.sill)
          segment(
            opening.offset,
            opening.offset + opening.width,
            opening.sill + opening.height,
            model.referenceHeight,
          )
          const frameGroup = new THREE.Group(),
            midpoint = opening.offset + opening.width / 2
          frameGroup.position.set(
            wall.from[0] + (dx * midpoint) / length,
            opening.sill + opening.height / 2,
            wall.from[1] + (dz * midpoint) / length,
          )
          frameGroup.rotation.y = angle
          wallRoot.add(frameGroup)
          if (opening.kind === 'window') {
            const pane = box(
              frameGroup,
              [opening.width, opening.height, 0.018],
              [0, 0, 0],
              glassMaterial,
            )
            pane.castShadow = false
            const divisions = Math.max(2, Math.round(opening.width / 0.72))
            for (let n = 0; n <= divisions; n++)
              box(
                frameGroup,
                [0.036, opening.height, 0.055],
                [-opening.width / 2 + (opening.width * n) / divisions, 0, 0],
                edgeMaterial,
              )
            for (const y of [-opening.height / 2, opening.height / 2])
              box(frameGroup, [opening.width, 0.036, 0.055], [0, y, 0], edgeMaterial)
            box(
              frameGroup,
              [opening.width + 0.06, 0.035, wall.thickness + 0.08],
              [0, -opening.height / 2 - 0.015, 0],
              trim,
            )
            if (opening.treatment === 'slatted') {
              // Window-local +Z is not always indoors (the corner window is reversed).
              const sampleDistance = wall.thickness / 2 + 0.12
              const roomSide =
                [1, -1].find((side) =>
                  model.rooms.some((room) =>
                    inside(
                      frameGroup.position.x + Math.sin(angle) * sampleDistance * side,
                      frameGroup.position.z + Math.cos(angle) * sampleDistance * side,
                      room.polygon,
                    ),
                  ),
                ) ?? 1
              const blindDepth = roomSide * (wall.thickness / 2 + 0.04)
              const slats = Math.ceil(opening.height / 0.07)
              for (let n = 0; n < slats; n++) {
                const slat = box(
                  frameGroup,
                  [opening.width - 0.04, 0.012, 0.065],
                  [0, opening.height / 2 - ((n + 0.5) * opening.height) / slats, blindDepth],
                  blinds,
                )
                slat.rotation.x = roomSide * 0.45
              }
              for (const y of [-opening.height / 2 + 0.025, opening.height / 2 - 0.025])
                box(
                  frameGroup,
                  [opening.width - 0.035, 0.05, 0.055],
                  [0, y, blindDepth],
                  blinds,
                  0,
                  0.004,
                )
              const tapes = Math.max(2, Math.round(opening.width / 0.65))
              for (let n = 0; n < tapes; n++)
                box(
                  frameGroup,
                  [0.022, opening.height - 0.06, 0.006],
                  [
                    (opening.width - 0.16) * (n / (tapes - 1) - 0.5),
                    0,
                    blindDepth + roomSide * 0.038,
                  ],
                  blindTapes,
                )
            }
          } else {
            // Framed openings keep passages open; unconfirmed door swings are not fabricated.
            for (const x of [-opening.width / 2, opening.width / 2])
              box(frameGroup, [0.045, opening.height, wall.thickness + 0.025], [x, 0, 0], trim)
            box(
              frameGroup,
              [opening.width + 0.09, 0.045, wall.thickness + 0.025],
              [0, opening.height / 2, 0],
              trim,
            )
            box(
              frameGroup,
              [opening.width, 0.016, wall.thickness],
              [0, -opening.height / 2 + 0.008, 0],
              trim,
            )
          }
          last = opening.offset + opening.width
        }
        segment(last, length, 0, model.referenceHeight)
        let cursor = 0
        for (const door of [...wall.openings]
          .filter((o) => o.kind === 'door')
          .sort((a, b) => a.offset - b.offset)) {
          if (door.offset > cursor)
            barriers.push({
              a: [wall.from[0] + (dx * cursor) / length, wall.from[1] + (dz * cursor) / length],
              b: [
                wall.from[0] + (dx * door.offset) / length,
                wall.from[1] + (dz * door.offset) / length,
              ],
              radius: wall.thickness / 2,
            })
          cursor = door.offset + door.width
        }
        if (cursor < length)
          barriers.push({
            a: [wall.from[0] + (dx * cursor) / length, wall.from[1] + (dz * cursor) / length],
            b: wall.to,
            radius: wall.thickness / 2,
          })
      }

      for (const { group: wallRoot } of roomWalls)
        wallRoot.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          const base = object.material as Three.Material
          object.userData.wallFinish = base
          if (!roomWallFinishes.has(base)) {
            const variants = [roomBackCut, roomFrontCut].map((plane) => {
              const value = base.clone()
              value.clippingPlanes = base === capMaterial ? [...roomSides] : [plane, ...roomSides]
              value.clipShadows = true
              materials.add(value)
              return value
            }) as [Three.Material, Three.Material]
            roomWallFinishes.set(base, variants)
          }
        })

      const furnitureFootprints: { position: number[]; size: number[]; rotation: number }[] = []
      for (const [index, item] of model.furniture.entries()) {
        const g = new THREE.Group()
        g.position.set(item.position[0], item.elevation ?? 0, item.position[1])
        g.rotation.y = item.rotation ?? 0
        g.userData.selection = `furniture:${index}`
        furnitureGroup.add(g)
        furnitureMeshes.set(index, g)
        const [w, d, h] = item.size
        const elevation = item.elevation ?? 0,
          humanBottom = 0,
          humanTop = 1.82
        const intersectsWalkingHeight = elevation < humanTop && elevation + h > humanBottom
        if (
          intersectsWalkingHeight &&
          ![
            'rug',
            'ceiling',
            'chandelier',
            'fanLight',
            'pendant',
            'flushLight',
            'airConditioner',
            'hood',
          ].includes(item.kind)
        )
          furnitureFootprints.push({
            position: item.position,
            size: item.size,
            rotation: g.rotation.y,
          })
        const upholstery =
          item.finish === 'olive'
            ? olive
            : item.finish === 'pink'
              ? pink
              : item.finish === 'linen'
                ? linen
                : fabric
        const finish = item.finish === 'white' ? white : wood
        const legs = (top: number, parent = g, width = w, depth = d) => {
          for (const x of [-width / 2 + 0.07, width / 2 - 0.07])
            for (const z of [-depth / 2 + 0.07, depth / 2 - 0.07])
              rod(parent, [x, 0.02, z], [x * 0.92, top, z * 0.92], 0.022, wood)
        }
        if (item.kind === 'bed') {
          rounded(g, [w, h * 0.42, d], [0, h * 0.26, 0], wood)
          cushion(g, [w - 0.025, h * 0.36, d - 0.04], [0, h * 0.68, 0], linen, 8)
          cushion(g, [w - 0.04, 0.055, d * 0.65], [0, h * 0.91, d * 0.16], upholstery, 14)
          if (item.variant !== 'low') {
            const headboardHeight = Math.max(0.95, h * 1.8)
            if (item.variant === 'carved') {
              const headboardShape = new THREE.Shape()
              headboardShape.moveTo(-w / 2, 0)
              headboardShape.lineTo(-w / 2, headboardHeight * 0.58)
              headboardShape.quadraticCurveTo(
                -w / 2,
                headboardHeight * 0.88,
                -w * 0.28,
                headboardHeight * 0.94,
              )
              headboardShape.quadraticCurveTo(
                0,
                headboardHeight * 1.1,
                w * 0.28,
                headboardHeight * 0.94,
              )
              headboardShape.quadraticCurveTo(
                w / 2,
                headboardHeight * 0.88,
                w / 2,
                headboardHeight * 0.58,
              )
              headboardShape.lineTo(w / 2, 0)
              headboardShape.closePath()
              shapeExtrusion(g, headboardShape, 0.085, [0, 0, -d / 2 + 0.04], wood, 0.008)
              for (const x of [-w / 2 + 0.07, w / 2 - 0.07]) {
                rod(
                  g,
                  [x, 0.1, -d / 2 + 0.02],
                  [x, headboardHeight * 0.92, -d / 2 + 0.02],
                  0.027,
                  wood,
                )
                sphere(g, [0.1, 0.13, 0.1], [x, headboardHeight * 0.98, -d / 2 + 0.02], wood)
              }
            } else
              rounded(
                g,
                [w + 0.04, headboardHeight, 0.085],
                [0, headboardHeight / 2, -d / 2 + 0.04],
                wood,
              )
          }
          for (const x of [-w / 4, w / 4])
            cushion(g, [w * 0.36, 0.11, 0.37], [x, h + 0.02, -d * 0.29], linen, 4.5)
        } else if (item.kind === 'sofa') {
          const clearance = item.clearance ?? 0.12,
            seat = item.seatHeight ?? h * 0.49,
            armThickness = Math.min(0.07, w * 0.035),
            inner = w - armThickness * 2 - 0.045,
            seatThickness = Math.min(0.16, (seat - clearance) * 0.6),
            baseHeight = seat - seatThickness - clearance - 0.055
          rounded(g, [w - 0.06, 0.055, d - 0.08], [0, clearance + 0.0275, 0], wood)
          legs(clearance)
          if (baseHeight > 0)
            cushion(
              g,
              [inner, baseHeight, d - 0.12],
              [0, clearance + 0.055 + baseHeight / 2, 0],
              upholstery,
              10,
            )
          // The thin support and loose cushions have distinct silhouettes.
          cushion(
            g,
            [inner, h - seat + 0.08, 0.075],
            [0, (h + seat - 0.08) / 2, d / 2 - 0.0375],
            upholstery,
            8,
          )
          const count = Math.max(2, Math.round(w / 0.85))
          for (let n = 0; n < count; n++) {
            const x = -inner / 2 + (inner * (n + 0.5)) / count
            cushion(
              g,
              [inner / count - 0.018, seatThickness, d * 0.7],
              [x, seat - seatThickness / 2, -d * 0.1],
              upholstery,
              7,
            )
            const backHeight = (h - seat) * 0.78
            const backCushion = cushion(
              g,
              [inner / count - 0.025, backHeight, 0.17],
              [x, seat + backHeight / 2 - 0.008, d * 0.27],
              upholstery,
              4.5,
            )
            backCushion.rotation.x = 0.12
          }
          const armHeight = seat - clearance + (h - seat) * 0.48
          for (const side of [-1, 1]) {
            box(
              g,
              [armThickness, armHeight, d * 0.88],
              [side * (w / 2 - armThickness / 2), clearance + armHeight / 2, 0],
              wood,
              0,
              0.035,
            )
            for (const z of [-d * 0.24, d * 0.24])
              sphere(
                g,
                [0.005, 0.012, 0.012],
                [side * (w / 2 - 0.003), clearance + armHeight * 0.3, z],
                trim,
              )
          }
        } else if (['desk', 'liftingDesk', 'table', 'dining'].includes(item.kind)) {
          const topMaterial = item.kind === 'dining' ? pale : wood,
            topThickness = 0.045
          rounded(g, [w, topThickness, d], [0, h - topThickness / 2, 0], topMaterial)
          // A thin front fascia keeps the desktop legible as a timber slab without widening it.
          box(
            g,
            [w - 0.026, 0.014, 0.018],
            [0, h - topThickness - 0.007, d / 2 - 0.009],
            topMaterial,
          )
          if (item.kind === 'liftingDesk') {
            const spacing = item.legSpacing ?? w * 0.75
            for (const x of [-spacing / 2, spacing / 2]) {
              box(g, [0.085, h - 0.05, 0.07], [x, (h - 0.05) / 2, 0], dark)
              rounded(g, [0.095, 0.035, d * 0.8], [x, 0.035, 0], dark)
            }
            box(g, [spacing, 0.065, 0.07], [0, h - 0.095, 0], dark)
            rounded(g, [w * 0.36, 0.055, d * 0.22], [w * 0.15, h + 0.075, -d * 0.25], wood)
            const monitorZ = -d * 0.28
            box(g, [w * 0.36, 0.38, 0.03], [w * 0.15, h + 0.36, monitorZ + 0.014], dark)
            box(g, [w * 0.33, 0.34, 0.004], [w * 0.15, h + 0.36, monitorZ + 0.031], screen)
            box(g, [w * 0.33, 0.018, 0.005], [w * 0.15, h + 0.18, monitorZ + 0.0315], dark)
            rod(g, [w * 0.15, h + 0.11, -d * 0.28], [w * 0.15, h + 0.23, -d * 0.28], 0.018, dark)
            box(g, [0.31, 0.015, 0.22], [-w * 0.32, h + 0.015, 0], dark)
            const laptop = box(g, [0.31, 0.2, 0.012], [-w * 0.32, h + 0.115, -0.105], screen)
            laptop.rotation.x = -0.12
            for (const x of [-w * 0.11, w * 0.41]) {
              rounded(g, [0.13, 0.24, 0.13], [x, h + 0.12, -d * 0.24], pale)
              sphere(g, [0.09, 0.09, 0.015], [x, h + 0.09, -d * 0.24 + 0.068], screen)
            }
            box(g, [0.31, 0.014, 0.1], [w * 0.15, h + 0.015, d * 0.08], dark)
          } else {
            legs(h - 0.04)
            if (item.kind === 'dining')
              for (const sign of [-1, 1])
                for (const along of [-0.28, 0.28]) {
                  const chair = new THREE.Group()
                  chair.position.set(
                    w > d ? w * along : sign * (w / 2 + 0.23),
                    0,
                    w > d ? sign * (d / 2 + 0.23) : d * along,
                  )
                  chair.rotation.y =
                    w > d ? (sign > 0 ? 0 : Math.PI) : sign > 0 ? Math.PI / 2 : -Math.PI / 2
                  cushion(chair, [0.36, 0.055, 0.36], [0, 0.43, 0], fabric, 10)
                  rounded(chair, [0.36, 0.38, 0.045], [0, 0.65, 0.15], wood)
                  legs(0.43, chair, 0.36, 0.36)
                  g.add(chair)
                  const cosine = Math.cos(g.rotation.y),
                    sine = Math.sin(g.rotation.y)
                  if (intersectsWalkingHeight)
                    furnitureFootprints.push({
                      position: [
                        item.position[0] + chair.position.x * cosine + chair.position.z * sine,
                        item.position[1] - chair.position.x * sine + chair.position.z * cosine,
                      ],
                      size: [0.36, 0.36],
                      rotation: g.rotation.y + chair.rotation.y,
                    })
                }
          }
        } else if (item.kind === 'shelf') {
          const [cols, rows] = item.compartments ?? [1, 3],
            base = 0.075,
            frame = Math.min(0.02, w * 0.035),
            backDepth = Math.min(0.018, d * 0.08),
            innerWidth = w - frame * 2,
            innerHeight = h - base - frame * 2
          box(
            g,
            [innerWidth, innerHeight, backDepth],
            [0, base + frame + innerHeight / 2, -d / 2 + backDepth / 2],
            wood,
          )
          rounded(g, [w, frame, d], [0, h - frame / 2, 0], wood)
          rounded(g, [w, frame, d], [0, base + frame / 2, 0], wood)
          for (const x of [-w / 2 + frame / 2, w / 2 - frame / 2])
            rounded(
              g,
              [frame, innerHeight, d - backDepth],
              [x, base + frame + innerHeight / 2, backDepth / 2],
              wood,
            )
          for (let n = 1; n < rows; n++)
            rounded(
              g,
              [innerWidth, frame, d - backDepth],
              [0, base + frame + (innerHeight * n) / rows, backDepth / 2],
              wood,
            )
          for (let n = 1; n < cols; n++)
            rounded(
              g,
              [frame, innerHeight, d - backDepth],
              [
                -innerWidth / 2 + (innerWidth * n) / cols,
                base + frame + innerHeight / 2,
                backDepth / 2,
              ],
              wood,
            )
          for (const x of [-w / 2 + 0.06, w / 2 - 0.06])
            for (const z of [-d / 2 + 0.04, d / 2 - 0.04])
              sphere(g, [0.045, 0.06, 0.035], [x, 0.03, z], dark)
        } else if (item.kind === 'coffee') {
          sphere(g, [w, 0.055, d], [0, h - 0.025, 0], wood)
          const shape = new THREE.Shape()
          shape.moveTo(-d * 0.42, 0.02)
          shape.quadraticCurveTo(-d * 0.3, h * 0.5, -d * 0.31, h * 0.9)
          shape.lineTo(d * 0.32, h * 0.9)
          shape.quadraticCurveTo(d * 0.26, h * 0.35, d * 0.43, 0.02)
          shape.closePath()
          const hole = new THREE.Path()
          hole.moveTo(-d * 0.23, h * 0.18)
          hole.lineTo(d * 0.23, h * 0.18)
          hole.lineTo(d * 0.16, h * 0.69)
          hole.lineTo(-d * 0.17, h * 0.69)
          hole.closePath()
          shape.holes.push(hole)
          const support = new THREE.Mesh(
            new THREE.ExtrudeGeometry(shape, {
              depth: w * 0.66,
              bevelEnabled: true,
              bevelSegments: 2,
              steps: 1,
              bevelSize: 0.008,
              bevelThickness: 0.008,
            }),
            wood,
          )
          support.rotation.y = Math.PI / 2
          support.position.x = -w * 0.33
          support.castShadow = true
          g.add(support)
        } else if (item.kind === 'rug') {
          rounded(g, [w, h, d], [0, h / 2 + 0.004, 0], fabric).userData.walkSurface = true
        } else if (item.kind === 'screen') {
          rounded(g, [w, h, d], [0, h / 2, 0], dark)
          box(g, [w - 0.025, h - 0.025, 0.004], [0, h / 2, d / 2 + 0.003], screen)
        } else if (item.kind === 'door') {
          box(g, [w, h, d], [0, h / 2, 0], wood)
          const handleX = w * 0.36,
            face = d / 2 + 0.014
          rounded(g, [0.07, h * 0.16, 0.018], [handleX, h * 0.46, face], dark)
          rod(
            g,
            [handleX, h * 0.49, face + 0.018],
            [handleX - w * 0.13, h * 0.49, face + 0.018],
            0.014,
            dark,
          )
          sphere(g, [0.024, 0.024, 0.01], [0, h * 0.71, face], brass)
        } else if (item.kind === 'chair') {
          const diningChair = item.finish === 'linen' || item.finish === 'white'
          if (diningChair) {
            const seatHeight = h * 0.45,
              seatWidth = w * 0.82,
              seatDepth = d * 0.72
            cushion(g, [seatWidth, h * 0.09, seatDepth], [0, seatHeight, 0], linen, 10)
            legs(seatHeight - h * 0.05, g, seatWidth, seatDepth)
            if (h > seatHeight * 1.45) {
              const backHeight = h - seatHeight
              rounded(
                g,
                [seatWidth * 0.86, backHeight * 0.44, d * 0.055],
                [0, seatHeight + backHeight * 0.55, d * 0.31],
                wood,
              )
              for (const x of [-seatWidth * 0.4, seatWidth * 0.4])
                rod(
                  g,
                  [x, seatHeight - h * 0.02, d * 0.27],
                  [x, h * 0.82, d * 0.27],
                  h * 0.018,
                  wood,
                )
            }
          } else {
            const chairFrame = dark
            rounded(g, [w * 0.78, 0.08, d * 0.67], [0, h * 0.4, 0], chairFrame)
            const backWidth = w * 0.78,
              backHeight = h * 0.52,
              backDepth = 0.065,
              backCenterY = h * 0.7,
              backCenterZ = d * 0.32,
              frameThickness = Math.min(0.035, w * 0.055),
              innerWidth = backWidth - frameThickness * 2,
              innerHeight = backHeight - frameThickness * 2,
              backSurface = backDepth / 2
            const backFrame = new THREE.Group()
            backFrame.position.set(0, backCenterY, backCenterZ)
            backFrame.rotation.x = 0.1
            g.add(backFrame)
            const backOutline = (width: number, height: number) => {
              const x = width / 2,
                y = height / 2,
                outline = new THREE.Shape()
              outline.moveTo(-x * 0.68, -y)
              outline.lineTo(x * 0.68, -y)
              outline.quadraticCurveTo(x * 0.82, -y, x * 0.86, -y * 0.75)
              outline.lineTo(x, y * 0.55)
              outline.quadraticCurveTo(x, y, x * 0.68, y)
              outline.lineTo(-x * 0.68, y)
              outline.quadraticCurveTo(-x, y, -x, y * 0.55)
              outline.lineTo(-x * 0.86, -y * 0.75)
              outline.quadraticCurveTo(-x * 0.82, -y, -x * 0.68, -y)
              return outline
            }
            const outerBack = backOutline(backWidth, backHeight),
              innerBack = backOutline(innerWidth, innerHeight)
            outerBack.holes.push(innerBack)
            shapeExtrusion(
              backFrame,
              outerBack,
              backDepth,
              [0, 0, -backDepth / 2],
              chairFrame,
              0.004,
            )
            shapeExtrusion(backFrame, innerBack, 0.012, [0, 0, backSurface - 0.018], screen)
            rounded(
              backFrame,
              [w * 0.46, h * 0.1, 0.018],
              [0, h * 0.63 - backCenterY, backSurface + 0.008],
              chairFrame,
            )
            rod(g, [0, 0.08, 0], [0, h * 0.4, 0], 0.03, chairFrame)
            for (let n = 0; n < 5; n++) {
              const angle = (n * Math.PI * 2) / 5,
                x = Math.cos(angle) * w * 0.48,
                z = Math.sin(angle) * d * 0.42
              rod(g, [0, 0.13, 0], [x, 0.07, z], 0.018, chairFrame)
              sphere(g, [0.05, 0.07, 0.05], [x, 0.035, z], chairFrame)
            }
            for (const x of [-w * 0.47, w * 0.47]) {
              rod(g, [x, h * 0.4, 0], [x, h * 0.56, 0], 0.016, chairFrame)
              rounded(g, [0.065, 0.035, d * 0.4], [x, h * 0.56, 0], chairFrame)
            }
          }
        } else if (item.kind === 'computer' || item.kind === 'drawer') {
          rounded(g, [w, h, d - 0.025], [0, h / 2, -0.01], dark)
          if (item.kind === 'drawer')
            for (let n = 0; n < 5; n++) {
              const y = (h * (n + 0.5)) / 5
              box(g, [w - 0.02, h / 5 - 0.009, 0.016], [0, y, d / 2 - 0.018], dark)
              rod(g, [-w * 0.17, y + 0.02, d / 2], [w * 0.17, y + 0.02, d / 2], 0.004, pale)
            }
          else
            for (let n = 0; n < 10; n++)
              box(g, [w * 0.76, 0.005, 0.005], [0, h * 0.3 + n * 0.018, d / 2], screen)
        } else if (item.kind === 'waterHeater') {
          // The bounds include only the photographed casing, flue and exposed fittings.
          box(g, [w * 0.82, h * 0.52, d * 0.8], [0, h * 0.54, 0], applianceDark, 0, 0.014)
          box(g, [w * 0.78, h * 0.49, 0.008], [0, h * 0.54, d * 0.4], applianceDark, 0, 0.008)
          box(g, [w * 0.16, 0.035, 0.006], [0, h * 0.32, d * 0.43], screen, 0, 0.003)
          rod(
            g,
            [0, h * 0.8, -d * 0.12],
            [0, h * 0.99, -d * 0.12],
            Math.min(w * 0.11, d * 0.3),
            steel,
          )
          for (const side of [-1, 0, 1]) {
            const x = side * w * 0.24,
              points = [
                new THREE.Vector3(x, h * 0.28, 0),
                new THREE.Vector3(x, h * 0.21, d * 0.08),
                new THREE.Vector3(x + w * 0.05, h * 0.15, d * 0.08),
                new THREE.Vector3(x, h * 0.045, -d * 0.2),
                new THREE.Vector3(x, h * 0.035, -d * 0.35),
              ],
              hose = new THREE.Mesh(
                new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.009, 6, false),
                side === 0 ? yellowHose : steel,
              )
            hose.castShadow = hose.receiveShadow = true
            g.add(hose)
            box(g, [0.035, 0.035, 0.035], [x, h * 0.265, 0], brass, 0, 0.003)
            sphere(g, [0.045, 0.028, 0.04], [x, h * 0.035, -d * 0.35], steel)
            rod(g, [x, h * 0.035, -d * 0.35], [x, h * 0.035, -d * 0.46], 0.012, steel)
            const collar = new THREE.Mesh(
              new THREE.CylinderGeometry(0.022, 0.022, 0.009, 16),
              steel,
            )
            collar.rotation.x = Math.PI / 2
            collar.position.set(x, h * 0.035, -d * 0.36)
            collar.castShadow = collar.receiveShadow = true
            g.add(collar)
          }
        } else if (item.kind === 'dishRack') {
          box(g, [w, 0.025, d], [0, 0.0125, 0], dark, 0, 0.009)
          for (const x of [-w * 0.46, w * 0.46]) {
            for (const z of [-d * 0.43, d * 0.43])
              rod(g, [x, 0.035, z], [x, h * 0.95, z], 0.006, steel)
            for (const y of [h * 0.2, h * 0.95])
              rod(g, [x, y, -d * 0.43], [x, y, d * 0.43], 0.006, steel)
          }
          for (const z of [-d * 0.43, d * 0.43])
            for (const y of [h * 0.2, h * 0.62])
              rod(g, [-w * 0.46, y, z], [w * 0.46, y, z], 0.005, steel)
          for (let n = 0; n < 7; n++) {
            const x = w * (n / 6 - 0.5) * 0.82
            rod(g, [x, h * 0.2, -d * 0.4], [x, h * 0.2, d * 0.4], 0.004, steel)
            rod(g, [x, h * 0.2, -d * 0.4], [x, h * 0.68, -d * 0.4], 0.004, steel)
          }
        } else if (item.kind === 'hangingBin') {
          box(g, [w * 0.92, h * 0.88, d * 0.94], [0, h * 0.45, 0], pale, 0, 0.04)
          box(g, [w, h * 0.075, d], [0, h * 0.92, 0], dark, 0, 0.022)
          box(g, [w, h * 0.07, d], [0, h * 0.965, 0], pale, 0, 0.022)
          box(g, [w * 0.12, 0.009, d * 0.12], [0, h, d * 0.24], steel, 0, 0.003)
        } else if (item.kind === 'airConditioner') {
          rounded(g, [w, h, d], [0, h / 2, 0], white)
          box(g, [w * 0.82, 0.018, 0.012], [0, h * 0.2, d / 2 + 0.008], dark)
          for (let n = 0; n < 4; n++)
            box(g, [w * 0.68, 0.008, 0.008], [0, h * (0.34 + n * 0.07), d / 2 + 0.008], trim)
          sphere(g, [0.035, 0.035, 0.025], [-w * 0.36, h * 0.72, d / 2 + 0.012], pale)
        } else if (item.kind === 'laundry') {
          const counterHeight = h * 0.4,
            upperHeight = h * 0.3,
            upperBottom = h * 0.7
          const leftWidth = w * 0.34,
            machineWidth = w * 0.62,
            sinkWidth = w * 0.7,
            gap = w * 0.02
          const leftX = -w / 2 + leftWidth / 2,
            machineX = leftX + leftWidth / 2 + gap + machineWidth / 2,
            sinkX = w * 0.12
          box(g, [w, counterHeight, 0.025], [0, counterHeight / 2, -d / 2 + 0.0125], white)
          rounded(g, [w, 0.06, d + 0.035], [0, counterHeight + 0.03, 0], white)
          box(
            g,
            [leftWidth, counterHeight * 0.88, d * 0.92],
            [leftX, counterHeight * 0.44, 0],
            white,
          )
          rounded(
            g,
            [machineWidth, counterHeight * 0.88, d * 0.94],
            [machineX, counterHeight * 0.44, 0],
            dark,
          )
          const drumRadius = Math.min(machineWidth * 0.36, counterHeight * 0.3)
          const drum = new THREE.Mesh(
            new THREE.CylinderGeometry(drumRadius, drumRadius, 0.018, 32),
            dark,
          )
          drum.rotation.x = Math.PI / 2
          drum.position.set(machineX, counterHeight * 0.47, d / 2 + 0.02)
          drum.castShadow = true
          g.add(drum)
          const drumRing = new THREE.Mesh(
            new THREE.TorusGeometry(drumRadius * 0.82, 0.018, 8, 32),
            pale,
          )
          drumRing.position.set(machineX, counterHeight * 0.47, d / 2 + 0.035)
          g.add(drumRing)
          box(g, [w, upperHeight, d], [0, upperBottom + upperHeight / 2, 0], white)
          for (const x of [-w / 6, w / 6])
            box(
              g,
              [0.008, upperHeight * 0.96, 0.018],
              [x, upperBottom + upperHeight / 2, d / 2 + 0.01],
              trim,
            )
          box(g, [w, 0.035, d], [0, upperBottom - h * 0.075, 0], white)
          rounded(g, [sinkWidth * 0.82, 0.024, d * 0.62], [sinkX, counterHeight + 0.065, 0], dark)
          rounded(g, [sinkWidth * 0.68, 0.022, d * 0.5], [sinkX, counterHeight + 0.08, 0], pale)
          rod(
            g,
            [sinkX, counterHeight + 0.07, -d * 0.34],
            [sinkX, counterHeight + 0.22, -d * 0.34],
            0.012,
            dark,
          )
          rod(
            g,
            [sinkX, counterHeight + 0.22, -d * 0.34],
            [sinkX, counterHeight + 0.22, -d * 0.16],
            0.012,
            dark,
          )
          const hangingY = upperBottom - h * 0.115
          rod(g, [-w * 0.42, hangingY, d * 0.4], [w * 0.42, hangingY, d * 0.4], 0.012, dark)
        } else if (item.kind === 'mirror') {
          box(g, [w, h, d], [0, h / 2, 0], white)
          for (const x of [-w / 3, 0, w / 3]) {
            box(g, [w / 3 - 0.014, h * 0.88, 0.012], [x, h * 0.48, d / 2 + 0.012], glassMaterial)
            if (x !== w / 3)
              box(g, [0.012, h * 0.88, 0.018], [x + w / 6, h * 0.48, d / 2 + 0.022], dark)
          }
          box(g, [w * 0.9, 0.035, 0.035], [0, h * 0.95, d / 2 + 0.026], pale)
        } else if (item.kind === 'shower') {
          box(g, [w, 0.035, d], [0, 0.018, 0], pale)
          box(g, [0.025, h, d * 0.9], [-w / 2 + 0.018, h / 2, 0], glassMaterial)
          box(g, [w * 0.85, h, 0.025], [0, h / 2, -d / 2 + 0.018], glassMaterial)
          const showerX = w * 0.24,
            showerBack = -d * 0.4
          rod(g, [showerX, 0.08, showerBack], [showerX, h * 0.72, showerBack], 0.012, dark)
          rod(
            g,
            [showerX, h * 0.72, showerBack],
            [showerX, h * 0.72, showerBack + d * 0.13],
            0.012,
            dark,
          )
          rod(
            g,
            [showerX, h * 0.72, showerBack + d * 0.13],
            [showerX, h * 0.72 - 0.04, showerBack + d * 0.13],
            0.012,
            dark,
          )
          const head = new THREE.Mesh(
            new THREE.CylinderGeometry(Math.min(w, d) * 0.16, Math.min(w, d) * 0.16, 0.025, 20),
            dark,
          )
          head.position.set(showerX, h * 0.72 - 0.04, showerBack + d * 0.13)
          g.add(head)
        } else if (item.kind === 'hood') {
          const hoodBottom = 0,
            hoodHeight = h * 0.2,
            upperBottom = hoodBottom + hoodHeight
          const upperHeight = h - upperBottom
          box(g, [w, upperHeight, d], [0, upperBottom + upperHeight / 2, 0], white)
          for (let n = 0; n < 3; n++) {
            const x = -w / 2 + (w * (n + 0.5)) / 3
            box(
              g,
              [w / 3 - 0.008, upperHeight - 0.04, 0.025],
              [x, upperBottom + upperHeight / 2, d / 2 + 0.014],
              white,
            )
          }
          box(g, [w * 0.9, hoodHeight, d * 0.9], [0, hoodBottom + hoodHeight / 2, 0], dark)
          box(
            g,
            [w * 0.82, 0.035, d * 0.8],
            [0, hoodBottom + hoodHeight * 0.24, d / 2 + 0.012],
            screen,
          )
          box(g, [w * 0.72, 0.025, d * 0.84], [0, hoodBottom - 0.014, 0], dark)
          box(g, [w * 0.3, 0.022, d * 0.25], [0, hoodBottom + hoodHeight * 0.72, -d * 0.22], dark)
        } else if (item.kind === 'curtain') {
          if (item.variant === 'roman') {
            box(g, [w, h * 0.54, d * 0.45], [0, h * 0.29, 0], linen)
            for (const y of [0.12, 0.2, 0.28, 0.36, 0.44, 0.52])
              rounded(g, [w, h * 0.035, d * 0.62], [0, h * y, 0], linen)
            const stripeCount = Math.max(5, Math.round(w / 0.18))
            for (let n = 0; n < stripeCount; n++) {
              const stripe = n % 2 ? rust : linen
              const stripeWidth = w / stripeCount,
                stripeHeight = h * 0.42,
                radius = stripeWidth / 2
              const scallop = new THREE.Shape()
              scallop.moveTo(-radius, stripeHeight)
              scallop.lineTo(-radius, radius)
              scallop.quadraticCurveTo(-radius, 0, 0, 0)
              scallop.quadraticCurveTo(radius, 0, radius, radius)
              scallop.lineTo(radius, stripeHeight)
              scallop.closePath()
              shapeExtrusion(
                g,
                scallop,
                d * 0.56,
                [-w / 2 + (w * (n + 0.5)) / stripeCount, h * 0.58, -d * 0.28],
                stripe,
              )
            }
            box(g, [w + 0.06, 0.025, 0.04], [0, h, 0], dark)
          } else {
            const layered = model.furniture.some((other) => {
              if (
                other === item ||
                other.kind !== 'curtain' ||
                other.room !== item.room ||
                (other.finish === 'linen') === (item.finish === 'linen') ||
                Math.abs(Math.sin((other.rotation ?? 0) - g.rotation.y)) > 0.001
              )
                return false
              const dx = other.position[0] - item.position[0],
                dz = other.position[1] - item.position[1],
                cosine = Math.cos(g.rotation.y),
                sine = Math.sin(g.rotation.y)
              return (
                Math.abs(dx * cosine - dz * sine) < (w + other.size[0]) / 2 &&
                Math.abs(dx * sine + dz * cosine) < (d + other.size[1]) / 2
              )
            })
            const pleats = Math.max(4, Math.round(w / 0.075)),
              segments = pleats * 12,
              foldDepth = d * (layered ? 0.4 : 0.7),
              layerOffset = layered ? d * (item.finish === 'linen' ? 0.27 : -0.27) : 0,
              thickness = Math.min(0.008, foldDepth * 0.16),
              frontOffset = -thickness / 2,
              backOffset = thickness / 2,
              positions: number[] = [],
              uvs: number[] = [],
              indices: number[] = []
            const rows = 12,
              stride = rows + 1,
              sideStride = (segments + 1) * stride
            for (const side of [frontOffset, backOffset])
              for (let n = 0; n <= segments; n++) {
                const across = n / segments
                for (let row = 0; row <= rows; row++) {
                  const up = row / rows,
                    relax = (1 - up) ** 2,
                    phase =
                      across * pleats * Math.PI * 2 + 0.13 * relax * Math.sin(across * Math.PI),
                    x =
                      -w / 2 +
                      w * across +
                      w * 0.008 * Math.sin(across * Math.PI) * Math.sin(up * Math.PI),
                    y = h * up + 0.008 * (1 - up) ** 6 * (0.5 + Math.cos(phase) / 2),
                    z =
                      ((Math.cos(phase) * (foldDepth - thickness)) / 2) * (0.82 + 0.18 * relax) +
                      side +
                      layerOffset
                  positions.push(x, y, z)
                  uvs.push(
                    (across * w) / (textileWorldSize * textileFallbackRepeat),
                    y / (textileWorldSize * textileFallbackRepeat),
                  )
                }
              }
            for (let n = 0; n < segments; n++) {
              for (let row = 0; row < rows; row++) {
                const front = n * stride + row,
                  nextFront = front + stride,
                  back = sideStride + front,
                  nextBack = sideStride + nextFront
                indices.push(front, front + 1, nextFront + 1, front, nextFront + 1, nextFront)
                indices.push(back, nextBack, nextBack + 1, back, nextBack + 1, back + 1)
              }
              const front = n * stride,
                nextFront = front + stride,
                back = sideStride + front,
                nextBack = sideStride + nextFront
              indices.push(front, nextFront, nextBack, front, nextBack, back)
              indices.push(
                front + rows,
                nextBack + rows,
                nextFront + rows,
                front + rows,
                back + rows,
                nextBack + rows,
              )
            }
            for (const n of [0, segments])
              for (let row = 0; row < rows; row++) {
                const front = n * stride + row,
                  back = sideStride + front
                if (n === 0) indices.push(front, back, back + 1, front, back + 1, front + 1)
                else indices.push(front, front + 1, back + 1, front, back + 1, back)
              }
            const pleatedGeometry = new THREE.BufferGeometry()
            pleatedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
            pleatedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
            pleatedGeometry.setIndex(indices)
            pleatedGeometry.computeVertexNormals()
            const pleatedCurtain = new THREE.Mesh(pleatedGeometry, upholstery)
            pleatedCurtain.castShadow = true
            pleatedCurtain.receiveShadow = true
            g.add(pleatedCurtain)
            box(g, [w + 0.06, 0.02, 0.04], [0, h, 0], dark)
          }
        } else if (item.kind === 'ceiling') {
          const band = 0.26
          for (const x of [-w / 2 + band / 2, w / 2 - band / 2])
            box(g, [band, h, d], [x, h / 2, 0], white)
          for (const z of [-d / 2 + band / 2, d / 2 - band / 2])
            box(g, [w, h, band], [0, h / 2, z], white)
          box(g, [w, 0.06, d], [0, h + 0.03, 0], white)
          for (const z of [-d * 0.33, 0, d * 0.33])
            for (const x of [-w / 2 + band / 2, w / 2 - band / 2])
              sphere(g, [0.08, 0.008, 0.08], [x, -0.004, z], pale)
          for (let n = 0; n < 5; n++)
            box(g, [w * 0.55, 0.005, 0.012], [0, -0.006, d / 2 - 0.18 + n * 0.024], dark)
        } else if (item.kind === 'pendant') {
          rod(g, [0, h, 0], [0, h * 0.38, 0], 0.017, dark)
          sphere(g, [0.14, 0.024, 0.14], [0, h - 0.012, 0], dark)
          if (item.variant === 'amber') {
            sphere(g, [w * 0.52, h * 0.35, d * 0.52], [0, h * 0.2, 0], warmGlass)
            sphere(g, [w * 0.26, h * 0.14, d * 0.26], [0, h * 0.2, 0], pale)
          } else {
            for (let n = 0; n < 8; n++) {
              const angle = (n * Math.PI) / 4
              const petal = sphere(
                g,
                [w * 0.34, h * 0.2, d * 0.22],
                [Math.cos(angle) * w * 0.22, h * 0.2, Math.sin(angle) * d * 0.22],
                white,
              )
              petal.rotation.y = -angle
            }
            sphere(g, [w * 0.24, h * 0.12, d * 0.24], [0, h * 0.2, 0], pale)
          }
        } else if (item.kind === 'flushLight') {
          const square = item.variant === 'square'
          if (square) {
            box(g, [w, h, d], [0, h * 0.45, 0], dark)
            box(g, [w * 0.86, 0.012, d * 0.86], [0, -h * 0.12, 0], pale)
          } else {
            const radius = Math.min(w, d) * 0.42
            const disc = new THREE.Mesh(
              new THREE.CylinderGeometry(radius, radius, Math.max(0.025, h * 0.18), 32),
              white,
            )
            disc.position.set(0, h * 0.45, 0)
            disc.castShadow = true
            disc.receiveShadow = true
            g.add(disc)
            const lightDisc = new THREE.Mesh(
              new THREE.CylinderGeometry(radius * 0.78, radius * 0.78, 0.014, 32),
              pale,
            )
            lightDisc.position.set(0, h * 0.33, 0)
            g.add(lightDisc)
          }
        } else if (item.kind === 'chandelier' || item.kind === 'fanLight') {
          rod(g, [0, h, 0], [0, h * 0.3, 0], 0.017, dark)
          sphere(g, [0.14, 0.024, 0.14], [0, h - 0.012, 0], dark)
          sphere(g, [0.21, 0.12, 0.21], [0, h * 0.3, 0], wood)
          if (item.kind === 'chandelier')
            for (let n = 0; n < 6; n++) {
              const angle = (n * Math.PI) / 3,
                x = Math.cos(angle) * w * 0.34,
                z = Math.sin(angle) * d * 0.34
              rod(g, [0, h * 0.3, 0], [x, h * 0.17, z], 0.008, dark)
              sphere(g, [0.19, 0.18, 0.19], [x, 0.1, z], pale)
            }
          else
            for (let n = 0; n < 3; n++) {
              const angle = (n * Math.PI * 2) / 3
              const blade = sphere(
                g,
                [w * 0.45, 0.018, d * 0.12],
                [Math.cos(angle) * w * 0.28, h * 0.31, Math.sin(angle) * d * 0.28],
                wood,
              )
              blade.rotation.y = -angle
            }
          if (item.kind === 'fanLight') sphere(g, [0.18, 0.07, 0.18], [0, h * 0.16, 0], pale)
        } else if (item.kind === 'toilet') {
          rounded(g, [w * 0.86, h * 1.15, d * 0.23], [0, h * 0.6, -d * 0.35], pale)
          sphere(g, [w * 0.65, h * 0.65, d * 0.67], [0, h * 0.33, d * 0.06], pale)
          sphere(g, [w, 0.08, d * 0.77], [0, h, d * 0.06], pale)
        } else if (item.kind === 'refrigerator') {
          rounded(g, [w, h, d], [0, h / 2, 0], white)
          const lowerTop = h * 0.34
          box(g, [w - 0.02, 0.008, 0.012], [0, lowerTop, d / 2 + 0.004], dark)
          box(g, [0.008, h - lowerTop - 0.02, 0.012], [0, (lowerTop + h) / 2, d / 2 + 0.004], dark)
          for (const x of [-w * 0.34, w * 0.34])
            box(g, [0.018, h * 0.3, 0.03], [x, lowerTop + h * 0.18, d / 2 + 0.012], dark)
          box(g, [0.018, h * 0.23, 0.03], [w * 0.34, h * 0.15, d / 2 + 0.012], dark)
        } else if (item.kind === 'sideboard') {
          const baseTop = h * 0.28,
            topThickness = 0.026,
            nicheBottom = baseTop + topThickness,
            nicheTop = h * 0.55,
            middleTop = h * 0.72,
            front = d / 2 + 0.014
          box(g, [w, baseTop, d], [0, baseTop / 2, 0], white)
          box(g, [w, topThickness, d], [0, baseTop + topThickness / 2, 0], wood)
          for (let n = 0; n < 3; n++) {
            const x = -w / 2 + (w * (n + 0.5)) / 3
            box(g, [w / 3 - 0.008, baseTop - 0.04, 0.025], [x, baseTop / 2, front], white)
            sphere(g, [0.055, 0.055, 0.055], [x, baseTop * 0.56, front + 0.026], brass)
          }
          box(
            g,
            [w - 0.05, nicheTop - nicheBottom, 0.025],
            [0, (nicheBottom + nicheTop) / 2, -d / 2 + 0.025],
            wood,
          )
          for (const x of [-w / 2 + 0.025, w / 2 - 0.025])
            box(
              g,
              [0.05, nicheTop - nicheBottom, d * 0.92],
              [x, (nicheBottom + nicheTop) / 2, 0],
              wood,
            )
          box(g, [w - 0.05, 0.026, d * 0.92], [0, nicheTop, 0], wood)
          box(g, [w, middleTop - nicheTop, d * 0.92], [0, (nicheTop + middleTop) / 2, 0], wood)
          for (let n = 0; n < 2; n++) {
            const x = -w / 4 + (w * n) / 2,
              y = (nicheTop + middleTop) / 2
            box(g, [w / 2 - 0.012, middleTop - nicheTop - 0.05, 0.026], [x, y, front + 0.014], wood)
          }
          box(g, [w, h - middleTop, d], [0, (middleTop + h) / 2, 0], white)
          for (let n = 0; n < 3; n++) {
            const x = -w / 2 + (w * (n + 0.5)) / 3
            box(
              g,
              [w / 3 - 0.008, h - middleTop - 0.04, 0.025],
              [x, (middleTop + h) / 2, front],
              white,
            )
          }
        } else if (item.kind === 'airFryer') {
          const bodyWidth = w * 0.88,
            bodyDepth = d * 0.9,
            bodyHeight = h * 0.75
          const radius = Math.min(w, d, h) * 0.1,
            front = bodyDepth / 2 + d * 0.012
          box(g, [bodyWidth, bodyHeight, bodyDepth], [0, bodyHeight / 2, 0], pale, 0, radius)
          box(
            g,
            [w * 0.78, h * 0.06, d * 0.72],
            [0, bodyHeight + h * 0.03, 0],
            white,
            0,
            radius * 0.45,
          )
          box(g, [w * 0.72, h * 0.24, d * 0.018], [0, h * 0.26, front], white, 0, radius * 0.25)
          box(g, [w * 0.72, h * 0.014, d * 0.01], [0, h * 0.395, front], dark)
          box(
            g,
            [w * 0.08, h * 0.22, d * 0.06],
            [0, h * 0.26, front + d * 0.028],
            pale,
            0,
            radius * 0.3,
          )
          const knobRadius = Math.min(w, d) * 0.065,
            knobHeight = h * 0.075
          for (const x of [-w * 0.2, w * 0.2]) {
            const knob = new THREE.Mesh(
              new THREE.CylinderGeometry(knobRadius, knobRadius * 0.92, knobHeight, 20),
              pale,
            )
            knob.position.set(x, bodyHeight + h * 0.06 + knobHeight / 2, 0)
            knob.castShadow = true
            knob.receiveShadow = true
            g.add(knob)
          }
        } else if (item.kind === 'soyMilkMaker') {
          const baseWidth = w * 0.82,
            baseDepth = d * 0.84,
            baseHeight = h * 0.26
          const radius = Math.min(w, d, h) * 0.055,
            front = baseDepth / 2 + d * 0.014
          box(g, [baseWidth, baseHeight, baseDepth], [0, baseHeight / 2, 0], pale, 0, radius)
          box(g, [w * 0.66, h * 0.09, d * 0.024], [0, h * 0.22, front], white, 0, radius * 0.25)
          box(g, [w * 0.16, h * 0.045, d * 0.012], [0, h * 0.235, front + d * 0.007], screen)
          const buttonRadius = Math.min(w, d, h) * 0.025
          sphere(
            g,
            [buttonRadius * 2, buttonRadius * 2, buttonRadius * 1.4],
            [w * 0.23, h * 0.235, front + d * 0.012],
            dark,
          )
          const cupWidth = w * 0.6,
            cupDepth = d * 0.6,
            cupBottom = h * 0.3,
            cupHeight = h * 0.52
          box(g, [cupWidth, h * 0.06, cupDepth], [0, h * 0.285, 0], pale, 0, radius * 0.5)
          const cup = new THREE.Mesh(
            new THREE.CylinderGeometry(cupWidth / 2, cupWidth * 0.46, cupHeight, 16),
            glassMaterial,
          )
          cup.position.y = cupBottom + cupHeight / 2
          cup.scale.z = cupDepth / cupWidth
          g.add(cup)
          const lid = new THREE.Mesh(
            new THREE.CylinderGeometry(cupWidth * 0.51, cupWidth * 0.51, h * 0.06, 16),
            white,
          )
          lid.position.y = cupBottom + cupHeight + h * 0.03
          lid.scale.z = cupDepth / cupWidth
          g.add(lid)
          sphere(g, [w * 0.16, h * 0.045, d * 0.12], [0, h * 0.9, 0], pale)
          const handleRadius = Math.min(w, d, h) * 0.014,
            handleStart = cupWidth / 2 - w * 0.01,
            handleEnd = cupWidth / 2 + w * 0.09
          rod(g, [handleStart, h * 0.5, 0], [handleEnd, h * 0.5, 0], handleRadius, pale)
          rod(g, [handleEnd, h * 0.5, 0], [handleEnd, h * 0.68, 0], handleRadius, pale)
          rod(g, [handleEnd, h * 0.68, 0], [handleStart, h * 0.68, 0], handleRadius, pale)
        } else if (item.kind === 'cabinet' && item.variant === 'wardrobe') {
          const base = h * 0.08,
            drawerTop = h * 0.34,
            front = d / 2 + 0.014
          box(g, [w, h, d], [0, h / 2, 0], white)
          box(g, [w - 0.012, h - 0.018, 0.002], [0, h / 2, d / 2 + 0.001], cabinetRecess)
          const doors = Math.max(2, Math.round(w / 0.62))
          for (let n = 0; n < doors; n++) {
            const x = -w / 2 + (w * (n + 0.5)) / doors
            box(
              g,
              [w / doors - 0.008, h - drawerTop - 0.05, 0.025],
              [x, (drawerTop + h) / 2, front],
              white,
            )
            sphere(
              g,
              [0.052, 0.052, 0.052],
              [x + (n % 2 ? -0.06 : 0.06), (drawerTop + h) / 2, front + 0.03],
              brass,
            )
          }
          for (let n = 0; n < 3; n++) {
            const y = base + ((drawerTop - base) * (n + 0.5)) / 3
            box(g, [w - 0.018, (drawerTop - base) / 3 - 0.008, 0.025], [0, y, front], white)
            sphere(g, [0.052, 0.052, 0.052], [0, y, front + 0.03], brass)
          }
          rounded(g, [w + 0.014, 0.045, d + 0.016], [0, h - 0.0225, 0], white)
        } else if (item.kind === 'cabinet' && item.variant === 'shoe') {
          const base = h * 0.08,
            front = d / 2 + 0.014,
            usable = h - base
          const nicheWidth = w * 0.48,
            nicheX = w * 0.25,
            doorX = -w * 0.25
          const nicheBottom = h * 0.43,
            nicheTop = h * 0.61
          box(g, [w, usable, 0.025], [0, base + usable / 2, -d / 2 + 0.025], white)
          box(
            g,
            [nicheWidth, nicheTop - nicheBottom, 0.028],
            [nicheX, (nicheTop + nicheBottom) / 2, -d / 2 + 0.045],
            wood,
          )
          for (const y of [nicheBottom, nicheTop])
            box(g, [nicheWidth, 0.025, d], [nicheX, y, 0], wood)
          for (const x of [-w / 2 + 0.02, 0, w / 2 - 0.02])
            box(g, [0.04, usable, d], [x, base + usable / 2, 0], white)
          for (const [x, bottom, top] of [
            [doorX, base, nicheTop],
            [doorX, nicheTop, h],
            [nicheX, base, nicheBottom],
            [nicheX, nicheTop, h],
          ]) {
            box(g, [nicheWidth, top - bottom - 0.01, 0.025], [x, (top + bottom) / 2, front], white)
            const handleY = bottom === base ? top - 0.045 : bottom + 0.045
            for (const sign of [-1, 1])
              sphere(
                g,
                [0.035, 0.04, 0.035],
                [x + sign * nicheWidth * 0.09, handleY, front + 0.025],
                brass,
              )
          }
          for (const x of [-w / 2 + 0.05, w / 2 - 0.05])
            box(g, [0.05, base, d], [x, base / 2, 0], white)
        } else {
          const sink = item.fixture === 'sink'
          if (sink) {
            const bodyHeight = h - 0.06,
              panel = Math.min(0.04, w * 0.04)
            // Leave the under-sink cabinet open at the top so the bowl can drop into it.
            box(g, [panel, bodyHeight, d], [-w / 2 + panel / 2, bodyHeight / 2, 0], finish)
            box(g, [panel, bodyHeight, d], [w / 2 - panel / 2, bodyHeight / 2, 0], finish)
            box(
              g,
              [w - panel * 2, bodyHeight, panel],
              [0, bodyHeight / 2, -d / 2 + panel / 2],
              finish,
            )
            box(g, [w - panel * 2, panel, d - panel], [0, panel / 2, 0], finish)
          } else {
            box(g, [w, h - 0.06, d], [0, (h - 0.06) / 2, 0], finish)
          }
          const doors = Math.max(2, Math.round(w / 0.48))
          for (let n = 0; n < doors; n++) {
            const x = -w / 2 + (w * (n + 0.5)) / doors
            box(g, [w / doors - 0.007, h - 0.09, 0.022], [x, h / 2, d / 2 + 0.012], finish)
            if (item.kind === 'cabinet')
              box(
                g,
                [0.007, 0.16, 0.015],
                [x + (w / doors) * 0.33, Math.min(h * 0.55, 1.1), d / 2 + 0.03],
                dark,
              )
          }
          if (!sink)
            rounded(
              g,
              [w + 0.014, 0.045, d + 0.016],
              [0, h - 0.0225, 0],
              item.kind === 'cabinet' ? finish : pale,
            )
          if (item.fixture === 'cooktop') {
            rounded(g, [w * 0.4, 0.012, d * 0.69], [0, h + 0.006, 0], screen)
            for (const x of [-w * 0.105, w * 0.105]) {
              const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.003, 6, 24), dark)
              ring.rotation.x = Math.PI / 2
              ring.position.set(x, h + 0.018, 0)
              g.add(ring)
            }
          } else if (sink) {
            const countertopWidth = w + 0.014,
              countertopDepth = d + 0.016,
              topThickness = 0.045,
              basinWidth = w * 0.68,
              basinDepth = d * 0.64
            // A single worktop with a real aperture avoids seams between four slabs.
            const topShape = new THREE.Shape()
            topShape.moveTo(-countertopWidth / 2, -countertopDepth / 2)
            topShape.lineTo(countertopWidth / 2, -countertopDepth / 2)
            topShape.lineTo(countertopWidth / 2, countertopDepth / 2)
            topShape.lineTo(-countertopWidth / 2, countertopDepth / 2)
            topShape.closePath()
            const aperture = new THREE.Path()
            aperture.moveTo(-basinWidth / 2, -basinDepth / 2)
            aperture.lineTo(-basinWidth / 2, basinDepth / 2)
            aperture.lineTo(basinWidth / 2, basinDepth / 2)
            aperture.lineTo(basinWidth / 2, -basinDepth / 2)
            aperture.closePath()
            topShape.holes.push(aperture)
            const worktop = shapeExtrusion(
              g,
              topShape,
              topThickness - 0.004,
              [0, h - 0.002, 0],
              pale,
              0.002,
            )
            worktop.rotation.x = Math.PI / 2

            const rimThickness = 0.012,
              rimY = h + 0.006
            for (const z of [-1, 1])
              box(
                g,
                [basinWidth + rimThickness * 2, rimThickness, rimThickness],
                [0, rimY, z * (basinDepth / 2 + rimThickness / 2)],
                steel,
                0,
                0.003,
              )
            for (const x of [-1, 1])
              box(
                g,
                [rimThickness, rimThickness, basinDepth],
                [x * (basinWidth / 2 + rimThickness / 2), rimY, 0],
                steel,
                0,
                0.003,
              )

            const bowlDepth = Math.min(0.16, h * 0.19),
              wallThickness = 0.024,
              bowlWidth = basinWidth + rimThickness * 2,
              bowlWidthDepth = basinDepth + rimThickness * 2,
              bowlTopY = h + 0.001,
              bowlBottomY = bowlTopY - bowlDepth,
              bowlCenterY = (bowlTopY + bowlBottomY) / 2
            box(
              g,
              [bowlWidth, bowlDepth, wallThickness],
              [0, bowlCenterY, -bowlWidthDepth / 2 + wallThickness / 2],
              steel,
              0,
              0.008,
            )
            box(
              g,
              [bowlWidth, bowlDepth, wallThickness],
              [0, bowlCenterY, bowlWidthDepth / 2 - wallThickness / 2],
              steel,
              0,
              0.008,
            )
            for (const x of [-1, 1])
              box(
                g,
                [wallThickness, bowlDepth, bowlWidthDepth - wallThickness * 2],
                [x * (bowlWidth / 2 - wallThickness / 2), bowlCenterY, 0],
                steel,
                0,
                0.008,
              )
            const bowlBottom = bowlBottomY + 0.014
            rounded(
              g,
              [bowlWidth - wallThickness * 2, 0.028, bowlWidthDepth - wallThickness * 2],
              [0, bowlBottom, 0],
              steel,
            )
            const drainRadius = Math.min(bowlWidth, bowlWidthDepth) * 0.085
            const drain = new THREE.Mesh(
              new THREE.CylinderGeometry(drainRadius, drainRadius * 0.9, 0.008, 24),
              steel,
            )
            drain.position.set(0, bowlBottom + 0.018, 0)
            drain.castShadow = true
            g.add(drain)
            const drainRing = new THREE.Mesh(
              new THREE.TorusGeometry(drainRadius * 0.78, 0.0035, 8, 24),
              steel,
            )
            drainRing.rotation.x = Math.PI / 2
            drainRing.position.set(0, bowlBottom + 0.023, 0)
            g.add(drainRing)

            const faucetX = w * 0.28,
              faucetBaseZ = -d * 0.41,
              faucetTopY = h + 0.22
            const faucetBase = new THREE.Mesh(
              new THREE.CylinderGeometry(0.027, 0.032, 0.012, 20),
              steel,
            )
            faucetBase.position.set(faucetX, h + 0.006, faucetBaseZ)
            faucetBase.castShadow = true
            g.add(faucetBase)
            const faucetCurve = new THREE.CatmullRomCurve3([
              new THREE.Vector3(faucetX, h + 0.012, faucetBaseZ),
              new THREE.Vector3(faucetX, h + 0.13, faucetBaseZ),
              new THREE.Vector3(faucetX, faucetTopY, faucetBaseZ + d * 0.08),
              new THREE.Vector3(faucetX, faucetTopY, faucetBaseZ + d * 0.18),
            ])
            const faucetNeck = new THREE.Mesh(
              new THREE.TubeGeometry(faucetCurve, 16, 0.012, 8, false),
              steel,
            )
            faucetNeck.castShadow = true
            g.add(faucetNeck)
            rod(
              g,
              [faucetX, faucetTopY, faucetBaseZ + d * 0.18],
              [faucetX, faucetTopY, faucetBaseZ + d * 0.29],
              0.012,
              steel,
            )
            const handleX = faucetX - w * 0.1
            rod(
              g,
              [handleX, h + 0.014, faucetBaseZ],
              [handleX, h + 0.074, faucetBaseZ],
              0.009,
              steel,
            )
            sphere(g, [0.026, 0.018, 0.026], [handleX, h + 0.084, faucetBaseZ], steel)

            // A dark shadow line under the worktop reads as the recessed cabinet pull.
            box(g, [w * 0.92, 0.014, 0.018], [0, h - 0.052, d / 2 + 0.026], dark, 0, 0.004)
          } else if (item.kind === 'basin') {
            rounded(g, [w * 0.64, 0.018, d * 0.62], [0, h + 0.006, 0], dark)
            rounded(g, [w * 0.54, 0.02, d * 0.5], [0, h + 0.016, 0], pale)
            rod(g, [0, h + 0.01, -d * 0.34], [0, h + 0.18, -d * 0.34], 0.012, dark)
            rod(g, [0, h + 0.18, -d * 0.34], [0, h + 0.18, -d * 0.15], 0.012, dark)
          }
        }
        g.traverse((node) => {
          if ((node as Three.Mesh).isMesh) pickable.push(node)
        })
      }
      const selectionOutline = new THREE.Box3Helper(new THREE.Box3(), readColor('highlight'))
      selectionOutline.visible = false
      scene.add(selectionOutline)
      for (const mat of Array.isArray(selectionOutline.material)
        ? selectionOutline.material
        : [selectionOutline.material]) {
        materials.add(mat)
        roleMaterials.push({
          material: mat as Three.Material & { color: Three.Color },
          role: 'highlight',
        })
      }

      const roleName = {
        greenPipe: 'green-pipe',
        orangePipe: 'orange-pipe',
        network: 'network',
        fiber: 'fiber',
        lighting: 'lighting',
        switch: 'outlet',
        waterPipe: 'water-pipe',
        drainPipe: 'drain-pipe',
        outlet: 'outlet',
        cableDuct: 'gray-pipe',
      }
      const objectColor = (object: ModelObject) =>
        object.kind === 'guide'
          ? 'water-guide'
          : object.signal === 'tv'
            ? 'tv'
            : object.signal === 'unidentified'
              ? 'gray-pipe'
              : object.surfaceColor
                ? `${object.surfaceColor}-pipe`
                : roleName[object.role]
      const routeColor = (object: ModelObject) =>
        object.surfaceColor
          ? `${object.surfaceColor}-pipe`
          : object.category === 'network' || object.category === 'diagramNetwork'
            ? 'green-pipe'
            : object.category === 'outlets' ||
                object.category === 'switches' ||
                object.category === 'lighting'
              ? 'orange-pipe'
              : object.category === 'water'
                ? 'blue-pipe'
                : objectColor(object)
      const routeDiameter = (object: ModelObject) => {
        const route = object.route
        const fallback = object.category === 'water' ? 0.04 : 0.025
        const targetId = route?.to?.object
        if (object.trace && targetId) {
          const target = model.objects.find((item) => item.id === targetId)
          return Math.min(object.displayDiameter ?? fallback, target?.displayDiameter ?? fallback)
        }
        const reference = route?.references
          .map((id) => model.objects.find((item) => item.id === id))
          .find(
            (item) =>
              item?.kind === 'region' &&
              (item.category === object.category || item.role === object.role) &&
              item.displayDiameter !== undefined,
          )
        return reference?.displayDiameter ?? fallback
      }
      const pickMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      materials.add(pickMaterial)
      const highlightMaterial = material('highlight', {
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        side: THREE.BackSide,
      })
      const addPipe = (
        g: Three.Group,
        points: Three.Vector3[],
        radius: number,
        mat: Three.Material,
      ) => {
        const curve = new THREE.CurvePath<Three.Vector3>()
        let from = points[0]
        for (let i = 1; i < points.length; i++) {
          if (i === points.length - 1) {
            curve.add(new THREE.LineCurve3(from, points[i]))
            break
          }
          const corner = points[i],
            next = points[i + 1]
          const inset = Math.min(
            radius * 2.5,
            from.distanceTo(corner) * 0.25,
            next.distanceTo(corner) * 0.25,
          )
          const before = corner
            .clone()
            .lerp(from, inset / Math.max(0.000001, from.distanceTo(corner)))
          const after = corner
            .clone()
            .lerp(next, inset / Math.max(0.000001, next.distanceTo(corner)))
          curve.add(new THREE.LineCurve3(from, before))
          curve.add(new THREE.QuadraticBezierCurve3(before, corner, after))
          from = after
        }
        const segments = Math.max(24, points.length * 12)
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 10, false), mat)
        g.add(mesh)
        pickable.push(mesh)
        // Wider invisible picking geometry keeps fine conduit readable at its display diameter.
        const pick = new THREE.Mesh(
          new THREE.TubeGeometry(curve, segments, Math.max(radius + 0.025, 0.045), 6, false),
          pickMaterial,
        )
        pick.userData.pickProxy = true
        g.add(pick)
        pickable.push(pick)
        const highlight = new THREE.Group()
        const halo = new THREE.Mesh(
          new THREE.TubeGeometry(curve, segments, radius + 0.012, 8, false),
          highlightMaterial,
        )
        halo.userData.fixedColor = true
        halo.userData.pickProxy = true
        highlight.add(halo)
        for (const point of [points[0], points[points.length - 1]]) {
          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(Math.max(radius * 1.35, 0.04), 12, 8),
            highlightMaterial,
          )
          marker.position.copy(point)
          marker.userData.fixedColor = true
          marker.userData.pickProxy = true
          highlight.add(marker)
        }
        highlight.visible = false
        g.add(highlight)
        return { mesh, pick, highlight }
      }
      for (const object of model.objects) {
        const g = new THREE.Group()
        g.userData.selection = `object:${object.id}`
        const points = object.path.map((point) => new THREE.Vector3(...point))
        if (object.kind === 'region') {
          const radius = (object.displayDiameter ?? (object.role === 'drainPipe' ? 0.1 : 0.025)) / 2
          const { highlight } = addPipe(
            g,
            points,
            radius,
            material(objectColor(object), { roughness: 0.48 }),
          )
          objectHighlights.set(object.id, highlight)
        } else if (object.kind === 'relationship' || object.kind === 'guide') {
          const mat = new LineMaterial({
            color: readColor(objectColor(object)),
            linewidth: 2.5,
            dashed: true,
            dashSize: object.kind === 'guide' ? 0.24 : 0.16,
            gapSize: 0.11,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
          materials.add(mat)
          const line = new Line2(new LineGeometry().setPositions(object.path.flat()), mat)
          // CSS-pixel width keeps functional guides legible at every zoom level above the scan context.
          line.renderOrder = 10
          line.computeLineDistances()
          g.add(line)
          pickable.push(line)
          const markerMat = material(objectColor(object), { depthTest: false })
          for (const [index, p] of points.entries()) {
            // Referenced boxes already mark this endpoint and must stay directly selectable.
            if (object.endpointBoxes?.[index] || object.links?.[index]) continue
            const marker = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), markerMat)
            marker.position.copy(p)
            g.add(marker)
            pickable.push(marker)
          }
        } else {
          const point = points[0]
          if (object.category === 'network') {
            // Functional endpoints do not assert separate installed socket plates.
            const marker = new THREE.Mesh(
              new THREE.SphereGeometry(0.04, 16, 12),
              material(objectColor(object)),
            )
            marker.position.copy(point)
            marker.userData.selection = `object:${object.id}`
            g.add(marker)
            pickable.push(marker)
          } else if (object.category === 'lighting' && !object.trace) {
            const markerMaterial = material(roleName[object.role], {
              transparent: true,
              opacity: 0.92,
              side: THREE.DoubleSide,
            })
            const marker = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.14, 24), markerMaterial)
            marker.rotation.x = -Math.PI / 2
            marker.position.copy(point)
            marker.position.y += 0.012
            marker.userData.selection = `object:${object.id}`
            g.add(marker)
            pickable.push(marker)
            const center = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), markerMaterial)
            center.rotation.x = -Math.PI / 2
            center.position.copy(point)
            center.position.y += 0.014
            g.add(center)
            pickable.push(center)
          } else if (object.category === 'outlets' || object.category === 'switches') {
            const panelCount = object.category === 'switches' ? object.keyCount : object.outletCount
            if (panelCount && panelCount > 0) {
              const physical = new THREE.Group()
              physical.position.copy(point)
              physical.rotation.y = object.rotation ?? 0
              g.add(physical)
              const highlight = new THREE.Group()
              const [displayWidth, displayHeight, displayDepth] = object.displaySize ?? [
                0.12, 0.12, 0.025,
              ]
              const panelSize = object.category === 'switches' ? displayWidth : 0.086
              const panelHeight = object.category === 'switches' ? displayHeight : panelSize
              const panelDepth = object.category === 'switches' ? displayDepth : 0.018
              const panelSpacing = object.category === 'switches' ? 0 : 0.094
              const offset = ((panelCount - 1) * panelSpacing) / 2
              if (object.category === 'switches') {
                const keyGap = Math.min(0.006, panelSize / (panelCount * 4), panelHeight / 8)
                const keyWidth = (panelSize - (panelCount + 1) * keyGap) / panelCount
                const keyHeight = panelHeight - keyGap * 2
                const firstKeyX = -panelSize / 2 + keyGap + keyWidth / 2
                const keyDepth = Math.min(0.008, panelDepth * 0.4)
                const keyZ = (panelDepth - keyDepth) / 2
                const plate = box(
                  physical,
                  [panelSize, panelHeight, panelDepth - keyDepth],
                  [0, 0, -keyDepth / 2],
                  white,
                )
                plate.userData.fixedColor = true
                plate.userData.selection = `object:${object.id}`
                pickable.push(plate)
                for (let index = 0; index < panelCount; index++) {
                  const x = firstKeyX + index * (keyWidth + keyGap)
                  const key = box(physical, [keyWidth, keyHeight, keyDepth], [x, 0, keyZ], white)
                  key.userData.fixedColor = true
                  key.userData.selection = `object:${object.id}`
                  pickable.push(key)
                  if (index > 0) {
                    const separator = box(
                      physical,
                      [keyGap, keyHeight * 0.82, keyDepth],
                      [x - keyWidth / 2 - keyGap / 2, 0, keyZ],
                      dark,
                    )
                    separator.userData.fixedColor = true
                    separator.userData.selection = `object:${object.id}`
                    pickable.push(separator)
                  }
                }
              } else
                for (let index = 0; index < panelCount; index++) {
                  const x = index * panelSpacing - offset
                  const panel = box(physical, [panelSize, panelSize, panelDepth], [x, 0, 0], white)
                  panel.userData.fixedColor = true
                  panel.userData.selection = `object:${object.id}`
                  pickable.push(panel)
                }
              const outlineWidth =
                object.category === 'switches'
                  ? panelSize + 0.012
                  : panelSize + (panelCount - 1) * panelSpacing + 0.012
              const outlineHeight = panelHeight + 0.012
              const outlineMaterial = material('highlight', { depthWrite: false })
              for (const sign of [-1, 1]) {
                box(
                  highlight,
                  [outlineWidth, 0.004, 0.004],
                  [0, (sign * outlineHeight) / 2, panelDepth / 2 + 0.004],
                  outlineMaterial,
                ).userData.fixedColor = true
                box(
                  highlight,
                  [0.004, outlineHeight, 0.004],
                  [(sign * outlineWidth) / 2, 0, panelDepth / 2 + 0.004],
                  outlineMaterial,
                ).userData.fixedColor = true
              }
              highlight.visible = false
              physical.add(highlight)
              objectHighlights.set(object.id, highlight)
            } else {
              // A point marker does not assert an unconfirmed socket or switch type.
              const panel = box(
                g,
                object.displaySize ?? [0.12, 0.12, 0.025],
                point.toArray(),
                material(roleName[object.role]),
                object.rotation ?? 0,
              )
              if (object.mount === 'ceiling' || object.mount === 'floor')
                panel.rotation.x = Math.PI / 2
              panel.userData.selection = `object:${object.id}`
              pickable.push(panel)
            }
          } else {
            const physical = new THREE.Group()
            physical.position.copy(point)
            physical.rotation.y = object.rotation ?? 0
            if (object.mount === 'ceiling' || object.mount === 'floor')
              physical.rotation.x = Math.PI / 2
            g.add(physical)
            const [width, height, depth] = object.displaySize ?? [0.1, 0.1, 0.035]
            const casing = material(objectColor(object), { roughness: 0.62 })
            if (object.boxStyle === 'open') {
              const rim = Math.min(0.008, width * 0.08, height * 0.08)
              for (const x of [-1, 1])
                pickable.push(
                  box(physical, [rim, height, depth], [(x * (width - rim)) / 2, 0, 0], casing),
                )
              for (const y of [-1, 1])
                pickable.push(
                  box(
                    physical,
                    [width - rim * 2, rim, depth],
                    [0, (y * (height - rim)) / 2, 0],
                    casing,
                  ),
                )
              const back = box(
                physical,
                [width - rim * 2, height - rim * 2, 0.005],
                [0, 0, -depth / 2],
                dark,
              )
              back.userData.fixedColor = true
              pickable.push(back)
            } else if (object.boxStyle === 'roundOpen') {
              const radius = width / 2,
                rim = Math.min(0.008, radius * 0.2)
              const shape = new THREE.Shape()
              shape.absarc(0, 0, radius, 0, Math.PI * 2, false)
              const hole = new THREE.Path()
              hole.absarc(0, 0, radius - rim, 0, Math.PI * 2, true)
              shape.holes.push(hole)
              pickable.push(shapeExtrusion(physical, shape, depth, [0, 0, -depth / 2], casing))
              const opening = new THREE.Mesh(
                new THREE.CircleGeometry(radius - rim, 24),
                material(
                  'metal',
                  { metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide },
                  false,
                ),
              )
              opening.position.z = -depth / 2
              opening.userData.fixedColor = true
              physical.add(opening)
              pickable.push(opening)
            } else if (object.boxStyle === 'roundCap') {
              const cap = new THREE.Mesh(
                new THREE.CylinderGeometry(width / 2, width / 2, depth, 24),
                casing,
              )
              cap.rotation.x = Math.PI / 2
              physical.add(cap)
              pickable.push(cap)
            } else pickable.push(box(physical, [width, height, depth], [0, 0, 0], casing))
          }
        }
        const display = new THREE.Group()
        display.userData.selection = `object:${object.id}`
        display.add(g)
        baseGroups.set(object.id, g)
        if (object.route) {
          const route = new THREE.Group()
          const routePoints = object.route.path.map((point) => new THREE.Vector3(...point))
          const radius = routeDiameter(object) / 2
          const {
            mesh: routeMesh,
            pick: routePick,
            highlight: routeHighlight,
          } = addPipe(route, routePoints, radius, material(routeColor(object), { roughness: 0.48 }))
          routeMesh.userData.selection = `object:${object.id}`
          routeMesh.userData.fixedColor = true
          routePick.userData.selection = `object:${object.id}`
          display.add(route)
          routeGroups.set(object.id, { group: route, highlight: routeHighlight })
        }
        group.add(display)
        objectGroups.set(object.id, display)
      }
      // Only source-confirmed exterior continuations close short projection seams.
      const continuationGroups = (model.observedContinuations ?? [])
        .filter((connection) => connection.bridge !== false)
        .map((connection) => {
          const members = connection.objects.map((id) =>
            model.objects.find((item) => item.id === id)!,
          )
          const g = new THREE.Group()
          const mat = material(objectColor(members[0]), { roughness: 0.48 })
          const [a, b] = members.map((item, index) => item.path[connection.ends[index]])
          if (a.some((value, index) => value !== b[index]))
            rod(g, a, b, Math.min(...members.map((item) => item.displayDiameter ?? 0.025)) / 2, mat)
          group.add(g)
          return { g, mat, members }
        })
      const supplyBox = model.objects.find((item) => item.id === model.powerSupply?.box)
      const powerRoot = new THREE.Group()
      const powerMaterial = new LineMaterial({
        color: readColor('highlight'),
        linewidth: 3,
        dashed: true,
        dashSize: 0.2,
        gapSize: 0.12,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
      materials.add(powerMaterial)
      roleMaterials.push({ material: powerMaterial, role: 'highlight' })
      const powerLine = new Line2(
        new LineGeometry().setPositions([0, 0, 0, 0, 0, 0]),
        powerMaterial,
      )
      powerLine.renderOrder = 10
      powerRoot.add(powerLine)
      group.add(powerRoot)
      const powerSummaryRoot = new THREE.Group()
      const powerSummaryLines = supplyBox
        ? model.objects
            .filter((object) => object.powerEndpoint && object.id !== supplyBox.id)
            .map((endpoint) => {
              const geometry = new LineGeometry().setPositions([
                ...supplyBox.path[0],
                ...endpoint.path[0],
              ])
              const role = objectColor(endpoint)
              const material = new LineMaterial({
                color: readColor(role),
                linewidth: 2.5,
                dashed: true,
                dashSize: 0.18,
                gapSize: 0.12,
                transparent: true,
                depthTest: false,
                depthWrite: false,
                toneMapped: false,
              })
              materials.add(material)
              roleMaterials.push({ material, role })
              const line = new Line2(geometry, material)
              line.renderOrder = 10
              line.computeLineDistances()
              powerSummaryRoot.add(line)
              return { endpoint, line }
            })
        : []
      group.add(powerSummaryRoot)
      const ambient = new THREE.AmbientLight(readColor('light'), 0.5)
      scene.add(ambient)
      const hemisphere = new THREE.HemisphereLight(readColor('light'), readColor('trim'), 1.4)
      scene.add(hemisphere)
      // A broad, unshadowed bounce lifts the shaded faces without another shadow pass.
      const bounce = new THREE.DirectionalLight(readColor('light'), 0)
      bounce.position.set(6, 5, -4)
      scene.add(bounce)
      const sun = new THREE.DirectionalLight(readColor('light'), 2.2)
      shadowLight = sun
      sun.position.set(-6, 10, 7)
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.camera.left = sun.shadow.camera.bottom = -10
      sun.shadow.camera.right = sun.shadow.camera.top = 10
      sun.shadow.normalBias = 0.04
      scene.add(sun)
      // Fit the existing shadow map to the model, independently of the viewing camera.
      scene.updateMatrixWorld(true)
      sun.shadow.updateMatrices(sun)
      const shadowBounds = new THREE.Box3()
      const margin = Math.max(...model.walls.map((wall) => wall.thickness), 0.1)
      for (const x of [-model.extent[0] / 2 - margin, model.extent[0] / 2 + margin])
        for (const y of [-0.12, model.referenceHeight])
          for (const z of [-model.extent[1] / 2 - margin, model.extent[1] / 2 + margin])
            shadowBounds.expandByPoint(
              new THREE.Vector3(x, y, z).applyMatrix4(sun.shadow.camera.matrixWorldInverse),
            )
      // This receiver is presentation only: outside group, framing, picking and walk geometry.
      const groundingMaterial = new THREE.ShadowMaterial({
        color: readColor('furniture'),
        opacity: 0.16,
        depthWrite: false,
      })
      materials.add(groundingMaterial)
      const grounding = new THREE.Mesh(
        new THREE.PlaneGeometry(model.extent[0] + 6, model.extent[1] + 6),
        groundingMaterial,
      )
      grounding.rotation.x = -Math.PI / 2
      grounding.position.y = -0.135
      grounding.receiveShadow = true
      scene.add(grounding)

      const projected = new THREE.Vector3()
      const keys = new Set<string>()
      let walking = false,
        yaw = 0,
        pitch = 0,
        previousTime = 0,
        wasBlocked = false,
        currentRoom = ''
      const activePointers = new Set<number>()
      let pointerStart: { id: number; x: number; y: number } | null = null
      let lookLast: { x: number; y: number } | null = null,
        dragged = false
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
      const landingMaterial = new THREE.MeshBasicMaterial({
        color: readColor('highlight'),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
      materials.add(landingMaterial)
      roleMaterials.push({ material: landingMaterial, role: 'highlight' })
      const landingMarker = new THREE.Group()
      landingMarker.add(
        new THREE.Mesh(new THREE.RingGeometry(0.17, 0.21, 48), landingMaterial),
        new THREE.Mesh(new THREE.CircleGeometry(0.035, 24), landingMaterial),
      )
      landingMarker.rotation.x = -Math.PI / 2
      landingMarker.visible = false
      group.add(landingMarker)
      const clearLanding = () => {
        landingMarker.visible = false
        renderer.domElement.style.cursor = walking && latest.current.mode === 'home' ? 'grab' : ''
      }
      const cancel = () => {
        const pointerId = pointerStart?.id
        pointerStart = lookLast = null
        dragged = false
        clearLanding()
        if (walking && pointerId !== undefined && renderer.domElement.hasPointerCapture(pointerId))
          renderer.domElement.releasePointerCapture(pointerId)
        schedule()
      }
      const distanceToSegment = (x: number, z: number, a: number[], b: number[]) => {
        const dx = b[0] - a[0],
          dz = b[1] - a[1]
        const t = Math.max(
          0,
          Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)),
        )
        return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)
      }
      const passable = (x: number, z: number) => {
        const onFloor = model.rooms.some(
          (room) =>
            inside(x, z, room.polygon) ||
            room.polygon.some(
              (p, i) =>
                distanceToSegment(x, z, p, room.polygon[(i + 1) % room.polygon.length]) < 0.22,
            ),
        )
        if (
          !onFloor ||
          barriers.some((wall) => distanceToSegment(x, z, wall.a, wall.b) < wall.radius + 0.15)
        )
          return false
        if (
          latest.current.mode === 'home' &&
          latest.current.furniture &&
          furnitureFootprints.some((item) => {
            const rotation = item.rotation,
              dx = x - item.position[0],
              dz = z - item.position[1]
            return (
              Math.abs(dx * Math.cos(rotation) - dz * Math.sin(rotation)) <
                item.size[0] / 2 + 0.15 &&
              Math.abs(dx * Math.sin(rotation) + dz * Math.cos(rotation)) < item.size[1] / 2 + 0.15
            )
          })
        )
          return false
        return true
      }
      const render = () => {
        frame = 0
        if (stopped || disposed) return
        const now = performance.now(),
          dt = Math.min((now - previousTime) / 1000 || 0.016, 0.04)
        previousTime = now
        const forward =
          Number(keys.has('w') || keys.has('arrowup') || latest.current.motion === 'forward') -
          Number(keys.has('s') || keys.has('arrowdown') || latest.current.motion === 'back')
        const sideways =
          Number(keys.has('d') || keys.has('arrowright') || latest.current.motion === 'right') -
          Number(keys.has('a') || keys.has('arrowleft') || latest.current.motion === 'left')
        if (walking && (forward || sideways)) {
          clearLanding()
          const normal = Math.hypot(forward, sideways),
            speed = (dt * 1.65) / normal
          const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * sideways) * speed
          const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * sideways) * speed
          const x = camera.position.x - group.position.x,
            z = camera.position.z - group.position.z
          const allowX = passable(x + dx, z),
            allowZ = passable(x + (allowX ? dx : 0), z + dz)
          if (allowX) camera.position.x += dx
          if (allowZ) camera.position.z += dz
          const nextRoom = model.rooms.find((room) =>
            inside(
              camera.position.x - group.position.x,
              camera.position.z - group.position.z,
              room.polygon,
            ),
          )
          if (nextRoom && nextRoom.id !== currentRoom) {
            currentRoom = nextRoom.id
            latest.current.onRoomChange(currentRoom)
          }
          const blocked = Math.hypot(allowX ? dx : 0, allowZ ? dz : 0) < speed * 0.25
          if (blocked !== wasBlocked) {
            wasBlocked = blocked
            latest.current.onBlocked(blocked)
          }
          frame = requestAnimationFrame(render)
        }
        if (latest.current.mode === 'home' && !walking) homeOcclusion.render()
        else renderer.render(scene, camera)
        if (!readyReported) {
          readyReported = true
          latest.current.onStatus('ready')
        }
        const { width, height } = element.getBoundingClientRect()
        const guideBounds: { x: number; y: number; w: number; h: number }[] = []
        for (const object of latest.current.primaryObjects.filter((item) => item.landmarks))
          for (const landmark of object.landmarks!) {
            const label = guideLabels.current.get(object.id + ':' + landmark.index)
            if (!label) continue
            projected
              .set(...object.path[landmark.index])
              .add(group.position)
              .project(camera)
            const x = ((projected.x + 1) * width) / 2,
              y = ((1 - projected.y) * height) / 2
            label.style.display =
              latest.current.mode === 'pipes' &&
              projected.z > -1 &&
              projected.z < 1 &&
              x > 12 &&
              x < width - 12 &&
              y > 180 &&
              y < height - 60
                ? ''
                : 'none'
            if (label.style.display === 'none') continue
            const w = label.offsetWidth,
              h = label.offsetHeight
            const left = Math.min(width - w / 2 - 8, Math.max(w / 2 + 8, x)),
              top = y - h / 2 - 12
            if (
              guideBounds.some(
                (b) =>
                  Math.abs(left - b.x) < (w + b.w) / 2 + 6 &&
                  Math.abs(top - b.y) < (h + b.h) / 2 + 6,
              )
            ) {
              label.style.display = 'none'
              continue
            }
            guideBounds.push({ x: left, y: top, w, h })
            label.style.left = `${left}px`
            label.style.top = `${top}px`
          }
        const targetLabel = powerTargetLabel.current
        const powerTarget = model.objects.find((item) => item.id === latest.current.powerTarget)
        if (targetLabel) {
          if (!powerTarget || latest.current.mode !== 'pipes' || !latest.current.showPowerSupply)
            targetLabel.style.display = 'none'
          else {
            projected
              .set(...powerTarget.path[0])
              .add(group.position)
              .project(camera)
            const x = ((projected.x + 1) * width) / 2,
              y = ((1 - projected.y) * height) / 2
            targetLabel.style.display =
              projected.z > -1 &&
              projected.z < 1 &&
              x > 24 &&
              x < width - 24 &&
              y > 24 &&
              y < height - 24
                ? ''
                : 'none'
            targetLabel.style.left = `${Math.min(width - 110, Math.max(110, x))}px`
            targetLabel.style.top = `${y - 28}px`
          }
        }
        const endpointObject = latest.current.visibleObjects.find(
          (item) => latest.current.selected === 'object:' + item.id && item.endpoints,
        )
        endpointLabels.current.forEach((label, index) => {
          if (!label) return
          if (!endpointObject || latest.current.mode !== 'pipes') {
            label.style.display = 'none'
            return
          }
          projected
            .set(...endpointObject.path[index])
            .add(group.position)
            .project(camera)
          const x = ((projected.x + 1) * width) / 2,
            y = ((1 - projected.y) * height) / 2
          label.style.display =
            projected.z > -1 &&
            projected.z < 1 &&
            x > 12 &&
            x < width - 12 &&
            y > 24 &&
            y < height - 24
              ? ''
              : 'none'
          label.style.left = `${Math.min(width - 60, Math.max(60, x))}px`
          label.style.top = `${y - 28}px`
        })
        const supplyLabel = powerLabel.current
        if (supplyLabel && supplyBox) {
          projected
            .copy(new THREE.Vector3(...supplyBox.path[0]).add(group.position))
            .project(camera)
          const x = ((projected.x + 1) * width) / 2,
            y = ((1 - projected.y) * height) / 2
          supplyLabel.style.display =
            latest.current.mode === 'pipes' &&
            latest.current.showPowerSupply &&
            projected.z > -1 &&
            projected.z < 1 &&
            x > 24 &&
            x < width - 24 &&
            y > 24 &&
            y < height - 24
              ? ''
              : 'none'
          supplyLabel.style.left = `${Math.min(width - 60, Math.max(60, x))}px`
          supplyLabel.style.top = `${y - 24}px`
        }
        const occupied: { left: number; right: number; top: number; bottom: number }[] = []
        // Keep the selected room first; small rooms remain reachable in the room list.
        const relatedRooms = new Set(
          model.objects.find((object) => latest.current.selected === `object:${object.id}`)
            ?.rooms ??
            model.rooms
              .filter((room) => latest.current.selected === `room:${room.id}`)
              .map((room) => room.id),
        )
        const ordered = [...model.rooms].sort(
          (a, b) => Number(relatedRooms.has(b.id)) - Number(relatedRooms.has(a.id)),
        )
        for (const room of ordered) {
          const button = labels.current.get(room.id)
          if (!button) continue
          projected
            .set(room.label[0] + group.position.x, 0.3, room.label[1] + group.position.z)
            .project(camera)
          const x = ((projected.x + 1) * width) / 2,
            y = ((1 - projected.y) * height) / 2
          const show =
            latest.current.roomLabels &&
            (!focusedRoom || room.id === focusedRoom.id) &&
            !walking &&
            projected.z > -1 &&
            projected.z < 1 &&
            x > 0 &&
            x < width &&
            y > 0 &&
            y < height &&
            (width > 560 || relatedRooms.has(room.id))
          button.style.display = show ? '' : 'none'
          if (!show) continue
          const halfWidth = button.offsetWidth / 2,
            halfHeight = button.offsetHeight / 2
          const left = Math.min(width - halfWidth - 4, Math.max(halfWidth + 4, x))
          const top = Math.min(height - halfHeight - 4, Math.max(halfHeight + 4, y))
          const bounds = {
            left: left - halfWidth,
            right: left + halfWidth,
            top: top - halfHeight,
            bottom: top + halfHeight,
          }
          if (
            occupied.some(
              (other) =>
                bounds.left < other.right + 4 &&
                bounds.right + 4 > other.left &&
                bounds.top < other.bottom + 4 &&
                bounds.bottom + 4 > other.top,
            )
          ) {
            button.style.display = 'none'
            continue
          }
          occupied.push(bounds)
          button.style.left = `${left}px`
          button.style.top = `${top}px`
        }
      }
      const schedule = () => {
        if (!stopped && !disposed && !frame) frame = requestAnimationFrame(render)
      }
      const framingPoints = (nodes: Three.Object3D[] = [group]) => {
        const points: Three.Vector3[] = []
        group.updateWorldMatrix(true, true)
        for (const node of nodes)
          node.traverseVisible((child) => {
            const mesh = child as Three.Mesh
            if (
              !mesh.geometry ||
              child.userData.pickProxy ||
              child === landingMarker ||
              child.parent === landingMarker
            )
              return
            mesh.geometry.computeBoundingBox()
            const bounds = mesh.geometry.boundingBox!
            const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
            const clipped = mat?.clippingPlanes?.includes(cut)
            const corners: Three.Vector3[] = []
            for (const x of [bounds.min.x, bounds.max.x])
              for (const y of [bounds.min.y, bounds.max.y])
                for (const z of [bounds.min.z, bounds.max.z])
                  corners.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld))
            if (clipped && corners.every((point) => point.y > cut.constant)) return
            for (const point of corners) {
              if (clipped) point.y = Math.min(point.y, cut.constant)
              points.push(point)
            }
          })
        return points
      }
      const fitCamera = (points: Three.Vector3[], top = false, reverse = false) => {
        if (!points.length) return
        // A group inspected on its own faces the camera; whole-house and two-end views retain their orientation.
        const panelGroup =
          latest.current.view.kind === 'object'
            ? model.objects.find(
                (item) =>
                  item.id === latest.current.view.object &&
                  (item.keyCount !== undefined ||
                    (item.outletCount !== undefined && !latest.current.showPowerSupply)),
              )
            : undefined
        const angle = panelGroup
          ? [Math.sin(panelGroup.rotation ?? 0), 0.22, Math.cos(panelGroup.rotation ?? 0)]
          : camera.aspect < 0.8
            ? latest.current.mode === 'home' && latest.current.view.kind === 'focus'
              ? [0.5, 1.05, 1.4]
              : [0.18, 2.1, 1.25]
            : [
                0.75,
                latest.current.mode === 'home' && latest.current.view.kind === 'focus'
                  ? 0.95
                  : 1.05,
                1.15,
              ]
        const direction = new THREE.Vector3(
          ...((top ? [0, 1, 0.028] : reverse ? angle.map((n, i) => (i === 1 ? n : -n)) : angle) as [
            number,
            number,
            number,
          ]),
        ).normalize()
        const right = new THREE.Vector3(direction.z, 0, -direction.x).normalize()
        const up = new THREE.Vector3().crossVectors(direction, right).normalize()
        const bounds = new THREE.Box3().setFromPoints(points)
        controls.target.copy(bounds.getCenter(new THREE.Vector3()))
        const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        const projected = points.map((point) => point.clone().sub(controls.target))
        const horizontal = projected.map((point) => point.dot(right)),
          vertical = projected.map((point) => point.dot(up))
        controls.target
          .addScaledVector(right, (Math.min(...horizontal) + Math.max(...horizontal)) / 2)
          .addScaledVector(up, (Math.min(...vertical) + Math.max(...vertical)) / 2)
        // Reserve the permanent toolbar in every pipe object view, including wide layouts.
        // Temporary panels never change this fit or the canvas size.
        const objectRoute = latest.current.mode === 'pipes' && latest.current.view.kind === 'object'
        const roomFocus = latest.current.mode === 'home' && latest.current.view.kind === 'focus'
        const toolbar = objectRoute
          ? (element
              .closest(`.${styles.viewer}`)
              ?.querySelector('[aria-label="预埋类别快速入口"]') ?? null)
          : roomFocus
            ? (element.closest(`.${styles.viewer}`)?.querySelector('[aria-label="查看模式"]') ??
              null)
            : null
        const narrowRoute =
          objectRoute && toolbar !== null && getComputedStyle(toolbar).display === 'grid'
        const height = element.clientHeight
        const topSpace = Math.max(
          narrowRoute ? Math.min(252, height * 0.34) : 0,
          toolbar
            ? toolbar.getBoundingClientRect().bottom - element.getBoundingClientRect().top + 12
            : 0,
        )
        const bottomSpace =
          objectRoute || roomFocus ? Math.min(narrowRoute ? 116 : 64, height * 0.16) : 0
        const verticalSpace = Math.max(0.35, (height - topSpace - bottomSpace) / height)
        const horizontalSpace = narrowRoute
          ? Math.max(0.5, (element.clientWidth - 64) / element.clientWidth)
          : roomFocus && camera.aspect < 0.8
            ? 0.84
            : 0.94
        let distance = controls.minDistance
        for (const source of points) {
          const point = source.clone().sub(controls.target)
          distance = Math.max(
            distance,
            point.dot(direction) +
              Math.max(
                Math.abs(point.dot(right)) / (tangent * camera.aspect * horizontalSpace),
                Math.abs(point.dot(up)) / (tangent * 0.9 * verticalSpace),
              ),
          )
        }
        if (objectRoute || roomFocus)
          camera.setViewOffset(
            element.clientWidth,
            height,
            0,
            (bottomSpace - topSpace) / 2,
            element.clientWidth,
            height,
          )
        camera.position.copy(controls.target).addScaledVector(direction, distance)
      }
      const loadScanBase = async () => {
        const registration = model.constructionRegistration
        if (scanAttempted || !registration || !model.constructionModel) return
        scanAttempted = true
        latest.current.onStructureBase('loading')
        try {
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
          const gltf = await new GLTFLoader().loadAsync(
            `/private-vr/${model.constructionModel.file}`,
          )
          const originalMaterials = new Set<Three.Material>(),
            originalTextures = new Set<Three.Texture>()
          gltf.scene.traverse((node) => {
            const mesh = node as Three.Mesh
            for (const mat of Array.isArray(mesh.material)
              ? mesh.material
              : mesh.material
                ? [mesh.material]
                : []) {
              originalMaterials.add(mat)
              for (const value of Object.values(mat))
                if (value && typeof value === 'object' && (value as Three.Texture).isTexture)
                  originalTextures.add(value as Three.Texture)
            }
            if (stopped || disposed) mesh.geometry?.dispose()
          })
          for (const mat of originalMaterials) mat.dispose()
          const originalBitmaps = new Set<ImageBitmap>()
          for (const texture of originalTextures) {
            texture.dispose()
            const bitmap = texture.source.data
            if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap)
              originalBitmaps.add(bitmap)
          }
          for (const bitmap of originalBitmaps) bitmap.close()
          if (stopped || disposed) return
          // The scan and traced paths share one rigid registration; the source mesh is never stretched to fit a guessed wall.
          gltf.scene.matrixAutoUpdate = false
          gltf.scene.matrix
            .makeScale(...registration.scale)
            .multiply(new THREE.Matrix4().makeRotationY(registration.rotation))
            .setPosition(...registration.translation)
          const roof = new THREE.Plane(
            new THREE.Vector3(0, -1, 0),
            registration.bounds[0][1] +
              (registration.bounds[1][1] - registration.bounds[0][1]) * 0.85,
          )
          const scanMaterial = material('wall', {
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            side: THREE.DoubleSide,
            clippingPlanes: [roof],
            roughness: 1,
          })
          gltf.scene.traverse((node) => {
            const mesh = node as Three.Mesh
            if (mesh.isMesh) {
              mesh.material = scanMaterial
              mesh.castShadow = false
              mesh.receiveShadow = false
            }
          })
          scanBase = gltf.scene
          group.add(scanBase)
          latest.current.onStructureBase('scan')
          update()
          if (!walking && currentFraming) {
            currentFraming()
            controls.update()
            schedule()
          }
        } catch {
          if (!stopped && !disposed) latest.current.onStructureBase('model')
        }
      }
      const update = () => {
        const state = latest.current
        const indoor = state.view.kind === 'walk' || state.view.kind === 'photo'
        const home = state.mode === 'home'
        focusedRoom =
          home && state.view.kind === 'focus'
            ? model.rooms.find((room) => room.id === state.view.room)
            : undefined
        camera.fov = indoor ? 70 : home ? 32 : 38
        camera.updateProjectionMatrix()
        if (focusedRoom) {
          roomBackCut.constant = state.wallCut + 0.001
          const xs = focusedRoom.polygon.map(([x]) => x),
            zs = focusedRoom.polygon.map(([, z]) => z)
          const margin = Math.max(...model.walls.map((wall) => wall.thickness)) / 2 + 0.025
          roomSides[0].constant = -(Math.min(...xs) + group.position.x - margin)
          roomSides[1].constant = Math.max(...xs) + group.position.x + margin
          roomSides[2].constant = -(Math.min(...zs) + group.position.z - margin)
          roomSides[3].constant = Math.max(...zs) + group.position.z + margin
        }
        for (const [base, variants] of roomWallFinishes)
          for (const value of variants)
            if ('color' in base && 'color' in value)
              (value.color as Three.Color).copy(base.color as Three.Color)
        for (const wall of roomWalls) {
          wall.group.visible = true
          if (focusedRoom) {
            // Exclude neighbouring walls that merely touch the cutaway bounds.
            // Probe intervals split by polygon vertices, including concave rooms.
            const polygon = focusedRoom.polygon
            const tangent = new THREE.Vector2(-wall.normal.y, wall.normal.x)
            const breaks = [
              -wall.length / 2,
              wall.length / 2,
              ...polygon.map(([x, z]) =>
                THREE.MathUtils.clamp(
                  new THREE.Vector2(x, z).sub(wall.midpoint).dot(tangent),
                  -wall.length / 2,
                  wall.length / 2,
                ),
              ),
            ].sort((a, b) => a - b)
            const distance = wall.thickness / 2 + 0.08
            wall.group.visible = breaks.slice(1).some((end, i) => {
              if (end - breaks[i] < 0.0001) return false
              const point = wall.midpoint.clone().addScaledVector(tangent, (breaks[i] + end) / 2)
              return [-1, 1].some((side) =>
                inside(
                  point.x + wall.normal.x * distance * side,
                  point.y + wall.normal.y * distance * side,
                  polygon,
                ),
              )
            })
          }
          const offset = focusedRoom
            ? wall.midpoint.clone().sub(new THREE.Vector2(...focusedRoom.label))
            : null
          const outward = wall.normal.clone()
          if (offset && outward.dot(offset) < 0) outward.negate()
          // Keep the two back elevations; cut the viewer-facing elevations down to a plinth.
          const front = outward.dot(new THREE.Vector2(0.75, 1.15)) > 0.15
          wall.group.userData.focusCut = front ? roomFrontCut.constant : roomBackCut.constant
          wall.group.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return
            const base = object.userData.wallFinish as Three.Material
            object.material = focusedRoom ? roomWallFinishes.get(base)![front ? 1 : 0] : base
          })
        }
        scene.environment = home ? studioLight.texture : null
        scene.environmentIntensity = 0.18
        renderer.toneMappingExposure = home ? 1 : 1.05
        ambient.intensity = home ? (indoor ? 0.85 : 0.18) : 0.5
        hemisphere.intensity = home ? 0.8 : 1.4
        hemisphere.groundColor.set(readColor(home ? 'ground-light' : 'trim'))
        bounce.intensity = home && !indoor ? 0.3 : 0
        sun.position.set(...((home ? [-6, 10, 7] : [-5, 14, 7]) as [number, number, number]))
        sun.intensity = home ? 2.5 : 2.2
        sun.shadow.radius = home ? (focusedRoom ? 12 : 5) : 1
        sun.shadow.intensity = home ? 0.75 : 1
        sun.shadow.bias = home ? -0.00012 : 0
        sun.shadow.normalBias = home ? 0.009 : 0.04
        sun.updateMatrixWorld(true)
        sun.shadow.updateMatrices(sun)
        const shadowCamera = sun.shadow.camera
        const visibleShadowBounds = shadowBounds.clone()
        if (focusedRoom) {
          visibleShadowBounds.makeEmpty()
          for (const [x, z] of focusedRoom.polygon)
            for (const y of [-0.12, model.referenceHeight])
              visibleShadowBounds.expandByPoint(
                new THREE.Vector3(x + group.position.x, y, z + group.position.z).applyMatrix4(
                  shadowCamera.matrixWorldInverse,
                ),
              )
        }
        shadowCamera.left = home ? visibleShadowBounds.min.x - 0.25 : -10
        shadowCamera.right = home ? visibleShadowBounds.max.x + 0.25 : 10
        shadowCamera.bottom = home ? visibleShadowBounds.min.y - 0.25 : -10
        shadowCamera.top = home ? visibleShadowBounds.max.y + 0.25 : 10
        shadowCamera.near = home ? Math.max(0.1, -visibleShadowBounds.max.z - 0.5) : 0.5
        shadowCamera.far = home ? -visibleShadowBounds.min.z + 0.5 : 500
        shadowCamera.updateProjectionMatrix()
        // Orbiting does not move the house or its light; update shadows only on scene changes.
        sun.shadow.autoUpdate = !home
        sun.shadow.needsUpdate = true
        grounding.visible = home && !indoor
        clearLanding()
        if (state.mode !== 'home' || !indoor) relocationAnimation?.cancel()
        renderer.domElement.setAttribute(
          'aria-label',
          indoor && state.mode === 'home'
            ? '三维室内场景，单击地面移动，拖动转头，也可使用 WASD、方向键或屏幕方向按钮移动'
            : '三维房屋场景，可拖动旋转、缩放或选择房间',
        )
        cut.constant = indoor || state.mode === 'pipes' ? model.referenceHeight : state.wallCut
        if (state.mode === 'pipes' && !scanAttempted) void loadScanBase()
        if (scanBase) scanBase.visible = state.mode === 'pipes' && state.structure
        wallGroup.visible = state.mode === 'home' || (state.structure && !scanBase)
        ceilingGroup.visible = state.mode === 'home' && indoor
        wallMaterial.opacity =
          edgeMaterial.opacity =
          trim.opacity =
          blinds.opacity =
          blindTapes.opacity =
          wallTileMaterial.opacity =
            state.mode === 'pipes' ? 0.12 : 1
        wallMaterial.depthWrite =
          edgeMaterial.depthWrite =
          trim.depthWrite =
          blinds.depthWrite =
          blindTapes.depthWrite =
          wallTileMaterial.depthWrite =
            state.mode === 'home'
        for (const cap of wallCaps) {
          const height = focusedRoom ? (cap.wall.userData.focusCut as number) : cut.constant
          cap.mesh.visible = home && height > cap.bottom && height < cap.top - 0.001
          cap.mesh.position.y = Math.min(height, cap.top) - 0.007
        }
        furnitureGroup.visible = state.mode === 'home' && state.furniture
        for (const [index, g] of furnitureMeshes) {
          const item = model.furniture[index]
          const topFixture =
            [
              'ceiling',
              'chandelier',
              'fanLight',
              'pendant',
              'flushLight',
              'airConditioner',
              'hood',
            ].includes(item.kind) || (item.elevation ?? 0) >= 1.82
          g.visible =
            (!focusedRoom || item.room === focusedRoom.id) &&
            (!topFixture || indoor || (!!focusedRoom && item.kind !== 'ceiling'))
        }
        const selectedGroup = [...furnitureMeshes].find(
          ([index]) => state.selected === `furniture:${index}`,
        )?.[1]
        selectionOutline.visible = !!selectedGroup?.visible && furnitureGroup.visible
        if (selectionOutline.visible && selectedGroup) {
          group.updateMatrixWorld(true)
          selectionOutline.box.setFromObject(selectedGroup)
          selectionOutline.updateMatrixWorld(true)
        }
        for (const [id, mesh] of floorMeshes) {
          mesh.castShadow = home
          mesh.visible = home ? !focusedRoom || id === focusedRoom.id : !scanBase
          mesh.material.opacity = state.mode === 'pipes' ? 0.28 : 1
          mesh.material.depthWrite = state.mode === 'home'
          mesh.material.emissive.set(
            state.selected === `room:${id}` ? readColor('highlight') : readColor('background'),
          )
          mesh.material.emissiveIntensity = state.selected === `room:${id}` ? 0.12 : 0
        }
        const visibleIds = new Set(state.visibleObjects.map((item) => item.id))
        const primaryIds = new Set(
          state.primaryObjects.flatMap((item) => [
            item.id,
            ...(item.links ?? []),
            ...(item.endpointBoxes ?? []).filter((id): id is string => id !== null),
          ]),
        )
        const adjacentIds = new Set<string>()
        const selectedObjectId =
          state.mode === 'pipes' && state.selected.startsWith('object:')
            ? state.selected.slice(7)
            : undefined
        if (selectedObjectId && visibleIds.has(selectedObjectId))
          for (const connection of model.observedContinuations ?? []) {
            const otherId =
              connection.objects[0] === selectedObjectId
                ? connection.objects[1]
                : connection.objects[1] === selectedObjectId
                  ? connection.objects[0]
                  : undefined
            if (otherId && visibleIds.has(otherId)) adjacentIds.add(otherId)
          }
        const target = model.objects.find((item) => item.id === state.powerTarget)
        const powerVisible = state.mode === 'pipes' && state.showPowerSupply && !!supplyBox
        powerRoot.visible =
          powerVisible &&
          !!target &&
          primaryIds.has(target.id) &&
          !(state.showRoutes && target.route)
        powerLine.visible = powerRoot.visible
        if (supplyBox && target && powerLine.userData.target !== target.id) {
          powerLine.geometry.dispose()
          powerLine.geometry = new LineGeometry().setPositions([
            ...supplyBox.path[0],
            ...target.path[0],
          ])
          powerLine.computeLineDistances()
          powerLine.userData.target = target.id
        }
        powerSummaryRoot.visible = powerVisible
        for (const { endpoint, line } of powerSummaryLines)
          line.visible =
            powerVisible &&
            state.primaryObjects.includes(endpoint) &&
            endpoint.id !== target?.id &&
            !(state.showRoutes && endpoint.route)
        for (const object of model.objects) {
          const g = objectGroups.get(object.id)!
          const homeOutletVisible =
            state.mode === 'home' &&
            state.furniture &&
            object.category === 'outlets' &&
            (!focusedRoom || object.rooms.includes(focusedRoom.id)) &&
            !!object.outletCount
          g.visible =
            homeOutletVisible ||
            (state.mode === 'pipes' &&
              (visibleIds.has(object.id) || (state.showPowerSupply && object.id === supplyBox?.id)))
          const highlighted = state.selected === `object:${object.id}`
          const route = routeGroups.get(object.id)
          const routeVisible =
            state.mode === 'pipes' &&
            state.showRoutes &&
            !!route &&
            state.primaryObjects.includes(object) &&
            (!object.powerEndpoint || state.showPowerSupply)
          if (route) {
            route.group.visible = routeVisible
            route.highlight.visible = routeVisible && (highlighted || adjacentIds.has(object.id))
          }
          baseGroups.get(object.id)!.visible =
            !routeVisible || (object.kind !== 'relationship' && object.kind !== 'guide')
          const highlight = objectHighlights.get(object.id)
          if (highlight) highlight.visible = highlighted || adjacentIds.has(object.id)
          g.traverse((child) => {
            const mat = (child as Three.Mesh).material as
              (Three.Material & { color: Three.Color }) | undefined
            if (mat && 'color' in mat && !child.userData.fixedColor && !child.userData.pickProxy) {
              mat.color.set(
                readColor(
                  highlighted && object.kind !== 'region' && object.kind !== 'guide'
                    ? 'highlight'
                    : objectColor(object),
                ),
              )
              const context =
                !primaryIds.has(object.id) &&
                !adjacentIds.has(object.id) &&
                object.id !== supplyBox?.id &&
                !highlighted
              updateMaterialContext(
                child as Three.Mesh<Three.BufferGeometry, Three.Material>,
                context,
              )
            }
          })
        }
        updateContinuationVisibility(continuationGroups, {
          mode: state.mode,
          showRoutes: state.showRoutes,
          visibleIds,
        })
        for (const { mat, members } of continuationGroups) {
          const context = members.every(
            (item) =>
              !primaryIds.has(item.id) &&
              !adjacentIds.has(item.id) &&
              state.selected !== `object:${item.id}`,
          )
          mat.transparent = context
          mat.opacity = context ? 0.2 : 1
          mat.depthWrite = !context
        }
        if (state.view.serial !== viewSerial) {
          cancel()
          activePointers.clear()
          relocationAnimation?.cancel()
          viewSerial = state.view.serial
          const room = model.rooms.find((item) => item.id === state.view.room)
          walking = indoor
          controls.enabled = !walking
          keys.clear()
          wasBlocked = false
          latest.current.onBlocked(false)
          previousTime = performance.now()
          camera.clearViewOffset()
          camera.updateProjectionMatrix()
          if (walking) {
            const viewpoint =
              state.view.kind === 'photo'
                ? model.viewpoints?.find((item) => item.id === state.view.viewpoint)
                : undefined
            const target =
              room ??
              (viewpoint ? model.rooms.find((item) => item.id === viewpoint.room) : undefined) ??
              model.rooms[0]
            currentRoom = target.id
            let location: [number, number] | null = null
            const findLocation = (origin: [number, number]) => {
              for (let radius = 0; radius <= 3 && !location; radius += 0.2) {
                for (let angle = 0; angle < Math.PI * 2 && !location; angle += Math.PI / 8) {
                  const x = origin[0] + Math.cos(angle) * radius,
                    z = origin[1] + Math.sin(angle) * radius
                  if (inside(x, z, target.polygon) && passable(x, z)) location = [x, z]
                }
              }
            }
            if (viewpoint && viewpoint.room === target.id)
              findLocation([viewpoint.position[0], viewpoint.position[2]])
            if (!location) findLocation(target.label)
            if (viewpoint && viewpoint.room === target.id && location) {
              const cameraY = Math.min(
                model.referenceHeight - 0.08,
                Math.max(1.2, viewpoint.position[1]),
              )
              camera.position.set(
                location[0] + group.position.x,
                cameraY,
                location[1] + group.position.z,
              )
              const dx = viewpoint.target[0] - location[0],
                dy = viewpoint.target[1] - cameraY,
                dz = viewpoint.target[2] - location[1]
              yaw = Math.atan2(-dx, -dz)
              pitch = Math.max(-1.25, Math.min(1.25, Math.atan2(dy, Math.hypot(dx, dz))))
            } else if (location) {
              camera.position.set(
                location[0] + group.position.x,
                1.55,
                location[1] + group.position.z,
              )
              yaw = pitch = 0
            } else {
              latest.current.onBlocked(true)
              walking = false
              controls.enabled = true
            }
            if (walking) {
              camera.rotation.set(pitch, yaw, 0, 'YXZ')
              renderer.domElement.focus({ preventScroll: true })
            }
          } else if (
            state.view.kind === 'object' &&
            state.view.object &&
            objectGroups.has(state.view.object)
          ) {
            controls.minDistance = 0.6
            currentFraming = () => {
              const current = latest.current
              const currentObjectId =
                current.view.kind === 'object' ? current.view.object : undefined
              const currentObjectGroup = currentObjectId
                ? objectGroups.get(currentObjectId)
                : undefined
              const currentObject = currentObjectId
                ? model.objects.find((item) => item.id === currentObjectId)
                : undefined
              if (!currentObjectGroup) return
              const nodes: Three.Object3D[] = [currentObjectGroup]
              for (const id of [
                ...(currentObject?.endpointBoxes ?? []),
                ...(currentObject?.links ?? []),
              ]) {
                const endpoint = id ? objectGroups.get(id) : undefined
                if (endpoint?.visible) nodes.push(endpoint)
              }
              if (
                current.showRoutes &&
                currentObject?.route?.to &&
                current.primaryObjects.includes(currentObject)
              ) {
                const continuation = objectGroups.get(currentObject.route.to.object)
                if (continuation?.visible) nodes.push(continuation)
              }
              if (
                currentObjectId &&
                current.mode === 'pipes' &&
                current.selected === `object:${currentObjectId}` &&
                currentObjectGroup.visible
              ) {
                const visibleObjectIds = new Set(current.visibleObjects.map((item) => item.id))
                if (visibleObjectIds.has(currentObjectId))
                  for (const connection of model.observedContinuations ?? []) {
                    const otherId =
                      connection.objects[0] === currentObjectId
                        ? connection.objects[1]
                        : connection.objects[1] === currentObjectId
                          ? connection.objects[0]
                          : undefined
                    const otherGroup =
                      otherId && visibleObjectIds.has(otherId)
                        ? objectGroups.get(otherId)
                        : undefined
                    if (otherGroup?.visible) nodes.push(otherGroup)
                  }
              }
              const currentSupplyGroup = supplyBox && objectGroups.get(supplyBox.id)
              if (
                current.showPowerSupply &&
                currentObject?.powerEndpoint &&
                current.primaryObjects.includes(currentObject) &&
                currentSupplyGroup
              )
                nodes.push(currentSupplyGroup)
              fitCamera(framingPoints(nodes))
            }
            currentFraming()
          } else if (state.view.kind === 'focus' && room) {
            controls.minDistance = 1.6
            currentFraming = () => {
              const points = room.polygon.flatMap(([x, z]) =>
                [0, focusedRoom ? roomBackCut.constant : Math.min(cut.constant, 1.2)].map(
                  (y) => new THREE.Vector3(x + group.position.x, y, z + group.position.z),
                ),
              )
              for (const [index, g] of furnitureMeshes)
                if (furnitureGroup.visible && g.visible && model.furniture[index].room === room.id)
                  points.push(...framingPoints([g]))
              if (latest.current.mode === 'pipes')
                for (const object of model.objects)
                  if (object.rooms.includes(room.id) && objectGroups.get(object.id)!.visible)
                    points.push(...framingPoints([objectGroups.get(object.id)!]))
              fitCamera(points)
            }
            currentFraming()
          } else {
            controls.minDistance = 2
            currentFraming = () =>
              fitCamera(framingPoints(), state.view.kind === 'top', state.view.kind === 'reverse')
            currentFraming()
          }
          if (walking) currentFraming = null
          if (!walking) controls.update()
        }
        clearLanding()
        schedule()
      }
      refresh.current = update
      const resize = () => {
        clearLanding()
        const { width, height } = element.getBoundingClientRect()
        if (!width || !height) return
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        const pixelRatio = Math.min(window.devicePixelRatio, 2)
        if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio)
        renderer.setSize(width, height)
        homeOcclusion.resize(width, height)
        if (!walking && currentFraming) {
          currentFraming()
          controls.update()
        }
        schedule()
      }
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(element)
      // Browser zoom or moving between displays can change DPR without resizing the host.
      const watchPixelRatio = () => {
        window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
          'change',
          () => {
            resize()
            watchPixelRatio()
          },
          { once: true, signal: events.signal },
        )
      }
      watchPixelRatio()
      themeObserver = new MutationObserver(() => {
        scene.background = new THREE.Color(readColor('background'))
        for (const entry of roleMaterials) entry.material.color.set(readColor(entry.role))
        update()
      })
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      })
      const raycaster = new THREE.Raycaster()
      raycaster.params.Line2 = { threshold: 12 }
      const isVisible = (item: Three.Object3D) => {
        for (let node: Three.Object3D | null = item; node; node = node.parent)
          if (!node.visible) return false
        return true
      }
      const pointRay = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect()
        camera.updateMatrixWorld()
        group.updateMatrixWorld(true)
        raycaster.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            (-(event.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        )
      }
      const landingAt = (event: PointerEvent) => {
        clearLanding()
        if (
          !walking ||
          latest.current.mode !== 'home' ||
          document.elementFromPoint(event.clientX, event.clientY) !== renderer.domElement
        )
          return null
        pointRay(event)
        // The nearest physical surface must be floor or rug; never pick floor through a wall or furniture.
        const hit = raycaster
          .intersectObjects([wallGroup, furnitureGroup, ...floorMeshes.values()], true)
          .find((entry) => isVisible(entry.object))
        if (
          !hit?.object.userData.walkSurface ||
          !hit.face ||
          hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y < 0.9
        )
          return null
        const x = hit.point.x - group.position.x,
          z = hit.point.z - group.position.z
        const room = model.rooms.find((item) => inside(x, z, item.polygon))
        if (!room || !passable(x, z)) return null
        landingMarker.position.set(x, hit.point.y + 0.012, z)
        landingMarker.visible = true
        renderer.domElement.style.cursor = 'pointer'
        return { point: hit.point, room }
      }
      const down = (event: PointerEvent) => {
        if (!event.isPrimary || event.button !== 0 || activePointers.size > 1) {
          cancel()
          return
        }
        pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY }
        lookLast = pointerStart
        dragged = false
        if (walking) {
          renderer.domElement.focus({ preventScroll: true })
          renderer.domElement.setPointerCapture(event.pointerId)
          landingAt(event)
          schedule()
        }
      }
      const up = (event: PointerEvent) => {
        activePointers.delete(event.pointerId)
        if (
          !pointerStart ||
          dragged ||
          pointerStart.id !== event.pointerId ||
          activePointers.size ||
          Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5
        ) {
          cancel()
          return
        }
        pointerStart = lookLast = null
        if (walking && latest.current.mode === 'home') {
          const landing = landingAt(event)
          if (landing) {
            camera.position.x = landing.point.x
            camera.position.z = landing.point.z
            if (landing.room.id !== currentRoom) {
              currentRoom = landing.room.id
              latest.current.onRoomChange(currentRoom)
            }
            wasBlocked = false
            latest.current.onBlocked(false)
            relocationAnimation?.cancel()
            if (!reducedMotion.matches)
              relocationAnimation = element.animate([{ opacity: 0.35 }, { opacity: 1 }], {
                duration: 160,
                easing: 'ease-out',
              })
          }
          clearLanding()
          schedule()
          return
        }
        pointRay(event)
        const visible = pickable.filter(isVisible)
        for (const hit of raycaster.intersectObjects(visible, false)) {
          let node: Three.Object3D | null = hit.object
          while (node && !node.userData.selection) node = node.parent
          if (node?.userData.selection) {
            latest.current.onSelect(node.userData.selection)
            break
          }
        }
      }
      const lost = (event: Event) => {
        event.preventDefault()
        dispose()
        latest.current.onStatus('error')
      }
      const move = (event: PointerEvent) => {
        if (!walking) return
        if (!pointerStart) {
          if (
            event.pointerType !== 'touch' &&
            !activePointers.size &&
            latest.current.mode === 'home'
          ) {
            landingAt(event)
            schedule()
          }
          return
        }
        if (!lookLast || pointerStart.id !== event.pointerId) return
        dragged ||= Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5
        if (!dragged) {
          landingAt(event)
          schedule()
          return
        }
        clearLanding()
        renderer.domElement.style.cursor = 'grabbing'
        yaw -= (event.clientX - lookLast.x) * 0.004
        pitch = Math.max(-1.25, Math.min(1.25, pitch - (event.clientY - lookLast.y) * 0.004))
        lookLast = { x: event.clientX, y: event.clientY }
        camera.rotation.set(pitch, yaw, 0, 'YXZ')
        schedule()
      }
      const keydown = (event: KeyboardEvent) => {
        if (sceneKeyBlocked(event)) {
          stopMoving()
          return
        }
        if (
          !walking ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          (event.target as HTMLElement)?.closest(
            'input, select, textarea, button, a, #model-inspector, #model-layers',
          )
        )
          return
        const key = event.key.toLowerCase()
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
          event.preventDefault()
          keys.add(key)
          schedule()
        }
      }
      const stopMoving = () => {
        keys.clear()
        activePointers.clear()
        cancel()
        relocationAnimation?.cancel()
      }
      window.addEventListener('keydown', keydown, { signal: events.signal })
      window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()), {
        signal: events.signal,
      })
      window.addEventListener('blur', stopMoving, { signal: events.signal })
      document.addEventListener(
        'focusin',
        (event) => {
          if (sceneKeyBlocked(event)) stopMoving()
        },
        { signal: events.signal },
      )
      window.addEventListener(
        'pointerdown',
        (event) => {
          activePointers.add(event.pointerId)
          if (activePointers.size > 1) cancel()
        },
        { capture: true, signal: events.signal },
      )
      window.addEventListener(
        'pointerup',
        (event) => {
          activePointers.delete(event.pointerId)
          if (pointerStart?.id === event.pointerId && event.target !== renderer.domElement) cancel()
        },
        { capture: true, signal: events.signal },
      )
      window.addEventListener(
        'pointercancel',
        (event) => {
          activePointers.delete(event.pointerId)
          cancel()
        },
        { capture: true, signal: events.signal },
      )
      document.addEventListener('visibilitychange', stopMoving, { signal: events.signal })
      reducedMotion.addEventListener(
        'change',
        () => {
          if (reducedMotion.matches) relocationAnimation?.cancel()
        },
        { signal: events.signal },
      )
      renderer.domElement.addEventListener('pointerdown', down, { signal: events.signal })
      renderer.domElement.addEventListener('pointermove', move, { signal: events.signal })
      renderer.domElement.addEventListener('pointerup', up, { signal: events.signal })
      renderer.domElement.addEventListener('lostpointercapture', cancel, { signal: events.signal })
      renderer.domElement.addEventListener(
        'pointerleave',
        () => {
          if (!pointerStart) {
            clearLanding()
            schedule()
          }
        },
        { signal: events.signal },
      )
      renderer.domElement.addEventListener('webglcontextlost', lost, { signal: events.signal })
      controls.addEventListener('start', () => {
        currentFraming = null
      })
      controls.addEventListener('change', schedule)
      resize()
      update()
    }
    start().catch(() => {
      if (!stopped) {
        dispose()
        latest.current.onStatus('error')
      }
    })
    return () => {
      stopped = true
      dispose()
    }
  }, [props.model])

  useEffect(() => {
    refresh.current?.()
  }, [
    props.mode,
    props.visibleObjects,
    props.primaryObjects,
    props.powerTarget,
    props.showPowerSupply,
    props.showRoutes,
    props.selected,
    props.wallCut,
    props.furniture,
    props.structure,
    props.roomLabels,
    props.view,
    props.motion,
  ])

  return (
    <>
      <div className={styles.canvasHost} ref={host} />
      <div className={styles.overlayLabels}>
        {props.model.rooms.map((room) => (
          <Button
            variant="ghost"
            key={room.id}
            ref={(element) => {
              if (element) labels.current.set(room.id, element)
              else labels.current.delete(room.id)
            }}
            style={{ display: 'none' }}
            className={`${styles.roomLabel} ${props.selected === `room:${room.id}` ? styles.selectedLabel : ''}`}
            aria-label={`${room.name}，查看房间`}
            onClick={() => props.onSelect(`room:${room.id}`)}
          >
            {room.name}
          </Button>
        ))}
      </div>
      {props.model.powerSupply && (
        <div className={styles.overlayLabels}>
          <Button
            variant="ghost"
            ref={powerLabel}
            style={{ display: 'none' }}
            className={styles.roomLabel}
            onClick={() => props.onSelect('object:' + props.model.powerSupply!.box)}
          >
            强电箱
          </Button>
        </div>
      )}
      <div className={styles.overlayLabels}>
        <Button
          variant="ghost"
          ref={powerTargetLabel}
          style={{ display: 'none' }}
          className={styles.roomLabel + ' ' + styles.selectedLabel}
          onClick={() => props.powerTarget && props.onSelect('object:' + props.powerTarget)}
        >
          {props.model.objects.find((item) => item.id === props.powerTarget)?.label}
        </Button>
      </div>
      <div className={styles.overlayLabels}>
        {[0, 1].map((index) => (
          <Button
            variant="ghost"
            key={index}
            ref={(element) => {
              endpointLabels.current[index] = element
            }}
            style={{ display: 'none' }}
            className={styles.roomLabel}
            onClick={() => {
              const endpoint = props.model.objects.find(
                (item) => props.selected === 'object:' + item.id,
              )?.endpointBoxes?.[index]
              props.onSelect(endpoint ? 'object:' + endpoint : props.selected)
            }}
          >
            {
              props.model.objects.find((item) => props.selected === 'object:' + item.id)
                ?.endpoints?.[index]
            }
          </Button>
        ))}
      </div>
      <div className={styles.overlayLabels}>
        {props.mode === 'pipes' &&
          props.primaryObjects.flatMap((object) =>
            (object.landmarks ?? []).map((landmark) => (
              <Button
                variant="ghost"
                key={object.id + ':' + landmark.index}
                ref={(element) => {
                  const key = object.id + ':' + landmark.index
                  if (element) guideLabels.current.set(key, element)
                  else guideLabels.current.delete(key)
                }}
                style={{ display: 'none' }}
                className={styles.roomLabel}
                onClick={() => props.onSelect('object:' + object.id)}
              >
                {landmark.label}
              </Button>
            )),
          )}
      </div>
    </>
  )
}
