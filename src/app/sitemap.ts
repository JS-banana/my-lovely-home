import type { MetadataRoute } from 'next'
import { publicArticles } from '../../scripts/lib/public-files.mjs'
export const dynamic = 'force-static'
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/home-3d/', ...publicArticles.map(({ href }) => href), '/about/'].map((route) => ({
    url: `https://home.laifuyou.com${route}`,
  }))
}
