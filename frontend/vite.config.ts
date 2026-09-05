import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // `@zama-fhe/relayer-sdk` locates its own WASM binaries (tfhe_bg.wasm,
    // kms_lib_bg.wasm) and its worker script at runtime via
    // `new URL('tfhe_bg.wasm', import.meta.url)`, resolved relative to
    // wherever that JS module physically lives.
    //
    // Vite's dev-server dependency pre-bundler (esbuild) copies optimized
    // deps into `node_modules/.vite/deps/`, which rewrites `import.meta.url`
    // to point there instead of to the real package directory. The
    // `tfhe_bg.wasm` / `kms_lib_bg.wasm` files never get copied alongside
    // it, so every one of those `new URL(...)` lookups 404s — and because
    // Vite's dev server falls back to serving `index.html` for unmatched
    // paths (SPA fallback), the SDK receives an HTML document where it
    // expected a WASM binary. That is the exact, confirmed cause of the
    // "WebAssembly.instantiate(): expected magic word ... found 3c 21 64
    // 6f" error (0x3c216 46f is the literal ASCII bytes of "<!do", i.e.
    // "<!doctype html>") — reproduced directly against this dev server
    // before this fix by requesting
    // /node_modules/.vite/deps/tfhe_bg.wasm and observing a 200 OK,
    // Content-Type: text/html response containing the app's own
    // index.html.
    //
    // Excluding the package from pre-bundling keeps it served straight out
    // of its real `node_modules/@zama-fhe/relayer-sdk/lib/` location, where
    // the adjacent .wasm files and workerHelpers.js actually live, so the
    // relative URL resolves correctly. This is Zama's own documented fix
    // for Vite projects. Production builds were never affected — Vite's
    // production bundler (Rollup) already emits these as real hashed
    // assets (see frontend/dist/assets/tfhe_bg-*.wasm after `npm run
    // build`) — only the dev server's optimizer had this gap.
    optimizeDeps: {
      exclude: ['@zama-fhe/relayer-sdk'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
