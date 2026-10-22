# Community page media

官网导航、页脚指向 `/community/`；手机设置打开原生二维码页面。
App 直接请求同一个 `/community/current.json` 接口，再下载图片在 App 中显示。
可保存原图到系统相册，首次保存时按系统要求请求权限。
页面每次打开、回到前台及停留期间每 60 秒获取 `/community/current.json`，
使用 no-store 和时间戳避免缓存。二维码过期时隐藏图片，加载失败时可重试。
手机每次打开、回到前台及停留期间每 60 秒重新获取配置；过期隐藏图片。
换二维码无需重新发布 App，首次启用仍需先将公共配置和图片部署到官网。

## 每七天更新群码

收到新图后，保留原始 PNG，使用截图标明的到期时间（必须含时区）：

```sh
node scripts/update-community-qr.mjs /absolute/path/new-qr.png '2026-09-18T00:00:00+08:00'
```

脚本不改动图片，生成内容哈希命名的 `public/community/assets/wechat-group-*.png`，
并原子更新 `public/community/current.json`。必须核对截图有效期并确认二维码可扫描。
「9 月 18 日前」按北京时间 9 月 18 日零点保守处理。

上线时先上传新图片，再原子替换线上 `community/current.json`。
配置建议使用 `Cache-Control: no-store`；图片可以保留 immutable 缓存，因为文件名随内容变化。
不能覆盖旧图片文件名，也不要在旧配置仍可能被访问时删除旧图。
上传目的地必须是当前服务的静态根目录；全站部署也应携带最新配置，避免回滚到旧群码。
配置与图片更新无需 Web 构建或 App 发版。脚本只准备本地文件，不自动上传；
生产更新仍需用户明确要求。当前没有自动生成微信群码的能力，需要用户提供新图。

`npm run community:assets` 保留原有营销图片优化工作流；不会覆盖 current.json 或新的群码。
