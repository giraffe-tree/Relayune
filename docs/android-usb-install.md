# Android USB 安装

此流程目前面向维护者，依赖仓库外的生产签名管理工具。公共仓库尚未提供完整的通用替代签名入口；外部使用者不能仅凭下列命令假定可完成签名和安装。

手机开启 USB 调试并授权电脑后，在项目根目录执行：

```sh
npm run mobile:android:install
```

默认安装当前分支本地 `HEAD` 的正式签名 APK，不包含未提交修改，也不自动 fetch/pull。
安装前核对手机上次实际安装的提交及其来源 worktree，不能只比较版本号。同一个
`0.3.27+37` 可以来自不同提交；如果上一版来自尚未合入 main 的功能分支，应先将用户
已验收的那条提交链整合到安装目标，并保留当前修复。用 `git merge-base --is-ancestor
<上一版提交> <目标提交>` 核对包含关系，再检查整合后的界面。缓存记录只能证明 APK
构建成功，上次安装来源还应有成功安装日志或会话记录支持。
命令启动时先打印执行目录、目标引用、完整 commit、提交说明、作者及带时区的作者/提交时间；`--check` 也会显示。默认 HEAD 明确标出当前分支，`--ref` 显式标出指定引用。
先检查手机和版本，再复用脚本保存的同提交缓存；首次使用或提交变化时，在专用隔离 worktree
构建 APK。普通目录下的旧 APK 即使版本号相同也不会被误用。成功后保留应用数据覆盖安装、启动并检查进程。

```sh
# 只检查目标提交、USB 连接、版本和缓存，不构建、不安装
npm run mobile:android:install -- --check

# 多设备时使用 adb devices 查询自己的设备序列号
npm run mobile:android:install -- --device DEVICE_SERIAL

# 可选指定本地提交或分支
npm run mobile:android:install -- --ref main
```

脚本从环境变量、`mobile/android/local.properties` 和 Homebrew SDK 路径查找工具。
本机 ADB 是 `/opt/homebrew/share/android-commandlinetools/platform-tools/adb`。
可通过 `ADB`、`ANDROID_SDK_ROOT`、`FLUTTER`（可执行文件路径）指定工具；Java 使用现有 Java/Flutter 配置。
签名默认调用维护者私有 `manage-android-signing-keys` 工具，该工具不随公共源码提供。
`ANDROID_SIGNING_SCRIPT` 可覆盖可执行脚本路径，但只是已有接口，不代表通用替代实现已提供。
外部使用者须自行实现兼容签名脚本并管理自己的密钥；维护者工具会把密码仅注入构建进程。

隔离构建复制本地 `mobile/android/push.local.properties`，继承推送环境参数；配置改变时不复用旧缓存。
构建缓存保存在 `~/Library/Caches/Relayune/android-usb/`，按仓库、完整提交和配置区分，
记录 APK SHA-256；安装前始终检查正式签名、包名和版本。保留 worktree 与构建缓存便于重试。

多设备、USB 未授权、签名错误、构建失败或版本降级会停止。脚本不会卸载应用、清数据、
使用调试签名替代正式签名，也不会上传或发布。若进程被强制杀死留下 `install.lock`，
确认没有安装或构建进程后才手动删除报错中指定的锁目录。
