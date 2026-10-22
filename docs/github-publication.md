# GitHub 公开准备与验收

本次目标是校验公开源码候选集中的敏感信息，并整理适合公开仓库的 README 和相关文档。
维护者已确认自有代码和素材有权公开；第三方部分仍适用原许可。后续功能改进、真实设备验收、
外部服务投递、安装包许可及独立安全审计按各自范围另行推进，未完成项如实披露。
维护者已授权初始化本地 Git
并设置 `origin=git@github.com:giraffe-tree/Relayune.git`，但**没有授权暂存、提交或 push**。
不得为了 CI、构建元数据或验证发布流程而在本仓库创建提交。公开准备、首次提交、
首次上传和应用发行是分别授权的操作。

采用 [MIT License](../LICENSE)，对外称为 MIT 开源项目。
许可覆盖范围、第三方例外和商业授权说明见[许可文档](licensing.md)。

## 评估维度和证据

| 维度 | 必需证据 | 当前检查入口 |
| --- | --- | --- |
| 隐私与凭据 | 真实候选文件、index blob、符号链接、秘密模式扫描及逐项复核 | `npm run audit:publication -- --secrets`，`.gitleaks.toml` |
| 安全与数据边界 | 未配置管理员默认拒绝；身份、加密、撤销、保留窗口和日志约束不被削弱 | `tests/monitoring.test.mjs`、密码学/盲密文测试及真实 Mongo fixture |
| 许可与素材 | 完整项目许可、原第三方声明、逐素材来源和锁定依赖许可元数据 | `THIRD_PARTY_NOTICES.md`、`asset-provenance.json`、`dependency-licenses.json` |
| 独立开发和自托管 | 明确工具版本、锁文件、配置入口、作者环境依赖与可替代路径 | 根/平台 README、`self-hosting.md`、开发构建计划检查 |
| 功能与质量 | Web/Server 构建、类型/lint、Node/Desktop/Flutter fixtures、真实数据库结果 | `quality.yml`、Windows workflow 和本地验证记录 |
| GitHub 协作 | 贡献和私密漏洞渠道、问题/PR 模板、低权限且固定 action commit 的 CI | 根 CONTRIBUTING/SECURITY、`.github/` |

检查通过只能证明实际覆盖的范围。真实 Agent 执行、原生 App 生命周期、最终签名产物、
系统权限、邮件/SLS/推送投递、操作系统升级和独立密码学审计必须另外列明；
不能用 fixture、旧验收摘要或绿灯图标替代这些证据。

## 本地重复检查

使用 Node.js >=22.13.0（本轮 22.19.0），安装锁定的根与 Desktop 依赖：

```sh
npm ci
npm ci --prefix desktop
node scripts/install-gitleaks.mjs
GITLEAKS_BIN="$PWD/.public-prep/tools/gitleaks" npm run audit:publication -- --secrets
npm run typecheck
npm run lint
npm test
npm --prefix desktop test
npm --prefix desktop run check:development-build
npm run desktop:check
npm --prefix desktop run test:rust:lib
npm run mobile:check
npm run build:self-hosted
```

`install-gitleaks.mjs` 显式下载官方 Gitleaks 8.30.1，并用固定 SHA-256 检验归档，
仅写入被忽略的 `.public-prep/tools/`，不安装系统软件。当前支持 macOS arm64/Linux x64；
其他平台由开发者独立验证二进制后设置 `GITLEAKS_BIN`。
不加 `--secrets` 只检查文件选择和链接边界，不能声称已经扫描凭据。

扫描器同时检查工作区文件及暂存区的真实 blob，拒绝外部/排除内容的链接、环境文件、
签名密钥、运行时数据等候选路径。秘密扫描不接受行内 `gitleaks:allow` 或隐式 fingerprint ignore 文件绕过；
只有两项已复核的确定性测试向量按精确路径与值共同豁免，不豁免整个 tests 目录。
报告只保存规则、路径和行号，不写出命中原文，临时扫描副本在退出时清理。
它不是任意编码秘密、图片内隐私或素材权利的完整检测器，人工检查仍然必要。

