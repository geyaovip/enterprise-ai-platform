import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { brandingPlugin } from '../../infrastructure/branding-plugin';
export default defineConfig({ base: process.env.SUITE_PUBLIC_BASE ?? '/', plugins: [react(), brandingPlugin()], server: { proxy: { '/api': process.env.SUITE_DEV_API_TARGET ?? 'http://127.0.0.1:4600' } } });
