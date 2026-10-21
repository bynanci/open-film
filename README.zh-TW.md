# OpenFilm

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

OpenFilm 是一款開源、以故事為核心、優先在本機執行的媒體編輯工具。它能把本機照片、影片與音訊整理成回憶、故事與可編輯影片，不會修改原始檔案。

## 功能概要

OpenFilm 以 Vue 桌面工作區、CLI、本機 Node 服務與 SQLite 專案資料庫組成，不需要雲端帳號或 AI 服務。介面支援繁體中文、英文與日文；影片語言與介面語言彼此獨立。

工作流程涵蓋素材匯入、媒體整理、故事規劃、時間軸剪輯、預覽及輸出。可剪輯照片與影片、調整速度和音量、加入音樂／旁白／字幕、保存命名版本，並在素材移動後重新連結。輸出包括 MP4，以及適用情況下的 JSON、OpenTimelineIO、FCPXML、EDL、PNG、WAV 與音軌分軌。

程式會保留素材來源與專案資料，對轉錄、遠端語言服務、素材重新連結及相容性驗證提供明確的狀態或限制說明。原始媒體不會被改寫。

## 開始使用

需要 Node.js 24.14.0 以上、pnpm 11.11.0、FFmpeg 與 FFprobe。安裝相依套件後即可在本機執行基本素材工作流程：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

CLI 範例與完整功能、相容性及驗證細節請參閱[英文版 README](README.md)。文件網站提供[繁體中文](https://bynanci.github.io/open-film/)、[English](https://bynanci.github.io/open-film/en/) 與[日本語](https://bynanci.github.io/open-film/ja/)內容。
