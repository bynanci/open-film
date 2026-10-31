# 參與 OpenFilm

[English](CONTRIBUTING.md) · [繁體中文](CONTRIBUTING.zh-TW.md) · [日本語](CONTRIBUTING.ja.md)

OpenFilm 歡迎缺陷修正、測試、文件、可重用故事模板與 adapter。請讓變更聚焦於使用者問題，說明行為差異，並提供審查者可重現的佐證。

## 提案與提交變更

- 大型功能請先開 issue，討論範圍、使用情境和限制；小型且範圍明確的修正可直接送 pull request。
- 請在分支或 fork 上工作，並向 main 開 pull request。每個 PR 應便於審查，並說明相容性、專案資料或遷移影響。
- 使用 repository 的 pull request 範本，列出實際執行的檢查和結果，並指出未執行的平台或人工 gate。
- 沒有可重現證據時，不要宣稱效能、創作品質或外部剪輯軟體相容性。

## 開發流程

需要 Node.js 24.14.0 或更新版本、pnpm 11.11.0、FFmpeg 和 FFprobe。Perl 或系統版 ExifTool 可改善 metadata 擷取。依照 [README](README.zh-TW.md) 設定環境；使用 pnpm frozen lockfile 安裝可重現的相依套件。

依變更內容執行相關檢查：

    pnpm lint
    pnpm format:check
    pnpm typecheck
    pnpm test
    pnpm build

UI 變更請在安裝 Playwright Chromium 後執行瀏覽器測試。Rust 變更請在 apps/desktop/src-tauri 執行 cargo fmt、開啟 warnings-denied 的 clippy，以及 cargo test；這些檢查需要原生平台相依套件。Exporter 變更應包含 OpenTimelineIO interchange 檢查。文件變更請確認本機連結有效；修改 README 或多語指南時，也請執行 pnpm test:docs-i18n。

PR 描述請列出實際命令、環境和簡要結果，並區分自動化佐證與尚未完成的實體裝置、私人媒體、硬體、NLE 或編輯品質檢視。

## 設計界線

- Core model 與演算法應獨立於 Vue、Tauri、Node、filesystem、SQLite 和媒體執行檔；runtime 整合放在 adapter。
- 引用原始媒體並保存剪輯操作。不得覆寫來源媒體或在輸出時默默丟棄編輯。
- 驗證公開 project/schema 變更、記錄遷移，並拒絕未知版本，不要自行猜測。
- 保留時間戳信心度、來源資訊和時區不確定性。
- 遠端 provider 必須由使用者明確、限範圍啟用；基本流程維持本機執行。
- 限制匯入工作量、分頁讀取 catalog、顯示清楚的工作狀態並提供可採取行動的錯誤訊息。

請參閱[架構](docs/architecture.md)與[整合契約](docs/CONTRACTS.md)。重要架構變更請在 docs/adr/ 新增 ADR，記錄背景、決策、後果及需要的驗證。

## 文件與驗證證據

依照[文件分類索引](docs/index.md)選擇文件位置。使用指南放在相應工作流程中；架構決策放在 docs/adr/；發行說明放在 docs/releases/；產品研究放在 research/；有日期的驗證證據保留在既有 validation 記錄。文件網站會分類顯示這些紀錄，不搬動來源檔，因此既有連結可維持穩定。

App 與文件的正式語系為英文、繁體中文和日文。README 與主要使用指南請同步維護這三種語言。詳細契約和驗證證據目前以英文為主；翻譯可提供摘要並連回原始紀錄，但必須保留命令、識別碼、量測值、commit 和測試結果。詳見[語言政策](docs/i18n.md)。

驗證紀錄只描述當次執行。請保留該次 commit、OS/工具版本、命令、結果、失敗項目和人工 gate。新增後續結果時，建立新的日期條目或紀錄；目前狀態則更新 ROADMAP.md 和 TASKS.md，不要改寫舊證據。請移除私人路徑、憑證、GPS 和不可公開的媒體。

## 測試與 fixtures

行為變更請加入能在回歸時失敗的集中測試。套件領域測試放在所屬 package；媒體/application 整合測試請用暫存目錄和 fixtures/sample-media/ 產生的媒體。瀏覽器測試使用真實本機服務。若修改匯入或渲染，請比對原始檔案 hash。

請勿提交個人照片、人臉、逐字稿、GPS 軌跡、憑證或私人 .openfilm 專案。請使用產生的 fixtures，或授權允許重新散布的媒體，並附上必要署名與授權資訊。

## 行為準則、安全與授權

請遵守[行為準則](CODE_OF_CONDUCT.md)。漏洞請依 [SECURITY.md](SECURITY.md) 私下回報，不要放在公開 issue。產品問題請參閱 [SUPPORT.md](SUPPORT.zh-TW.md)，缺陷與功能建議請使用 issue 表單。

除非另有說明，提交納入本專案的貢獻均採 Apache-2.0。請確認你有權提交程式碼和媒體。標示第三方材料並保留其授權與署名；貢獻不會移轉著作權。詳見[授權說明](docs/licensing.md)、LICENSE 與 NOTICE。

## 貢獻來源聲明與 DCO

此政策採用後首次提交的貢獻，其每個新 commit 都必須由貢獻者本人以
`git commit -s` 加入 DCO 1.1 簽署聲明。提交前請先閱讀
[DCO.md](DCO.md)。這是對貢獻來源及授權權限的聲明，不代表移轉著作權，
也不提供專屬商業再授權的權利。

使用第三方或 AI 輔助程式碼前，應確認來源、使用權及必要聲明；
若涉及雇主持有權利的程式碼，需先取得適當授權。詳見
[GOVERNANCE.md](GOVERNANCE.md)。
