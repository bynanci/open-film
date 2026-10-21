import { existsSync } from 'node:fs'
import { defineConfig } from 'vitepress'

const guide = (label: string, path: string) => ({ text: label, link: `/${path}` })
const group = (text: string, items: ReturnType<typeof guide>[], collapsed = true) => ({ text, collapsed, items })
const keepExisting = (items: ReturnType<typeof guide>[]) => items.filter(({ link }) => existsSync(new URL(`../${link.slice(1)}.md`, import.meta.url)))
const tokenizeForSearch = (text: string) =>
  Array.from(new Intl.Segmenter('zh-TW', { granularity: 'word' }).segment(text.toLocaleLowerCase('zh-TW')))
    .filter(({ isWordLike }) => isWordLike)
    .map(({ segment }) => segment)
const tokenizeForEnglish = (text: string) =>
  Array.from(new Intl.Segmenter('en', { granularity: 'word' }).segment(text.toLocaleLowerCase('en-US')))
    .filter(({ isWordLike }) => isWordLike)
    .map(({ segment }) => segment)
const tokenizeForJapanese = (text: string) =>
  Array.from(new Intl.Segmenter('ja', { granularity: 'word' }).segment(text.toLocaleLowerCase('ja-JP')))
    .filter(({ isWordLike }) => isWordLike)
    .map(({ segment }) => segment)

const gettingStarted = keepExisting([
  guide('製作流程', 'product-workflow'),
  guide('匯入媒體', 'collect-media'),
  guide('專案格式', 'project-format'),
  guide('媒體搬移與重新連結', 'media-portability'),
  guide('相機與來源支援', 'source-support'),
])

const editing = keepExisting([
  guide('故事模板', 'creative-story-templates'),
  guide('精準剪輯', 'precision-editing'),
  guide('標記與吸附', 'markers-and-snapping'),
  guide('Film Looks', 'film-looks'),
  guide('PhotoDepth', 'photo-depth'),
  guide('原生文字控制', 'native-text-controls'),
  guide('音訊品質', 'audio-quality'),
  guide('字幕', 'composition-captions'),
  guide('逐字稿編輯', 'transcript-editing'),
  guide('可審閱建議', 'review-suggestions'),
])

const exportDocs = keepExisting([
  guide('輸出品質', 'export-quality'),
  guide('輸出設定檔', 'export-profiles'),
  guide('OpenTimelineIO 與 NLE', 'nle-compatibility'),
  guide('NLE 交接', 'nle-handoff'),
  guide('Collect Media 套件', 'collect-media'),
])

const intelligence = keepExisting([
  guide('媒體智慧', 'media-intelligence'),
  guide('轉錄', 'transcription'),
  guide('場景腳本規劃', 'scene-script-planning'),
  guide('場景方向編輯', 'scene-direction-editing'),
  guide('分析復原', 'media-analysis-recovery'),
])

const concepts = keepExisting([
  guide('架構', 'architecture'),
  guide('設計系統', 'design-system'),
  guide('國際化', 'i18n'),
  guide('詞彙表', 'glossary'),
  guide('授權', 'licensing'),
  guide('第三方元件', 'third-party'),
  guide('整合契約', 'CONTRACTS'),
  guide('編輯契約', 'EDITING_CONTRACTS'),
  guide('來源介接契約', 'SOURCE_ADAPTER_CONTRACTS'),
])

const validation = keepExisting([
  guide('穩定版驗證', 'validation-stable-release'),
  guide('視覺品質檢查', 'validation-visual-qa'),
  guide('匯出設定驗證', 'validation-export-profiles'),
  guide('PhotoDepth 驗證', 'validation-photo-depth'),
  guide('Film Looks 驗證', 'validation-film-looks'),
  guide('音訊品質驗證', 'validation-audio-quality'),
  guide('媒體復原驗證', 'validation-media-analysis-recovery'),
  guide('NLE 交接驗證', 'validation-nle-handoff'),
  guide('工作站 QA', 'workstation-qa'),
])

