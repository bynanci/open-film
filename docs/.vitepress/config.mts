import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

const guide = (label: string, path: string) => ({
  text: label,
  link: `/${path}`,
});
const group = (
  text: string,
  items: ReturnType<typeof guide>[],
  collapsed = true,
) => ({ text, collapsed, items });
const keepExisting = (items: ReturnType<typeof guide>[]) =>
  items.filter(({ link }) =>
    existsSync(new URL(`../${link.slice(1)}.md`, import.meta.url)),
  );
const tokenizeForSearch = (text: string) =>
  Array.from(
    new Intl.Segmenter("zh-TW", { granularity: "word" }).segment(
      text.toLocaleLowerCase("zh-TW"),
    ),
  )
    .filter(({ isWordLike }) => isWordLike)
    .map(({ segment }) => segment);
const tokenizeForEnglish = (text: string) =>
  Array.from(
    new Intl.Segmenter("en", { granularity: "word" }).segment(
      text.toLocaleLowerCase("en-US"),
    ),
  )
    .filter(({ isWordLike }) => isWordLike)
    .map(({ segment }) => segment);
const tokenizeForJapanese = (text: string) =>
  Array.from(
    new Intl.Segmenter("ja", { granularity: "word" }).segment(
      text.toLocaleLowerCase("ja-JP"),
    ),
  )
    .filter(({ isWordLike }) => isWordLike)
    .map(({ segment }) => segment);

const gettingStarted = keepExisting([
  guide("製作流程", "product-workflow"),
  guide("Collect Media 可攜套件", "collect-media"),
  guide("專案格式", "project-format"),
  guide("媒體搬移與重新連結", "media-portability"),
  guide("相機與來源支援", "source-support"),
]);

const editing = keepExisting([
  guide("故事模板", "creative-story-templates"),
  guide("精準剪輯", "precision-editing"),
  guide("標記與吸附", "markers-and-snapping"),
  guide("Film Looks", "en/film-looks"),
  guide("PhotoDepth", "en/photo-depth"),
  guide("原生文字控制", "en/native-text-controls"),
  guide("音訊品質", "audio-quality"),
  guide("字幕", "en/composition-captions"),
  guide("逐字稿編輯", "en/transcript-editing"),
  guide("可審閱建議", "en/review-suggestions"),
]);

const exportDocs = keepExisting([
  guide("輸出品質", "export-quality"),
  guide("輸出設定檔", "en/export-profiles"),
  guide("OpenTimelineIO 與 NLE", "en/nle-compatibility"),
  guide("NLE 交接", "en/nle-handoff"),
  guide("Collect Media 套件", "collect-media"),
]);

const intelligence = keepExisting([
  guide("媒體智慧", "en/media-intelligence"),
  guide("轉錄", "en/transcription"),
  guide("場景腳本規劃", "en/scene-script-planning"),
  guide("場景方向編輯", "en/scene-direction-editing"),
  guide("分析復原", "en/media-analysis-recovery"),
]);

const concepts = keepExisting([
  guide("架構", "en/architecture"),
  guide("設計系統", "en/design-system"),
  guide("國際化", "i18n"),
  guide("詞彙表", "en/glossary"),
  guide("授權", "en/licensing"),
  guide("第三方元件", "en/third-party"),
  guide("整合契約", "en/CONTRACTS"),
  guide("編輯契約", "en/EDITING_CONTRACTS"),
  guide("來源介接契約", "en/SOURCE_ADAPTER_CONTRACTS"),
]);

const validation = keepExisting([
  guide("穩定版驗證", "en/validation-stable-release"),
  guide("視覺品質檢查", "en/validation-visual-qa"),
  guide("匯出設定驗證", "en/validation-export-profiles"),
  guide("PhotoDepth 驗證", "en/validation-photo-depth"),
  guide("Film Looks 驗證", "en/validation-film-looks"),
  guide("音訊品質驗證", "en/validation-audio-quality"),
  guide("媒體復原驗證", "en/validation-media-analysis-recovery"),
  guide("NLE 交接驗證", "en/validation-nle-handoff"),
  guide("工作站 QA", "en/workstation-qa"),
]);

