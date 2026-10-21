# OpenFilm 公開格式

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

`openfilm-project-1.0.0.schema.json` 定義專案 manifest，以及可重用的媒體、故事、組合、事件、重複群組和工作定義。`media-asset-1.0.0.schema.json` 參照媒體定義；`plugin-manifest-1.schema.json` 定義 Plugin API 1；`workstation-qa-1.0.0.schema.json` 定義綁定候選版本的人工／硬體 QA 證據。`$id` 是穩定識別碼；驗證器應在本機讀取隨附檔案，不需要網路。

時長、來源修剪位置與時間軸位置都以秒計；影格率以 fps 計。片段畫面 x/y 座標採組合影格像素，原點在中心（+x 向右、+y 向下）；來源像素先 contain-fit，再縮放及順時針旋轉。地理座標採 WGS84 度數，事件半徑以公里計。信心度與工作進度為 0 到 1，評分為 0 到 5，時間戳必須包含時區。Plugin 中繼資料請使用命名空間以避免衝突。

片段 `locked` 是 1.0.0 的可選新增欄位。舊專案仍有效，不需轉換；鎖定會保護片段識別、來源選取、時長和效果，但前方剪輯仍可能使其時間軸位置移動。編輯或移除鎖定片段前須明確解鎖。載入器會保存並重新載入此欄位，且拒絕非布林值。

載入 manifest 時呼叫 `validateProject`。除結構 schema 外，也會檢查時長範圍、唯一 ID、日曆時間、故事與 beat 參照。提供 `{ assetIds: catalogIds }` 可進一步驗證候選、選取、限制及片段參照是否存在於目錄。專案 manifest 不會嵌入原始素材或重複保存目錄。

選用的 `graphicScenes` 包含完整 v1 場景；只允許 Image／Text／Shape／Group 圖元，並限制幾何、文字、動畫、清單長度與四層巢狀。PhotoDepth 是可選擴充，識別碼必須是目錄 ID，不可為路徑或 URL。執行階段還會檢查區間關係、唯一 ID、節點／文字／像素總量預算，以及 PhotoDepth 綁定。JSON Schema 的 `maxLength` 計算 Unicode 字元，核心另有限制 UTF-16 code unit。結構驗證不能取代 `validateProject` 或本機素材檢查。

`validateMediaAsset`、`validateStory`、`validateComposition` 與 `validateJob` 是可攜式執行階段驗證器；成功時會回傳獨立的 JSON 相容資料，不會修改原物件。`migrateProject` 會將已文件化的 0.1.0 草案升級為 1.0.0；省略設定時預設 1920×1080、30 fps。未版本化、格式錯誤、未來版本與其他未文件化版本均拒絕，不會猜測單位或缺漏內容。

支援的故事限制為 `must-include`、`must-exclude`、`asset-order`（使用唯一 `assetIds`），以及可帶 `enabled` 的 `chronological`。求解器會回報無法同時滿足的需求，不會靜默丟棄必選素材。

AI 介面會宣告 `execution: local | remote`、端點及可能收到的資料類別。ProviderRegistry 沒有預設遠端 Provider。註冊不會啟用遠端功能；呼叫端必須先透過 `grantConsent` 提供具範圍和時間戳的 `RemoteProviderConsent`。每次呼叫都檢查同意、資料類別與端點未變；撤銷或替換 Provider 後須重新授權。Plugin 是可執行程式碼，宿主應只信任可信任的 Plugin；同意檢查是宿主契約，不是任意 Plugin 程式碼的沙箱。
