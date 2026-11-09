import { publicArticle } from '../../../../scripts/lib/public-files.mjs'
import Article, { articleMetadata } from '../Article'

export const metadata = articleMetadata(publicArticle.network)

export default function Network() {
  return <Article article={publicArticle.network} />
}
