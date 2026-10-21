# Collect Media 可攜式套件

Collect Media 會複製開啟與算繪影片所需的已儲存專案資料，建立可搬移的套件；不會搬移或改寫原始檔案。桌面應用程式、HTTP 與 CLI 共用 @openfilm/application 的 CollectMediaService。此服務沿用既有 Composition 作為唯一剪輯時間軸，不變更專案 schema 1.0.0 或素材目錄 schema v5。

## 範圍與檢查

建立套件前，請先選擇範圍：

- 「目前影片」會納入一個已儲存的 Composition 及其 Story。
- 「整個專案」會納入所有已儲存的 Story 和 Composition。

只會收集這些 Story 選取／限制條件、Composition 片段、次要版面和 GraphicScene 圖片所參照的資產。未使用的素材庫資產會省略。收集範圍包含選定 Composition 的音訊／影片、產生的 WAV、剪輯使用的衍生媒體、該 Composition 已儲存的字幕和場景資料，以及標題、字幕與 GraphicScene 文字使用的字型。

規劃報告會列出每項資產／字型的顯示名稱、類型、大小與 SHA-256。若檔案遺失、無法讀取、路徑為符號連結、與素材目錄檢查時相比已有變更、超過檔案限制、URI 不支援、位於巢狀封存檔中、字型缺失，或沒有明確權利聲明，該項目會被阻擋。若使用字型替代方案，套件仍可建立，但會附上排版檢查警告；這不代表替代字型在視覺上等同原字型。

每個媒體檔和收集的字型都必須確認權利依據：owned、licensed、cc0、public-domain 或 other。非自有的聲明需填寫授權名稱；署名欄位可選。這些聲明是使用者提供的紀錄，不是自動授權判定。權利回條欄位會拒絕絕對本機路徑和類似機密的文字，也不接受 file URL。

## 套件結構與隱私

應用程式會在既有素材目錄寫入器暫停期間，擷取 project.json 與具 SQLite 一致性的素材目錄快照。素材目錄只保留所選資產及其逐字稿資料；工作、審閱建議、快取、未選資產和舊版自由頁面殘留都會移除。發布前會對篩選後的 SQLite 快照執行 vacuum。Named Versions 快照會刻意排除，UI／manifest 會標示 versionsIncluded: false。

內容相同的來源位元組只儲存一次，位置為 sources/<雜湊前兩碼>/<sha256>.<副檔名>；字型位於 fonts/<sha256>.<副檔名>。每項資產的套件 URI 依穩定資產 ID 保持不透明且唯一；openfilm.managedSource.relativePath 則指向依雜湊命名的檔案。移動後重新開啟套件，只會重新定位套件內這些受管理來源，不會改動原始媒體。

Manifest 會記錄檔案雜湊／大小、所選 Story／Composition ID、每項資產的來源雜湊、字型、權利聲明、範圍、版本排除狀態，以及每個原始 URI 的 SHA-256 摘要；不會包含原始絕對來源路徑。資產顯示名稱會簡化為檔名；像路徑的標籤會省略，看起來像機密的中繼資料索引鍵會移除，中繼資料字串中的本機路徑會以摘要取代。專案 schema、Composition ID、鎖定、選定媒體 ID 和已儲存編輯狀態會保留。

## 安全、限制與發布

資料夾套件只包含一般檔案。ZIP 使用 UTF-8 檔名和不壓縮項目；ZIP 解壓會拒絕路徑穿越、絕對／UNC／磁碟機路徑、重複或大小寫衝突路徑、符號連結／特殊檔案、巢狀封存檔、格式錯誤標頭、重疊項目、超出大小限制和錯誤 CRC。封存檔只會解壓到新建的私人暫存資料夾。來源、套件和輸出路徑中的符號連結元件會被拒絕；資料夾中硬連結檔案也會被拒絕。名稱會正規化為可攜式相對路徑；中日韓檔名可正確往返。

目前實作限制為：最多 10,000 個來源檔、每檔 2 GiB、manifest 16 MiB，素材目錄快照遵守既有 256 MiB 限制。ZIP 輸出遵守 ZIP32 限制，低於 4 GiB。ZIP 項目不壓縮，以避免解壓縮炸彈；套件大小估算會計入未壓縮資料與 manifest，不含 ZIP 標頭。工作會在目的地旁分階段暫存，使用每個目的地專屬的排他鎖，並在檢查來源、專案與素材目錄版本後才發布。取消時會刪除暫存檔，不會留下已發布的部分套件；不會刻意覆寫既有目的地。

HTTP 服務只會在目前開啟專案的 exports/ 目錄內建立唯一命名的套件；驗證時也只接受同一目錄中的套件名稱。CLI 是本機命令，可指定目的地。沒有任何端點可指定任意封存檔解壓目的地。

## 驗證與重新開啟

Package Verify 會將資料夾套件複製到私人暫存根目錄，或將 ZIP 解壓至該處。它會檢查 manifest 中每個檔案的雜湊與大小、素材目錄成員資格、資產 URI／重新定位中繼資料、來源／字型雜湊、選定的 Story／Composition ID 及權利涵蓋範圍。接著會在無法存取原始來源位置的隔離套件中開啟專案、算繪預覽和實際 MP4，並比對 MP4 算繪回條中的來源雜湊與 manifest，以及 MP4 位元組雜湊。FFmpeg 會解碼每一影格；FFprobe 會檢查 H.264 尺寸、影格率、解碼影格數／片長和預期音訊串流。回傳證據僅含雜湊和技術串流資訊，不含來源路徑。

整個專案套件的驗證會以第一個已儲存 Composition 算繪代表性 MP4。其他 Composition 仍保留在套件中，開啟後可以選擇。隔離驗證只能證明目前主機上的行為，不代表已認證 Windows／macOS 檔案系統語義、工作站上安裝的字型或任何特定 NLE。自動化證據與待人工檢查項目請見[Collect Media 驗證](/validation-collect-media)。

## 命令

CLI 需要在 JSON 陣列中明確宣告權利。典型流程如下：

~~~sh
pnpm cli collect plan --project ./film.openfilm --scope current-film \
  --composition <composition-id> --rights ./rights.json
pnpm cli collect create --project ./film.openfilm --scope current-film \
  --composition <composition-id> --rights ./rights.json \
  --plan-id <plan-id> --base-revision <revision> \
  --format zip --destination ./handoff/film.zip
pnpm cli collect verify --project ./film.openfilm --package ./handoff/film.zip
~~~

HTTP 路由為 POST /api/collect/plan、POST /api/collect/create 和 POST /api/collect/verify。關閉請求可取消建立／驗證作業；伺服器會等到暫存工作停止後才釋放專案。桌面應用程式的輸出頁面提供相同的計畫、權利檢查、套件建立與驗證流程。
