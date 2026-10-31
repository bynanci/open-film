# 取得 OpenFilm 協助

[English](SUPPORT.md) · [繁體中文](SUPPORT.zh-TW.md) · [日本語](SUPPORT.ja.md)

先從[使用流程](docs/product-workflow.md)或[文件網站](https://bynanci.github.io/open-film/)開始。若說明不清楚或功能無法正常使用，歡迎以英文、繁體中文或日文提問。

## 選擇適合的管道

| 你需要的協助                     | 前往位置                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安裝設定、使用方式或功能支援範圍 | 搜尋[既有 issues](https://github.com/bynanci/open-film/issues)中的已知問題，或在 [Discussions](https://github.com/bynanci/open-film/discussions) 提問。 |
| 錯誤或與文件描述不同的行為       | 使用[錯誤回報表單](https://github.com/bynanci/open-film/issues/new?template=bug_report.yml)。                                                           |
| 新功能或流程改善                 | 使用[功能建議表單](https://github.com/bynanci/open-film/issues/new?template=feature_request.yml)，說明你想完成的工作。                                  |
| 安全漏洞                         | 依 [SECURITY.md](SECURITY.zh-TW.md) 指示回報，不要在公開 issue 貼漏洞細節。                                                                             |
| 社群行為問題                     | 依[行為準則](CODE_OF_CONDUCT.zh-TW.md)中的私人回報方式處理。                                                                                            |

不需要先找到原因才能提問。若已有類似 issue，可補充你的環境中不同的情況。

## 提供哪些資訊

簡短描述即可開始討論：

- 想做什麼、預期結果，以及實際發生的情況。
- 最少的重現步驟，並說明是否每次都會發生。
- Release tag 或 commit、作業系統，以及啟動方式：瀏覽器開發工作區、原生開發視窗、CLI 或安裝包候選版本。
- 有幫助的簡短錯誤訊息、去識別化的 log 片段或截圖。媒體相關問題可附已知的格式、codec、尺寸與長度。

不知道版本或媒體屬性時，直接註明即可。不需要附完整專案或私人影片。若使用原始碼 checkout，可執行 `git rev-parse --short HEAD` 查詢 commit。

## 版本與平台現況

目前最新公開版本 **v0.4.0** 是原始碼版本；`main` 為尚未發行的開發內容。尚未發布已簽署的 Windows/macOS 安裝包，手動產生的安裝包候選版本不等同穩定發行版。

`pnpm dev` 會啟動瀏覽器工作區與本機服務。原生視窗開發的額外需求請見[桌面版指南](apps/desktop/README.zh-TW.md)。尚待完成的平台工作請看[roadmap](ROADMAP.md)與[發行準備狀態](docs/roadmap/v1-readiness.md)；外部剪輯軟體的限制請看 [NLE 相容性指南](docs/nle-compatibility.md)。

## 只分享需要的資料

專案、logs、截圖與媒體 metadata 可能包含姓名、路徑、拍攝日期、GPS、逐字稿或憑證。公開張貼前請先移除。避免上傳專案資料庫或完整 logs；優先使用產生的測試素材，或你有權分享的最小範例。

若疑似發生資料遺失，繼續測試前請先保留原始媒體與專案。透過檔案系統複製專案前，請先關閉 OpenFilm，或使用支援 SQLite 的備份工具；詳見[專案處理說明](SECURITY.md#privacy-and-project-handling)。部分素材可能引用專案外的檔案，請同時保留並備份專案資料夾與這些來源。瀏覽器管理的副本與 Collect Media 套件可能包含媒體。

## 社群支援

OpenFilm 由社群維護，回覆取決於維護者與貢獻者的時間；目前不保證回覆時限，也沒有付費支援方案。清楚的重現步驟有助於調查。若自行找到解法，請補充到 issue，方便後續遇到相同問題的人查閱。

若想協助文件、問題重現或修正，請看[貢獻指南](CONTRIBUTING.zh-TW.md)。
