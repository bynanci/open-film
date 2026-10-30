// SPDX-License-Identifier: Apache-2.0
export default {
  collectDelivery: {
    heading: "素材の整理方法を検討",
    description: "作品で使うソース範囲と、カットの前後に残す素材を確認します。",
    planningOnly:
      "これは計画の確認です。現在のパッケージ作成には元の素材をすべて含めます。派生素材の配布は、時刻と出力の検証後に有効になります。",
    mode: "確認する配布方法",
    originals: "元の素材全体",
    trimmed: "使用範囲と前後の余裕",
    offline: "軽量オフライン編集",
    handles: "カット前後に残す秒数",
    review: "ソース範囲を確認",
    cancel: "確認をキャンセル",
    preparing: "ソース範囲を確認中…",
    results: "ソースの使用範囲",
    ranges: "ソース区間：",
    window: "{start}–{end} 秒",
    duration: "{retained} 秒を保持 · {removed} 秒を省略",
    pages: "ソース範囲のページ",
    previous: "前へ",
    next: "次へ",
    pageCount: "{total} 件中 {first}–{last} 件",
    quality: {
      originals: "現在の元素材パッケージはソース全体を保持します。",
      "requires-lossless-parity":
        "範囲整理の候補は、元作品とのデコード映像・音声・時刻の一致を検証してから配布します。",
      "offline-only":
        "オフライン候補は軽量編集と確認用です。元の品質で仕上げるには元素材が必要です。",
    },
    actions: {
      "copy-original": "元の素材全体を保持",
      "trim-candidate": "範囲整理の候補",
      "offline-candidate": "オフラインプレビュー候補",
    },
    reasons: {
      identityMissing: "ソースのバイト列と保存済みの識別情報を確認できません。",
      timingUnavailable: "信頼できるソースの長さがありません。",
      unsupported: "この素材は現在の設計では元ファイル全体を保持します。",
      locked: "素材またはクリップの保護により元ファイルを保持します。",
      opaqueReference: "シーンやレイアウトの依存先にはソース全体が必要です。",
      evidenceBound:
        "文字起こし・来歴・拡張データには元のソース時刻が必要です。",
      rangeInvalid: "保存済みの範囲を整理前に確認してください。",
      unused: "参照されていますが、明確なクリップ範囲が見つかりません。",
    },
  },
};
