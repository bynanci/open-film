# OpenFilm

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![Verify](https://github.com/bynanci/open-film/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bynanci/open-film/actions/workflows/ci.yml)
[![最新發行版](https://img.shields.io/github/v/release/bynanci/open-film)](https://github.com/bynanci/open-film/releases/latest)
[![授權](https://img.shields.io/github/license/bynanci/open-film)](LICENSE)
[![文件](https://img.shields.io/badge/docs-online-2563eb)](https://bynanci.github.io/open-film/)

OpenFilm 是一款開源、優先在本機執行的媒體編輯工具，可將照片、影片與音訊整理成故事和可編輯的電影。它不會修改原始媒體，也不需要雲端帳號。

## 專案狀態

目前最新的正式穩定版為 **v0.4.0**。main 是持續開發中的未發行版本；已訂定的 **v1.0.0** 目標與尚待完成的發行條件，請見[版本就緒 roadmap](docs/roadmap/v1-readiness.md)。目前尚未提供可發行的原生安裝程式。

## 功能

- 在專案中匯入並整理本機媒體，使用可攜式 SQLite 素材目錄。
- 規劃故事、編輯時間軸、加入字幕與音訊，並在採用變更前先行檢視。
- 預覽並輸出 MP4、JSON 與支援的交換格式。進階 OTIO 效果在其他剪輯軟體中可能需要手動重建，請參閱[相容性指南](docs/nle-compatibility.md)。
- 透過 Visual QA、contact sheets 和輸出報告檢視已儲存的剪輯，並整理可搬移的引用素材。
- 使用桌面工作流程或 CLI。選用的 provider 整合需明確啟用；基本工作流程不需要 AI provider。

OpenFilm 面向單一使用者的本機工作站，不是多使用者或面向網際網路的服務。若要對外開放本機服務或檢視 plugin，請先閱讀[安全政策](SECURITY.md)。

## 從原始碼開始

需要 Node.js **24.14.0 或更新版本**、pnpm **11.11.0**、FFmpeg 與 FFprobe。原生桌面 shell 的其他需求列在[桌面指南](apps/desktop/README.md)。

    pnpm install --frozen-lockfile
    pnpm dev

這會啟動本機開發工作區和應用程式服務。查看 CLI：

    pnpm cli --help

驗證方式與各類測試命令請見[貢獻指南](CONTRIBUTING.md)。這是原始碼開發流程，不是提供給一般使用者的安裝程式。

## 文件

[文件網站](https://bynanci.github.io/open-film/)提供**繁體中文、英文與日文**內容。可從[使用流程](docs/product-workflow.md)開始，或瀏覽[文件分類索引](docs/index.md)。

- 目前狀態：[roadmap](ROADMAP.md)、[v1.0.0 就緒進度](docs/roadmap/v1-readiness.md)、[工作項目](TASKS.md)
- 設計與介面：[架構](docs/architecture.md)、[專案格式](docs/project-format.md)、[整合契約](docs/CONTRACTS.md)
- 證據：[發行與驗證紀錄](docs/index.md)
- 研究：[研究索引](research/README.zh-TW.md)

## 社群

- [貢獻指南](CONTRIBUTING.zh-TW.md) · [支援方式](SUPPORT.zh-TW.md)
- [行為準則](CODE_OF_CONDUCT.zh-TW.md)
- [回報安全問題](SECURITY.zh-TW.md)
- [建立 issue](https://github.com/bynanci/open-film/issues/new/choose)

歡迎使用英文、繁體中文或日文提交社群回報。請勿附上私人媒體、專案資料庫、原始檔案路徑、GPS 資料或憑證；請使用產生的測試素材，或你有權分享的媒體。

## 授權

OpenFilm 第一方程式碼採用 [Apache-2.0](LICENSE)。第三方元件與媒體各自遵循其授權條款，詳見 [NOTICE](NOTICE) 與[授權說明](docs/licensing.md)。
