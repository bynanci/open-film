# Google Pixel ソースアダプター

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

`PixelSource` は既存のローカルメディアソースポートを実装します。`enrichPixelAsset` は EXIF／QuickTime の Google ブランドと Pixel カメラモデルを見て識別します。ファイル名や Google Photos のソフトウェアタグだけでは `GenericCamera` のままです。元の EXIF／FFprobe 拡張、ID、ハッシュ、評価、ロックを保持します。日付オフセット、向き、GPS、カメラ、寸法、コーデック、フレームレート、色／HDR の根拠もソースメタデータと `openfilm.pixel.evidence` に残ります。

Motion Photo は実験的な検出のみです。範囲内の正の動画バイトオフセット、または ExifTool の埋め込み動画フィールドを `embedded` として記録します。タグと同じディレクトリの通常動画が一致する場合は `sidecar`、参照先を解決できない場合は `metadata-reference` です。オフセットは MP4 抽出の検証ではなく、ファイル名による組み合わせも対応関係の証明ではありません。元ファイルの変更、埋め込み動画の抽出、モーション再生の構築、製品対応の主張は行いません。参照する sidecar はソースと同じディレクトリに必要で、シンボリックリンクは無視します。

`inspectPixelDng` は通常の検査と1フレームのデコードを試します。インストール済みツールでデコードできなくても、実際の ExifTool DNG メタデータがあれば `openfilm.preview.supported: false` と RAW 書き出しの案内を付けてカタログに保持します。DNG メタデータのない不正ファイルは失敗します。合成メタデータのテストはカタログ保持を確認するもので、実機 Pixel の RAW デモザイク、光学出力、HDR の見え方を証明しません。これらは手動確認が必要です。
