import type { Material, Object3D } from 'three'

/** Runtime material emphasis at the scene's real mesh consumer. */
export function createMaterialContextUpdater() {
  const baselines = new WeakMap<
    Material,
    Pick<Material, 'opacity' | 'transparent' | 'depthWrite'>
  >()
  return (mesh: { material: Material }, context: boolean) => {
    const material = mesh.material
    let base = baselines.get(material)
    if (!base) {
      base = {
        opacity: material.opacity,
        transparent: material.transparent,
        depthWrite: material.depthWrite,
      }
      baselines.set(material, base)
    }
    material.transparent = context || base.transparent
    material.opacity = base.opacity * (context ? 0.2 : 1)
    material.depthWrite = context ? false : base.depthWrite
  }
}

export function updateContinuationVisibility(
  entries: Iterable<{ g: Object3D; members: ReadonlyArray<{ id: string }> }>,
  state: { mode: 'home' | 'pipes'; showRoutes: boolean; visibleIds: ReadonlySet<string> },
) {
  for (const { g, members } of entries)
    g.visible =
      state.mode === 'pipes' &&
      state.showRoutes &&
      members.every((item) => state.visibleIds.has(item.id))
}
