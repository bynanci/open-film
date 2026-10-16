import app from "../modules/app/ja-JP";
import editor from "../modules/editor/ja-JP";
import media from "../modules/media/ja-JP";
import precision from "../modules/precision/ja-JP";
import transcript from "../modules/transcript/ja-JP";
import system from "./system-ja-JP";

export default {
  ...system,
  ...app,
  ...editor,
  ...media,
  ...precision,
  ...transcript,
  scenePlan: {
    heading: "脚本とシーンを計画",
    description: "思い出をシーンにまとめ、それぞれの時間を割り当てます。",
    evidence:
      "このオフラインの下書きは、カテゴリー、撮影日、あらすじに基づきます。写真の内容は認識しません。脚本と演出メモは編集可能な計画用テキストで、ナレーション音声や字幕は生成しません。",
    close: "計画を閉じる",
    title: "作品名",
    brief: "どんな物語を伝えたいですか？",
    briefHint: "きっかけ、伝えたい気持ちやメッセージを記入してください。",
    grouping: "シーンのまとめ方",
    category: "カテゴリー",
    chronology: "撮影日",
    scope: "使う思い出",
    allMedia: "条件に合うすべてのメディア",
    visibleMedia: "現在のライブラリページ（{count}）",
    target: "目標時間（秒）",
    maximum: "上限時間（秒）",
    transition: "シーンのリズム",
    cut: "カット",
    crossfade: "クロスフェード",
    working: "準備中…",
    preview: "シーン案をプレビュー",
    review: "シーン案を確認",
    reviewHint:
      "シーン名、意図、脚本メモを編集してから、新しいストーリーと編集を作成します。既存の作品は残ります。",
    timing: "目標 {target} · 上限 {maximum}",
    audioExcluded:
      "音声のみの素材を除外しました：{count}。音楽は後で編集から追加できます。",
    previewAgain:
      "計画の設定が変わりました。もう一度プレビューし、時間を確認してから作成してください。",
    sceneTitle: "シーン名",
    intent: "シーンの意図",
    narration: "脚本・ナレーションメモ",
    visualDirection: "映像の演出",
    candidates: "候補の思い出：{count}",
    accept: "ストーリーと編集を作成",
    accepted:
      "ストーリーと編集を作成しました。下でシーンを確認するか、編集に進めます。",
    stale:
      "プレビュー後に素材または作品の言語が変わりました。脚本の下書きはここに残っています。再度プレビューして最新の案を作成してください。",
    discardWarning: "未保存のシーン案を破棄して閉じますか？",
    regenerateWarning:
      "再プレビューすると、この下書きで編集した脚本が置き換わります。残したい文章を先に控えてください。",
    keep: "下書きを残す",
    discard: "下書きを破棄",
    regenerate: "新しいプレビューで置換",
    draftPending:
      "プロジェクトを切り替える前に、シーン案を採用するか破棄してください。",
    sceneTiming: "実際 {actual} · 予算 {target}",
    memoryPreview: "選択した思い出のプレビュー",
    categories: "カテゴリー",
    categoriesHint:
      "カテゴリーをコンマで区切ります。最初のカテゴリーでシーンにまとめます。",
    saveCategories: "カテゴリーを保存",
    categoriesSaved: "カテゴリーを保存しました。",
    categoryPending: "現在のカテゴリーを保存してから続けてください。",
  },
  captions: {
    title: "字幕",
    description:
      "現在の編集と修正済みの文字起こしから字幕ファイルを作成します。動画や元のメディアは変更しません。",
    composition: "現在の編集",
    sourceTrack: "会話のトラック",
    chooseTrack: "トラックを1つ選択",
    noTracks: "この編集には字幕を作成できる動画・音声トラックがありません。",
    singleTrack:
      "字幕にする会話を含む動画・音声・音楽トラックを1つ選んでください。",
    generate: "字幕を作成",
    cancel: "キャンセル",
    checkStatus: "変更を確認",
    previewOnly:
      "文字と時間のみのプレビューです。字幕は別ファイルに保存され、動画には焼き込みません。",
    preview: "字幕プレビュー",
    cueCount: "字幕なし | 字幕 {count} 件 | 字幕 {count} 件",
    noCues:
      "利用できる字幕がありません。注意事項を確認し、文字起こしを修正または作成してから再生成してください。",
    blocked: "書き出せない問題を修正し、字幕を作成し直してください。",
    asset: "素材",
    revision: "文字起こしの版",
    clip: "クリップ",
    previous: "前へ",
    next: "次へ",
    page: "{total} 件中 {from}–{to} 件",
    attention: "書き出す前に確認",
    exportSrt: "SRTを書き出す",
    exportVtt: "WebVTTを書き出す",
    saved: "字幕ファイルを保存しました。",
    download: "字幕をダウンロード",
    downloadManifest: "出典記録をダウンロード",
    trackTypes: {
      video: "動画",
      audio: "音声",
      music: "音楽",
    },
    severity: {
      warning: "注意：",
      error: "書き出し不可：",
    },
    status: {
      idle: "トラックを選択してください。",
      loading: "字幕ファイルを準備中…",
      ready: "書き出せます。書き出し時に出典のスナップショットを再確認します。",
      attention:
        "字幕の確認が必要です。注意事項を読んでから書き出してください。",
      stale:
        "編集または元の文字起こしが変更されました。字幕を作成し直してください。",
      failed:
        "字幕を準備できませんでした。以下の理由を確認して再試行してください。",
      cancelled: "キャンセルしました。字幕を作成し直せます。",
    },
    issues: {
      TRACK_UNSUPPORTED:
        "このトラックでは字幕を作成できません。動画・音声・音楽トラックを選択してください。",
      TIMING_UNSUPPORTED:
        "このクリップの時間設定は安全に変換できません。対応する正の固定速度にして再生成してください。",
      SOURCE_UNAVAILABLE:
        "素材がオフラインか読み取れないため、字幕を省略しました。再接続して作成し直してください。",
      TRANSCRIPT_MISSING:
        "利用できる文字起こしがないため、字幕を省略しました。文字起こし後に再生成してください。",
      TRANSCRIPT_STALE:
        "文字起こしが別の素材バージョンに由来するため、字幕を省略しました。現在の素材を確認して再度文字起こししてください。",
      MEDIA_UNSUPPORTED:
        "この素材から会話の字幕は作成できないため省略しました。",
      MUTED_CLIP: "このクリップはミュートされているため、字幕を省略しました。",
      PARTIAL_SEGMENT:
        "編集で文字起こしの区間が途中で切れています。残った単語を確実に判定できないため、区間全体を省略しました。",
      ALIGNMENT_STALE:
        "文字が修正されているため、区間の時間を使います。単語の時間を正確な対応として扱いません。",
      TIMING_ESTIMATED:
        "この区間の時間は推定です。動画を再生して字幕の時間を確認してください。",
      INVALID_SEGMENT:
        "文字起こし区間の時間が無効です。修正してから書き出してください。",
      INVALID_TEXT:
        "この区間に無効な文字があります。修正してから書き出してください。",
      EMPTY_TEXT: "空の文字起こし区間を省略しました。",
      TEXT_ESCAPED:
        "特殊な文字には形式に応じた処理が必要です。SRT で保持できない場合は WebVTT を選んでください。",
      ZERO_DURATION: "出力時刻の丸め処理後に長さが残らない区間を省略しました。",
      OVERLAP:
        "字幕の時間が重複しています。両方を保持しますが、表示はプレーヤーによって異なります。",
      MUSIC_SOURCE:
        "音楽トラックが選択されています。必要な会話が含まれているか確認してください。",
      LIMIT_EXCEEDED:
        "字幕の上限を超えています。短い編集またはトラックを選択してください。",
      unknown: "この字幕は確認が必要です。詳細は出典記録をご覧ください。",
    },
  },
  errors: {
    ...system.errors,
    story: {
      ...system.errors.story,
      sceneTooShort:
        "これらのシーンには少なくとも {minimum} 秒必要です。目標時間と上限時間を延ばすか、カテゴリーをまとめてください。",
      sceneLimit:
        "このシーン案は {limit} グループを超えています。カテゴリーを減らすか、思い出を絞ってください。",
      planStale:
        "素材または作品の言語が変わりました。シーン案を再プレビューしてから採用してください。",
      planConflict:
        "このシーン案は別の内容ですでに採用されています。作成済みのストーリーを開くか、新しい案を作成してください。",
    },
    captions: {
      srtTextUnsupported:
        "この文字には SRT で確実に保持できない書式の構文が含まれています。WebVTT で書き出してください。",
      invalid:
        "この字幕は書き出せません。注意事項を確認し、対応するトラックを選択してください。",
      stale:
        "編集または文字起こしが変更されました。字幕を作成し直してから書き出してください。",
      failed:
        "字幕ファイルを保存できませんでした。プロジェクトの場所と空き容量を確認して再試行してください。",
      unavailable:
        "この字幕スナップショットは利用できません。字幕を作成し直してください。",
    },
  },
};
