# Flutter 命令入口

在仓库根目录使用 `node mobile/tool/flutter.mjs <Flutter 参数>`，或在 `mobile/` 目录使用
`node tool/flutter.mjs <Flutter 参数>`。`check` 顺序执行 `analyze` 和 `test`；普通构建/运行
仍需有效 Git HEAD，自动记录真实来源信息，不会为 source ZIP 或未提交仓库虚构提交号。

macOS/Linux 沿用 PATH 中的 Flutter 命令。Windows 的 `flutter.bat` 不能直接交给不带
shell 的 Node 子进程执行，因此本入口使用已初始化 SDK 内的 `dart.exe` 及
`bin/cache/flutter_tools.snapshot`。所有参数以数组原样传入，不经 shell 拼接。

Windows 首次使用前，由开发者在自己的终端初始化 SDK，例如 PowerShell：

```powershell
$env:FLUTTER_ROOT = 'C:\tools\flutter'
& "$env:FLUTTER_ROOT\bin\flutter.bat" --version
node mobile/tool/flutter.mjs --version
```

也可将 SDK 的 `bin` 目录加入自己的 PATH；入口会从 `flutter.bat` 的位置定位 SDK，
无需硬编码安装目录。`FLUTTER_ROOT` 如有设置必须是 SDK 的绝对目录路径。
SDK 路径与 Flutter 参数可以包含空格。若 native Dart 或 snapshot 缺失，入口明确报错，
请先重新运行 SDK 自带的 `flutter.bat --version`；它不会自动启动批处理、修复 SDK 或下载
工具。升级 Flutter 或清理 SDK cache 后也需重新初始化。`FLUTTER_TOOL_ARGS` 中的
Dart VM 选项不由此入口解析或转发，需要这类自定义启动时直接使用 Flutter 官方入口。

版本与普通源码检查不要求本项目有 Git HEAD：

```powershell
node mobile/tool/flutter.mjs --version
node mobile/tool/flutter.mjs check
```

以上检查不安装 App。构建、设备运行或安装需按各自流程另行执行；不要把静态检查、
fixture 或未记录来源的原生 Flutter 构建描述为正式发行验收。
