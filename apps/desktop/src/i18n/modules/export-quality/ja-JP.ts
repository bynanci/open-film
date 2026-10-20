// SPDX-License-Identifier: Apache-2.0
export default {
  exportQuality: {
    heading: "出力画質",
    savedFrame: "動画サイズとフレームレート",
    frame: "{width} × {height} · 毎秒 {frameRate} フレーム",
    source: "使用する素材",
    originals: "オリジナルの写真と動画",
    quality: "MP4 の画質",
    captionTrack: "MP4 に字幕を焼き込む",
    captionTrackAutomatic: "最初の保存済み字幕トラック",
    captionTrackNone: "字幕を焼き込まない",
    captionTrackHint: "SRT と WebVTT は別ファイルとしてダウンロードできます。",
    standard: "標準",
    highDetail: "高精細",
    standardHint: "ファイルサイズと書き出し時間のバランスを保ちます。",
    highDetailHint:
      "圧縮を抑えます。書き出しに時間がかかり、ファイルも通常は大きくなります。",
    frameUnchanged:
      "画質の選択は圧縮だけを変えます。保存済みのフレームや編集内容は変わりません。",
    limits:
      "元の素材にない細部や、写真の拡大時に失われた細部を復元することはできません。",
  },
  exportProfiles: {
    heading: "出力フレーム",
    description:
      "保存済み Composition は変更せずに出力比率を選択します。プレビューには実際にレンダリングしたフレームを使います。",
    ratio: "アスペクト比",
    framing: "収め方",
    contain: "全体表示（黒帯）",
    crop: "中央でクロップ",
    frameTime: "プレビュー時刻（秒）",
    outputFrameRate: "{frameRate} fps",
    cropWarning:
      "中央クロップでは人物、グラフィックカード、字幕のセーフエリアが切れる場合があります。実際のフレームを確認してから出力してください。",
    letterboxWarning:
      "保存済み Composition のフレーム全体を保ち、黒帯で出力比率を合わせます。",
    alphaWarning: "PNG は不透明画像で出力され、透明背景には対応していません。",
    noAudioRoles:
      "ナレーション、音楽、環境音、台詞のクリップがないため、役割別ステムは作成されません。",
    previewFrame: "出力フレームをプレビュー",
    renderingPreview: "プレビューをレンダリング中…",
    saveStill: "静止画 PNG を保存",
    cancel: "出力をキャンセル",
    confirmCrop:
      "プレビューを確認し、この中央クロップで出力することを確認します。",
    previewAlt: "{time} 秒のレンダリング済み出力フレーム",
    previewDetails: "{width} × {height} · {time} 秒 · フレーム {frame}",
    stillSaved: "静止画を保存しました",
    downloadStill: "{filename} をダウンロード",
    downloadReceipt: "素材とレンダリングの記録をダウンロード",
    audioHeading: "音声出力",
    audioDescription:
      "WAV ミックスと役割別ステムは、現在のクリップ、フェード、ゲイン、ミュート、ダッキングを使います。すべて Composition と同じ時間範囲です。",
    saveMix: "全体ミックス WAV を保存",
    saveStems: "役割別ステムを保存",
    exportingAudio: "音声を書き出し中…",
    audioSaved: "音声を書き出しました",
    audioFile:
      "{role}：{filename} · {duration} 秒 · {sampleRate} Hz · {channels} チャンネル · {samples} サンプル",
    roles: {
      mix: "全体ミックス",
      narration: "ナレーション",
      music: "音楽",
      ambience: "環境音",
      dialogue: "台詞",
    },
  },
};
