import Link from 'next/link'
export default function NotFound() {
  return (
    <div className="share-title">
      <h1>这里还没有房间</h1>
      <p>
        这个地址不存在。<Link href="/">回到首页</Link>，或者<Link href="/home-3d/">逛逛这个家</Link>
        。
      </p>
    </div>
  )
}
