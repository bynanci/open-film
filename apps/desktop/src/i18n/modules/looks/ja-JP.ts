// SPDX-License-Identifier: Apache-2.0
export default {
  looks: {
    heading: "映像のルック",
    description: "作品全体のルックを選び、シーンやクリップごとに調整できます。",
    film: "作品全体",
    beat: "このシーン",
    clip: "このクリップ",
    inherit: "上位の設定を継承",
    strength: "強さ",
    strengthLabel: "{scope}の強さ",
    resolved: "表示：{preset} · {source}",
    sources: {
      export: "今回の出力",
      clip: "クリップの設定",
      beat: "シーンの設定",
      film: "作品全体の設定",
      original: "元の色",
    },
    presets: {
      none: "元の色",
      "soft-film": "ソフトフィルム",
      americana: "アメリカーナ",
      "clean-camera": "一眼カメラ風",
      retro: "レトロ",
      natural: "ナチュラル",
      sport: "スポーツ",
    },
    hints: {
      none: "素材本来の色を保ちます。",
      "soft-film":
        "富士の写真を思わせる柔らかな緑と穏やかなコントラスト。日々の思い出に。",
      americana: "暖かな色と深いコントラストで、印象的な旅の映像に。",
      "clean-camera":
        "鮮明なディテールとバランスのよいコントラストで、上質なカメラの雰囲気に。",
      retro: "影を持ち上げ、色を抑えた色あせた時代の雰囲気。",
      natural: "なじみのある色を保ちながら、控えめに整えます。",
      sport: "鮮やかな色と力強いコントラストで、動きのある瞬間を引き立てます。",
    },
    protected:
      "クリップまたはライブラリの素材のロックを解除してから、ルックを変更してください。",
    previewNote:
      "ルックは写真と動画に適用されます。素材表示は仕上がりの目安です。特に動画やHDR素材は「プレビューを作成」で最終的な映像を確認してください。",
    exportHeading: "MP4のルック",
    exportMode: "今回の出力のルック",
    preserve: "シーンとクリップのルックを保持",
    unify: "今回の出力を一つのルックに統一",
    exportPreset: "出力ルック",
    exportStrength: "出力の強さ",
    exportOnly:
      "出力の選択は保存済みの編集を変えません。レンダリングプレビューも同じ選択を使います。",
    uniformHint:
      "今回の出力ではロック中のクリップも含めてルックを統一します。プロジェクト設定は変更しません。",
    previewOverride:
      "レンダリングプレビュー：作品全体に「{preset}」。編集モニターは保存済みのシーンとクリップのルックを表示します。",
    interchange:
      "編集用の書き出しは保存済みルックの情報を保持します。編集アプリで手動再現してください。MP4専用の統一設定は含まれません。",
  },
};
