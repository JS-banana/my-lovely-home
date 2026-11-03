/** 编辑型入口插画；不替代资料封面、实拍热点或三维模型。 */
export default function HomeArtwork({
  scene,
  priority = false,
  showNote = true,
}: {
  scene: 'study' | 'home'
  priority?: boolean
  /** 独立配有常显性质说明的封面不再重复叠加标签。 */
  showNote?: boolean
}) {
  return (
    <span className="home-artwork">
      <img
        src={`/artwork/${scene}-miniature-2026-10-19.webp`}
        alt={scene === 'study' ? '书房的 AI 微缩插画，非实拍' : '全屋的 AI 微缩插画，非精确户型图'}
        width={1448}
        height={1086}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
      />
      {showNote && <span className="home-artwork-note">AI 微缩示意</span>}
    </span>
  )
}
