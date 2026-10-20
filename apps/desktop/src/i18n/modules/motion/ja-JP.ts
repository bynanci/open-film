export default {
  motion: {
    chooseScene: "関連する M8A シーンを選択",
    states: {
      preview: "プレビュー",
      accepted: "承認済み",
      prepared: "読み込みを復旧中",
      imported: "読み込み済み",
      restored: "復元済み",
      revoked: "破棄済み",
    },
    clear: "未採用のモーションプレビューをすべて破棄",
    heading: "モーション候補",
    localOnly:
      "ローカル審査のみ。リモート生成は無効です。人物のいない風景を推奨します。",
    provider: "候補のソース",
    fixture: "ローカルカメラテスト（AI ではありません）",
    external: "外部動画を読み込む",
    loadVideos: "ライブラリ動画を読み込む",
    externalNotice:
      "先にライブラリへ動画を読み込み、1～3 本を選択します。原画との関係は利用者の申告です。アップロードしません。",
    prompt: "意図（ハッシュのみ保存）",
    negative: "変更禁止事項（ハッシュのみ保存）",
    scene: "関連する M8A シーン",
    original: "元の写真",
    people: "人物または重要な実物の細部を含む",
    warning:
      "動きにより人物、表情、細部が変形する場合があります。各候補を手動で比較してください。保持は保証されません。",
    consent: "このローカル候補処理に同意します。元の素材は保持されます。",
    generate: "候補をプレビュー",
    cancel: "キャンセル／プレビューを破棄",
    failed:
      "処理に失敗したか結果が古くなりました。保存済み版とソースを確認し、新しくプレビューしてください。",
    compareTime: "M8A 比較時刻",
    compareM8a: "この時刻の M8A フレームを表示",
    reviewed:
      "人物、細部、輪郭、色を手動確認しました。忠実性の保証ではありません。",
    candidate: "候補 {number}",
    free: "無料のローカルテスト。24 時間または破棄で期限切れ。",
    unknownCost: "外部生成の費用と由来は利用者の申告です。",
    accept: "審査後に承認",
    import: "選択した写真クリップを置換",
    restore: "元の写真／M8A を復元",
  },
};
