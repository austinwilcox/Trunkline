import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Trunkline',
  tagline: 'Git worktrees as easy as branches — with hooks and stacks',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  // Production URL for GitHub Pages (https://<org>.github.io/<repo>/).
  url: 'https://austinwilcox.github.io',
  baseUrl: '/Trunkline/',

  // GitHub Pages deployment config.
  organizationName: 'austinwilcox',
  projectName: 'Trunkline',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/', // serve docs at the site root
          editUrl:
            'https://github.com/austinwilcox/Trunkline/tree/main/docs-site/',
        },
        blog: false, // documentation site — no blog
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Trunkline',
      logo: {
        alt: 'Trunkline',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/austinwilcox/Trunkline',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Introduction', to: '/'},
            {label: 'Commands', to: '/commands/list'},
            {label: 'Stacks', to: '/stacks'},
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/austinwilcox/Trunkline',
            },
            {
              label: 'worktrunk (inspiration)',
              href: 'https://github.com/max-sixty/worktrunk',
            },
            {
              label: 'git-spice (inspiration)',
              href: 'https://abhinav.github.io/git-spice/',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Trunkline contributors. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'toml', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
