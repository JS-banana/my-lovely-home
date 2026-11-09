import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { publicArticles } from '../../../scripts/lib/public-files.mjs'
import TopicVisual, { topicCaptions } from './TopicVisual'

type PublicArticle = (typeof publicArticles)[number]

export function articleMetadata({ title, summary, href }: PublicArticle) {
  return { title, description: summary, alternates: { canonical: href } }
}

export default async function Article({ article: { slug } }: { article: PublicArticle }) {
  const text = fs.readFileSync(path.join(process.cwd(), `content/${slug}.md`), 'utf8')
  const processor = unified().use(remarkParse).use(remarkRehype).use(rehypeStringify)
  const tree = await processor.run(processor.parse(text))
  const [title, lead, ...body] = tree.children.filter((node) => node.type === 'element')
  if (title?.tagName !== 'h1' || lead?.tagName !== 'p') {
    throw new Error(`Public topic requires a title and a lead paragraph: ${slug}`)
  }
  const render = (children: typeof body) => processor.stringify({ type: 'root', children })
  const headingText = (node: (typeof body)[number]) =>
    node.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
  // The reviewed equipment list is the final section and supplies the facts for this module.
  const equipmentStart = body.findIndex(
    (node) => node.tagName === 'h2' && headingText(node) === '设备与用途',
  )
  const equipment = equipmentStart < 0 ? [] : body.splice(equipmentStart)
  if (equipment.length && equipment.map((node) => node.tagName).join() !== 'h2,p,ul') {
    throw new Error(
      `Public equipment must end the article with a status paragraph and a list: ${slug}`,
    )
  }
  const chapters = body
    .filter((node) => node.tagName === 'h2')
    .map((node, i) => {
      const id = `note-${i + 1}`
      node.tagName = 'h3'
      node.properties.id = id
      return { id, title: headingText(node) }
    })

  return (
    <article className="share-topic-page" data-topic={slug}>
      <nav className="share-topic-back" aria-label="返回主题目录">
        <Link href="/#planning">
          <Icon name="arrow-left" size={18} />
          设计与规划
        </Link>
      </nav>
      <div className="share-topic-overview">
        <div>
          <header
            className="share-topic-heading"
            dangerouslySetInnerHTML={{ __html: render([title, lead]) }}
          />
          <nav className="share-jump" aria-label="专题分区">
            {equipment.length > 0 && (
              <a href="#equipment">
                <Icon name="layers" size={18} /> 设备与用途
              </a>
            )}
            <a href="#notes">
              <Icon name="book" size={18} /> 规划笔记
            </a>
          </nav>
        </div>
        <figure className="share-topic-figure">
          <div className="share-topic-media" data-topic={slug}>
            <TopicVisual topic={slug} />
          </div>
          {slug !== 'design' && <figcaption>{topicCaptions[slug]}</figcaption>}
        </figure>
      </div>
      {equipment.length > 0 && (
        <section
          id="equipment"
          aria-label="设备与用途"
          className="share-equipment prose"
          dangerouslySetInnerHTML={{ __html: render(equipment) }}
        />
      )}
      <section className="share-topic-notes" id="notes" aria-labelledby="notes-title">
        <div className="share-topic-index">
          <h2 id="notes-title">规划笔记</h2>
          <nav aria-label="本篇目录">
            <ul>
              {chapters.map(({ id, title }) => (
                <li key={id}>
                  <a href={`#${id}`}>{title}</a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="prose" dangerouslySetInnerHTML={{ __html: render(body) }} />
      </section>
      <nav className="share-related" aria-label="更多设计与规划">
        {publicArticles
          .filter((article) => article.slug !== slug)
          .map(({ href, title, summary }) => (
            <Link href={href} key={href}>
              <span>
                <strong>{title}</strong>
                <small>{summary}</small>
              </span>
              <Icon name="arrow-right" size={20} />
            </Link>
          ))}
      </nav>
    </article>
  )
}
