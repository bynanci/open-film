# OpenFilm 桌面版

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

桌面工作區使用本機應用程式服務，預設位於 `127.0.0.1:4310)。不會要求上傳素材，也不會載入遠端字型、媒體或模型。從 repo 根目錄執行 `pnpm dev` 可啟動開發環境；建置前端請執行 `pnpm --filter @openfilm/desktop build`。

## 建立影片與語言

Welcome 頁面可建立影片、開啟專案或查看最近使用的影片。建立時可設定故事類型、影片語言與目標／最長時長。介面支援繁體中文、英文與日文，切換不會重新載入編輯器；影片語言、使用者自訂文字與介面偏好互相獨立。

## 剪輯與逐字稿

Edit 工作區提供 Story 與 Precision 模式。可修剪片段、設定照片時長、速度、音量、轉場和畫面位置；也能產生波形／場景切點、加入標記、吸附修剪位置及分割片段。Edit → Transcript 可修正逐字稿、搜尋取代、合併／分割段落並使用獨立復原紀錄。

變更會自動儲存。遇到儲存衝突或離線素材時，草稿仍可保留供復原；重新連結會顯示素材比對依據，不會自行刪除評分、選取狀態或剪輯效果。原始素材不會被修改。

## 原生桌面與匯出

Tauri 桌面殼可提供原生檔案／資料夾選擇器。安裝平台相依元件後，可執行：

```sh
pnpm --filter @openfilm/desktop tauri dev
```

匯出包含 MP4 與相容性報告；可依支援情況另存字幕或 OpenTimelineIO 等交接格式。OTIO 中的進階效果可能需要在目標剪輯軟體內手動重建，實際匯入仍須人工驗證。

更多完整操作與平台限制請參閱[英文版桌面指南](README.md)，以及[產品流程](../../docs/product-workflow.md)、[轉錄設定](../../docs/transcription.md)與[NLE 相容性](../../docs/nle-compatibility.md)。
