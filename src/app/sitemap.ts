import type { MetadataRoute } from 'next'
export const dynamic = 'force-static'
export default function sitemap(): MetadataRoute.Sitemap {
  return ['', 'home-3d/', 'design/', 'about/'].map((route) => ({
    url: `https://home.laifuyou.com/${route}`,
  }))
}
