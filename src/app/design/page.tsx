import fs from 'node:fs'
import path from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'

export const metadata = { title: '设计思路', alternates: { canonical: '/design/' } }
export default async function Design() {
  const text = fs.readFileSync(path.join(process.cwd(), 'content/design.md'), 'utf8')
  const html = String(
    await unified().use(remarkParse).use(remarkRehype).use(rehypeStringify).process(text),
  )
  return <article className="prose share-reading" dangerouslySetInnerHTML={{ __html: html }} />
}
