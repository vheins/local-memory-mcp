import { defineConfig } from 'vitepress'

export default defineConfig({
  srcDir: '../../docs',
  lang: 'en-US',
  title: 'Local Memory MCP',
  description: 'MCP Local Memory Service — long-term, high-signal memory for AI Agents',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
  ],

  themeConfig: {
    search: {
      provider: 'local',
    },

    nav: [
      { text: 'English', link: '/en/getting-started' },
      { text: 'Bahasa Indonesia', link: '/id/getting-started' },
      { text: 'GitHub', link: 'https://github.com/vheins/local-memory-mcp' },
    ],

    sidebar: {
      '/en/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation & Setup', link: '/en/getting-started' },
            { text: 'Tool Reference', link: '/en/tools-reference' },
            { text: 'Dashboard Guide', link: '/en/dashboard-guide' },
          ],
        },
        {
          text: 'Features',
          items: [
            { text: 'Features Overview', link: '/en/features' },
            { text: 'Hybrid Search Logic', link: '/en/hybrid-search' },
            { text: 'MCP Protocol Reference', link: '/en/mcp-concepts' },
          ],
        },
        {
          text: 'Integrations',
          items: [
            { text: 'Claude Code', link: '/en/claude-code-integration' },
            { text: 'Codex (OpenAI)', link: '/en/codex-integration' },
            { text: 'Kiro', link: '/en/kiro-integration' },
            { text: 'Auto-Start Dashboard', link: '/en/auto-start-dashboard' },
          ],
        },
        {
          text: 'Support',
          items: [
            { text: 'Troubleshooting', link: '/en/troubleshooting' },
          ],
        },
      ],

      '/id/': [
        {
          text: 'Memulai',
          items: [
            { text: 'Instalasi & Pengaturan', link: '/id/getting-started' },
            { text: 'Referensi Alat', link: '/id/tools-reference' },
            { text: 'Panduan Dashboard', link: '/id/dashboard-guide' },
          ],
        },
        {
          text: 'Fitur',
          items: [
            { text: 'Ikhtisar Fitur', link: '/id/features' },
            { text: 'Logika Pencarian Hybrid', link: '/id/hybrid-search' },
            { text: 'Referensi Protokol MCP', link: '/id/mcp-concepts' },
          ],
        },
        {
          text: 'Integrasi',
          items: [
            { text: 'Claude Code', link: '/id/claude-code-integration' },
            { text: 'Codex (OpenAI)', link: '/id/codex-integration' },
            { text: 'Kiro', link: '/id/kiro-integration' },
            { text: 'Dashboard Auto-Start', link: '/id/auto-start-dashboard' },
          ],
        },
        {
          text: 'Dukungan',
          items: [
            { text: 'Pemecahan Masalah', link: '/id/troubleshooting' },
          ],
        },
      ],
    },

    footer: {
      message: 'Released under the MIT License.',
    },
  },
})
