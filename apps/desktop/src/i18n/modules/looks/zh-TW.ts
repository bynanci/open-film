// SPDX-License-Identifier: GPL-3.0-only
export default {
  looks: {
    heading: "影片風格",
    description: "先選擇整片風格，再依場景或片段調整。",
    film: "整支影片",
    beat: "目前場景",
    clip: "目前片段",
    inherit: "沿用上層",
    strength: "強度",
    strengthLabel: "{scope}強度",
    resolved: "顯示：{preset} · {source}",
    sources: {
      export: "本次輸出",
      clip: "片段設定",
      beat: "場景設定",
      film: "整片設定",
      original: "原始色彩",
    },
    presets: {
      none: "原始色彩",
      "soft-film": "柔和底片",
      americana: "美式",
      "clean-camera": "單眼質感",
      retro: "復古時代",
      natural: "自然",
      sport: "運動",
    },
    hints: {
      none: "保留來源原本的色彩。",
      "soft-film": "富士感的柔綠色調與柔和對比，適合日常回憶。",
      americana: "溫暖色調搭配較深的對比，營造鮮明的旅行電影感。",
      "clean-camera": "清晰細節與均衡對比，呈現細膩的單眼相機質感。",
      retro: "提亮暗部、收斂色彩，呈現褪色年代感。",
      natural: "輕微、均衡的潤飾，保留熟悉的自然色彩。",
      sport: "鮮明色彩與強烈對比，突顯動感時刻。",
    },
    protected: "請先解鎖這個片段，或在素材庫解鎖來源，再調整片段風格。",
    previewNote:
      "風格只套用照片與影片。來源監看僅供快速參考；請以「算繪預覽」確認最終畫面，尤其是影片或 HDR 素材。",
    exportHeading: "MP4 風格",
    exportMode: "本次輸出的風格",
    preserve: "保留場景與片段風格",
    unify: "本次輸出統一風格",
    exportPreset: "輸出風格",
    exportStrength: "輸出強度",
    exportOnly: "這項輸出選擇不會改動已儲存的剪輯；產生預覽也會使用相同選擇。",
    uniformHint: "本次輸出會覆蓋分段風格，包含鎖定片段；不更動專案設定。",
    previewOverride:
      "算圖預覽：整片使用「{preset}」。剪輯監看仍顯示已儲存的場景與片段風格。",
    interchange:
      "可編輯匯出會保留已儲存的風格資料，需在剪輯軟體手動重建；不包含僅供本次 MP4 的統一設定。",
  },
};
