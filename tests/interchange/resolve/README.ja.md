# Resolve 準備用フィクスチャとパーサー検証

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

`verify.py` は公式 OpenTimelineIO 0.18.1 と FFprobe を使用します。`scripts/verify-interchange.ts` 経由で実行すると、手続き型の CC0 素材と3つの OTIO ケースを生成し、公式の読み込み／書き込み／再読み込みを行います。実際のファイル URL、ハッシュ、境界を検査し、ソース欠落時に検証が失敗することも確認します。DaVinci Resolve のプロセスは起動も模擬もしません。

```sh
OPENFILM_OTIO_PYTHON=/path/to/otio-venv/bin/python pnpm test:interchange --output /path/to/empty/bundle
```

出力にはカットのみ、メタデータのみの高度な編集、分数フレームレートのケースと、期待する manifest／レポートが含まれます。高度な効果は手動で再作成する必要があります。スローモーションのケースは、ラベル付きのパディング間隔を意図的に示します。保持されるソースはデコード可能な合成 PNG／MP4／WAV で、検証後も元ソースのハッシュは変わりません。

Resolve のインポートチェックリストとして使う前に、[NLE 互換性と手動 QA](../../../docs/nle-compatibility.md)を確認してください。このスクリプトの成功はパーサーとソース参照の証拠であり、Resolve で実際にインポートした結果ではありません。
