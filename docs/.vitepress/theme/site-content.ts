export type SiteLocale = "en-US" | "zh-TW" | "ja-JP";
export interface SiteCopy {
  eyebrow: string;
  title: [string, string];
  description: string;
  start: string;
  explore: string;
  workflow: string;
  guides: string;
  pathTitle: string;
  pathDescription: string;
  steps: [string, string, string][];
  productTitle: string;
  productIntro: string;
  panels: [string, string, string][];
  screenshot: string;
  exampleTitle: string;
  exampleDescription: string;
  exampleLabel: string;
  exampleUnavailable: string;
  values: [string, string][];
  availability: string;
  sourceNotice: string;
  ending: string;
  endingDescription: string;
  gardenCredit: string;
  source: string;
  community: string;
  guideIntro: string;
  guideGroups: [string, string][];
  englishReference: string;
  setupSteps: [string, string][];
}

const en: SiteCopy = {
  eyebrow: "OPEN SOURCE · LOCAL FIRST · STORY FIRST",
  title: ["A little order.", "A story of your own."],
  description:
    "Bring your photos, videos, and recordings together. Find the moments that matter, shape a story, and make a film you can keep editing.",
  start: "Start your first film",
  explore: "Follow the workflow",
  workflow: "Workflow",
  guides: "Guides",
  pathTitle: "One thoughtful step at a time.",
  pathDescription:
    "A clear route from scattered memories to a finished film. Move freely between steps, with your decisions always in your hands.",
  steps: [
    [
      "Add media",
      "Bring your photos, video, and audio into one local library.",
      "_1-add-media",
    ],
    [
      "Organize",
      "Find related moments. Keep favorites and protect important memories.",
      "_2-organize-media",
    ],
    [
      "Build a story",
      "Give your memories an order, an intention, and a little room to breathe.",
      "_3-build-the-story",
    ],
    [
      "Edit",
      "Refine timing, framing, sound, and captions with edits you can undo.",
      "_4-edit-and-preview",
    ],
    [
      "Export",
      "Make a playable MP4, or prepare a cut for further finishing.",
      "_5-export-and-check",
    ],
  ],
  productTitle: "Make room for the moments that matter.",
  productIntro:
    "A workspace for memories and stories, with precise tools close by when you need them.",
  panels: [
    [
      "A home for your memories.",
      "Browse photos and clips, inspect a source, and choose what belongs in your film. Missing files keep their place while you reconnect them.",
      "library",
    ],
    [
      "See the shape of your story.",
      "Arrange beats, connect ideas, and select the memories for each moment. Set the film's target length before refining the cut.",
      "story",
    ],
    [
      "Keep the final say.",
      "Trim a video, hold a photo a little longer, adjust sound, or review a shortening suggestion. Your originals stay untouched.",
      "edit",
    ],
  ],
  screenshot:
    "Actual development workspace in English, using generated sample media.",
  exampleTitle: "A quiet afternoon, in twelve seconds.",
  exampleDescription:
    "A silent sample rendered by OpenFilm from the original generated garden images used on this site. Press play to load the film.",
  exampleLabel: "Play the twelve-second OpenFilm garden sample",
  exampleUnavailable:
    "This browser could not play the sample. You can still follow the film-making workflow.",
  values: [
    [
      "Your media stays with you.",
      "The basic workflow runs locally, without a cloud account. Optional remote services require your setup and consent.",
    ],
    [
      "Suggestions you can review.",
      "See the proposed change and its reason. Choose what to accept, keep your own words, and undo an edit.",
    ],
    [
      "Open to make your own.",
      "Apache-2.0 source, shareable project data, and documented handoff limits. Explore, contribute, and build on the work.",
    ],
  ],
  availability: "Available from source",
  sourceNotice:
    "v0.4.0 is the published source release. The screenshots show current development. Distributable desktop installers are not available yet.",
  ending: "Every film starts with a first step.",
  endingDescription:
    "Start with a few photos and a short clip. The guide takes you from setup to your first MP4.",
  gardenCredit: "Original generated garden imagery · asset origins",
  source: "Source code",
  community: "Community",
  guideIntro:
    "Choose the task in front of you. Each guide gives you a practical next step, including the limits and recovery options.",
  guideGroups: [
    ["Start a film", "Set up OpenFilm and learn the route."],
    ["Organize memories", "Understand sources and keep media connected."],
    ["Shape a story", "Arrange beats and choose important moments."],
    ["Refine the edit", "Control timing, framing, words, and sound."],
    ["Finish and export", "Create an MP4 or prepare further editing."],
    ["Find your way back", "Reconnect media and recover interrupted work."],
    ["Build with OpenFilm", "Understand the architecture and contribute."],
  ],
  englishReference: "English reference",
  setupSteps: [
    ["Prepare", "_1-prepare-your-environment"],
    ["Start locally", "_2-start-the-local-workspace"],
    ["Make a film", "_3-make-your-first-film"],
  ],
};
const zh: SiteCopy = {
  eyebrow: "開源 · 本機優先 · 從故事開始",
  title: ["讓回憶找到次序。", "讓故事成為電影。"],
  description:
    "把照片、影片與錄音放在一起，找出值得留下的時刻。安排故事、細修剪輯，做一部始終由你掌握的影片。",
  start: "開始製作第一部影片",
  explore: "走一遍製作流程",
  workflow: "製作流程",
  guides: "使用指南",
  pathTitle: "一步一步，走成一段故事。",
  pathDescription:
    "從散落的素材走到完成的影片，每一步都有清楚的方向。你可以自由往返，保留每一次自己的決定。",
  steps: [
    ["加入素材", "讓照片、影片與錄音，在本機素材庫裡相遇。", "_1-加入素材"],
    ["整理回憶", "找出相關時刻，標記最愛，保護重要的回憶。", "_2-整理素材"],
    ["安排故事", "為回憶安排次序、意圖，以及適當的停留。", "_3-建立故事"],
    ["細修剪輯", "調整長度、構圖、聲音與字幕，隨時可以復原。", "_4-剪輯與預覽"],
    ["輸出影片", "製作可以播放的 MP4，或準備接續其他工具。", "_5-輸出並檢查"],
  ],
  productTitle: "把空間留給重要的時刻。",
  productIntro: "以回憶與故事為中心的工作區，需要精準工具時，也能順手找到。",
  panels: [
    [
      "讓回憶有個位置。",
      "瀏覽照片與短片、檢視來源，選擇屬於這部影片的素材。檔案離線時，仍保留它的位置與編輯。",
      "library",
    ],
    [
      "看見故事的形狀。",
      "安排段落、連結想法，為每個時刻挑選回憶。先設定片長方向，再逐步完成剪輯。",
      "story",
    ],
    [
      "最後的決定，留給你。",
      "修剪短片、讓照片多停留一會、調整聲音，或檢視縮短建議。原始素材始終保持不變。",
      "edit",
    ],
  ],
  screenshot: "使用生成範例素材的實際開發版工作區（英文介面）。",
  exampleTitle: "十二秒，留住安靜的午後。",
  exampleDescription:
    "由 OpenFilm 使用本網站的原創生成庭園圖像算繪的無聲範例。按下播放才會載入影片。",
  exampleLabel: "播放十二秒的 OpenFilm 庭園範例",
  exampleUnavailable: "這個瀏覽器無法播放範例，仍可依照製作流程開始。",
  values: [
    [
      "素材留在你身邊。",
      "基本流程在本機完成，不需要雲端帳號。選用遠端服務時，須由你設定並同意資料傳送。",
    ],
    [
      "先理解，再採用。",
      "看見建議、變更與理由，再決定採用哪些內容。保留自己的文字，也能復原編輯。",
    ],
    [
      "開放，也能成為你的作品。",
      "Apache-2.0 原始碼、可攜的專案資料，以及清楚記錄的交接限制。歡迎探索、貢獻與延伸。",
    ],
  ],
  availability: "目前可從原始碼啟動",
  sourceNotice:
    "已發布的原始碼版本為 v0.4.0；畫面呈現目前開發中的功能。尚未提供可散布的桌面安裝程式。",
  ending: "每部影片，都從第一步開始。",
  endingDescription:
    "先選幾張照片與一段短片，跟著指南完成設定，走到第一個 MP4。",
  gardenCredit: "原創生成庭園圖像 · 素材來源",
  source: "原始碼",
  community: "社群",
  guideIntro:
    "從眼前想完成的事開始。每份指南都提供具體下一步，並說明限制與復原方式。",
  guideGroups: [
    ["開始製作", "設定 OpenFilm，認識製作路徑。"],
    ["整理回憶", "了解來源，保持素材連結。"],
    ["安排故事", "編排段落，選擇重要時刻。"],
    ["細修剪輯", "掌握時間、構圖、文字與聲音。"],
    ["完成與輸出", "製作 MP4，或準備接續剪輯。"],
    ["找回製作進度", "重新連結素材，復原中斷的工作。"],
    ["一起開發 OpenFilm", "了解架構，參與貢獻。"],
  ],
  englishReference: "英文參考文件",
  setupSteps: [
    ["準備環境", "_1-準備環境"],
    ["本機啟動", "_2-啟動本機工作區"],
    ["製作影片", "_3-製作第一部影片"],
  ],
};
const ja: SiteCopy = {
  eyebrow: "オープンソース · ローカルファースト · ストーリーから",
  title: ["思い出に、ひとつの流れを。", "あなただけの映画へ。"],
  description:
    "写真、動画、録音をひとつに。大切な瞬間を見つけ、物語を組み立て、自分の手で仕上げられる映画にしましょう。",
  start: "最初の映画をつくる",
  explore: "制作の流れを見る",
  workflow: "制作の流れ",
  guides: "ガイド",
  pathTitle: "一歩ずつ、ひとつの物語へ。",
  pathDescription:
    "散らばった思い出から、完成した映画まで。段階を自由に行き来しながら、自分の判断で進められます。",
  steps: [
    [
      "素材を追加",
      "写真、動画、音声をローカルのライブラリへ。",
      "_1-素材を追加する",
    ],
    [
      "思い出を整理",
      "つながる瞬間を見つけ、大切な素材を保護します。",
      "_2-素材を整理する",
    ],
    [
      "物語を組み立てる",
      "順番と意図を決め、それぞれの瞬間に余白を。",
      "_3-ストーリーを組み立てる",
    ],
    [
      "編集する",
      "長さ、構図、音声、字幕を調整。編集は取り消せます。",
      "_4-編集してプレビューする",
    ],
    [
      "書き出す",
      "再生できる MP4 や、仕上げを続けるためのデータへ。",
      "_5-書き出して確認する",
    ],
  ],
  productTitle: "大切な瞬間のための、余白。",
  productIntro:
    "思い出と物語を中心に。細かな調整が必要なときは、精密なツールがすぐそばにあります。",
  panels: [
    [
      "思い出の居場所を。",
      "写真やクリップを見渡し、元の素材を確認して映画に残すものを選びます。ファイルがオフラインでも、配置と編集は残ります。",
      "library",
    ],
    [
      "物語のかたちを見る。",
      "段落を並べ、アイデアをつなぎ、各場面の思い出を選びます。目標の長さを決めてから、編集を整えられます。",
      "story",
    ],
    [
      "最後に決めるのは、あなた。",
      "動画をトリムし、写真を少し長く見せ、音声や短縮案を確認します。元の素材は書き換えません。",
      "edit",
    ],
  ],
  screenshot: "生成したサンプル素材を使った実際の開発版画面（英語表示）です。",
  exampleTitle: "静かな午後を、十二秒に。",
  exampleDescription:
    "本サイトのオリジナル生成庭園画像から、OpenFilm で書き出した無音のサンプルです。再生を押すと動画を読み込みます。",
  exampleLabel: "十二秒の OpenFilm 庭園サンプルを再生",
  exampleUnavailable:
    "このブラウザーではサンプルを再生できません。制作ガイドは引き続き利用できます。",
  values: [
    [
      "素材は、あなたの手元に。",
      "基本の制作はローカルで完結。クラウドアカウントは不要です。任意のリモートサービスには設定と同意が必要です。",
    ],
    [
      "確認してから、反映。",
      "変更案と理由を見て、採用するものを選べます。自分の言葉を残し、編集を取り消すこともできます。",
    ],
    [
      "自由に育てられる道具。",
      "Apache-2.0 のソース、持ち運べるプロジェクト、明示された引き渡しの制限。探索、貢献、改良を歓迎します。",
    ],
  ],
  availability: "ソースコードから利用できます",
  sourceNotice:
    "公開済みのソースリリースは v0.4.0 です。画面は現在の開発版です。配布可能なデスクトップインストーラーはまだありません。",
  ending: "どんな映画も、最初の一歩から。",
  endingDescription:
    "数枚の写真と短い動画から。設定から最初の MP4 まで、ガイドと一緒に進めましょう。",
  gardenCredit: "オリジナル生成庭園画像 · 素材の出典",
  source: "ソースコード",
  community: "コミュニティ",
  guideIntro:
    "いま取り組みたいことから選べます。各ガイドに具体的な次の一歩と、制限や復旧方法をまとめています。",
  guideGroups: [
    ["映画を始める", "設定と制作の流れを知る。"],
    ["思い出を整理する", "素材を理解して接続を保つ。"],
    ["物語を組み立てる", "段落を並べ、大切な瞬間を選ぶ。"],
    ["編集を整える", "タイミング、構図、言葉、音声を調整する。"],
    ["仕上げと書き出し", "MP4 を作り、次の編集へ引き継ぐ。"],
    ["制作に戻る", "素材を再リンクし、中断した作業を復旧する。"],
    ["OpenFilm を育てる", "アーキテクチャを理解して貢献する。"],
  ],
  englishReference: "英語の参考資料",
  setupSteps: [
    ["環境の準備", "_1-環境を準備する"],
    ["ローカル起動", "_2-ローカルワークスペースを起動する"],
    ["映画をつくる", "_3-最初の映画を制作する"],
  ],
};
export const siteContent: Record<SiteLocale, SiteCopy> = {
  "en-US": en,
  "zh-TW": zh,
  "ja-JP": ja,
};
// VitePress uses NFKD heading slugs; Japanese voiced kana otherwise link to a different DOM id.
for (const copy of Object.values(siteContent)) {
  for (const step of copy.steps) step[2] = step[2].normalize("NFKD");
  for (const step of copy.setupSteps) step[1] = step[1].normalize("NFKD");
}
export function siteLocale(lang: string): SiteLocale {
  return lang.startsWith("ja")
    ? "ja-JP"
    : lang.startsWith("zh")
      ? "zh-TW"
      : "en-US";
}
export function sitePrefix(locale: SiteLocale): string {
  return locale === "zh-TW" ? "/" : locale === "ja-JP" ? "/ja/" : "/en/";
}
