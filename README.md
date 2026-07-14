# ZZ Record

一款面向教程、演示和工作记录的 Windows 屏幕录制与编辑工具。录完可直接剪辑、添加光标效果和缩放，并导出 MP4 或 GIF；也可以将手机作为局域网摄像头使用。

> 当前首发版本仅支持 Windows x64。下载、安装和问题反馈都在本仓库的 [Releases](https://github.com/zhouzilai626/zz-Record/releases) 与 [Issues](https://github.com/zhouzilai626/zz-Record/issues)。

![录制与编辑效果](./docs/media/feature1.gif)

## 适合做什么

- 录制整个屏幕或指定窗口
- 录制麦克风和系统声音
- 录制结束后直接剪辑、裁切、调速、添加注释和背景样式
- 使用光标平滑、点击效果和自动缩放，让教程更易看清
- 添加本地摄像头或手机摄像头画面
- 导出 MP4 或 GIF，或保存项目后继续编辑

![摄像头叠加效果](./docs/media/feature2.gif)

## 下载与安装

1. 前往 [Releases](https://github.com/zhouzilai626/zz-Record/releases) 下载最新的 `zz-Record-windows-x64.exe`。
2. 双击安装程序，按提示完成安装。
3. 首次启动后选择要录制的屏幕或窗口；需要声音时，在开始录制前分别开启“麦克风”或“系统声音”。

当前安装包尚未进行 Windows 代码签名。Windows 可能显示 SmartScreen 提示，请仅从本仓库的 Release 页面下载，并核对发布页提供的 SHA-512 校验和。

## 手机作为摄像头

1. 在录制工具中打开摄像头菜单，选择“手机摄像头（本地）”。
2. 使用手机扫描桌面端显示的二维码，并允许浏览器使用摄像头。
3. 手机与电脑必须连接同一局域网。首次使用时，手机可能要求信任桌面端生成的本机 HTTPS 证书。
4. 连接成功后，手机画面会作为摄像头素材参与录制；录制中的预览以受保护独立窗口显示，避免被重复录入画面。

手机画面通过本地局域网 HTTPS 传输，不会上传到第三方服务。

## 系统要求与当前限制

| 项目 | 当前支持 |
| --- | --- |
| 操作系统 | Windows 10 20H1（Build 19041）或更高版本，64 位 |
| 录制 | 屏幕、窗口、麦克风、系统声音 |
| 摄像头 | 本地摄像头、同一局域网内的手机摄像头 |
| 导出 | MP4、GIF |

- macOS 和 Linux 源码仍在仓库中，但当前没有经过同等验证的公开安装包。
- 第三方扩展系统已临时停用，已安装的扩展不会执行。
- 原始录制文件的音频在部分 Windows 原生录制路径中会以伴随音轨保存；请以编辑器预览和导出文件为准。

## 从源码运行

开发构建需要 Node.js、Visual Studio 2022（或 Build Tools）的 C++ 工作负载和 CMake。

```bash
git clone https://github.com/zhouzilai626/zz-Record.git
cd zz-Record
npm install
npm run dev
```

构建 Windows 安装包：

```bash
npm run build:win
```

构建产物位于 `release/`，该目录不会提交到 Git。

## 反馈与贡献

- 使用问题与功能建议：请提交 [Issue](https://github.com/zhouzilai626/zz-Record/issues)。
- 代码贡献：请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，提交聚焦的 Pull Request，并说明测试方式。
- 安全问题：请不要在公开 Issue 中附上可利用细节，按 [SECURITY.md](./SECURITY.md) 的方式报告。

## 许可证与归属

ZZ Record 基于 [Recordly](https://github.com/webadderallorg/Recordly) 定制，Recordly 最初基于 [OpenScreen](https://github.com/siddharthvaddem/openscreen)。

本项目以 [GNU AGPL-3.0](./LICENSE.md) 发布。使用、修改或再发布时请保留许可证、版权声明和上述归属信息。
