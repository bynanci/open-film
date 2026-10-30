// SPDX-License-Identifier: Apache-2.0
export default {
  primaryColor: {
    applyHint: "「適用」で値を保存し、モニターを更新します。",
    current:
      "現在：色調 {temperature}、符号化 SDR ゲイン {exposure} EV、コントラスト {contrast}。",
    heading: "基本色補正",
    description:
      "符号化 SDR 値の暖色・寒色、ゲイン、コントラストを調整します。ゲインは EV 単位です。校正されたシーン露出には別途カラーマネジメントが必要です。",
    scope: "設定の範囲",
    scopes: {
      film: "フィルム全体",
      beat: "シーン",
      clip: "クリップ",
      original: "未補正",
    },
    temperature: "暖色／寒色（−1～1）",
    exposure: "符号化 SDR ゲイン（EV）",
    contrast: "コントラスト（0.5～1.5）",
    apply: "基本色補正を適用",
    neutral: "中立の値",
    inherit: "継承",
    effective: "有効な基本色設定：{scope}",
    review: "自動マッチ・統計上の提案",
    statistical:
      "フィルムルック適用前の明るさ、色調、コントラストを統計で比較します。実際のサンプルを確認してから適用してください。不透明な写真または平面動画のクリップを2つ使用します。各ソースは512 MiB以内です。",
    reference: "参照クリップ",
    measure: "提案を測定",
    discard: "破棄／キャンセル",
    measuring: "ローカルソースのサンプルを測定中…",
    failed:
      "比較できません。対応する不透明なソース2つが利用可能で、各512 MiB以内であることと、フィルムの保存状態を確認して再測定してください。",
    sample: "サンプル",
    variants: {
      reference: "参照",
      before: "基本補正前",
      after: "基本補正の提案",
    },
    median: "輝度中央値（0～255）",
    clipping: "クリップしたサンプル画素",
    proposed:
      "提案：色調 {temperature}、符号化 SDR ゲイン {exposure} EV、コントラスト {contrast}。",
    reviewed: "参照、補正前、提案のサンプルを確認しました。",
    applyClip: "このクリップに提案を適用",
    warnings: {
      "statistical-suggestion":
        "統計上の提案です。照明やシーン内容の違いを確認してください。",
      "insufficient-evidence":
        "サンプルが暗すぎる、平坦、またはクリップ過多のため有効な提案ができません。手動で調整してください。",
      "no-useful-match":
        "測定による改善または編集条件が不十分です。現在の設定を維持するか手動で調整してください。",
    },
  },
};
