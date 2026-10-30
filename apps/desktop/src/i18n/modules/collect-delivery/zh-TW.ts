// SPDX-License-Identifier: Apache-2.0
export default {
  collectDelivery: {
    heading: "探索素材精簡封裝",
    description: "審閱影片使用的來源區間，以及每個剪接點前後要保留的素材。",
    planningOnly:
      "先審閱，再明確接受並建立套件。受保護素材會保留完整原檔；無損區間檔可能比壓縮原檔更大。",
    format: "套件格式",
    directory: "資料夾",
    acceptLossless:
      "我已審閱區間，接受無損交付並進行輸出驗證。檔案體積可能增加。",
    acceptOffline:
      "我接受較低解析度的壓縮審閱素材；此套件無法輸出原始品質的母片。",
    acceptOriginals: "我已審閱並接受完整原始素材套件。",
    create: "接受並建立套件",
    validating: "正在建立素材並驗證交付影片…",
    rightsFirst: "請先在素材收集中審閱並確認所有來源與字型的使用權。",
    offlineOutput: "此專案使用離線審閱素材；輸出無法還原原始來源的品質。",
    mode: "要審閱的交付選項",
    originals: "完整原始素材",
    trimmed: "使用區間與前後餘裕",
    offline: "輕量離線剪輯",
    handles: "剪接點前後額外保留秒數",
    review: "審閱來源區間",
    cancel: "取消審閱",
    preparing: "正在檢查來源區間…",
    results: "來源使用範圍",
    ranges: "來源區間：",
    window: "{start}–{end} 秒",
    duration: "保留來源 {retained} 秒 · 省略 {removed} 秒",
    pages: "來源區間分頁",
    previous: "上一頁",
    next: "下一頁",
    pageCount: "第 {first}–{last} 項，共 {total} 項",
    quality: {
      originals: "目前的原始素材套件會保留完整來源。",
      "requires-lossless-parity":
        "區間精簡候選須先與原影片比對解碼畫面、音訊與時間，才能交付。",
      "offline-only": "離線候選供輕量剪輯與審閱。原畫質交付仍需要原始素材。",
    },
    actions: {
      "copy-original": "保留完整原始素材",
      "trim-candidate": "區間精簡候選",
      "offline-candidate": "離線預覽候選",
    },
    reasons: {
      userPinned: "使用者釘選需要保留完整原始來源與已儲存的來源時鐘。",
      identityMissing: "無法確認來源位元組與已儲存的素材身分相符。",
      timingUnavailable: "缺少可靠的來源長度。",
      unsupported: "此類素材在目前設計中保留完整原檔。",
      locked: "素材或片段保護會保留原檔。",
      opaqueReference: "場景或版面依賴需要完整來源。",
      evidenceBound: "逐字稿、來源證據或擴充資料需要保留原始時間。",
      rangeInvalid: "已儲存的來源區間需要先檢查。",
      unused: "此來源仍被引用，但找不到明確的片段使用區間。",
    },
  },
};
