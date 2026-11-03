import type { Metadata } from 'next'
import Link from 'next/link'
import ThemeToggle from '@/components/ThemeToggle'
import './globals.css'
import './showcase.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://home.laifuyou.com'),
  title: { default: 'My Lovely Home · 把家搬进浏览器', template: '%s · My Lovely Home' },
  description: '一个可以旋转、走进的三维小家。分享空间布局、设计思路和浏览器中的 3D 实现。',
  openGraph: {
    title: 'My Lovely Home',
    description: '把日子，慢慢住成家。',
    images: ['/artwork/home-miniature-2026-10-19.webp'],
  },
}
const themeScript = `(function(){try{var m=localStorage.getItem('mh-theme')||'system';var dark=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.dataset.theme=dark?'dark':'light';r.dataset.themeMode=m;}catch(e){}})();`

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          跳到正文
        </a>
        <header className="share-header">
          <Link className="share-brand" href="/">
            My Lovely Home<span>好好生活，慢慢记录。</span>
          </Link>
          <nav aria-label="主导航">
            <Link href="/home-3d/">逛逛这个家</Link>
            <Link href="/design/">设计思路</Link>
            <ThemeToggle />
          </nav>
        </header>
        <main id="main" className="share-main">
          {children}
        </main>
        <footer className="share-footer">
          <span>把日子，慢慢住成家。</span>
          <nav aria-label="页脚导航">
            <a href="https://github.com/JS-banana/my-lovely-home">GitHub 源码</a>
            <Link href="/about/">关于与使用说明</Link>
          </nav>
        </footer>
      </body>
    </html>
  )
}
