# 參與 OpenFilm

[English](CONTRIBUTING.md) · [繁體中文](CONTRIBUTING.zh-TW.md) · [日本語](CONTRIBUTING.ja.md)

改善指南、翻譯介面、重現問題或修改程式碼，都能幫助 OpenFilm。好的貢獻會說明要解決的問題，並讓其他人能檢查結果。

## 從適合你的地方開始

- **第一次參與：**試跑[原始碼設定流程](README.zh-TW.md)、修正不清楚的操作說明，或用產生的測試素材重現既有 issue。
- **文件與翻譯：**改善一篇指南或幾則介面訊息；若相關翻譯仍需要協助，請在 PR 中註明。
- **錯誤修正：**描述錯誤行為，讓修改聚焦；若測試能呈現問題，請加入回歸測試。
- **新功能或架構調整：**大幅實作前，先開[功能建議](https://github.com/bynanci/open-film/issues/new?template=feature_request.yml)，討論使用者需求與範圍。

小型修正可以直接送 pull request。使用問題請看[支援方式](SUPPORT.zh-TW.md)；安全漏洞請依[安全政策](SECURITY.zh-TW.md)回報，不要使用公開錯誤回報。

## 準備開發環境

應用程式使用 Node.js **24.14.0 或更新版本**、pnpm **11.11.0**。執行媒體流程還需要 FFmpeg 和 FFprobe；Perl 或系統版 ExifTool 可改善 metadata 擷取。

在 repository 根目錄執行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 會啟動本機服務與瀏覽器工作區，不會開啟原生 Tauri 視窗或產生安裝包。原生開發另需 Rust 與平台相依套件，請依[桌面版指南](apps/desktop/README.zh-TW.md)設定。

目前最新公開版本 **v0.4.0** 是原始碼版本。`main` 包含尚未發行的開發內容，尚未發布已簽署的 Windows/macOS 安裝包。回報結果時請指出測試的 tag 或 commit；安裝包候選產物不等同正式發行的安裝包。

### 只修改文件

改善文件不需要 FFmpeg、Rust 或私人媒體。文件網站使用獨立的 npm lockfile，請在 repository 根目錄執行：

```sh
npm --prefix docs ci
npm --prefix docs run build
pnpm test:docs-i18n
```

前兩個命令等同於在 `docs/` 中執行 `npm ci` 與 `npm run build`。請勿用 pnpm lockfile 取代 `docs/package-lock.json`。若只安裝了 Node 與 npm，可執行 `node scripts/check-doc-locales.mjs`，效果與 `pnpm test:docs-i18n` 相同。

## 檢查你修改的部分

選擇能驗證此次變更的檢查。純文件 PR 不需要在本機重跑媒體、原生平台或外部剪輯軟體 QA；CI 會獨立執行 repository 要求的檢查。

| 變更類型                  | 建議的本機檢查                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository 文件或翻譯     | 確認連結與各語言對應頁，執行 `pnpm test:docs-i18n`。若修改網站內容、連結、導覽或設定，再建置文件網站。                                                              |
| 介面翻譯                  | 執行 `pnpm test:i18n`，檢查受影響畫面的換行與缺漏訊息。                                                                                                             |
| TypeScript 邏輯或本機服務 | 執行 `pnpm lint`、`pnpm typecheck` 與相關 Vitest 測試。共用契約或 schema 變更加跑 `pnpm test:contracts`。                                                           |
| UI 行為                   | 執行上述程式檢查與相關 Playwright spec，檢查鍵盤操作及改動的版面。                                                                                                  |
| 媒體、匯入或渲染          | 執行受影響的整合測試；變更橫跨媒體流程時執行 `pnpm test:media`。涉及來源檔案操作時，確認原檔未被修改。                                                              |
| 輸出或交換格式            | 執行 exporter 回歸測試；交換格式行為改變時執行 `pnpm test:interchange`。Python/OpenTimelineIO 需求見[交換格式測試設定](tests/interchange/resolve/README.zh-TW.md)。 |
| Rust 或原生視窗           | 安裝平台相依套件後執行 `pnpm test:native`，再於該平台檢查受影響的原生行為。                                                                                         |
| 建置或相依套件設定        | 執行相關檢查與 `pnpm build`；若平台或工具版本影響結果，也請註明。                                                                                                   |

例如，以下命令分別執行單一領域測試與瀏覽器測試：

```sh
pnpm exec vitest run packages/core/tests/timebase.test.ts
pnpm exec playwright install chromium
pnpm test:e2e tests/e2e/editing.spec.ts
```

請換成與此次修改相關的測試檔。瀏覽器測試需要媒體工具，且會自行啟動本機服務；請先停止既有的 `pnpm dev`。Linux 上的 Playwright 可能還需要系統瀏覽器相依套件。

安裝根目錄相依套件後，可用 `pnpm exec prettier --check <files>` 檢查修改檔案的格式；`pnpm format:check` 會檢查整個 repository。較廣泛的程式變更可執行完整的 `pnpm lint`、`pnpm typecheck`、`pnpm test` 與 `pnpm build`。

請列出實際執行的命令與結果。若相關檢查需要你沒有的硬體或軟體，在 PR 中說明即可。Parser 測試、瀏覽器測試或 Linux 建置通過，並不能代表已驗證真實 Resolve 匯入、原生安裝包行為或相機格式相容性。

## 提交 pull request

1. 在 fork 或分支上工作，向 `main` 提交 PR。
2. 說明問題、修改後的行為與影響範圍；若有相關 issue，附上連結。
3. 列出相關檢查與結果。UI 變更可附截圖或短錄影，請使用可公開的測試素材。
4. 說明專案格式變動、遷移需求或已知限制，並列出更新的文件與翻譯。

每個 PR 保持便於審查的範圍。尚在實作時可以先開 draft，也可以尋求測試或翻譯協助，不需要先完成無關的平台驗證。

## 開發界線

- 領域模型與演算法應獨立於 Vue、Tauri、Node、檔案系統存取、SQLite 和媒體執行檔；執行環境整合放在 adapter。
- 引用原始媒體並保存剪輯操作；不得覆寫來源或默默丟棄編輯。
- 驗證專案與 schema 版本、記錄遷移，並清楚拒絕不支援的版本。
- 保留時間戳的來源、信心度與時區不確定性。
- 基本流程維持本機執行；遠端 provider 需要使用者針對資料與操作明確同意。
- 限制匯入工作量、分頁讀取 catalog，並讓工作狀態與復原操作容易理解。

請參閱[架構](docs/architecture.md)與[整合契約](docs/CONTRACTS.md)。重要設計變更請在 `docs/adr/` 新增簡短 ADR，說明背景、決策與影響。

## 文件與測試素材

依照[文件分類索引](docs/index.md)選擇位置。使用指南說明操作流程；`docs/adr/` 記錄設計決策；`docs/releases/` 記錄發行內容；`research/` 收錄產品研究。

主要指南與 repository 手冊請維持英文、繁體中文、日文對齊。每份 `README.md` 都有同目錄的 `README.zh-TW.md` 與 `README.ja.md`。`docs/` 下的參考紀錄在 `docs/en/` 也有英文鏡像；語系檢查要求同步時，請一起更新。翻譯需保留命令、識別碼、量測值與佐證連結。詳見[語言政策](docs/i18n.md)。

有日期的驗證紀錄描述特定一次執行。後續結果以新日期條目新增，不改寫舊結果；目前狀態放在 roadmap。只記錄足以支持結論的環境與佐證。

請使用[範例媒體](fixtures/sample-media/README.zh-TW.md)產生的 fixtures，或授權允許重新散布的媒體。勿提交個人影片、私人專案、逐字稿、GPS 軌跡或憑證；logs 與截圖應遮蔽姓名及私人路徑。新增第三方媒體、字型、模型或程式碼時，附上必要署名。

## 行為準則與授權

請遵守[行為準則](CODE_OF_CONDUCT.zh-TW.md)。除非另有說明，提交納入本專案的貢獻均採 [Apache-2.0](LICENSE)，你仍保有著作權。請確認有權提交程式碼與材料，並保留第三方授權及署名。詳見 [LICENSE](LICENSE)、[NOTICE](NOTICE) 與[授權指南](docs/licensing.md)。

## 貢獻來源聲明與 DCO

此政策採用後首次提交的貢獻，其每個新 commit 都必須由貢獻者本人以 `git commit -s` 加入 DCO 1.1 簽署聲明。提交前請先閱讀 [DCO.md](DCO.md)。這是對貢獻來源及授權權限的聲明，不代表移轉著作權，也不提供專屬商業再授權的權利。

使用第三方或 AI 輔助程式碼前，應確認來源、使用權及必要聲明；若涉及雇主持有權利的程式碼，需先取得適當授權。詳見 [GOVERNANCE.md](GOVERNANCE.md)。