const englishGettingStarted = keepExisting([
  guide("Film-making workflow", "en/product-workflow"),
  guide("Collect Media packages", "en/collect-media"),
  guide("Project format", "en/project-format"),
  guide("Moving and reconnecting media", "en/media-portability"),
  guide("Camera sources and preview limits", "en/source-support"),
]);
const japaneseGettingStarted = keepExisting([
  guide("映画制作の流れ", "ja/product-workflow"),
  guide("Collect Media パッケージ", "ja/collect-media"),
  guide("プロジェクト形式", "ja/project-format"),
  guide("メディアの移動と再リンク", "ja/media-portability"),
  guide("カメラソースとプレビュー", "ja/source-support"),
]);
const englishAdditionalDocs = keepExisting([
  guide("Creative story templates", "en/creative-story-templates"),
  guide("Precision editing", "en/precision-editing"),
  guide("Source markers and snapping", "en/markers-and-snapping"),
  guide("Audio quality", "en/audio-quality"),
  guide("MP4 compression quality", "en/export-quality"),
]);
const japaneseEditing = keepExisting([
  guide("クリエイティブストーリーテンプレート", "ja/creative-story-templates"),
  guide("精密編集", "ja/precision-editing"),
  guide("ソースマーカーとスナップ", "ja/markers-and-snapping"),
  guide("確認可能な音声品質", "ja/audio-quality"),
]);
const japaneseExportDocs = keepExisting([
  guide("MP4 圧縮品質", "ja/export-quality"),
]);
const englishReference = keepExisting([
  guide("Export quality", "en/export-quality"),
  guide("Export profiles", "en/export-profiles"),
  guide("NLE compatibility", "en/nle-compatibility"),
  guide("Media intelligence", "en/media-intelligence"),
  guide("Architecture", "en/architecture"),
  guide("Internationalization", "en/i18n"),
  guide("Glossary", "en/glossary"),
  guide("Licensing", "en/licensing"),
]);

const listedDocumentation = new Set(
  [
    ...gettingStarted,
    ...editing,
    ...exportDocs,
    ...intelligence,
    ...concepts,
    ...validation,
    ...englishGettingStarted,
    ...japaneseGettingStarted,
    ...englishReference,
  ].map(({ link }) => link.slice(1).replace(/^(?:en|ja)\//, "")),
);
const docsRootPath = fileURLToPath(new URL("../", import.meta.url));
const localizedSlugs = new Set([
  "index.md",
  "product-workflow.md",
  "collect-media.md",
  "project-format.md",
  "media-portability.md",
  "source-support.md",
  "i18n.md",
  "creative-story-templates.md",
  "precision-editing.md",
  "markers-and-snapping.md",
  "export-quality.md",
  "audio-quality.md",
]);
const sectionNames: Record<string, Record<string, string>> = {
  root: {
    "zh-TW": "其他技術文件",
    "en-US": "Other technical documents",
    "ja-JP": "その他の技術資料",
  },
  adr: {
    "zh-TW": "架構決策紀錄",
    "en-US": "Architecture decisions",
    "ja-JP": "アーキテクチャ決定記録",
  },
  security: {
    "zh-TW": "安全文件",
    "en-US": "Security documents",
    "ja-JP": "セキュリティ資料",
  },
  "reference-workflows": {
    "zh-TW": "參考流程",
    "en-US": "Reference workflows",
    "ja-JP": "参考ワークフロー",
  },
  releases: {
    "zh-TW": "版本紀錄",
    "en-US": "Release notes",
    "ja-JP": "リリースノート",
  },
  roadmap: {
    "zh-TW": "路線圖",
    "en-US": "Roadmaps",
    "ja-JP": "ロードマップ",
  },
  validation: {
    "zh-TW": "驗證紀錄",
    "en-US": "Validation records",
    "ja-JP": "検証記録",
  },
};
const englishFallbackGroups = (locale: "zh-TW" | "en-US" | "ja-JP") => {
  const grouped = new Map<string, ReturnType<typeof guide>[]>();
  const collect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(docsRootPath, absolutePath)
        .split(sep)
        .join("/");
      if (entry.isDirectory()) {
        if ([".vitepress", "en", "ja", "superpowers"].includes(relativePath))
          continue;
        collect(absolutePath);
        continue;
      }
      if (
        !entry.isFile() ||
        !relativePath.endsWith(".md") ||
        relativePath === "PROJECT_BRIEF.md" ||
        localizedSlugs.has(relativePath)
      ) {
        continue;
      }
      const slug = relativePath.replace(/\.md$/, "");
      if (listedDocumentation.has(slug)) continue;
      const section = relativePath.includes("/")
        ? relativePath.split("/")[0]
        : "root";
      const items = grouped.get(section) ?? [];
      const source = readFileSync(absolutePath, "utf8");
      const title = source.match(/^#\s+(.+?)\s*$/m)?.[1] ?? slug;
      items.push(guide(title, `en/${slug}`));
      grouped.set(section, items);
    }
  };
  collect(docsRootPath);
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([section, items]) => {
      const title = sectionNames[section]?.[locale] ?? section;
      return group(title, items);
    });
};

