import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径：同一份产物既能放 GitHub Pages 子路径 (/<repo>/)，
  // 也能放域名根目录 (Mavis 托管)，不用重新 build。
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
    // 保持和线上一样的分块：modulepreload polyfill 内联进主 chunk
    modulePreload: { polyfill: true },
  },
});
