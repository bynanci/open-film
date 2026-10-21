# OpenFilm 專案格式

.openfilm 專案是一個資料夾。專案 schema 1.0.0 與 OpenFilm 應用程式版本 0.1.0 各自獨立。專案以本機 file URI 參照來源媒體。原生檔案／資料夾匯入會直接參照原檔；瀏覽器選取檔案時，因瀏覽器不會提供原始本機路徑，所選位元組會複製到專案管理的 sources/。兩種匯入方式都不會修改原檔。

機器可讀契約已發布於 [專案 schema](https://github.com/bynanci/open-film/blob/main/schemas/openfilm-project-1.0.0.schema.json)、[媒體資產 schema](https://github.com/bynanci/open-film/blob/main/schemas/media-asset-1.0.0.schema.json) 和 [外掛 manifest schema](https://github.com/bynanci/open-film/blob/main/schemas/plugin-manifest-1.schema.json)。

```text
film.openfilm/
  project.json
  database.sqlite
  story/                  保留給未來獨立的故事文件
  timeline/               保留給未來獨立的剪輯文件
  analysis/
    events.json
    duplicates.json
  sources/                瀏覽器副本或以雜湊命名的收集媒體
  fonts/                  可攜式套件中的雜湊字型
  collect-manifest.json   僅含套件雜湊、範圍和權利回條
  versions/               不可變的具名專案快照和私人索引
    index.json            僅含可變標籤和冪等回條
    <version-id>/
      project.json        已儲存的 schema 1.0.0 manifest 影像
      database.sqlite     SQLite 一致性的素材目錄影像
      record.json         不可變版本識別和來源雜湊
  cache/
    thumbnails/
    proxies/
    preview.mp4
    export-preview/       短期私人設定檔影格 PNG 快取
    export-work/          私人暫存的 MP4／PNG／WAV 算繪工作
  exports/
    timeline.json | timeline.otio | timeline.fcpxml | timeline.edl
    timeline.<format>.report.json
    film-<unique-id>.mp4  已完成、可播放的影片輸出
    still-<request-id>.png + manifest
    mix-<request-id>.wav + manifest
    stems-<request-id>/   對齊的角色 WAV 和 manifest
```

SQLite 可能同時使用 database.sqlite-wal 和 database.sqlite-shm。分析、快取、輸出檔會在執行相關工作時出現。目前 Story 和時間軸都儲存在 project.json；建立預留資料夾不代表其中已存在獨立的標準文件。

設定檔輸出是衍生檔案。版本化的輸出設定檔與回條會記錄輸出尺寸、影格／時間或取樣測量、來源雜湊和警告，不會變更 Composition／專案設定或專案 schema 1.0.0。請見[輸出設定檔](/export-profiles)。私人預覽會到期並可重新產生；已輸出的圖片和 WAV 會留在 exports/，直到使用者移除。

## Manifest 與素材目錄

project.json 含有 schemaVersion、id、title、ISO 格式的 createdAt／updatedAt、mediaLibraries、stories、timelines 和 settings。每個素材庫都有 ID、URI 與顯示名稱。設定含寬度、高度和影格率；新專案預設為 1920 × 1080、30 fps。Story 會參照候選／已選媒體 ID；Composition 則包含參照素材目錄媒體 ID 的軌道和片段。

Composition 也可額外包含 graphicScenes；場景可以帶有綁定至根 Image 節點的 PhotoDepth v1 配方。來源、alpha 遮罩和可選背景仍是具有內容雜湊的一般本機素材目錄資產。這項可選擴充不變更專案 schema 1.0.0：沒有場景或 PhotoDepth 的舊專案不需遷移，衍生圖像位元組也不會內嵌到 project.json。

可選的 projectContentLocale（en-US、zh-TW、ja-JP）和 filmSettings（templateId、targetDuration、maxDuration）會描述新影片的預設值，不會自行建立故事；Story 仍可設定個別覆寫。範本段落可選擇包含 templateBeatKey、titleSource 和 intentSource；只有明確標為範本擁有的欄位會隨影片語言更新。沒有來源標記的既有文字會原樣保留。這些新增欄位維持 schema 1.0.0，不需要素材目錄遷移。介面語言與主題是專案以外的本機偏好。

manifest 通過驗證後才會以暫存檔原子替換。素材目錄使用 SQLite schema PRAGMA user_version=2、WAL 模式、供清單查詢的索引欄位，以及可擴充資產資料的 JSON 描述。版本 1 會以原子方式新增逐字稿修訂／片段表、衍生分析快取和來源綁定手動標記，遷移至版本 2。既有資產／工作描述會保留；遷移失敗會回復。大型逐字稿使用有界分段頁面，文字保存在各段旁。Manifest schema 維持 1.0.0。使用者偏好補丁可變更評分／狀態／標籤，同時保留來源描述。未來的素材目錄 schema 版本會被拒絕。請透過 ProjectCatalog 存取資料，以維持 schema 不變條件；避免直接執行任意 SQL 變更。

複製專案資料夾作為檔案備份前，請先關閉應用程式；若要備份正在使用的素材目錄，請使用理解 SQLite 的備份工具。來源媒體需另行備份。只有 manifest 無法保留素材目錄偏好，也無法讓遺失的原始檔重新可用。

工作記錄沿用舊的 URI／階段／訊息診斷，也可儲存穩定錯誤 code、字串／數字 params 和供本機化復原訊息使用的 detail。

## 媒體描述與編輯

資產含 ID、URI、名稱、類型、標籤、狀態、可擴充的命名空間中繼資料，以及可選技術／拍攝／雜湊／快取資訊。拍攝時間解析結果保存在 metadata["openfilm.timestamp"]，包含原始值、來源、信心度、時區及時區不確定性。沒有時區的拍攝資訊會表示為信心度較低的牆上時鐘 UTC，而不是已證實的 UTC。

額外中繼資料應使用命名空間，例如 openfilm.audio.transcript，以避免外掛衝突。縮圖和代理檔是衍生快取，不會取代原始資產 URI。外部檔案變更後重新匯入時，系統會重新計算雜湊／檢查媒體，但保留既有素材 ID 和偏好。最初由來源 URI 推導的 ID 在重新連結後仍穩定。若舊來源路徑已被另一個重新連結資產使用，再放入不同檔案會建立不同身分。

sourceIn、sourceOut、timelineStart、timelineDuration 和 Story 片長都以秒為單位。變形、音量／速度、標題和轉場描述的是操作，不會修改來源。素材目錄、段落候選／選取和時間軸片段中的 ID 必須一致。可選的 Clip.locked 會保存片段保護狀態，仍維持 schema 1.0.0。手動編輯可能超出 Story 最長片長；算繪前必須先縮短時間軸。復原／重做歷程只屬於目前開啟的編輯工作階段，不會永久保存。

## 可攜式來源參照與快取

目前資產 URI 是絕對本機 file URI。應用程式、HTTP API 和桌面版皆提供重新連結。可攜來源資訊使用既有 metadata["openfilm.reference"] 擴充欄位：

- originalUri：最初匯入位置，重新連結後仍保留。
- contentHash 和 fileSize：可選 SHA-256 身分和位元組大小。
- filename、mediaLibraryId、relativePath：來源名稱和素材庫相對位置。
- volumeId：穩定的邏輯身分，不是作業系統磁碟識別碼。
- rootUri：目前來源素材庫根目錄或掛載路徑。

重新連結會保留資產 ID、使用者中繼資料、評分、鎖定、故事和片段編輯。更新已選素材列之前會重新檢查候選檔，並以單一 SQLite 交易提交。已知雜湊不符時無法覆蓋。相對路徑、檔名／大小和舊版手動配對需確認；舊版替代檔也必須符合媒體類型和既有來源片長範圍。目前根目錄儲存在素材目錄參照中繼資料。重新連結不需同時交易 project.json 和 SQLite，也不會重寫 manifest 的原始素材庫 URI。

新縮圖／代理檔參照使用專案相對 cache/... 路徑。重新開啟搬移過的專案時，會依照應用程式產生快取的命名規則復原符合條件的舊版絕對參照。原始來源仍位於專案外，可能需要重新連結。來源遺失和素材庫可用性會在執行時檢查，與已儲存編輯修訂無關。尚未實作實體磁碟區自動偵測。配對方式與重新掛載限制請見[媒體搬移](/media-portability)和[重新連結契約](/RELINK_CONTRACTS)。

## 具名版本

可選的 versions/ 資料夾屬於應用程式管理資料，不屬於專案 schema 1.0.0 或素材目錄 schema v5。沒有此資料夾的專案仍可正常開啟。建立版本時會排除素材目錄寫入器，同時擷取已儲存 manifest 和有界素材目錄快照；暫存與發布前會驗證 SQLite schema、完整性和外鍵。快照中繼資料與雜湊不會複製來源媒體，也不會透過 API／CLI 紀錄暴露絕對來源 URI。名稱與描述儲存在索引，可在不重寫快照的情況下變更。儲存區有明確數量和位元組上限，不會默默刪除舊版本。

還原前會驗證所選 manifest／素材目錄／來源指紋、目前修訂和鎖定，然後先建立具名復原檢查點。Manifest 發布在素材目錄還原交易中進行；若啟動時偵測到發布中斷，小型私人日誌會回復至檢查點。目前專案 manifest 和素材目錄會一併替換，編輯器快照也會失效。還原不會恢復快取／輸出或原始素材，也不等同工作階段復原／重做。完整生命週期與失敗行為請見[具名版本](/named-versions)。

瀏覽器管理的副本會在 openfilm.managedSource 中記錄已驗證的來源相對路徑和原管理 URI。搬移專案後，只有仍指向受管理來源的資產會重新定位；明確重新連結至外部檔案的素材會維持外部參照。ID 和原始來源資訊不變。來源路徑必須在 sources/ 之內；專案快取或任意中繼資料路徑不會被當成受管理媒體匯入。

Collect Media 套件使用相同的受管理來源邊界。可選 collect-manifest.json 會記錄所選 Story／Composition、相對路徑、內容雜湊／大小、必要字型綁定、明確權利聲明及原 URI 摘要。專案素材目錄只保留參照資產與其選定逐字稿資料；無關素材庫資產、快取、工作、供應商憑證和具名版本快照不會納入。相同來源位元組只存一份；資產 URI 仍保持不透明且唯一，openfilm.managedSource.relativePath 則指向共用檔案。字型檔和解析器綁定保存在 fonts/，開啟套件時會檢查雜湊。這些回條位於 schema 1.0.0 和素材目錄 schema v5 之外；既有專案照常開啟。完整目錄／ZIP 與驗證契約請見[Collect Media](/collect-media)。

## 驗證與遷移

validateProject 會檢查目前 schema 和結構／值限制。migrateProject 支援目前 1.0.0，以及欄位名稱相同、已有文件說明的 0.1.0 草案版本；該草案若缺少 settings，會補上 1920 × 1080／30 fps。遷移不會修改輸入，也不會推測未標版本或未知格式。未知的未來版本會以明確錯誤拒絕。

開啟草案專案時會在記憶體中遷移；儲存或關閉時才寫入目前 manifest。Schema 遷移不會包含原始媒體。使用引入格式遷移的版本開啟專案前，請先備份。

## 時間軸交換

JSON 匯出包含 schema 版本、完整 Composition、參照資產和設定。OTIO 使用原生 Timeline／Stack／Track／Clip／Gap 物件表達剪輯版面、目前來源 file URI、靜態影格停留、音訊和 1x 來源範圍。速度、音量／靜音、變形、標題、交叉淡化和片段鎖定等進階編輯會保存在 OpenFilm 中繼資料，並附上明確警告，不會變成 NLE 原生效果。完整 Composition 和原始片段欄位會一併嵌入。調速片段會使用未調速的原生片段摘錄；必要時加入有標記的補白間隔以維持記錄位置，使用者須依中繼資料在 NLE 手動重建速度變更。軌道內重疊會被拒絕。

應用程式會回傳警告並寫入相鄰的 timeline.<format>.report.json；OTIO 也會內嵌相容性報告。FCPXML 和 EDL 僅支援有限的剪輯式流程，遇到不支援的進階操作會拒絕輸出。JSON 是完整模型匯出格式。官方 OTIO 解析器讀取／寫入／再次讀取的驗證，不等同於實際 NLE 行為；DaVinci Resolve 匯入與播放尚未驗證。詳細功能支援、中繼資料位置和人工檢查方式請見[NLE 相容性](/nle-compatibility)。

## 原生安裝程式的儲存區隔

M7E RuntimeManifest 和隨附執行檔屬於應用程式安裝資源，不是專案資料。Runtime 暫存和安裝程式打包不會複製或遷移專案資料夾。首次啟動檢查使用應用程式資料目錄。手動回復應用程式版本會保留專案，並依靠既有的專案／素材目錄相容性檢查；不支援的版本會被拒絕，不會被改寫。詳見[原生安裝程式](/native-installer)。
