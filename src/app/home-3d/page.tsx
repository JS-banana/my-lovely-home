import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import PublicHomeModel from '@/components/PublicHomeModel'
import type { HomeSceneData } from '@/lib/home-model-types'
import { validatePublicModel } from '../../../scripts/lib/public-model.mjs'

export const metadata = { title: '逛逛这个家', alternates: { canonical: '/home-3d/' } }
export default function Home3D() {
  const model = validatePublicModel(
    JSON.parse(fs.readFileSync(path.join(process.cwd(), 'content/home.json'), 'utf8')),
  ) as HomeSceneData
  return (
    <div className="share-tour">
      <h1 className="sr-only">逛逛这个家</h1>
      <PublicHomeModel model={model} />
      <p className="share-note">
        三维模型为近似表达，仅供参观。<Link href="/#planning">阅读设计与规划</Link>
      </p>
    </div>
  )
}
