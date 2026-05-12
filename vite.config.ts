import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx, defineManifest } from '@crxjs/vite-plugin';

const manifest = defineManifest({
  manifest_version: 3,
  name: 'hide-em',
  version: '0.1.0',
  description: "Personal attention filter — hides content you don't want to see.",
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
  icons: {},
});

export default defineConfig({
  plugins: [react(), crx({ manifest })],
});
