import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'install',
    {
      type: 'category',
      label: 'Commands',
      collapsed: false,
      items: [
        'commands/list',
        'commands/switch',
        'commands/remove',
        'commands/hook',
        'commands/config',
        'commands/init',
        'commands/stack',
        'commands/navigate',
      ],
    },
    'configuration',
    'hooks',
    'stacks',
  ],
};

export default sidebars;
