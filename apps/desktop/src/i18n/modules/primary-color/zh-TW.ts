// SPDX-License-Identifier: Apache-2.0
export default {
  primaryColor: {
    applyHint: "按「套用」儲存這些數值並更新監看畫面。",
    current:
      "目前冷暖 {temperature}、編碼 SDR 增益 {exposure} EV、對比 {contrast}。",
    heading: "基本色彩",
    description:
      "在編碼 SDR 數值上調整冷暖、增益與對比。增益使用 EV 單位；校準的場景曝光需要獨立色彩管理。",
    scope: "設定範圍",
    scopes: {
      film: "整部影片",
      beat: "場景",
      clip: "片段",
      original: "未校正",
    },
    temperature: "冷暖（−1 至 1）",
    exposure: "編碼 SDR 增益（EV）",
    contrast: "對比（0.5 至 1.5）",
    apply: "套用基本色彩",
    neutral: "中性數值",
    inherit: "繼承",
    effective: "目前有效的基本色彩設定：{scope}",
    review: "自動匹配・統計建議",
    statistical:
      "在電影風格之前比較亮度、冷暖與對比統計。請檢視實際樣本再套用。使用兩個不透明相片或平面影片片段，每個來源不超過 512 MiB。",
    reference: "參考片段",
    measure: "測量建議",
    discard: "捨棄／取消",
    measuring: "正在測量本機來源樣本…",
    failed:
      "無法比較。請確認兩個支援的不透明來源皆可存取、各不超過 512 MiB，並已儲存影片，再重新測量。",
    sample: "樣本",
    variants: {
      reference: "參考",
      before: "基本校正之前",
      after: "建議的基本校正",
    },
    median: "亮度中位數（0–255）",
    clipping: "樣本中截斷的像素",
    proposed:
      "建議冷暖 {temperature}、編碼 SDR 增益 {exposure} EV、對比 {contrast}。",
    reviewed: "我已檢視參考、校正前與建議樣本。",
    applyClip: "將建議套用至此片段",
    warnings: {
      "statistical-suggestion": "這是統計建議；請檢視光線與場景內容的差異。",
      "insufficient-evidence":
        "樣本過暗、對比過低或截斷過多，無法提供有效建議。請手動調整。",
      "no-useful-match": "測量改善或可編輯條件不足。請保留目前設定或手動調整。",
    },
  },
};
