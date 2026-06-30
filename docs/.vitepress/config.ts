import { defineConfig } from "vitepress";

const enNav = [
  { text: "Guide", link: "/guide/getting-started" },
  { text: "Reference", link: "/reference/cli" },
];

const enSidebar = [
  {
    text: "Introduction",
    items: [
      { text: "What is agtail", link: "/guide/getting-started" },
      { text: "Concepts", link: "/guide/concepts" },
    ],
  },
  {
    text: "Usage",
    items: [
      { text: "CLI", link: "/guide/cli" },
      { text: "Web UI", link: "/guide/web-ui" },
      { text: "Cross-machine sync", link: "/guide/sync" },
      { text: "Tokens & cost", link: "/guide/cost" },
    ],
  },
  {
    text: "How it works",
    items: [
      { text: "Adapters & the normalized model", link: "/guide/adapters" },
      { text: "CLI reference", link: "/reference/cli" },
    ],
  },
];

const jaNav = [
  { text: "ガイド", link: "/ja/guide/getting-started" },
  { text: "リファレンス", link: "/ja/reference/cli" },
];

const jaSidebar = [
  {
    text: "はじめに",
    items: [
      { text: "agtail とは", link: "/ja/guide/getting-started" },
      { text: "コンセプト", link: "/ja/guide/concepts" },
    ],
  },
  {
    text: "使い方",
    items: [
      { text: "CLI", link: "/ja/guide/cli" },
      { text: "Web UI", link: "/ja/guide/web-ui" },
      { text: "マシン間同期", link: "/ja/guide/sync" },
      { text: "トークンとコスト", link: "/ja/guide/cost" },
    ],
  },
  {
    text: "仕組み",
    items: [
      { text: "アダプタと正規化モデル", link: "/ja/guide/adapters" },
      { text: "CLI リファレンス", link: "/ja/reference/cli" },
    ],
  },
];

export default defineConfig({
  title: "agtail",
  description: "Cross-agent forensic search for coding-agent histories",
  // GitHub Pages project site: published under https://<owner>.github.io/agtail/.
  // VitePress prepends this base to absolute asset/link URLs (e.g. /screenshots/*).
  base: "/agtail/",
  cleanUrls: true,
  themeConfig: {
    search: { provider: "local" },
  },
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar,
        outline: { label: "On this page", level: [2, 3] },
      },
    },
    ja: {
      label: "日本語",
      lang: "ja",
      description: "コーディングエージェントの履歴を横断検索するフォレンジックツール",
      themeConfig: {
        nav: jaNav,
        sidebar: jaSidebar,
        outline: { label: "このページの内容", level: [2, 3] },
        docFooter: { prev: "前のページ", next: "次のページ" },
        darkModeSwitchLabel: "外観",
        lightModeSwitchTitle: "ライトモードに切り替え",
        darkModeSwitchTitle: "ダークモードに切り替え",
        sidebarMenuLabel: "メニュー",
        returnToTopLabel: "トップへ戻る",
        langMenuLabel: "言語を変更",
      },
    },
  },
});
