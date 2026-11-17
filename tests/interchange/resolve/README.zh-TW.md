# Resolve 準備測試素材與解析器檢查

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

`verify.py` 使用官方 OpenTimelineIO 0.18.1、FFprobe 與 FFmpeg。請透過 `scripts/verify-interchange.ts` 執行：它會產生程序化 CC0 素材及五個 OTIO 案例，執行官方讀取／寫入／再讀取，檢查實際檔案 URL、雜湊與邊界，並確認缺少來源時驗證會失敗。它也會解碼合成來源與 Renderer 實際輸出的 MP4／完整混音 WAV，檢查影音同步。此流程不會啟動或模擬 DaVinci Resolve。

```sh
OPENFILM_OTIO_PYTHON=/path/to/otio-venv/bin/python pnpm test:interchange --output /path/to/empty/bundle
```

輸出包含只有剪輯資訊、只有中繼資料的進階剪輯，以及非整數影格率案例，並附預期 manifest 和報告。進階效果需手動重建；慢動作案例會刻意顯示標示過的補白空隙。保留的來源是可解碼合成 PNG／MP4／WAV，檢查前後來源雜湊不變。

新增的兩個同步案例使用時鐘一致的純視訊 MP4 與雙聲道 48 kHz PCM WAV：來源第 30 格為白色閃光，同時開始一段 50 毫秒、1 kHz 音調。來源與輸出皆為 160×90、120 格（4 或 4.004 秒）。剪入與時間軸放置沿用既有 Composition、OTIO 匯出器、共用有理數時鐘、標準音訊樣本時間與 FFmpegRenderer。

| 案例              | 影格率     | 來源標記樣本 | 剪入／放置影格 | 輸出閃光影格 | 輸出音調樣本 |
| ----------------- | ---------- | ------------ | -------------- | ------------ | ------------ |
| `sync-30`         | 30/1       | 48000        | 12 / 24        | 42           | 67200        |
| `sync-fractional` | 30000/1001 | 48048        | 10 / 15        | 35           | 56056        |

Python 驗證器獨立宣告上述預期值，不從產生的中繼資料推導；它檢查官方 OTIO 兩次讀取、來源與輸出的每一格、完整雙聲道 PCM 混音、標記起訖與完整樣本數。非整數影格率以絕對有理數位置換算，所選端點皆為整數樣本；若每格各自將 1601.6 樣本四捨五入會累積誤差。實際觀測值寫入 `sync-evidence.json`。PCM 與畫面斷言的樣本／影格不確定度為零。MP4 AAC 另行觀測，起訖容許 ±1024 樣本：這是 AAC LC 的一個轉換影格，用於涵蓋有損編碼在 0.01 振幅偵測門檻附近的前回音／振鈴；不適用於 PCM。

在將這些檔案當作 Resolve 匯入檢查清單前，請閱讀[NLE 相容性與手動 QA](../../../docs/nle-compatibility.md)。此腳本通過表示解析器、來源參照及合成素材的 Renderer 同步檢查成功；Resolve 實際匯入與播放仍未驗證。
