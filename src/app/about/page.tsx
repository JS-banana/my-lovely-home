export const metadata = { title: '关于与使用说明', alternates: { canonical: '/about/' } }
export default function About() {
  return (
    <article className="prose share-reading">
      <h1>关于这个小家</h1>
      <p>
        My Lovely Home 是一个用浏览器参观家的小项目。空间用 Three.js
        实时绘制，页面可以静态部署。我们希望借此交流布局和设计，也把实现方式分享给有兴趣的朋友。
      </p>
      <h2>你可以怎样使用</h2>
      <p>项目源代码采用 MIT 许可证，可以参考、修改和复用，具体条款见 GitHub 仓库的 LICENSE。</p>
      <p>
        本站文字、家庭模型数据和插画不包含在源码 MIT
        授权中，仅用于本站展示与个人学习。转载、再发布或用于其他用途前，请先取得相应权利人的许可。AI
        插画是氛围示意，不是现场照片；本声明不主张超出适用法律的权利。
      </p>
      <h2>模型与现实</h2>
      <p>
        三维模型是近似表达，家具形状、材质、光照和部分摆放经过简化。它适合参观和交流，不作为施工、安装、测量或安全判断的依据。
      </p>
      <p>
        <a href="https://github.com/JS-banana/my-lovely-home">在 GitHub 查看实现与许可 →</a>
      </p>
    </article>
  )
}
