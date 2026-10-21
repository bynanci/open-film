# Insta360 素材來源介接器

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

`@openfilm/source-insta360` 實作既有的本機 `MediaSourceAdapter` 介面，並提供 `isInsta360Raw`、`inspectInsta360Raw`、`enrichInsta360Asset`。不會修改來源檔案。

- **第 1 級：**依 Insta360／Arashi Vision 相機或應用程式中繼資料，或明確的原始檔參照，辨識已檢查的平面 JPG／MP4 匯出。保留已解碼尺寸、時間、GPS、編碼、色彩及原始中繼資料。單憑檔名含「Insta360」不足以辨識。
- **第 2 級：**`.insv`、`.insp` 保留為素材目錄項目，並在可用時讀取真實 ExifTool 中繼資料與受限的 FFprobe 中繼資料。`.insv` 類型為 `360-video`，`.insp` 為 `image`；兩者都標示 `openfilm.preview.supported: false`，並提示從 Insta360 Studio 匯入已拼接、重新取景的平面匯出。損壞或不支援的內容仍保留來源識別與警告，不會把 raw 影格當作平面預覽。
- 若平面容器帶有明確 EXIF 球面／等距柱狀投影標籤或 FFprobe Spherical Mapping 側資訊，也必須先重新取景。僅靠長寬比不能判定球面投影。
- **第 3 級：**拼接、穩定、重新取景及實機光學驗證尚未支援。

`metadata["openfilm.insta360"]` 記錄等級、原始 360 來源、是否需要重新取景及證據。原始來源關聯會標註 `explicit-metadata` 或 `named-sibling`、URI、證據和可用狀態。檔名相鄰只能提供關聯線索，不能證明內容相同、光學正確或正式支援。符號連結會排除；來源掃描最多檢查排序後的 10,000 個項目。

應用程式匯入會共用一次匯入生命週期的 `Insta360ImportContext`，每個資料夾只掃描／排序一次；獨立匯入會建立新的索引以發現新複製的檔案。測試使用可解碼合成素材及合成 raw 辨識案例。真實 Insta360 相機素材和 Studio 輸出仍須手動相容性檢查。
