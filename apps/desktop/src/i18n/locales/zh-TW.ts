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
