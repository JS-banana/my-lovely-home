export function createSurfaceCanvas(
  surface: 'wood' | 'tile' | 'stone' | 'herringbone',
  colors: { base: string; grain: string },
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 surface 纹理的 2D Canvas 上下文')
  const grainNoise = (seed: number) => {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
    return value - Math.floor(value)
  }
  ctx.fillStyle = colors.base
  ctx.fillRect(0, 0, 512, 512)
  if (surface === 'herringbone') {
    const plank = (x: number, y: number, vertical: boolean) => {
      const boardX = ((Math.floor(x / 32) % 16) + 16) % 16,
        boardY = ((Math.floor(y / 32) % 16) + 16) % 16,
        seed = boardX * 37 + boardY * 53 + (vertical ? 97 : 0),
        width = 128,
        height = 32,
        inset = 0.55 + grainNoise(seed + 1) * 0.95
      ctx.save()
      ctx.translate(x, y)
      if (vertical) ctx.rotate(Math.PI / 2)
      ctx.globalAlpha = 1
      ctx.fillStyle = colors.base
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = colors.grain
      ctx.globalAlpha = 0.075 + grainNoise(seed + 2) * 0.085
      ctx.fillRect(inset, inset, width - inset * 2, height - inset * 2)
      ctx.strokeStyle = colors.grain
      const lineCount = 4 + Math.floor(grainNoise(seed + 3) * 3)
      for (let n = 0; n < lineCount; n++) {
        const lineSeed = seed + n * 11,
          lineY = 4 + ((n + 1) * (height - 8)) / (lineCount + 1),
          phase = grainNoise(lineSeed + 1) * Math.PI * 2,
          cycles = 2 + Math.floor(grainNoise(lineSeed + 2) * 3)
        ctx.globalAlpha = 0.035 + grainNoise(lineSeed + 3) * 0.045
        ctx.lineWidth = 0.45 + grainNoise(lineSeed + 4) * 0.65
        ctx.beginPath()
        ctx.moveTo(-2, lineY)
        for (let localX = -2; localX <= width + 2; localX += 8) {
          const t = (localX / width) * Math.PI * 2
          ctx.lineTo(
            localX,
            lineY +
              Math.sin(t * cycles + phase) * (0.45 + grainNoise(lineSeed + 5) * 0.8) +
              Math.sin(t * 5 + phase * 1.7) * 0.25,
          )
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 0.055 + grainNoise(seed + 9) * 0.025
      ctx.lineWidth = 0.65 + grainNoise(seed + 10) * 0.35
      ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2)
      ctx.restore()
    }
    for (let i = -4; i < 6; i++)
      for (let j = -12; j < 13; j++) {
        const x = i * 128 + j * 32,
          y = i * 128 - j * 32
        plank(x, y, false)
        plank(x + 128, y + 32, true)
      }
  } else if (surface === 'wood') {
    const bands: {
      center: number
      width: number
      phase: number
      wave: number
      depth: number
    }[] = []
    let center = -24
    for (let n = 0; center < 536; n++) {
      const seed = n * 31 + 17
      bands.push({
        center: center + (grainNoise(seed) - 0.5) * 3,
        width: 0.45 + grainNoise(seed + 1) * 1.2,
        phase: grainNoise(seed + 2) * Math.PI * 2,
        wave: 0.8 + grainNoise(seed + 3) * 2.2,
        depth: grainNoise(seed + 4),
      })
      center += 7.5 + grainNoise(seed + 5) * 8.5
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let n = 0; n < bands.length; n += 4) {
      const band = bands[n]
      ctx.strokeStyle = colors.grain
      for (const offset of [-512, 0, 512]) {
        ctx.globalAlpha = 0.025 + band.depth * 0.045
        ctx.lineWidth = 4 + band.depth * 6
        ctx.beginPath()
        for (let x = -512; x <= 1024; x += 8) {
          const t = (x / 512) * Math.PI * 2
          ctx.lineTo(
            x,
            band.center +
              offset +
              Math.sin(t * 2 + band.phase) * band.wave +
              Math.sin(t * 5 + band.phase * 1.7) * 0.7,
          )
        }
        ctx.stroke()
      }
    }
    for (const [n, band] of bands.entries()) {
      ctx.strokeStyle = n % 5 === 0 ? colors.base : colors.grain
      for (const offset of [-512, 0, 512]) {
        ctx.globalAlpha = n % 5 === 0 ? 0.065 : 0.065 + band.depth * 0.075
        ctx.lineWidth = n % 5 === 0 ? 3.5 + band.depth * 4 : band.width
        ctx.beginPath()
        for (let x = -512; x <= 1024; x += 8) {
          const t = (x / 512) * Math.PI * 2
          ctx.lineTo(
            x,
            band.center +
              offset +
              Math.sin(t * 2 + band.phase) * band.wave +
              Math.sin(t * 5 + band.phase * 1.7) * 0.7,
          )
        }
        ctx.stroke()
      }
    }
  } else {
    ctx.strokeStyle = colors.grain
    ctx.globalAlpha = 0.08
    ctx.lineWidth = 0.7
    for (let i = 0; i <= 512; i += 256) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, 512)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(512, i)
      ctx.stroke()
    }
  }
  return canvas
}

export function createTextileCanvases(): {
  color: HTMLCanvasElement
  bump: HTMLCanvasElement
} {
  const textileNoise = (seed: number) => {
    const value = Math.sin(seed * 12.9898 + 37.719) * 43758.5453
    return value - Math.floor(value)
  }
  const weaveCanvas = document.createElement('canvas')
  weaveCanvas.width = weaveCanvas.height = 128
  const weaveContext = weaveCanvas.getContext('2d')
  if (!weaveContext) throw new Error('无法创建 textile bump 的 2D Canvas 上下文')
  const weavePixels = weaveContext.createImageData(128, 128)
  for (let n = 0; n < 128 * 128; n++) {
    const x = n % 128,
      y = Math.floor(n / 128),
      tone =
        115 +
        textileNoise(x + y * 128) * 30 +
        textileNoise(Math.floor(x / 2) + Math.floor(y / 2) * 64) * 18
    weavePixels.data.set([tone, tone, tone, 255], n * 4)
  }
  weaveContext.putImageData(weavePixels, 0, 0)
  const textileCanvas = document.createElement('canvas')
  textileCanvas.width = textileCanvas.height = 128
  const textileContext = textileCanvas.getContext('2d')
  if (!textileContext) throw new Error('无法创建 textile color 的 2D Canvas 上下文')
  const textilePixels = textileContext.createImageData(128, 128)
  for (let n = 0; n < 128 * 128; n++) {
    const x = n % 128,
      y = Math.floor(n / 128)
    const tone =
      228 +
      textileNoise(x + y * 128) * 20 +
      textileNoise(Math.floor(x / 3) + Math.floor(y / 3) * 43) * 7
    textilePixels.data.set([tone, tone, tone, 255], n * 4)
  }
  textileContext.putImageData(textilePixels, 0, 0)
  return { color: textileCanvas, bump: weaveCanvas }
}
