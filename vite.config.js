import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

var HIDE_PANELS_CSS = [
  '/* hide panels */',
  'h1, .layout > .panel { display:none !important; }',
  '.right-side { display:none !important; }',
  '.stats-panel { display:none !important; }',
  '/* full-screen */',
  'html, body {',
  '  width:100vw; height:100vh; margin:0; padding:0 !important;',
  '  overflow:hidden; background:#000;',
  '  display:flex; align-items:center; justify-content:center;',
  '}',
  '.layout {',
  '  display:flex !important; align-items:center !important;',
  '  justify-content:center !important; gap:0 !important;',
  '  width:100vw !important; height:100vh !important; max-width:none !important;',
  '}',
  '.stage {',
  '  width:450px !important; height:800px !important;',
  '  flex-shrink:0 !important; position:relative !important;',
  '  transform-origin:center center;',
  '}',
].join('\n');

var SCALE_SCRIPT = [
  '(function(){',
  '  function applyScale(){',
  '    var s = Math.min(window.innerWidth / 450, window.innerHeight / 800);',
  '    var el = document.querySelector(".stage");',
  '    if(el) el.style.transform = "scale(" + s + ")";',
  '  }',
  '  window.addEventListener("resize", applyScale);',
  '  window.addEventListener("load", applyScale);',
  '  document.addEventListener("DOMContentLoaded", applyScale);',
  '})();',
].join('\n');

const hidePanelsPlugin = {
  name: 'hide-panels-in-build',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      if (!ctx.server) {
        return html
          .replace('</head>', '<style>\n' + HIDE_PANELS_CSS + '\n</style>\n<script>\n' + SCALE_SCRIPT + '\n</script>\n</head>');
      }
      return html;
    }
  }
};

export default defineConfig({
  root: '.',
  plugins: [hidePanelsPlugin, viteSingleFile()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100 * 1024 * 1024,
    target: 'esnext',
  },
});
