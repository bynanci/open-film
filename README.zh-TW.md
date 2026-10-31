# OpenFilm

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![Verify](https://github.com/bynanci/open-film/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bynanci/open-film/actions/workflows/ci.yml)
[![最新發行版](https://img.shields.io/github/v/release/bynanci/open-film)](https://github.com/bynanci/open-film/releases/latest)
[![授權](https://img.shields.io/github/license/bynanci/open-film)](LICENSE)
[![文件](https://img.shields.io/badge/docs-online-2563eb)](https://bynanci.github.io/open-film/)

**把照片、影片與音訊，整理成可以繼續剪輯的故事。**

OpenFilm 是一款開源、優先在本機執行的媒體編輯工具。從整理分散的素材、規劃故事，
到產生粗剪與精修，都能在同一個專案中完成。原始媒體保持不變，基本工作流程不需要
雲端帳號或 AI 服務，也能透過支援的交換格式，將作品交給其他剪輯軟體繼續後製。

[閱讀文件](https://bynanci.github.io/open-film/) ·
[查看 roadmap](ROADMAP.md) ·
[參與貢獻](CONTRIBUTING.zh-TW.md)

## 可以做什麼

- **整理素材。** 匯入本機檔案與資料夾、檢視中繼資料、審查重複素材與事件建議，
  並將素材選擇保存在可攜式 SQLite 目錄中。
- **規劃故事。** 從故事結構或自行撰寫的大綱開始，透過 Story Graph 與 Storyboard
  連結想法、挑選素材，並預覽符合時長條件的粗剪。
- **掌握剪輯。** 使用非破壞式編輯、鎖定、復原／重做與已儲存的專案版本，
  調整片段、照片、標題、字幕和音訊。
- **審查自動化。** 依序檢視 Pipeline 步驟、變更提案與創意版本，再決定是否採用。
  選用的本機或遠端 provider 需經設定；遠端資料傳送需要明確同意。
- **預覽與交付。** 算圖輸出 MP4、靜態畫面和音訊，或以支援的交換格式交付可編輯的
  剪輯。Visual QA 與輸出報告會揭露結果的限制。
- **保留專案可攜性。** 重新連結搬移的來源、收集引用素材，並透過圖形介面、CLI
  或本機 API 使用同一套應用程式服務。

以上描述目前開發分支的能力。完整操作路徑請見[使用流程](docs/product-workflow.md)，
外部剪輯軟體的交付限制請見 [NLE 相容性指南](docs/nle-compatibility.md)。部分效果需要
先算圖合成，或在目的端軟體中手動重建。

## 專案狀態

| 版本／管道                                                         | 使用前須知                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [v0.4.0](https://github.com/bynanci/open-film/releases/tag/v0.4.0) | 最新公開的穩定**原始碼發行版**；實際包含的範圍請見該版發行說明。     |
| `main`                                                             | 持續朝 v1.0.0 開發，包含尚未納入公開發行版的變更。                   |
| 原生安裝程式                                                       | 尚未提供正式散布版本；執行環境封裝、簽章與乾淨機器驗證仍是發行條件。 |

[v1.0.0 就緒 roadmap](docs/roadmap/v1-readiness.md)列出剩餘剪輯工作、原生散布條件
與工作站驗證。實體裝置的播放、音訊、顯示與 NLE 測試，和自動化測試分別追蹤。

OpenFilm 目前面向單一使用者的本機工作站。本機 API 並非多使用者或對外公開的服務；
支援範圍請見[安全政策](SECURITY.zh-TW.md)。

## 從原始碼執行

### 環境需求

- Git
- Node.js **24.14.0 或更新版本**
- pnpm **11.11.0**，與 `package.json` 指定版本一致
- 可從 `PATH` 執行的 FFmpeg 與 FFprobe

瀏覽器開發工作區不需要 Rust。原生桌面 shell 的額外平台需求，請參閱
[桌面指南](apps/desktop/README.zh-TW.md)。

### 啟動開發工作區

```sh
git clone https://github.com/bynanci/open-film.git
cd open-film
pnpm install --frozen-lockfile
pnpm dev
```

在瀏覽器開啟 **[http://127.0.0.1:1420](http://127.0.0.1:1420)**。這個命令會在
`4310` 啟動本機應用程式服務，並在 `1420` 啟動工作區；使用期間請保持終端機執行。
建立影片、匯入少量素材後，依照 **Library → Story → Edit → Export** 開始操作。
按 `Ctrl+C` 可停止開發程序。

在儲存庫根目錄查看 CLI：

```sh
pnpm cli --help
```

上述 checkout 使用 `main`。若需要已發行的基準版本，請選用
[v0.4.0 原始碼發行版](https://github.com/bynanci/open-film/releases/tag/v0.4.0)，
並依照該版本的說明操作。從原始碼建置不代表已產生驗證完成的一般使用者安裝程式。

## 找到需要的文件

| 你想要……                   | 從這裡開始                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 製作第一部影片             | [快速開始](docs/getting-started.md)、[使用流程](docs/product-workflow.md)與[文件索引](docs/index.md)                      |
| 跑過可重現的範例           | 使用產生素材的[求婚影片參考流程](docs/reference-workflows/proposal-film.md)                                               |
| 搬移專案或交給其他剪輯軟體 | [媒體可攜性](docs/media-portability.md)、[Collect Media](docs/collect-media.md)與 [NLE 相容性](docs/nle-compatibility.md) |
| 了解產品方向               | [專案願景](docs/PROJECT_BRIEF.md)、[roadmap](ROADMAP.md)與[工作項目](TASKS.md)                                            |
| 參與實作                   | [架構](docs/architecture.md)、[專案格式](docs/project-format.md)與[整合契約](docs/CONTRACTS.md)                           |
| 查閱發行條件或研究         | [v1 就緒進度](docs/roadmap/v1-readiness.md)、[驗證紀錄索引](docs/index.md)與[研究索引](research/README.zh-TW.md)          |

使用指南提供繁體中文、英文與日文版本。技術參考與驗證紀錄主要以英文維護；
翻譯涵蓋範圍請見[語言政策](docs/i18n.md)。

## 貢獻與社群

<<<<<<< HEAD
歡迎回報問題、改善文件、補充翻譯、提供可重現的媒體案例，或提交程式碼。
環境設定、檢查命令與 pull request 流程請先閱讀[貢獻指南](CONTRIBUTING.zh-TW.md)。
較大的變更建議先開 discussion 或 issue，確認範圍及應由哪個既有元件負責。

- [提問或討論想法](https://github.com/bynanci/open-film/discussions)
- [回報問題或提出功能需求](https://github.com/bynanci/open-film/issues/new/choose)
- [取得支援](SUPPORT.zh-TW.md) · [行為準則](CODE_OF_CONDUCT.zh-TW.md)
- [私下回報安全問題](SECURITY.zh-TW.md)

歡迎使用繁體中文、英文或日文參與。回報請使用產生的測試素材，或你有權分享的媒體；
不要在公開 issue 附上私人媒體、專案資料庫、來源路徑、GPS 資料或憑證。

## 授權與選用服務

目前的本機功能皆可免費使用。OpenFilm 第一方原始碼採用 [Apache-2.0](LICENSE)，
允許在遵守條款的前提下商用、修改及再散布。標示義務與第三方授權請見
[NOTICE](NOTICE) 與[授權說明](docs/licensing.md)。

Apache-2.0 允許商業使用與分支開發。程式碼授權與官方品牌身分是不同的事項，請參閱
[品牌使用政策](TRADEMARKS.md)、[商業使用說明](COMMERCIAL.md)與
[專案治理](GOVERNANCE.md)。這些文件不修改 Apache-2.0 的授權條件。

選用的外部 AI 服務可能另外收費。使用自己的 API 金鑰設定 provider 時，用量費用
由該供應商計收，不包含在 OpenFilm 中；基本本機工作流程不需要這些服務。
你的媒體、字型、模型權重與其他第三方素材，仍各自遵循原有授權。
