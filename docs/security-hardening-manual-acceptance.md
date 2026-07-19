# 安全加固手工验收清单

> 适用版本：本次 IPC、手机摄像头桥接与原子持久化改动。
> 自动验证已覆盖 TypeScript 编译与单元测试；以下项目必须在真实 Electron 打包或开发运行环境中手动完成。

## 0. 前置条件

- 使用一台安装 ZZ Record 的电脑和一台可接入同一 Wi-Fi 的手机。
- 电脑同时启用至少一个额外网络接口（例如 VPN、虚拟网卡或有线网络），用于确认桥接服务没有监听到非预期地址。
- 记录手机配对二维码中的电脑 LAN IP、会话参数和端口。
- 使用测试项目与测试录制目录，避免覆盖真实项目或媒体。

## 1. 手机摄像头网络范围与会话失效

| 编号 | 操作 | 期望结果 | 结果 |
| --- | --- | --- | --- |
| PC-01 | 在应用中选择手机摄像头，打开配对窗口。 | QR 中显示一个局域网 IPv4 地址；手机可在该地址打开配对页。 | ☑ 通过（用户于 2026-07-18 确认） |
| PC-02 | 从同一 Wi-Fi 的手机上传画面。 | 桌面预览显示画面，状态变为已连接。 | ☑ 通过（用户于 2026-07-18 确认） |
| PC-03 | 从连接到电脑 VPN/虚拟网卡对应网段的测试设备，访问该接口 IP 的 `17885` 与 `17886` 端口。 | 不能连接到桥接服务；服务仅在 QR 展示的 LAN 地址可达。 | ☑ 通过（用户于 2026-07-18 确认） |
| PC-04 | 保存当前 QR URL，退出并重新启动应用，再访问旧 URL。 | 页面显示配对链接已失效；旧 URL 不能连接或上传帧。 | ☑ 通过（用户于 2026-07-18 确认） |
| PC-05 | 新建手机摄像头会话，随后点击“忘记设备”，再访问该会话旧 URL。 | 旧 URL 立即失效，预览窗口关闭，状态回到未启用。 | ☑ 通过（用户于 2026-07-18 确认） |
| PC-06 | 同一运行期短暂关闭手机页面后重新打开当前 QR URL。 | 仍可重连；不需要重新选设备。 | ☑ 通过（用户于 2026-07-18 确认） |

## 2. 首次证书引导

桥接会先提供局域网 HTTP setup 页面，再跳转到 HTTPS 摄像头页。setup URL 含仅驻留内存的 256-bit 配对 token，默认 10 分钟失效；CA 下载必须同时提供当前会话 token 与一次性 ticket。每次会话最多签发 3 个下载 ticket，成功下载会立即消费 ticket。桌面与手机端都会展示同一 CA SHA-256 指纹，安装前必须人工比对。仍只能在受信任的私有网络中进行首次安装。

| 编号 | 操作 | 期望结果 | 结果 |
| --- | --- | --- | --- |
| CA-01 | 使用首次连接的手机扫描二维码，完成 CA 安装、指纹比对和 HTTPS 访问。 | setup 页展示与桌面一致的指纹；HTTPS 配对页可打开，摄像头授权可用。 | 待本轮真机回归 |
| CA-02 | 下载中断后刷新 setup 页，再次下载 CA。 | 在 10 分钟会话期内可重新签发 ticket；已成功使用的旧下载链接返回失效状态。 | 待本轮真机回归 |
| CA-03 | 移除 `session`、`token` 或 `ticket` 任一参数后访问 CA 下载 URL；或使用另一会话的 ticket。 | 返回失效状态，不下载证书。 | 自动化已覆盖：token/ticket 会话绑定、一次性消费、过期拒绝与单会话 3 次签发上限；真机待回归 |
| CA-04 | 等待超过 10 分钟后访问 setup、HTTPS 摄像头页与旧下载 URL。 | 页面及下载均显示配对失效，需重新扫码。 | 待本轮真机回归 |
| CA-05 | 在非受信任公共网络或无法确认网络完整性时尝试配对。 | 不继续安装 CA；记录为不支持的高风险环境。 | 待本轮真机回归 |

## 3. IPC 与导出回归

| 编号 | 操作 | 期望结果 | 结果 |
| --- | --- | --- | --- |
| IPC-01 | 导入视频、壁纸、音频并在编辑器中预览。 | 已通过文件选择器或当前项目授权的媒体可正常读取与预览。 | ☑ 通过（用户于 2026-07-18 确认） |
| IPC-02 | 尝试访问未导入的本地文件（开发者工具仅用于受控测试）。 | `read-local-file` 被拒绝，不返回文件字节。 | ☑ 通过（用户于 2026-07-18 确认） |
| IPC-03 | 常规 MP4/GIF 导出。 | 始终显示主进程保存对话框；用户取消后可使用“再次保存”。 | ☑ 通过（用户于 2026-07-18 确认） |
| IPC-04 | 执行 smoke export（仅 CI/开发受控环境）。 | 仅与 `RECORDLY_SMOKE_EXPORT_OUTPUT` 完全相同的路径可免对话框写入。 | ☑ 通过（用户于 2026-07-18 确认） |
| IPC-05 | 打开自动字幕并选择模型。 | 使用应用受控 Whisper 运行时；界面不再提供任意本地可执行文件选择。 | ☑ 通过（用户于 2026-07-18 确认） |

