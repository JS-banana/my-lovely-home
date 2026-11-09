import HomeArtwork from '@/components/HomeArtwork'
import Icon from '@/components/Icon'
import SmartSceneVisual from '@/components/SmartSceneVisual'

export const topicCaptions: Record<string, string> = {
  'smart-home': '从回家、经过到睡前，先梳理哪些时候希望灯光更顺手。',
  network: '设备之间的逻辑关系示意。连线表示有线回程。',
}

export default function TopicVisual({ topic }: { topic: string }) {
  if (topic === 'design') return <HomeArtwork scene="study" />
  if (topic === 'smart-home') return <SmartSceneVisual />

  return (
    <div
      className="share-network-visual"
      role="img"
      aria-label="有线 Mesh 关系示意，主路由与 Mesh 节点之间使用有线回程"
    >
      <svg viewBox="0 0 440 220" aria-hidden="true" focusable="false">
        <path className="share-network-path" d="M220 75v47m-106 44v-44h212v44" />
        <rect className="share-network-router" x="156" y="25" width="128" height="51" rx="8" />
        <rect x="52" y="165" width="124" height="42" rx="8" />
        <rect x="264" y="165" width="124" height="42" rx="8" />
        <rect className="share-network-label" x="165" y="107" width="110" height="30" rx="4" />
        <circle cx="114" cy="122" r="4" />
        <circle cx="326" cy="122" r="4" />
        <text x="220" y="51">
          主路由
        </text>
        <text className="share-network-wire-label" x="220" y="123">
          有线回程
        </text>
        <text x="114" y="187">
          Mesh 节点
        </text>
        <text x="326" y="187">
          Mesh 节点
        </text>
      </svg>
      <span className="share-network-key" aria-hidden="true">
        <Icon name="link" /> 有线 Mesh 示意
      </span>
    </div>
  )
}
