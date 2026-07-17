import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx, defineManifest } from '@crxjs/vite-plugin';

const manifest = defineManifest({
  manifest_version: 3,
  name: 'hide-em',
  version: '1.1.0',
  description: "Personal attention filter that hides content you do not want to see.",
  permissions: ['storage'],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/universal-scanner.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  options_page: 'src/ui/options/index.html',
  action: {
    default_title: 'hide-em quick add',
    default_popup: 'src/ui/popup/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
});

export default defineConfig({
  plugins: [react(), crx({ manifest })],
});
