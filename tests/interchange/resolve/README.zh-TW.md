# Resolve 準備測試素材與解析器檢查

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

`verify.py` 使用官方 OpenTimelineIO 0.18.1 與 FFprobe。請透過 `scripts/verify-interchange.ts` 執行：它會產生程序化 CC0 素材及三個 OTIO 案例，執行官方讀取／寫入／再讀取，檢查實際檔案 URL、雜湊與邊界，並確認缺少來源時驗證會失敗。此流程不會啟動或模擬 DaVinci Resolve。

```sh
OPENFILM_OTIO_PYTHON=/path/to/otio-venv/bin/python pnpm test:interchange --output /path/to/empty/bundle
```

輸出包含只有剪輯資訊、只有中繼資料的進階剪輯，以及非整數影格率案例，並附預期 manifest 和報告。進階效果需手動重建；慢動作案例會刻意顯示標示過的補白空隙。保留的來源是可解碼合成 PNG／MP4／WAV，檢查前後來源雜湊不變。

在將這些檔案當作 Resolve 匯入檢查清單前，請閱讀[NLE 相容性與手動 QA](../../../docs/nle-compatibility.md)。此腳本通過只表示解析器和來源參照檢查成功，不表示已在 Resolve 實際匯入。
