import { publicArticle } from '../../../../scripts/lib/public-files.mjs'
import Article, { articleMetadata } from '../Article'

export const metadata = articleMetadata(publicArticle.smartHome)

export default function SmartHome() {
  return <Article article={publicArticle.smartHome} />
}
