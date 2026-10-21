# MP4 壓縮品質

「輸出」會顯示影片實際儲存的寬度、高度和影格率。新專案預設為 1920 × 1080、30 fps；既有專案會保留自己的影格設定。預覽構圖輔助線不會改變輸出尺寸。MP4 算圖會讀取匯入的原始來源，與剪輯代理檔無關。

在「輸出」中選擇 **MP4 品質**：

| 選項 | H.264 編碼器 | 預設值 | CRF |
| --- | --- | --- | ---: |
| 標準（預設） | libx264 | veryfast | 23 |
| 高細節 | libx264 | medium | 18 |

高細節會降低影片壓縮。輸出時間較長，檔案通常也較大。它無法恢復來源中不存在的細節、還原先前的照片放大、加入 HDR 母帶處理，也不會變更 Composition 畫格。輸出後不會再進行放大處理。

此選項是算圖預覽與 MP4 輸出共用的輸出快照。變更選項會讓既有算圖結果標記為過期。開始輸出時會擷取所選品質；工作進行中不能透過選擇器變更。切換專案／Composition 或重新啟動時，選項會重設為標準。它不會儲存在專案、時間軸記錄或可編輯 NLE 輸出中。既有的影片／場景／片段外觀設定、修剪、時長、標題幾何位置和音樂軌都不變。音訊仍沿用既有 AAC／48 kHz 算圖流程；這是影片壓縮控制，不是無損音訊輸出。

## 無介面操作

```bash
pnpm cli render --project /path/film.openfilm --quality high-detail
pnpm cli export --project /path/film.openfilm --format mp4 --quality high-detail
```

省略 `--quality` 會使用標準品質。未知值或在可編輯輸出上使用品質旗標，都會驗證失敗。應用程式的 `FilmRenderOptions`、HTTP `/api/render` 和 MP4 `/api/export` 都接受相同的選用 `quality` 欄位。HTTP 會在保留工作之前先驗證，只接受 `standard` 或 `high-detail`；不接受任意編碼器、CRF 值或 FFmpeg 引數。

私有的 `.mp4.manifest.json` 會記錄設定檔、實際編碼器、預設值、CRF、已儲存畫格、來源身分和輸出雜湊。比較算圖結果時請檢查此檔案。設定檔是既有 version-1 manifest 的附加證據。

## 驗證範圍

產生的測試會讀取 x264 實際編碼的 SEI 和 manifest、比較兩個設定檔解碼後的音訊，並驗證 Full HD／小數影格率輸出。這些結果證明軟體契約，不代表私有影片的主觀品質主張或工作站效能基準。真實相機／HDR、顯示器、投影機、原生安裝程式和 Resolve 檢查仍是手動關卡。現有的照片動態轉接器仍可能先重新取樣照片再放大；此壓縮選項不會宣稱解決那項獨立的取樣限制。

參閱[已執行驗證](validation-export-quality.md)。