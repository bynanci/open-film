# 生成された Proposal Film 参照素材ライブラリ

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

```sh
node fixtures/proposal-film/generate.mjs /tmp/openfilm-proposal-reference
```

ジェネレーターは FFmpeg とリポジトリに同梱された Perl ExifTool パッケージを使い、再利用可能な CC0 の幾何学写真、テストパターン動画、合成音声を生成します。通常の Proposal Film ワークフローには生成された `media/` ディレクトリを読み込みます。生成バイナリはコミットされません。

`media/` には10種類の素材があります。風景、類似ショット、バイト単位で同一のコピー、ポートレート、撮影メタデータのない PNG、Google Pixel を模したポートレートと MP4、Insta360 のフラット JPG／MP4 エクスポートを模した素材、8秒の音声です。Pixel JPEG にはカメラ、撮影時刻、タイムゾーン、向き、合成 GPS 座標の実際の EXIF フィールドと実験的な Motion Photo タグがあります。端末名はメタデータの模擬対象であり、画像の実際の出所ではありません。

`raw/` には任意のアダプター用素材が5つあります。`.insv`／`.insp` の認識用ファイル、メタデータだけの DNG、タグ付き Pixel 写真／動画サイドカーです。未対応ソースのテストでは別途このディレクトリを読み込みます。360素材は raw 拡張子を付けた通常の MP4／JPEG コンテナーです。DNG は実際の DNG／EXIF タグを持ち、画像ストリップを含まない最小の TIFF 構造です。これらは認識、メタデータ保持、明示されたプレビュー制限を検証します。実機のスティッチング、RAW デモザイク、光学的な見え方はカメラのオリジナル素材で別途確認が必要です。

`manifest.json` は相対パス、期待するメタデータ、ハッシュ、バイト数、合成素材の由来、CC0 ライセンスを記録します。編集、レンダー、プロジェクト移動、再リンク後に元データのハッシュを確認できます。

```js
import { generateProposalMedia } from "./fixtures/proposal-film/generate.mjs";

const fixture = await generateProposalMedia("/tmp/reference", {
  includeRaw: true, // 既定 true。false は通常素材のみ
});
// fixture.mediaDirectory, fixture.rawDirectory, fixture.manifestPath
// fixture.byId["pixel-photo"], fixture.byId["insta360-video"]
// fixture.files: id, path, kind, expected, synthetic, sha256, bytes
```

編集練習の例：冒頭の風景から始め、完全一致するコピーを除外し、類似ショットを比較します。2つの動画をトリミングし、中盤にポートレートを配置して、Insta360 のフラットエクスポートで締めます。その後、素材とプロジェクトのディレクトリを移動して開き直し、評価と編集を保ったまま再リンクします。撮影メタデータのない PNG はファイルシステム時刻へのフォールバックを試し、音楽は録音演奏ではなく2つの正弦波です。
