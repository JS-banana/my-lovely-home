import Link from 'next/link'
import HomeArtwork from '@/components/HomeArtwork'
import Icon from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { publicArticles } from '../../scripts/lib/public-files.mjs'
import TopicVisual from './design/TopicVisual'

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
          <p>走进三维小家，看看我们怎么布置空间、安排灯光，以及让家庭网络服务日常生活。</p>
          <div className="share-actions">
            <Button asChild>
              <Link href="/home-3d/">
                逛逛这个家 <Icon name="arrow-right" size={18} />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="#planning">阅读设计与规划</Link>
            </Button>
          </div>
        </div>
        <Link className="share-hero-link" href="/home-3d/" aria-label="从全屋微缩图进入 3D 参观">
          <HomeArtwork scene="home" priority />
          <span className="share-hero-stamp">
            <Icon name="home" size={18} /> 打开三维户型 <Icon name="arrow-right" size={18} />
          </span>
        </Link>
      </section>
      <section className="share-intro" id="planning" aria-labelledby="planning-title">
        <h2 id="planning-title">设计与规划</h2>
        <ul className="share-topics">
          {publicArticles.map(({ slug, href, title, summary }) => (
            <li key={href}>
              <Link className="share-topic-card" href={href} aria-labelledby={`topic-${slug}`}>
                <div className="share-topic-media" data-topic={slug}>
                  <TopicVisual topic={slug} />
                </div>
                <div className="share-topic-card-body">
                  <h3 id={`topic-${slug}`}>{title}</h3>
                  <p>{summary}</p>
                  <span className="share-topic-action">
                    进入专题 <Icon name="arrow-right" size={18} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
