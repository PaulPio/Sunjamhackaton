import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS in dev so phone sensors (iOS requires a secure context) work over LAN.
// The itch.io build is served from their HTTPS domain, so prod needs nothing.
export default defineConfig(({ command }) => ({
  base: './',
  plugins: command === 'serve' ? [basicSsl()] : [],
  build: {
    target: 'es2020',
  },
}));
