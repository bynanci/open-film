# 產生的 Proposal Film 參考素材庫

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

```sh
node fixtures/proposal-film/generate.mjs /tmp/openfilm-proposal-reference
```

產生器使用 FFmpeg 與 repo 內的 Perl ExifTool 套件，建立可重複使用的 CC0 幾何照片、測試圖樣影片及合成音訊。一般 Proposal Film 流程請匯入產生的 `media/` 目錄；二進位素材不會提交至 repo。

`media/` 含十項素材：風景、相似畫面、位元完全相同的複本、人像、缺少拍攝中繼資料的 PNG、模擬 Google Pixel 的人像與 MP4、模擬 Insta360 的平面 JPG／MP4 匯出，以及 8 秒音訊。Pixel JPEG 含真正 EXIF 欄位（相機、拍攝時間、時區、方向、合成 GPS 座標）及實驗性 Motion Photo 標籤。裝置名稱表示模擬的中繼資料，不代表像素的實際來源。

`raw/` 有五個可選介接器測試素材：辨識用 `.insv`、`.insp`、只有中繼資料的 DNG，以及有標籤的 Pixel 照片／影片 sidecar 配對。測試不支援來源時請另外匯入此目錄。360 素材是使用原始副檔名的一般 MP4／JPEG 容器；DNG 是含真實 DNG／EXIF 標籤但沒有影像條帶的最小 TIFF 結構。它們只驗證辨識、中繼資料保留與明確的預覽限制。真實相機拼接、RAW 去馬賽克及光學外觀需以相機原檔另行手動確認。

`manifest.json` 記錄相對路徑、預期中繼資料、內容雜湊、位元組數、合成素材來源及 CC0 授權。編輯、渲染、搬移及重新連結專案後，可用雜湊確認原始位元組未變。

```js
import { generateProposalMedia } from "./fixtures/proposal-film/generate.mjs";

const fixture = await generateProposalMedia("/tmp/reference", {
  includeRaw: true, // 預設 true；false 只產生一般素材
});
// fixture.mediaDirectory, fixture.rawDirectory, fixture.manifestPath
// fixture.byId["pixel-photo"], fixture.byId["insta360-video"]
// fixture.files: id, path, kind, expected, synthetic, sha256, bytes
```

建議練習：從開場風景開始，排除完全相同的複本、比較相似畫面、修剪兩段影片、中段放入人像，最後使用 Insta360 平面匯出。接著搬移素材與專案目錄、重新開啟並重新連結，同時保留評分與剪輯。沒有中繼資料的 PNG 可測試檔案系統時間戳回退；音樂由兩個正弦波組成，並非錄音演奏。
