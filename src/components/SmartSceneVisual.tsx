export default function SmartSceneVisual({ detail = false }: { detail?: boolean }) {
  return (
    <div
      className="entry-visual entry-visual-scenes"
      data-detail={detail ? 'true' : undefined}
      role="img"
      aria-label="三个智能化生活场景，回家时有光，日常经过时就近控制，睡前能顺手关灯"
    >
      <div className="scene-card scene-home">
        <span className="scene-time">01</span>
        <span className="scene-illustration" aria-hidden="true">
          <i className="scene-door" />
          <i className="scene-light" />
        </span>
        <strong>回家</strong>
        <small>进门就有光</small>
      </div>
      <div className="scene-card scene-pass">
        <span className="scene-time">02</span>
        <span className="scene-illustration" aria-hidden="true">
          <i className="scene-path" />
          <i className="scene-panel" />
        </span>
        <strong>日常经过</strong>
        <small>就近控制</small>
      </div>
      <div className="scene-card scene-night">
        <span className="scene-time">03</span>
        <span className="scene-illustration" aria-hidden="true">
          <i className="scene-moon" />
          <i className="scene-bed" />
        </span>
        <strong>睡前</strong>
        <small>躺下也能关灯</small>
      </div>
    </div>
  )
}
