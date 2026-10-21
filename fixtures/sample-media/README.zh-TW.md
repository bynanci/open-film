# 產生的範例素材

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

從 repo 根目錄執行 `node fixtures/sample-media/generate.mjs /tmp/openfilm-samples`。FFmpeg 會建立兩張幾何圖片、一張完全相同的圖片複本、一段 3 秒含合成聲音的動態測試圖樣，以及一段 2 秒音調。不使用個人素材或下載內容。產生素材依 CC0 1.0 公共領域授權；產生器採 Apache-2.0，並保留歷史授權。請參閱 [授權說明](../../docs/licensing.md)。

測試會在暫存資料夾產生素材，並實際執行 FFprobe、FFmpeg 與 SQLite。原始素材保留在專案目錄之外；專案快取只放縮圖、影片代理檔與預覽。若有安裝 ExifTool，會用於補充中繼資料；否則使用 FFprobe 與檔案系統時間戳作為離線備援。

_OpenFilm 貢獻者於 2026-10-18 修改。現行第一方內容採 Apache-2.0；歷史授權仍可查閱。詳見 LICENSE 與 NOTICE。_
