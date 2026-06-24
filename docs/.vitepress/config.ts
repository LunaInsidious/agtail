import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "en-US",
  title: "agtail",
  description: "Cross-agent forensic search for coding-agent histories",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/cli" },
    ],
    sidebar: [
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
    ],
    search: { provider: "local" },
    outline: { label: "On this page", level: [2, 3] },
  },
});
