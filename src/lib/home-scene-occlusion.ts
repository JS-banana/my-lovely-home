import {
  Color,
  DepthTexture,
  HalfFloatType,
  Material,
  Mesh,
  MeshNormalMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'

/** This patch depends on OutputPass internals; Three upgrades must keep all three anchors. */
export function patchMiniatureOutputShader(shader: string) {
  const patches = [
    [
      'uniform sampler2D tDiffuse;',
      'uniform sampler2D tDiffuse;\nuniform vec3 miniatureBackground;',
    ],
    [
      'gl_FragColor = texture2D( tDiffuse, vUv );',
      `
        gl_FragColor = texture2D( tDiffuse, vUv );
        gl_FragColor.rgb /= max(gl_FragColor.a, 0.00001);
      `,
    ],
    [
      '// color space',
      `
        gl_FragColor.rgb = mix(miniatureBackground, gl_FragColor.rgb, gl_FragColor.a);
        gl_FragColor.a = 1.0;
        // color space
      `,
    ],
  ] as const
  let previous = -1
  let patched = shader
  for (const [anchor, replacement] of patches) {
    const index = shader.indexOf(anchor)
    if (index < 0 || shader.indexOf(anchor, index + anchor.length) >= 0)
      throw new Error(`Three.js OutputPass shader contract changed: expected one ${anchor}`)
    if (index <= previous)
      throw new Error('Three.js OutputPass shader contract changed: unexpected anchor order')
    previous = index
    patched = patched.replace(anchor, replacement)
  }
  return patched
}

/** Miniature-view contact shading. The depth pass must respect the same display cuts as color. */
export function createHomeOcclusion(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
) {
  const normals = new Map<Material, MeshNormalMaterial>()
  let normalTarget: WebGLRenderTarget
  let colorTarget: WebGLRenderTarget
  let composer: EffectComposer
  let colorPass: RenderPass
  let occlusion: GTAOPass
  let output: OutputPass
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const material of normals.values()) material.dispose()
    normalTarget?.dispose()
    occlusion?.dispose()
    // These two shader materials are not released by this installed GTAOPass version.
    occlusion?.gtaoMaterial.dispose()
    occlusion?.blendMaterial.dispose()
    colorPass?.dispose()
    output?.dispose()
    if (composer) composer.dispose()
    else colorTarget?.dispose()
  }

  try {
    normalTarget = new WebGLRenderTarget(1, 1, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      type: HalfFloatType,
      depthTexture: new DepthTexture(1, 1),
    })
    colorTarget = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: Math.min(2, renderer.capabilities.maxSamples),
    })
    composer = new EffectComposer(renderer, colorTarget)
    colorPass = new RenderPass(scene, camera, undefined, new Color(0x000000), 0)
    occlusion = new GTAOPass(scene, camera, 1, 1)
    occlusion.setGBuffer(normalTarget.depthTexture!, normalTarget.texture)
    occlusion.updateGtaoMaterial({
      radius: 0.24,
      thickness: 0.1,
      distanceFallOff: 0.8,
      samples: 16,
      screenSpaceRadius: false,
    })
    occlusion.updatePdMaterial({ radius: 4, samples: 8, rings: 2 })
    occlusion.blendIntensity = 0.65
    output = new OutputPass()
    // The paper background (and its grounding shadow) is UI color, not a lit surface.
    // Composite the paper background after tone mapping. The color pass alpha
    // carries MSAA coverage, so silhouettes never depend on the lower-res AO depth.
    output.uniforms.miniatureBackground = { value: new Color() }
    output.material.fragmentShader = patchMiniatureOutputShader(output.material.fragmentShader)
    composer.addPass(colorPass)
    composer.addPass(occlusion)
    composer.addPass(output)
  } catch (error) {
    dispose()
    throw error
  }
  const clearColor = new Color()

  const normalFor = (source: Material) => {
    let result = normals.get(source)
    if (!result) {
      result = new MeshNormalMaterial({
        side: source.side,
        clippingPlanes: source.clippingPlanes,
        clipIntersection: source.clipIntersection,
      })
      if (source instanceof MeshStandardMaterial) {
        result.bumpMap = source.bumpMap
        result.bumpScale = source.bumpScale
        result.normalMap = source.normalMap
        result.normalScale.copy(source.normalScale)
      }
      normals.set(source, result)
    }
    return result
  }

  return {
    resize(width: number, height: number) {
      // Keep color and silhouette coverage at the canvas resolution. Only AO may
      // be downsampled: upscaling the whole composer makes fine furniture blurry.
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(width, height)
      const aoScale = Math.min(renderer.getPixelRatio(), 1, 1600 / Math.max(width, height)) * 0.75
      const w = Math.max(1, Math.round(width * aoScale))
      const h = Math.max(1, Math.round(height * aoScale))
      normalTarget.setSize(w, h)
      occlusion.setSize(w, h)
    },
    render() {
      const replaced: [Mesh, Material | Material[]][] = []
      const hidden: Object3D[] = []
      const background = scene.background
      const target = renderer.getRenderTarget()
      const shadowEnabled = renderer.shadowMap.enabled
      const clearAlpha = renderer.getClearAlpha()
      renderer.getClearColor(clearColor)
      try {
        scene.traverseVisible((object) => {
          if (object instanceof Mesh) {
            const original = object.material
            const finishes = Array.isArray(original) ? original : [original]
            // Glass and non-depth-writing overlays cannot occlude the room behind them.
            if (finishes.every((material) => !material.depthWrite || material.opacity < 0.5)) {
              object.visible = false
              hidden.push(object)
            } else {
              replaced.push([object, original])
              object.material = Array.isArray(original)
                ? finishes.map(normalFor)
                : normalFor(original)
            }
          } else if ('isLine' in object || 'isPoints' in object || 'isSprite' in object) {
            object.visible = false
            hidden.push(object)
          }
        })
        scene.background = null
        renderer.shadowMap.enabled = false
        renderer.setRenderTarget(normalTarget)
        renderer.setClearColor(0x8080ff, 1)
        renderer.clear()
        renderer.render(scene, camera)
      } finally {
        for (const [mesh, material] of replaced) mesh.material = material
        for (const object of hidden) object.visible = true
        scene.background = background
        renderer.shadowMap.enabled = shadowEnabled
        renderer.setClearColor(clearColor, clearAlpha)
        renderer.setRenderTarget(target)
      }
      output.uniforms.miniatureBackground.value.copy(
        background instanceof Color ? background : clearColor,
      )
      scene.background = null
      try {
        composer.render()
      } finally {
        scene.background = background
      }
    },
    dispose,
  }
}
