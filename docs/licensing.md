# 许可与第三方素材

Relayune 自有源码和项目素材按根目录 `LICENSE` 中的 **MIT License** 提供。
依该许可可使用、修改和商业分发，复制或分发时须保留版权与许可声明；软件按原样提供，
不作担保。完整授权范围及条件以 `LICENSE` 为准。

本许可只覆盖维护者有权授权的部分。第三方代码、字体、图标和依赖继续适用各自原许可，
不能删除其声明，也不能把项目的 MIT 许可误当成所有第三方组件都采用 MIT。
名称、标志和第三方产品商标不因源码许可而自动授予商标权。参见
[品牌说明](../public/brand/relayune/README.md)和[第三方声明](../THIRD_PARTY_NOTICES.md)。

维护者已确认品牌图形文件继续 MIT，不另设非商业素材许可。代码和图形文件可以依 MIT
商业使用、修改和分发；第三方不能把这项版权许可当作将 Relayune 名称或 Logo 用作其自身
产品或服务品牌的授权。真实注明来源、描述兼容性和使用官方原版自托管不要求删除标志；
不得冒充官方或暗示背书。完整品牌规则见上述品牌说明。

## 已随源码分发的第三方内容

| 内容 | 原许可与证据 | 分发时保留 |
| --- | --- | --- |
| Mermaid 11.17.2 浏览器运行时，Web 与 Flutter 两份 | MIT；从 ESM 和修补后的锁定依赖重新打包；`BUILD.json` 记录 64 个实际输入包、依赖版本与输出哈希 | 两份 `LICENSE`、`THIRD_PARTY_LICENSES.txt`、`BUILD.json` 和 JS 内声明；附加文本包含 112 个运行时依赖的完整许可，是比实际 bundle 更宽的集合；fastdom/strictdom 的完整 MIT 文本来自包内 README 的 License 节 |
| Lucide 0.468.0 离线脚本 | ISC，含 Feather 原版权说明；脚本头与来源见可视化目录 | `mobile/assets/visualization/LICENSE-lucide` 和脚本头 |
| Relayune Preview CJK 字体 | Noto Sans SC 衍生、OFL-1.1；字体 name 表仍有 Adobe 2014–2021 声明，已补入许可旁文件；内部字体名已修改 | `LICENSE-noto`、字体来源与子集说明；不能将字体改授为项目许可 |
| Codex、Kimi、Claude 标识 | LobeHub lobe-icons MIT，固定 revision；逐个核对上游 SVG 的 path 数据相同 | Web/Flutter 两份 `LICENSE.txt`；识别集成不表示品牌方背书 |

两处 `night-sea.webp` 以及宣传卡纹理已替换为仓库内原创几何生成素材：
`node scripts/generate-night-sea.mjs` 离线重建，不读取外部图片、字体或生成式图像。
原 65 个二进制候选文件的逐文件来源、生成入口与哈希，以及附加 SVG/脚本来源，见
[`asset-provenance.json`](asset-provenance.json)。标为合成占位图的营销素材不证明真实用户旅程。
平台启动字形位图使用系统字体渲染，不包含系统字体文件；系统字体自身的许可不在本次审查范围。

## 依赖审查与发行边界

[`dependency-licenses.json`](dependency-licenses.json) 覆盖根和 Desktop npm 锁、Rust Cargo 锁、
Flutter 主项目及两个设计预览 Pub 锁的所有条目，包含开发、可选和其他平台依赖；它不是最终
可执行文件的链接清单。每项保留版本、声明许可、完整许可文件哈希或缺失状态，不包含本机路径。
当前快照有 1,038 个 npm 条目、539 个 crates、174 个 Pub 条目；重复包和不同锁中的条目分别计数。
2026-10-27 更新了 npm/Cargo 的变更版本与许可记录；三个 Pub 锁的 SHA-256 完全未变，
因本轮环境没有先前 Pub 缓存，清单明确沿用这些未变更条目的既有许可文本哈希证据，
不把它写成当天重新读取了 Pub 许可正文，也不以空缓存结果抹去已核对的材料。

```sh
# Python >=3.11。默认只读取本地锁和依赖缓存，不安装或执行包。
python3 scripts/audit-licenses.py
# 只读补查本地没有元数据的 crates.io 版本；缓存到被 Git 忽略的 .public-prep。
python3 scripts/audit-licenses.py --fetch-missing
# 已安装锁定 npm 依赖时，重建 Mermaid 的两份完整依赖许可文本。
python3 scripts/audit-licenses.py --write-vendored-notices
```

特别需要按原许可处理的依赖：

- `sharp` 的若干可选 `@img/sharp-libvips-*` 包为 LGPL-3.0-or-later；部分 Windows/WASM 包有
  Apache/MIT 与 LGPL 的组合。它们用于图像构建工具；若将相应库或可执行文件一起发行，还需核对
  库源代码、修改、链接方式和用户替换/重新链接能力等适用义务。锁文件不能证明某发行包未包含它们。
- npm 的部分 CSS 工具、Rust 的 `cssparser`、`cssparser-macros`、`dtoa-short`、`option-ext`、
  `selectors`，以及 Pub 的 `dbus`、`gtk` 使用 MPL-2.0。随源码分发这些依赖或修改受保护文件时，
  必须保留其许可；发行可执行形式时应按其条款提供受保护文件的源码。它们继续适用各自原许可。
