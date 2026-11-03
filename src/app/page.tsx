import Link from 'next/link'
import HomeArtwork from '@/components/HomeArtwork'
import { Button } from '@/components/ui/button'

export const metadata = { alternates: { canonical: '/' } }
export default function Home() {
  return (
    <>
      <section className="share-hero">
        <div>
          <h1>
            把日子，
            <br />
            慢慢住成家。
          </h1>
          <p>把自己的家搬进浏览器。转一转，走进去，看看空间、家具与生活如何相遇。</p>
          <div className="share-actions">
            <Button asChild>
              <Link href="/home-3d/">逛逛这个家 →</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/design/">看看设计思路</Link>
            </Button>
          </div>
        </div>
        <HomeArtwork scene="home" priority />
      </section>
      <section className="share-intro">
        <h2>从一个房间，认识一个家。</h2>
        <p>
          三维模型里保留了房间的关系、家具的摆放和材质的印象。可以俯瞰全屋，也可以选择一个房间，换个视角感受空间。
        </p>
        <p>
          这里分享的是不断调整的生活空间，以及把它画进浏览器的过程。模型为近似表达，插画为 AI
          微缩示意。
        </p>
      </section>
    </>
  )
}
