export default {
  common: {
    unknownDate: "拍攝日期不明",
    file: "此檔案",
    filesCount: "{count} 個檔案",
    unavailable: "無法使用",
    technicalDetails: "技術詳情",
  },
  errors: {
    request: {
      invalid: "請檢查輸入的內容後再試一次。",
      tooLarge: "選取的內容太大。請減少檔案數量或選擇較小的檔案。",
      unsupported: "不支援這項操作。請選擇支援的檔案或操作。",
      forbidden: "OpenFilm 無法存取此位置。請選擇可讀寫的本機資料夾。",
      notFound: "這個項目已無法使用。請重新整理工作區後再試一次。",
    },
    workspace: {
      unavailable:
        "無法連線至 OpenFilm 本機工作區。請重新啟動 OpenFilm；已儲存的內容仍然安全。",
      invalidResponse: "OpenFilm 無法讀取工作區回應。請重新啟動後再試一次。",
      closing: "OpenFilm 正在關閉工作區。請等候完成後再試一次。",
    },
    project: {
      required: "請先建立或開啟影片。",
      unavailable: "無法開啟這支影片。請重新連接硬碟，或選擇目前的儲存位置。",
      destinationInvalid:
        "無法在此儲存影片。請在進階設定中選擇可寫入的資料夾。",
    },
    jobs: {
      busy: "仍有工作正在使用這支影片。請等候完成，或在「工作進度」中取消。",
      notRunning: "這項工作已結束。請重新整理工作進度以查看結果。",
    },
    media: {
      notFound: "素材庫中已找不到這段回憶。請重新整理素材庫。",
      missing: "{name} 已離線。您的剪輯仍然安全。請選擇「尋找檔案」重新連接。",
      previewUnavailable:
        "此檔案沒有可用的預覽。請重新連接或再次加入檔案，以重建預覽。",
      unsupported:
        "無法在此播放這個來源。請加入支援的照片或已重新取景匯出的影片。",
      relinkFailed:
        "無法重新連接這些檔案。請檢查資料夾後再次尋找檔案或資料夾。",
      relinkConflict: "所選檔案與原始素材不符。請確認比對結果後再替換。",
      transcriptionFailed:
        "無法建立逐字稿。請檢查來源音訊與本機語音辨識設定後再試一次，或查看技術詳情以了解原因。",
      sceneFailed:
        "無法偵測畫面切換。請確認來源影片可存取且能播放後再試一次，或查看技術詳情。",
      waveformFailed:
        "無法產生波形。請確認來源含有可播放的音軌後再試一次，或查看技術詳情。",
    },
    story: {
      mediaRequired: "請先加入回憶，再建立故事。",
      scopeTooLarge: "請為這個故事選擇較小的一組回憶後再試一次。",
      invalid: "無法儲存故事。請檢查選取的回憶與長度限制。",
    },
    timeline: {
      notFound: "已找不到這份剪輯。請開啟影片的最新版本。",
      conflict:
        "您剪輯期間，已儲存的影片有了變更。請檢視新版本，或重新套用已保留的草稿。",
      invalidEdit:
        "這項變更超出素材或故事限制。請檢查裁切範圍、長度與鎖定的回憶。",
    },
    render: {
      overMaximum:
        "影片已超過長度上限。請使用「調整至目標長度」，或縮短部分片段後再匯出。",
      failed: "無法產生影片。請檢查離線檔案與不支援的素材後再試一次。",
    },
    import: { failed: "部分回憶無法加入。請檢查檔案位置與格式後再試一次。" },
    export: {
      failed: "無法匯出影片。請檢查儲存位置、可用空間與素材後再試一次。",
    },
    source: {
      changed: "來源檔案已變更。請再次加入，或重新連接原始素材後再繼續。",
    },
    model: {
      unavailable:
        "本機語音辨識模型無法使用。請設定已安裝的模型後再試一次。其他剪輯工具仍可使用。",
    },
    transcription: {
      modelRequired:
        "請先選擇已安裝的本機 Whisper 模型，再建立逐字稿。OpenFilm 不會自動下載模型檔案。",
      modelInvalid:
        "無法使用設定的模型。請檢查路徑與檔案格式，並選擇支援的本機 Whisper 模型。",
      runtimeUnavailable:
        "本機語音辨識執行環境無法使用。請安裝並設定支援的 Whisper 執行環境，再重新啟動 OpenFilm。",
      noAudio:
        "此來源沒有可用的音軌。請選擇含有語音的影片或錄音，以建立逐字稿。",
      failed:
        "語音辨識未能完成。請檢查來源音訊與模型設定後再試一次，或查看技術詳情。",
      invalidOutput:
        "語音辨識結果的文字或時間資料無效，因此未儲存。請檢查辨識工具設定後再試一次。",
    },
    transcript: {
      revisionConflict:
        "逐字稿在編輯期間已有更新。本機草稿已保留；請先載入較新版本。",
      segmentNotFound: "此逐字稿段落已不存在，請重新載入目前版本。",
      alignmentStale: "文字已修改，逐字時間僅供參考，不可作為精準對齊。",
      invalidCommand: "此逐字稿修改無效，請檢查所選文字、段落與分割時間。",
    },
    glossary: {
      storageBusy:
        "另一個 OpenFilm 視窗或程序正在更新全域詞彙表，請等候完成後再試。",
      entryConflict: "詞彙已變更或與另一項詞彙衝突，請重新載入詞彙表後再試。",
    },
    review: {
      providerUnavailable:
        "語言審閱供應者無法使用或尚需文字傳送同意，仍可使用詞彙建議。",
      suggestionStale:
        "此建議產生後，逐字稿已有修改。請先產生新建議再套用校正。",
      invalidOutput: "審閱結果無效，未套用任何修改。先前完成的有效建議仍保留。",
    },
    operation: {
      failed:
        "未能完成這項操作。已儲存的內容仍然安全。請再試一次，或查看技術詳情。",
    },
  },
};
