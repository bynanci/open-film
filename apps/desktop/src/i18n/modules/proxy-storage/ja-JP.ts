// SPDX-License-Identifier: Apache-2.0
export default {
  proxyStorage: {
    heading: "プレビューの保存領域",
    usage: "{quota} 中 {used} 使用",
    loading: "保存領域を確認中…",
    description:
      "軽量プレビューで編集を滑らかにします。書き出しには元の素材を使用し、プレビューはこの端末に保存します。",
    capacity: "プレビューキャッシュ使用量",
    otherUsage: "旧プレビュー：{legacy} · 作業用ファイル：{temporary}",
    incomplete:
      "一部のキャッシュを確認できません。保存領域を検証するまで削除を停止します。",
    working: "プレビューの保存領域を更新中…",
    running: "バックグラウンドでプレビューを準備中…",
    prepare: "不足するプレビューを準備",
    runQueued: "キューを実行（{count}）",
    resume: "停止した準備を再試行",
    cancel: "準備をキャンセル",
    verify: "このページを検証",
    previewCleanup: "削除内容を確認",
    refresh: "更新",
    protected: "削除から保護",
    checked: "ハッシュ検証済み",
    prepareSource: "「{name}」のプレビューを準備",
    prepareOne: "準備",
    empty: "準備が必要な動画・音声はありません。",
    pages: "プレビュー素材のページ",
    previous: "前へ",
    next: "次へ",
    pageCount: "{total} 件中 {first}–{last} 件",
    cleanupReview: "削除するプレビューを確認",
    cleanupSummary:
      "{count} 件 · {bytes} を解放可能 · 保護対象 {protected} 件を確認",
    moreCleanup: "ほかの対象が残っている場合、完了後に次の一覧を確認できます。",
    confirmCleanup:
      "上記のプレビューだけを削除し、元の素材と保存済みの編集を保持します。",
    acceptCleanup: "確認したプレビューを削除",
    settings: "保存領域の設定",
    quota: "管理するプレビューの上限（MiB）",
    savePolicy: "上限を保存",
    quotaHint:
      "1 MiB–1 TiB。上限を下げてもファイルは削除しません。削除内容を個別に確認してください。",
    recovery: "中断したプレビュー作業",
    recoveryHint:
      "以前の実行元を確認できません。ほかの OpenFilm 作業が停止したことを確認してから復旧してください。実行中の作業は引き継げません。",
    confirmStopped:
      "以前の作業とプレビューの読み込みが停止したことを確認しました。",
    recover: "停止した作業を復旧",
    cancelRequested:
      "キャンセルを要求しました。安全に停止するまでお待ちください。",
    verificationResult:
      "{total} 件中 {checked} 件を検証しました。残りは素材の状態を確認してください。",
    cleanupResult: "{bytes} を解放しました。再確認が必要なファイル：{failed}。",
    jobTitle: "プレビュー準備",
    status: {
      queued: "待機中",
      running: "準備中",
      cancelling: "停止中…",
      ready: "準備完了",
      missing: "未準備",
      stale: "再作成が必要",
      failed: "準備に失敗",
      cancelled: "キャンセル済み",
      legacy: "旧プレビュー",
      unavailable: "確認が必要",
    },
  },
};
