# Google Pixel 素材來源介接器

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

`PixelSource` 實作既有本機媒體來源介面。`enrichPixelAsset` 會依 EXIF／QuickTime 中的 Google 品牌和 Pixel 相機型號辨識素材；單靠檔名或 Google Photos 軟體標籤仍會保留為 `GenericCamera`。介接器會保留原始 EXIF／FFprobe 擴充欄位、ID、雜湊、評分與鎖定狀態。日期時區、方向、GPS、相機、尺寸、編碼、影格率、色彩與 HDR 證據會留在來源中繼資料及 `openfilm.pixel.evidence`。

Motion Photo 偵測僅屬實驗功能。可限制範圍的正影片位移量或 ExifTool 內嵌影片欄位會標記為 `embedded`；標籤與同目錄一般影片相符時標為 `sidecar`；找不到對應檔時標為 `metadata-reference`。位移量證據不代表已驗證 MP4 擷取；檔名相鄰也不代表內容相符。介接器不會修改原檔、擷取內嵌影片、組裝動態播放或宣稱正式支援。參照的 sidecar 必須位於來源同一目錄，符號連結會忽略。

`inspectPixelDng` 會先嘗試一般檢查及單格解碼。如果安裝工具無法解碼，仍可將具有真實 ExifTool DNG 中繼資料的檔案納入目錄，並標示 `openfilm.preview.supported: false` 及 RAW 匯出建議。缺少 DNG 中繼資料的損壞檔仍會失敗。合成中繼資料測試只證明目錄可保留資料，不代表真實 Pixel RAW 去馬賽克、光學結果或 HDR 外觀；這些仍須手動檢查。
