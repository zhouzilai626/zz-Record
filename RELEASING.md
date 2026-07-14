# ZZ Record 发布说明

当前正式发布 Windows x64 安装包，使用 GitHub Actions 在 Windows 2022 环境构建。

## 发布前检查

1. 将 `package.json` 与 `package-lock.json` 的版本统一为待发布版本，例如 `1.4.5`。
2. 提交并推送 `main`。
3. 执行 `npx tsc --noEmit`，并运行与改动相关的测试。
4. 确认 `release/`、本机录制文件、证书和私钥没有被提交。

## 创建正式版本

发布标签必须与包版本一致：`vX.Y.Z`。

```bash
npm run release:create -- --tag v1.4.5 --title "ZZ Record v1.4.5" --notes-file ./release-notes.md
```

该命令会创建并发布 GitHub Release。发布后 `.github/workflows/release.yml` 会自动：

- 在 Windows 2022 上安装依赖并编译原生辅助工具
- 构建 Windows NSIS 安装包
- 生成 `latest.yml` 与 `SHA256SUMS.txt`
- 上传安装包和更新所需附件到对应 Release

预发布版本使用标准语义化版本标签，例如：

```bash
npm run release:create -- --tag v1.4.5-beta.1 --title "ZZ Record v1.4.5 beta.1" --prerelease --notes-file ./release-notes.md
```

## 重建已有版本

如果 Release 已创建但云端构建失败，在 GitHub Actions 中手动运行 `Publish Release`，填写已有标签，例如 `v1.4.5`。工作流会从该标签检出源码并覆盖上传同名附件。

## Release 附件

每个 Windows Release 应包含：

- `zz-Record-windows-x64.exe`
- `zz-Record-windows-x64.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`

安装包暂未代码签名。若配置了 `WINDOWS_SIGNING_CERTIFICATE_P12_BASE64` 与 `WINDOWS_SIGNING_CERTIFICATE_PASSWORD` 两个 GitHub Secrets，构建会使用对应的 Authenticode 证书签名。

## 本机构建

本机构建命令为：

```bash
npm run build:win
```

构建产物在 `release/`，该目录被 Git 忽略。若 `release/win-unpacked` 被运行中的应用占用，请先退出应用再重建。
