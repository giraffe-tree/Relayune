# Relayune 版本更新日志

版本更新日志的运行时唯一来源是自托管 MongoDB 的
`relay_release_notes` collection。网页和手机端只读取公开接口
`GET /api/release-notes?locale=zh-CN|en`；服务端不提供写入 HTTP 接口。

## 数据格式

每个正式版本在 `release-notes/<version>.json` 保存一份可审核的发布清单：

```json
{
  "version": "0.2.6",
  "publishedAt": "2026-08-10T00:00:00.000Z",
  "platforms": ["web", "server", "android", "ios"],
  "copy": {
    "zh": { "title": "中文标题", "items": ["中文更新内容"] },
    "en": { "title": "English title", "items": ["English release note"] }
  }
}
```

Mongo 文档以版本号作为 `_id`，另存 `published_at`、`platforms` 和 `copy`。
不得加入用户数据、设备标识、业务明文、令牌、短码、凭据或内部部署说明。

## 每次发布

1. 新增并审阅 `release-notes/<version>.json`，中英文必须表达同一组已实际发布的变化。
2. 在连接数据库前先本地校验：

   ```bash
   npm run release-notes:publish -- release-notes/<version>.json --dry-run
   ```

3. 完成该版本的产物上传和服务切换后，在生产服务器使用部署环境已有的
   `MONGO_DATABASE`、`MONGO_USER`、`MONGO_PASSWORD_FILE` 运行打包后的 CLI：

   ```bash
   node --env-file=/etc/agent-relay/agent-relay.env \
     /path/to/current-api/publish-release-notes.cjs \
     /path/to/current-api/release-notes/<version>.json
   ```

   CLI 只允许 loopback MongoDB，严格校验字段，并按版本号执行幂等 upsert；重复执行不会
   产生重复记录。CLI 只输出版本号和是否发生变化，不输出清单正文或任何秘密。

4. 验证两个语言的公开读取结果：

   ```bash
   curl --fail --silent --show-error \
     'https://relayune.giraffetree.cn/api/release-notes?locale=zh-CN'
   curl --fail --silent --show-error \
     'https://relayune.giraffetree.cn/api/release-notes?locale=en'
   ```

5. 检查 `/zh/changelog/`、`/en/changelog/` 和手机端“版本记录”。确认版本、日期、平台及
   条目一致后，版本更新日志才算发布完成。

`publishedAt` 晚于服务器当前时间的记录不会出现在公开接口中，可用于随正式生效时间
预先写入，但不得用它提前宣称尚未完成的 App Store 审核或客户端发布。

## Android 自动更新清单

Android 直装版只读取 `https://relayune.giraffetree.cn/updates/android.json`。
该文件是一个会随新版本改变的指针，Nginx 必须以 `Cache-Control: no-store` 返回；它指向的
版本化 OSS APK 才使用长期 immutable 缓存。清单不经过 Server API，也不得包含令牌、
设备信息或任何用户数据。

签名 APK 构建完成后，先使用 Android 签名密钥流程独立核对包名、版本号和生产证书，再上传
版本化对象并验证匿名 HTTPS、大小、SHA-256 与 immutable 缓存。确认对象可用后再生成清单：

```bash
node scripts/prepare-android-update-manifest.mjs --production
node scripts/prepare-android-update-manifest.mjs --production --check
```

生成器从 `mobile/pubspec.yaml` 读取 `version_name` 与 `version_code`，从
`release-notes/<version>.json` 读取双语说明，并直接流式计算本地已签名 APK 的大小和
SHA-256。它还会通过 `apksigner` 验证现代 APK 签名方案、比对 Relayune 已登记生产证书
指纹，并通过 `aapt` 确认包名 `cn.giraffetree.relayune` 及 APK 内版本完全一致。默认产物路径
为 `dist/release/<version>/Relayune-<version>-Android.apk`，输出为
`public/updates/android.json`。

`--production` 会读取现有公开清单并阻止版本号或 build number 回退；同一
`version_code` 只允许内容完全相同的幂等重跑，不允许替换已经发布的 APK 哈希或说明。
正式发布顺序必须是“签名与验收 → OSS 上传并验证 → 生成清单 → 自托管构建与部署”，不得让
公网清单提前指向尚不存在或尚未验收的 APK。
