import fs from 'node:fs'
import path from 'node:path'
import PublicHomeModel from '@/components/PublicHomeModel'
import type { HomeSceneData } from '@/lib/home-model-types'
import { validatePublicModel } from '../../../scripts/lib/public-model.mjs'

export const metadata = { title: '逛逛这个家', alternates: { canonical: '/home-3d/' } }
export default function Home3D() {
  const model = validatePublicModel(
    JSON.parse(fs.readFileSync(path.join(process.cwd(), 'content/home.json'), 'utf8')),
  ) as HomeSceneData
  return (
    <>
      <div className="share-title">
        <h1>逛逛这个家</h1>
        <p>拖动旋转、滚动缩放；选一个房间，走进去看看。</p>
      </div>
      <PublicHomeModel model={model} />
      <p className="share-note">
        三维模型为近似表达，家具与材质用于分享设计思路，不作为施工或测量依据。
      </p>
    </>
  )
}