## 4. 持久化与故障恢复

| 编号 | 操作 | 期望结果 | 结果 |
| --- | --- | --- | --- |
| PERSIST-01 | 保存已有 `.recordly` 项目后重新打开。 | 内容完整，项目 ID、编辑设置和缩略图正常。 | ☑ 通过（用户于 2026-07-18 确认） |
| PERSIST-02 | 修改录制目录、麦克风开关、系统音频和具体麦克风；重启应用。 | 录制目录与全部录音偏好同时保留。 | ☑ 通过（用户于 2026-07-18 确认） |
| PERSIST-03 | 选择“默认麦克风”，重启应用。 | 不恢复旧的具体设备 ID，使用系统默认设备。 | ☑ 通过（用户于 2026-07-18 确认） |
| PERSIST-04 | 在测试副本上模拟磁盘写入失败或终止保存进程。 | 原项目文件仍为可解析的旧版本或完整新版本；不应出现截断 JSON。 | ☑ 通过（用户于 2026-07-18 确认） |

## 5. 本轮验证矩阵

每次准备提交前执行：

```text
npx vitest run electron/phoneCameraBridgeServer.test.ts electron/phoneCameraSessionState.test.ts
npx vitest run electron/windowSecurity.test.ts electron/ipc/atomicFile.test.ts electron/ipc/register/exportCaptionSidecars.test.ts
npx tsc --noEmit
git diff --check
npm test  # 连续运行两次
```

本轮已执行的 phone camera 定向验证（2026-07-19）：`electron/phoneCameraBridgeServer.test.ts`、`electron/phoneCameraSessionState.test.ts`、`electron/windowSecurity.test.ts`、`electron/ipc/register/exportCaptionSidecars.test.ts` 与 `src/components/phone-camera/PhoneCameraPairingWindow.test.ts` 共 **5 个文件 / 35 项测试通过**；同时 `npx tsc --noEmit` 与 `git diff --check` 通过。定向结果覆盖 token 过期时的 bridge/setup 页、连接和帧上传拒绝；CA ticket 的会话绑定、单次消费、过期和签发上限；setup/CA 下载路由的缺失 ticket 拒绝、跨会话 ticket 拒绝和三次签发上限；不可信 Origin 不会获得 health 探测 CORS 权限；完整安全响应头；以及桌面配对窗口的准备、等待、已连接、异常和停止状态文案。sidecar 写入失败日志为测试主动模拟 `disk full` 的预期故障路径。

已连续执行两次完整 `npm test`，两次命令均以退出码 `0` 完成；最近一次输出为 **112 个测试文件 / 917 项测试通过**（总耗时 74.23 秒）。测试输出含导出 fallback 等测试主动触发的预期错误日志，未出现失败用例。Windows 打包 smoke test 尚未执行。

Windows 打包环境可用时，另执行一次安装包或开发构建 smoke test，覆盖编辑器打开、录制启动、手机摄像头配对和一次导出。该项及 CA-01～CA-05 的 iPhone/Android 真机回归仍必须人工执行，不能由上述自动化结果替代。

## 已知限制与后续工作

- CA 私钥与相关证书材料仍以多个文件保存；虽然本轮 CA 下载凭据只在内存中，证书材料尚未升级为跨文件事务或 OS 凭据库保护。
- 本轮敏感资源调用方校验已先覆盖资产读取、目录枚举和壁纸缩略图；仍需将项目、导出、录制、扩展、外链与手机摄像头全部 handler 迁移到同一 caller policy，并把共享 preload 拆为按窗口角色的独立入口。
- 仅信任当前 QR 展示的私有 LAN 地址；VPN、公共 Wi-Fi、未知代理网络不支持首次 CA 安装。
- 本轮新增 token/ticket、CORS 和响应头的自动化测试通过，但 CA-01 至 CA-05 仍需要 iPhone/Android 真机回归记录，不能以静态或单元测试替代。

## 提交范围与风险摘要

本轮工作区中必须继续排除以下既有原生文件改动：

- `electron/native/bin/win32-x64/cursor-monitor.exe`
- `electron/native/bin/win32-x64/helpers-manifest.json`
- `electron/native/bin/win32-x64/recordly-gpu-export.exe`
- `electron/native/bin/win32-x64/wgc-capture.exe`

建议在真机验收完成后，按功能拆分本轮改动：手机信任引导、安全响应头与测试；IPC caller policy 与资产权限；扩展状态及字幕 sidecar 原子持久化；文档更新。推送前需要用户明确确认。
