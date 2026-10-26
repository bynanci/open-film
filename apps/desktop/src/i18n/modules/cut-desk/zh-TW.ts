// Modified by OpenFilm contributors on 2026-10-26. See LICENSE/NOTICE.
export default {
  cutDesk: {
    record: "成片",
    source: "來源",
    active: "使用中",
    playing: "播放中",
    paused: "已暫停",
    play: "播放序列",
    pause: "暫停序列",
    transport: "成片播放控制",
    sequenceTimecode: "序列時間碼",
    timebase: "序列時間基準",
    dropFrame: "丟格（DF）",
    nonDropFrame: "非丟格（NDF）",
    timebaseSaving: "正在儲存序列時間基準…",
    shortcuts:
      "空白鍵播放／暫停 · J K L 變速 · ← → 逐格 · Shift+← → 逐秒 · ↑ ↓ 剪接點 · Home/End 邊界 · B 分割",
    issues: {
      "not-ready": "正在等候成片媒體…",
      "source-missing": "成片來源遺失。您的剪輯內容已安全保留。",
      "source-inaccessible": "無法存取成片來源。",
      "decode-failed": "無法解碼成片媒體。",
      "invalid-composition": "無法預覽此成片組合。",
      "audio-gain-unavailable": "無法預覽要求的音訊增益。",
    },
  },
};