export default defineConfig({
  lang: "zh-TW",
  title: "OpenFilm",
  description: "OpenFilm 官方文件：從素材整理、故事規劃到剪輯與輸出。",
  locales: {
    root: {
      label: "繁體中文",
      lang: "zh-TW",
      themeConfig: {
        langMenuLabel: "切換語言",
        darkModeSwitchLabel: "外觀",
        lightModeSwitchTitle: "切換為淺色主題",
        darkModeSwitchTitle: "切換為深色主題",
        sidebarMenuLabel: "目錄",
        returnToTopLabel: "回到頂端",
        skipToContentLabel: "跳至主要內容",
      },
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      description:
        "Official OpenFilm documentation for the story-first, local-first media editor.",
      themeConfig: {
        nav: [
          { text: "English technical docs", link: "/en/product-workflow" },
          {
            text: "GitHub",
            link: "https://github.com/bynanci/open-film",
            target: "_blank",
            rel: "noreferrer",
          },
        ],
        sidebar: [
          group("Getting started", englishGettingStarted, false),
          group("Editing and export", englishAdditionalDocs),
          group("Technical references", englishReference),
          ...englishFallbackGroups("en-US"),
        ],
        outline: { label: "On this page", level: [2, 3] },
        docFooter: { prev: "Previous page", next: "Next page" },
        editLink: {
          pattern: "https://github.com/bynanci/open-film/edit/main/docs/:path",
          text: "Edit this page on GitHub",
        },
        langMenuLabel: "Change language",
        darkModeSwitchLabel: "Appearance",
        lightModeSwitchTitle: "Switch to light theme",
        darkModeSwitchTitle: "Switch to dark theme",
        sidebarMenuLabel: "Menu",
        returnToTopLabel: "Return to top",
        skipToContentLabel: "Skip to content",
        lastUpdated: { text: "Last updated" },
      },
    },
    ja: {
      label: "日本語",
      lang: "ja-JP",
      link: "/ja/",
      description:
        "ストーリー重視、ローカルファーストのメディアエディター OpenFilm の公式ドキュメント。",
      themeConfig: {
        nav: [
          { text: "ドキュメント", link: "/ja/product-workflow" },
          {
            text: "GitHub",
            link: "https://github.com/bynanci/open-film",
            target: "_blank",
            rel: "noreferrer",
          },
        ],
        sidebar: [
          group("スタートガイド", japaneseGettingStarted, false),
          group("編集", japaneseEditing),
          group("書き出し", japaneseExportDocs),
          group("言語と翻訳", keepExisting([guide("国際化", "ja/i18n")])),
          group("その他の技術資料", englishReference),
          ...englishFallbackGroups("ja-JP"),
        ],
        outline: { label: "このページの内容", level: [2, 3] },
        docFooter: { prev: "前のページ", next: "次のページ" },
        editLink: {
          pattern: "https://github.com/bynanci/open-film/edit/main/docs/:path",
          text: "GitHub でこのページを編集",
        },
        langMenuLabel: "言語を変更",
        darkModeSwitchLabel: "外観",
        lightModeSwitchTitle: "ライトテーマに切り替え",
        darkModeSwitchTitle: "ダークテーマに切り替え",
        sidebarMenuLabel: "メニュー",
        returnToTopLabel: "トップに戻る",
        skipToContentLabel: "コンテンツへ移動",
        lastUpdated: { text: "最終更新" },
      },
    },
  },
  base: "/open-film/",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["PROJECT_BRIEF.md", "superpowers/**"],
  markdown: { html: false },
  themeConfig: {
    siteTitle: "OpenFilm",
    i18nRouting: false,
    nav: [
      { text: "文件", link: "/product-workflow" },
      {
        text: "GitHub",
        link: "https://github.com/bynanci/open-film",
        target: "_blank",
        rel: "noreferrer",
      },
    ],
    sidebar: [
      group("開始使用", gettingStarted, false),
      group("剪輯與創作", editing),
      group("輸出與交接", exportDocs),
      group("媒體智慧", intelligence),
      group("架構與參考", concepts),
      group("驗證紀錄", validation),
      ...englishFallbackGroups("zh-TW"),
    ],
    outline: { label: "本頁目錄", level: [2, 3] },
    docFooter: { prev: "上一頁", next: "下一頁" },
    editLink: {
      pattern: "https://github.com/bynanci/open-film/edit/main/docs/:path",
      text: "在 GitHub 編輯此頁",
    },
    search: {
      provider: "local",
      options: {
        miniSearch: { options: { tokenize: tokenizeForSearch } },
        locales: {
          root: {
            translations: {
              button: { buttonText: "搜尋文件", buttonAriaLabel: "搜尋文件" },
              modal: {
                noResultsText: "找不到符合的結果",
                resetButtonTitle: "清除搜尋",
                footer: {
                  selectText: "選擇",
                  navigateText: "切換",
                  closeText: "關閉",
                },
              },
            },
          },
          en: {
            miniSearch: { options: { tokenize: tokenizeForEnglish } },
            translations: {
              button: {
                buttonText: "Search docs",
                buttonAriaLabel: "Search documentation",
              },
              modal: {
                noResultsText: "No results found",
                resetButtonTitle: "Clear search",
                footer: {
                  selectText: "Select",
                  navigateText: "Navigate",
                  closeText: "Close",
                },
              },
            },
          },
          ja: {
            miniSearch: { options: { tokenize: tokenizeForJapanese } },
            translations: {
              button: {
                buttonText: "ドキュメントを検索",
                buttonAriaLabel: "ドキュメントを検索",
              },
              modal: {
                noResultsText: "検索結果がありません",
                resetButtonTitle: "検索をクリア",
                footer: {
                  selectText: "選択",
                  navigateText: "移動",
                  closeText: "閉じる",
                },
              },
            },
          },
        },
      },
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/bynanci/open-film" },
    ],
  },
});
