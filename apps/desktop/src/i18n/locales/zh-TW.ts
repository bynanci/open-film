import app from "../modules/app/zh-TW";
import editor from "../modules/editor/zh-TW";
import media from "../modules/media/zh-TW";
import precision from "../modules/precision/zh-TW";
import transcript from "../modules/transcript/zh-TW";
import system from "./system-zh-TW";

export default {
  ...system,
  ...app,
  ...editor,
  ...media,
  ...precision,
  ...transcript,
  scriptReview: {
    heading: "腳本建議",
    description: "每次檢視一個已儲存的場景欄位。只有接受建議後才會儲存變更。",
    field: "要檢視的文字",
    generate: "產生修改建議",
    history: "顯示已處理建議",
    pending: "顯示待處理建議",
    providerMissing: "尚未設定選用的腳本語言服務。您可以繼續撰寫自己的腳本。",
    remoteConsent: "您同意後，腳本檢視才會將所選文字及場景背景傳送至此服務。",
    dataAccess:
      "這次檢視會傳送所選文字、影片與場景標題、場景意圖、時間目標和影片語言，不會傳送媒體檔案、位置或另一個腳本欄位。",
    grantConsent: "允許所列腳本檢視資料",
    revokeConsent: "撤回腳本檢視同意",
    uncertainAcceptance:
      "接受建議的回應遺失了。請保留此場景，並重試同一次接受操作，以確認已儲存的內容。",
    retryAcceptance: "重試接受操作",
    reload: "重新載入建議",
    running: "正在檢視場景腳本…",
    cancel: "取消腳本檢視",
    cancelled: "腳本檢視已取消，已儲存的建議仍可使用。",
    noSuggestions:
      "此欄位沒有待處理的建議。選用的語言檢視會保留原文，直到您接受建議。",
    noHistory: "此欄位尚未有任何建議紀錄。",
    pages: "腳本建議分頁",
    jobTitle: "場景腳本檢視",
  },
  scenePlan: {
    heading: "規劃腳本與場景",
    description: "將回憶編排成場景，為每一段故事安排時間。",
    evidence:
      "這份離線草稿根據你設定的分類、拍攝日期與故事簡介編排，不會辨識照片內容。腳本與畫面指示是可編輯的規劃文字，不會自動產生配音或字幕。",
    close: "關閉規劃",
    title: "影片名稱",
    brief: "你想訴說什麼故事？",
    briefHint: "描述場合、想傳達的心情或訊息。",
    grouping: "場景編排依據",
    category: "分類",
    chronology: "拍攝日期",
    scope: "納入的回憶",
    allMedia: "所有符合條件的素材",
    visibleMedia: "目前素材頁（{count}）",
    target: "目標長度（秒）",
    maximum: "最長時間（秒）",
    transition: "場景節奏",
    cut: "直接切換",
    crossfade: "交叉淡化",
    working: "準備中…",
    preview: "預覽場景規劃",
    review: "審閱你的場景規劃",
    reviewHint:
      "先修改場景名稱、意圖與腳本筆記，再建立新的故事與剪輯。既有影片會保留。",
    timing: "目標 {target} · 最長 {maximum}",
    audioExcluded:
      "已排除純音訊素材：{count}。這份規劃不會加入音樂或錄製的旁白。",
    previewAgain: "規劃設定已變更。請重新預覽，確認時長符合新設定後再建立。",
    sceneTitle: "場景名稱",
    intent: "場景意圖",
    narration: "腳本／旁白筆記",
    visualDirection: "畫面指示",
    candidates: "候選回憶：{count}",
    accept: "建立故事與剪輯",
    accepted: "故事與剪輯已建立。可以在下方審閱場景，或前往剪輯。",
    stale:
      "預覽後，素材或影片語言已變更。你的腳本草稿仍保留在此，請重新預覽以取得最新規劃。",
    discardWarning: "要捨棄這份尚未儲存的場景規劃並關閉嗎？",
    regenerateWarning:
      "重新預覽會取代這份草稿中修改過的腳本。請先保留想留下的文字。",
    keep: "保留草稿",
    discard: "捨棄草稿",
    regenerate: "以新預覽取代",
    draftPending: "切換專案前，請先接受或明確捨棄場景規劃。",
    sceneTiming: "實際 {actual} · 預算 {target}",
    memoryPreview: "選取回憶預覽",
    categories: "分類",
    categoriesHint:
      "每一列是一個分類，標點符號與換行會保留。第一個分類決定此回憶所屬的場景。",
    categoryLabel: "分類 {number}",
    addCategory: "新增分類",
    removeCategory: "移除分類 {number}",
    categoryRequired: "請填寫每列分類，或移除空白列。",
    saveCategories: "儲存分類",
    categoriesSaved: "分類已儲存。",
    categoryPending: "請先儲存目前分類再繼續。",
  },
  captions: {
    title: "字幕",
    description:
      "依目前剪輯與已校正的逐字稿產生字幕檔。影片與原始素材不會被修改。",
    composition: "目前剪輯",
    sourceTrack: "對白來源軌道",
    chooseTrack: "選擇一條軌道",
    noTracks: "目前剪輯沒有可產生字幕的影片或音訊軌道。",
    singleTrack: "選擇包含所需對白的一條影片、音訊或音樂軌道。",
    generate: "產生字幕",
    cancel: "取消",
    checkStatus: "檢查變更",
    previewOnly: "此處僅預覽文字與時間。字幕會另存檔案，不會燒錄進影片。",
    preview: "字幕預覽",
    cueCount: "沒有字幕 | {count} 則字幕 | {count} 則字幕",
    noCues: "找不到可用字幕。請查看提示、校正或辨識來源逐字稿，再重新產生。",
    blocked: "請先修正無法輸出的問題，再重新產生字幕。",
    asset: "素材",
    revision: "逐字稿版本",
    clip: "片段",
    previous: "上一頁",
    next: "下一頁",
    page: "第 {from}–{to} 筆，共 {total} 筆",
    attention: "輸出前請確認",
    exportSrt: "輸出 SRT",
    exportVtt: "輸出 WebVTT",
    saved: "字幕檔已儲存。",
    download: "下載字幕",
    downloadManifest: "下載來源紀錄",
    trackTypes: {
      video: "影片",
      audio: "音訊",
      music: "音樂",
    },
    severity: {
      warning: "請注意：",
      error: "無法輸出：",
    },
    status: {
      idle: "請先選擇來源軌道。",
      loading: "正在準備字幕檔…",
      ready: "可以輸出。輸出時會再次確認來源快照。",
      attention: "字幕需要確認。請閱讀提示後再輸出。",
      stale: "剪輯或來源逐字稿已有變更，請重新產生字幕。",
      failed: "無法準備字幕。請查看下方原因後重試。",
      cancelled: "已取消。你可以重新產生字幕。",
    },
    issues: {
      TRACK_UNSUPPORTED: "此軌道無法提供字幕，請選擇影片、音訊或音樂軌道。",
      TIMING_UNSUPPORTED:
        "此片段的時間設定無法安全對應。請使用支援的固定正速度，再重新產生。",
      SOURCE_UNAVAILABLE:
        "素材離線或無法讀取，已略過其字幕。請重新連接後再產生。",
      TRANSCRIPT_MISSING:
        "此素材沒有可用逐字稿，已略過其字幕。請先辨識，再重新產生。",
      TRANSCRIPT_STALE:
        "逐字稿來自不同版本的素材，已略過其字幕。請確認目前素材並重新辨識。",
      MEDIA_UNSUPPORTED: "此素材無法提供對白字幕，已略過。",
      MUTED_CLIP: "此片段已靜音，已略過其字幕。",
      PARTIAL_SEGMENT:
        "剪輯截斷了逐字稿片段。無法可靠判斷保留的文字，因此略過整段字幕。",
      ALIGNMENT_STALE: "文字已校正，採用片段時間，不將逐字時間視為精準對齊。",
      TIMING_ESTIMATED: "此段使用估算時間，請播放影片確認字幕時間。",
      INVALID_SEGMENT: "此逐字稿片段的時間無效，請修正後再輸出。",
      INVALID_TEXT: "此片段包含無效文字，請修正後再輸出。",
      EMPTY_TEXT: "已略過空白逐字稿片段。",
      TEXT_ESCAPED:
        "特殊文字需要依格式安全處理。若 SRT 無法保留文字，請改用 WebVTT。",
      ZERO_DURATION: "此片段在輸出時間取整後沒有剩餘長度，已略過。",
      OVERLAP: "字幕時間重疊，已保留全部字幕；實際顯示取決於播放器。",
      MUSIC_SOURCE: "目前選擇音樂軌道，請確認其中包含需要的對白。",
      LIMIT_EXCEEDED: "選取內容超過字幕支援上限，請選擇較短的剪輯或軌道。",
      unknown: "此字幕需要確認，詳細資料請查看來源紀錄。",
    },
  },
  errors: {
    ...system.errors,
    story: {
      ...system.errors.story,
      sceneTooShort:
        "這些場景至少需要 {minimum} 秒。請增加目標與最長時間，或合併分類。",
      sceneLimit:
        "這份場景規劃超過 {limit} 個群組。請減少分類，或選取較少的回憶。",
      planStale: "素材或影片語言已變更。請重新預覽場景規劃後再接受。",
      planConflict:
        "這份場景規劃已以其他內容接受。請開啟已建立的故事，或建立新的規劃。",
    },
    captions: {
      srtTextUnsupported:
        "文字包含 SRT 無法可靠保留的格式語法，請改用 WebVTT 輸出。",
      invalid: "此字幕選取內容無法輸出。請查看提示並選擇支援的軌道。",
      stale: "剪輯或逐字稿已有變更，請重新產生字幕再輸出。",
      failed: "無法儲存字幕檔。請確認專案位置與剩餘空間後重試。",
      unavailable: "此字幕快照已無法使用，請重新產生字幕。",
    },
  },
};
