import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { marketingPlugin } from './marketing/plugin';
import { brandingPlugin } from '../../infrastructure/branding-plugin';

export default defineConfig({
  plugins: [react(), brandingPlugin(), marketingPlugin()],
  server: { proxy: { '/api': process.env.SUITE_DEV_API_TARGET ?? 'http://127.0.0.1:4600' } },
});