export default defineConfig({
  lang: 'zh-TW',
  title: 'OpenFilm',
  description: 'OpenFilm 官方文件：從素材整理、故事規劃到剪輯與輸出。',
  locales: {
    root: {
      label: '繁體中文',
      lang: 'zh-TW',
      themeConfig: {
        langMenuLabel: '切換語言',
        darkModeSwitchLabel: '外觀',
        lightModeSwitchTitle: '切換為淺色主題',
        darkModeSwitchTitle: '切換為深色主題',
        sidebarMenuLabel: '目錄',
        returnToTopLabel: '回到頂端',
        skipToContentLabel: '跳至主要內容',
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      description: 'Official OpenFilm documentation for the story-first, local-first media editor.',
      themeConfig: {
        nav: [
          { text: 'English technical docs', link: '/product-workflow' },
          { text: 'GitHub', link: 'https://github.com/bynanci/open-film', target: '_blank', rel: 'noreferrer' },
        ],
        outline: { label: 'On this page', level: [2, 3] },
        docFooter: { prev: 'Previous page', next: 'Next page' },
        editLink: {
          pattern: 'https://github.com/bynanci/open-film/edit/main/docs/:path',
          text: 'Edit this page on GitHub',
        },
        langMenuLabel: 'Change language',
        darkModeSwitchLabel: 'Appearance',
        lightModeSwitchTitle: 'Switch to light theme',
        darkModeSwitchTitle: 'Switch to dark theme',
        sidebarMenuLabel: 'Menu',
        returnToTopLabel: 'Return to top',
        skipToContentLabel: 'Skip to content',
        lastUpdated: { text: 'Last updated' },
      },
    },
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      link: '/ja/',
      description: 'ストーリー重視、ローカルファーストのメディアエディター OpenFilm の公式ドキュメント。',
      themeConfig: {
        nav: [
          { text: '英語の技術ドキュメント', link: '/product-workflow' },
          { text: 'GitHub', link: 'https://github.com/bynanci/open-film', target: '_blank', rel: 'noreferrer' },
        ],
        outline: { label: 'このページの内容', level: [2, 3] },
        docFooter: { prev: '前のページ', next: '次のページ' },
        editLink: {
          pattern: 'https://github.com/bynanci/open-film/edit/main/docs/:path',
          text: 'GitHub でこのページを編集',
        },
        langMenuLabel: '言語を変更',
        darkModeSwitchLabel: '外観',
        lightModeSwitchTitle: 'ライトテーマに切り替え',
        darkModeSwitchTitle: 'ダークテーマに切り替え',
        sidebarMenuLabel: 'メニュー',
        returnToTopLabel: 'トップに戻る',
        skipToContentLabel: 'コンテンツへ移動',
        lastUpdated: { text: '最終更新' },
      },
    },
  },
  base: '/open-film/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['PROJECT_BRIEF.md', 'superpowers/**'],
  markdown: { html: false },
  themeConfig: {
    siteTitle: 'OpenFilm',
    i18nRouting: false,
    nav: [
      { text: '文件', link: '/product-workflow' },
      { text: 'GitHub', link: 'https://github.com/bynanci/open-film', target: '_blank', rel: 'noreferrer' },
    ],
    sidebar: [
      group('開始使用', gettingStarted, false),
      group('剪輯與創作', editing),
      group('輸出與交接', exportDocs),
      group('媒體智慧', intelligence),
      group('架構與參考', concepts),
      group('驗證紀錄', validation),
    ],
    outline: { label: '本頁目錄', level: [2, 3] },
    docFooter: { prev: '上一頁', next: '下一頁' },
    editLink: {
      pattern: 'https://github.com/bynanci/open-film/edit/main/docs/:path',
      text: '在 GitHub 編輯此頁',
    },
    search: {
      provider: 'local',
      options: {
        miniSearch: { options: { tokenize: tokenizeForSearch } },
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜尋文件', buttonAriaLabel: '搜尋文件' },
              modal: {
                noResultsText: '找不到符合的結果',
                resetButtonTitle: '清除搜尋',
                footer: { selectText: '選擇', navigateText: '切換', closeText: '關閉' },
              },
            },
          },
          en: {
            miniSearch: { options: { tokenize: tokenizeForEnglish } },
            translations: {
              button: { buttonText: 'Search docs', buttonAriaLabel: 'Search documentation' },
              modal: {
                noResultsText: 'No results found',
                resetButtonTitle: 'Clear search',
                footer: { selectText: 'Select', navigateText: 'Navigate', closeText: 'Close' },
              },
            },
          },
          ja: {
            miniSearch: { options: { tokenize: tokenizeForJapanese } },
            translations: {
              button: { buttonText: 'ドキュメントを検索', buttonAriaLabel: 'ドキュメントを検索' },
              modal: {
                noResultsText: '検索結果がありません',
                resetButtonTitle: '検索をクリア',
                footer: { selectText: '選択', navigateText: '移動', closeText: '閉じる' },
              },
            },
          },
        },
      },
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/bynanci/open-film' }],
  },
})
