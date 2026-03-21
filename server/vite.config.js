import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    allowedHosts: [
      'wh1234567.com',
      'www.wh1234567.com'
    ],
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'https://i.jzj9999.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
            proxyReq.setHeader('Referer', 'https://i.jzj9999.com/');
            proxyReq.setHeader('Host', 'i.jzj9999.com');
          });
        }
      }
    }
  }
})
