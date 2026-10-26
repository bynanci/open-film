// Modified by OpenFilm contributors on 2026-10-26. See LICENSE/NOTICE.
export default {
  cutDesk: {
    record: "レコード",
    source: "ソース",
    active: "使用中",
    playing: "再生中",
    paused: "一時停止中",
    play: "シーケンスを再生",
    pause: "シーケンスを一時停止",
    transport: "レコード再生操作",
    sequenceTimecode: "シーケンスタイムコード",
    timebase: "シーケンスのタイムベース",
    dropFrame: "ドロップフレーム（DF）",
    nonDropFrame: "ノンドロップフレーム（NDF）",
    timebaseSaving: "シーケンスのタイムベースを保存中…",
    shortcuts:
      "Space 再生／一時停止 · J K L シャトル · ← → フレーム · Shift+← → 秒 · ↑ ↓ 編集点 · Home/End 境界 · B 分割",
    issues: {
      "not-ready": "レコードのメディアを待機中…",
      "source-missing":
        "レコードのソースが見つかりません。編集内容は保持されています。",
      "source-inaccessible": "レコードのソースにアクセスできません。",
      "decode-failed": "レコードのメディアをデコードできませんでした。",
      "invalid-composition": "このコンポジションをプレビューできません。",
      "audio-gain-unavailable": "指定された音声ゲインをプレビューできません。",
    },
  },
};
