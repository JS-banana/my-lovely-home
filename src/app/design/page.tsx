import { publicArticle } from '../../../scripts/lib/public-files.mjs'
import Article, { articleMetadata } from './Article'

export const metadata = articleMetadata(publicArticle.design)

export default function Design() {
  return <Article article={publicArticle.design} />
}
