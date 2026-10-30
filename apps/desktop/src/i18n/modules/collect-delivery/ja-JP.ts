// SPDX-License-Identifier: Apache-2.0
export default {
  collectDelivery: {
    heading: "素材の整理方法を検討",
    description: "作品で使うソース範囲と、カットの前後に残す素材を確認します。",
    planningOnly:
      "確認後、明示的に承認してパッケージを作成します。保護された素材は元のまま保持します。可逆圧縮の範囲ファイルは元の圧縮素材より大きくなる場合があります。",
    format: "パッケージ形式",
    directory: "フォルダー",
    acceptLossless:
      "範囲を確認し、出力検証付きの可逆圧縮による受け渡しを承認します。容量が増える場合があります。",
    acceptOffline:
      "低解像度の圧縮レビュー素材を承認します。このパッケージから元の品質のマスターは作成できません。",
    acceptOriginals: "元の素材をすべて含むパッケージを確認し承認します。",
    create: "承認してパッケージを作成",
    validating: "素材を作成して受け渡す動画を検証中…",
    rightsFirst:
      "作成前に、素材収集ですべての素材とフォントの利用権を確認してください。",
    offlineOutput:
      "このプロジェクトはオフライン確認用の素材を使用しています。書き出しても元の画質には戻りません。",
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
      userPinned:
        "ユーザー固定のため、元の素材全体と保存済みの時間情報を保持します。",
      identityMissing: "ソースのバイト列と保存済みの識別情報を確認できません。",
      timingUnavailable: "信頼できるソースの長さがありません。",
      unsupported: "この素材は現在の設計では元ファイル全体を保持します。",
      locked: "素材またはクリップの保護により元ファイルを保持します。",
      opaqueReference: "シーンやレイアウトの依存先にはソース全体が必要です。",
      evidenceBound:
        "文字起こし・来歴・拡張データには元のソース時刻が必要です。",
      independentAudio:
        "独立した音声タイミングには、元ファイル全体とその音声時刻を保持します。",
      rangeInvalid: "保存済みの範囲を整理前に確認してください。",
      unused: "参照されていますが、明確なクリップ範囲が見つかりません。",
    },
  },
};