本地公开准备库尚无历史提交；这里不能扫描旧私库历史，也无法判断旧秘密是否需要轮换。
公开时只使用经过检查的当前源码，不导入原仓库的 `.git`、分支、标签、补丁归档或运行状态。
原环境的秘密若曾对外泄露，需在对应服务撤销/轮换；清理当前候选集不能代替该处理。
GitHub workflow 使用完整 fetch 和 Gitleaks Git 模式扫描所获取的全部历史，此外保留当前树检查。
Git ignore 不能防止 `git add -f` 或手工打包整个目录，不能把整个工作目录直接上传。

依赖漏洞检查使用官方 registry 的审计接口；某些镜像不提供该接口：

```sh
npm audit --omit=dev --registry=https://registry.npmjs.org
npm audit --prefix desktop --omit=dev --registry=https://registry.npmjs.org
```

审计返回错误或缺少工具不等于“零漏洞”。锁定版本、已知公告和实际调用边界都要复核。
包括无法上游修复项在内的当前结果见[依赖安全审查](dependency-security.md)。
许可证清单由 `python3 scripts/audit-licenses.py` 读取本地 lock/cache；
新增、升级或移除依赖后要重新生成并核对许可与随附声明。

仓库 `.gitattributes` 要求文本保持 LF，二进制素材禁止换行转换；锁文件和生成运行库的
字节哈希以此保持跨平台一致。源码 ZIP 不包含 Git 元数据，因此候选集和历史扫描必须在
正常 clone 中执行；不能用 ZIP 的普通构建结果替代 Git 内容审查。

## CI 与真实环境范围

`Source checks` 定义 Node/Web/Server、Desktop unit、秘密/历史扫描以及 Flutter 静态和 fixture
检查。已有 Windows workflow 另覆盖 Windows 原生编译和无签名安装生命周期。
Action 引用固定到完整 commit，默认 `contents: read`、不保留 checkout 凭据，不注入生产秘密。
本轮没有上传任何 Git 内容，因此不能把 workflow 定义或本地通过表述为 GitHub runner 已运行成功。

Mongo 集成需要独立下载并校验 `mongod`，显式提供 `RELAY_TEST_MONGOD`。
测试只使用 loopback、随机端口、合成账户与临时 dbpath，不安装服务，也不接触真实数据库。
现有容量/保留窗口 tests 可按此方式运行：

```sh
RELAY_TEST_MONGOD=/absolute/path/to/verified/mongod \
  node --test tests/online-capacity-mongo.test.mjs tests/relay-retention-mongo.test.mjs
RELAY_TEST_MONGOD=/absolute/path/to/verified/mongod \
  node scripts/test-mongo-isolated.mjs
```

`verify-mongo-self-hosted.mjs` 现在要求受保护的隔离 fixture，不能作为任意部署的在线探测器。
它会插入合成授权并触发邮件流程，不得拿生产 URL、数据库或真实用户令牌填入参数。
第二条命令独立创建完整 HTTP/Mongo fixture，验证注册、密码登录、双客户端独立 PAKE、
撤销、无收费状态访问、数据库秘密边界、限流和退出；只运行 MockCodex，没有真实 Agent 或原生 UI。
具体本地结果、跳过原因和限制记录在[公开清单](publication-checklist.md)。

## 维护者最后核对

1. 按最终候选版本重新扫描，人工确认图片、许可、公开范围、配置迁移及未验收事项。
2. 检查 `git ls-files --stage`、`git status --short` 和 `git remote -v`；确认没有私库历史。
3. 在维护者明确授权后，才准备经过审查的首次提交；首次 push 再单独取得授权。
4. GitHub 端核对可见性、许可证呈现、默认分支、私密漏洞报告和 secret scanning / push
   protection。启用功能取决于账户和仓库条件，未实际设置时不得在清单勾选完成。
5. 首次上传后观察真实 CI 结果，配置适用的分支保护/必需检查。不要为绿灯关闭鉴权、
   签名、安全测试或未经解释地扩大扫描豁免。

应用安装包、签名、公证、商店提交、生产部署及官方更新是后续独立任务。源码候选集
包含明确的当前限制，不承诺每个自托管客户端或发行组合已经通过真实环境验收。