- Rust `r-efi` 的声明为 `MIT OR Apache-2.0 OR LGPL-2.1-or-later`，可依许可选项选择 MIT 或 Apache；
  `OR` 是可选，`AND` 是同时满足。不要把多许可表达式当作可以任意删除的声明。
- `caniuse-lite` 数据声明 CC-BY-4.0；保留上游归属及许可。DOMPurify 提供 Apache-2.0 或 MPL-2.0
  选项；Mermaid 附加声明保存原始文本，不强行合并成 MIT。

该快照未发现声明为 AGPL 的依赖，也没有发现只能采用 GPL 的许可声明。Pub 的文本提示仅为
字符串匹配，例如 MPL 正文含 GPL 字样，并不表示该包采用 GPL；最终判断以其完整原许可为准。
自动许可清单不是法律意见，也不证明所有许可义务已满足。

源码公开候选不包含 `node_modules`、Cargo 构建目录、Flutter 构建缓存和应用安装包。
原生安装包的分发材料与实际产物核验另行记录，不以源码清单代替。
构建脚本现将 JavaScript 依赖的完整许可文本随生成物写出，项目 `LICENSE` 单独保留：

- Web 的 `npm run build` 在 `out/` 生成 `THIRD_PARTY_LICENSES.txt` 和 JSON 证据；自托管构建
  将它们复制进静态站点目录。Next 不提供本流程可用的精确 chunk 模块清单，因此这里明确采用
  已安装的前端/运行时依赖超集，不声称每个包都实际进入浏览器 bundle。
- `npm run build:self-hosted` 按两个 Server esbuild 产物的实际输入生成完整许可与输入证据，
  写到 `dist/self-hosted-server/`，同时记录两个 JS 产物的哈希；构建不会执行服务或发布更新说明。
- Desktop 的 Vite 产物和 sidecar 的 esbuild 产物分别按实际 JS 输入生成声明；声明也写入
  `desktop/src-tauri/resources/generated-notices/`，由既有 Tauri resource 配置带入后续打包。
  该生成目录被 Git 忽略。默认找不到完整许可证据会使收集失败，不以包的 `license` 字段代替正文。

缺正文的补充证据按精确包版本、固定上游来源和 SHA-256 绑定，见
[`scripts/license-evidence/README.md`](../scripts/license-evidence/README.md)。例如 `@next/env`
使用同版本 Next 仓库核验过的正文；`dijkstrajs` 保留其原 MIT 声明与归属，并附固定 SPDX
标准条文，保留标准模板占位符，不替换成其他包的作者。

`client-only@0.0.1` 的包内许可正文仍缺失；普通构建现在通过实际静态产物的来源证据，仅将
这个未进入发布 JS 的精确包版本从 Web 超集中排除。构建逐个检查实际 JS 链接的 source map
全部来源及原文、无 map 文件的精确来源和 HTML 内联脚本形态，并绑定最终字节及构建输入。
映射只留在忽略目录 `.public-prep/`，发布目录删除映射及末尾映射指令。缺映射、未知脚本、
来源中出现该包或输入变更均使检查失败。覆盖报告明确记录 `artifact_excluded_packages`，
不为该包猜测版权，也不清除其他分发场景中的缺证据问题。详见补证说明。

macOS 的 `prepare-sidecar` 在既有签名、布局修复和 smoke 检查完成后，自动生成独立的
`generated-notices/native-desktop/` 资源：固定版本 Node 的完整许可及内置库条文、pkg 注入代码
和补丁的原 MIT 声明、目标筛选后的 Cargo 非开发/构建依赖超集全文，以及 Rust 标准库声明。
缺独立 LICENSE 的特定 crate 保留原发布者声明，标准条文另行标注；不会填造版权年份或主体。
MPL 依赖同时携带与 Cargo 锁校验和一致的原始源码包，并逐文件确认本地源码未被修改。
macOS 当前两目标集合各含 335 个 registry crate；它是超集，不是精确链接清单。

生成器通过 `PKG_INVOKE_NODEJS` 只读核对新 sidecar 的 Node 版本/架构，并检查所选 pkg 缓存
原始 runtime 哈希。该探针绕过应用业务入口，不能替代启动和连接验收。最终 App 还需执行
`node scripts/native-desktop-notices.mjs --verify-app <Relayune.app>`，核对实际 App 中的全部
选定声明、MPL 源包和 JS 声明字节，记录 App 可执行文件与 sidecar 哈希。材料生成成功与
最终签名安装包的核验状态分开报告。来源及补证方式见
[`native-README.md`](../scripts/license-evidence/native-README.md)。

Windows CI 已禁用安装器上传；当前 macOS 原生生成器不为 Windows 二进制作验收。
Flutter、Pods、Gradle/Maven 及其 WebRTC、PDFium 等预编译库仍需移动端各自的实际打包物证据；
源码扫描、JS 声明或 macOS 材料都不能代替该检查。

## 可核验来源

- [MIT License 完整规范](https://opensource.org/license/mit)
- [Mermaid 源码与许可](https://github.com/mermaid-js/mermaid)
- [LobeHub 固定 revision 的 MIT 许可](https://github.com/lobehub/lobe-icons/blob/4aaf4ee1fb2678a7f989ea570f0f6ce14a9abf75/LICENSE)
- [Lucide 0.468.0 ISC 许可](https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE)
- [Noto CJK Sans 的 OFL 许可](https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE)
- [GNU LGPL 3.0](https://www.gnu.org/licenses/lgpl-3.0.html)、[MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/)
