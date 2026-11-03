/**
 * Next 配置。
 *
 * 注意 `output` 只在生产构建时设为 'export'：
 * 开发模式下 Next 会拿 URL 去和 generateStaticParams 的结果逐个比对，
 * 而中文路径在比对时是「编码 vs 解码」两种形态，于是每次打开中文文档都会
 * 打出一行 `⨯ Failed to generate static paths`。页面本身是好的，但刷屏很吓人。
 * 静态导出只在 build 时需要，所以开发时关掉它，行为一致、日志干净。
 */
const isDev = process.env.NODE_ENV === 'development'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: isDev ? undefined : 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // 内容目录（../）在项目根，Next 默认会把 web 之外的变更当作外部依赖，
  // 这里显式声明，避免开发时改 markdown 不生效。
  experimental: {
    externalDir: true,
  },
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
