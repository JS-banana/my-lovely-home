# My Lovely Home

把自己的家搬到浏览器中。使用 Three.js 绘制房间、墙体、家具与材质，支持全屋浏览和室内参观。网站也分享空间设计、家庭智能化和家庭网络的规划思路与实践。在线体验见 [home.laifuyou.com](https://home.laifuyou.com)。

## 本地运行

使用 Node.js 22.23.1 与 pnpm 11.17.0：

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
```

构建结果在 `out/`，可由 Nginx 等静态服务器托管。不存在的路径应返回 404，不回退到首页。

## 实现入口

- `src/components/HomeModelScene.tsx`：共享 Three.js 绘制、家具几何、镜头与交互。
- `src/components/PublicHomeModel.tsx`：参观操作。
- `content/home.json`：经过字段白名单筛选的几何数据；修改后须通过严格校验。
- `content/design.md`、`content/smart-home.md`、`content/network.md`：三篇精选公开稿。
- `scripts/check-public.mjs`：检查数据字段、资源及静态产物。
- `scripts/smoke-public.mjs`：发布后以真实 HTTP 检查页面、资源、404 与缓存；Deploy 工作流会核对响应与本次构建产物一致。

本仓库由私有主仓单向生成，有独立历史，不含私人材料或私有仓 Git 历史。上游维护者先在主仓修改，再重新导出、验证和发布。欢迎通过 issue 交流；外部代码贡献会先在主仓整合，再同步到此处。普通使用者可以直接 fork 本仓库独立修改。

## 许可与限制

源代码采用 [MIT](LICENSE)。`content/` 和 `public/artwork/` 的展示内容另见 [CONTENT-LICENSE.md](CONTENT-LICENSE.md)，不包含在 MIT 授权中。

模型是近似表达，不作为施工或测量依据。插画是 AI 氛围示意，非现场照片。使用的第三方依赖仍遵循各自许可证；本项目未重新授权它们。
