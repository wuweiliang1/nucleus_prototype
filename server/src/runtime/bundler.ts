/**
 * Bundles a generated multi-file web project (index.html, styles.css, app.js, etc.)
 * into a self-contained runnable HTML document injected with:
 * 1. window.NucleusDB — real PostgreSQL-backed Cloud DB SDK scoped to projectId
 * 2. Runtime Error Catcher — forwards JS/Promise errors to Nucleus Studio for Auto-Fix
 * 3. Visual Select-to-Edit Inspector — hover highlight & click-to-select DOM elements (preview mode only)
 */
export function buildRunnableHtml(params: {
  projectId: string;
  files: Record<string, string>;
  apiOrigin?: string;
  enableInspector?: boolean;
}): string {
  const { projectId, files, apiOrigin = '', enableInspector = false } = params;

  const htmlFile =
    files['index.html'] ||
    Object.entries(files).find(([k]) => k.endsWith('.html'))?.[1] ||
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Nucleus App</title></head><body><div id="app"></div></body></html>';

  const cssBlocks = Object.entries(files)
    .filter(([k]) => k.endsWith('.css'))
    .map(([name, content]) => `/* ${name} */\n${content}`)
    .join('\n\n');

  const jsBlocks = Object.entries(files)
    .filter(([k]) => k.endsWith('.js') && !k.endsWith('.config.js'))
    .map(([name, content]) => `// ${name}\n${content}`)
    .join('\n\n');

  const nucleusRuntimeScript = `
<script>
(function() {
  const PROJECT_ID = ${JSON.stringify(projectId)};
  const API_BASE = ${JSON.stringify(apiOrigin)} + '/api/runtime/' + encodeURIComponent(PROJECT_ID);

  async function req(path, options) {
    const res = await fetch(API_BASE + path, Object.assign({
      headers: { 'Content-Type': 'application/json' }
    }, options || {}));
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('NucleusDB error ' + res.status + ': ' + txt);
    }
    return res.json();
  }

  window.NucleusDB = {
    projectId: PROJECT_ID,
    collection: function(name) {
      const col = encodeURIComponent(name);
      return {
        list: async function() {
          const data = await req('/collections/' + col);
          return data.items || [];
        },
        add: async function(payload) {
          const data = await req('/collections/' + col, {
            method: 'POST',
            body: JSON.stringify(payload || {})
          });
          return data.item;
        },
        update: async function(id, payload) {
          const data = await req('/collections/' + col + '/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: JSON.stringify(payload || {})
          });
          return data.item;
        },
        remove: async function(id) {
          await req('/collections/' + col + '/' + encodeURIComponent(id), {
            method: 'DELETE'
          });
          return true;
        }
      };
    }
  };

  // Runtime error forwarding for Auto-Fix
  function reportError(message, stack) {
    try {
      window.parent && window.parent.postMessage({
        type: 'NUCLEUS_RUNTIME_ERROR',
        message: String(message || 'Unknown error'),
        stack: String(stack || '')
      }, '*');
    } catch (_) {}
  }
  window.addEventListener('error', function(e) {
    reportError(e.message, e.error && e.error.stack ? e.error.stack : (e.filename + ':' + e.lineno));
  });
  window.addEventListener('unhandledrejection', function(e) {
    const reason = e.reason;
    reportError(reason && reason.message ? reason.message : String(reason), reason && reason.stack ? reason.stack : '');
  });

  ${
    enableInspector
      ? `
  // Visual Select-to-Edit Inspector
  let inspectEnabled = false;
  let hoveredEl = null;
  const overlay = document.createElement('div');
  overlay.id = '__nucleus_inspector_overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    border: '2px solid #6366f1',
    background: 'rgba(99, 102, 241, 0.14)',
    borderRadius: '4px',
    display: 'none',
    transition: 'all 60ms ease'
  });
  const badge = document.createElement('div');
  Object.assign(badge.style, {
    position: 'absolute',
    top: '-22px',
    left: '0',
    background: '#4f46e5',
    color: '#fff',
    fontSize: '11px',
    fontFamily: 'monospace',
    padding: '1px 6px',
    borderRadius: '3px',
    whiteSpace: 'nowrap'
  });
  overlay.appendChild(badge);

  function ensureOverlay() {
    if (!document.body.contains(overlay)) document.body.appendChild(overlay);
  }

  function buildSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + el.id;
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string'
      ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.')
      : '';
    return cls ? tag + '.' + cls : tag;
  }

  window.addEventListener('message', function(ev) {
    if (!ev.data || ev.data.type !== 'NUCLEUS_TOGGLE_INSPECT') return;
    inspectEnabled = Boolean(ev.data.enabled);
    if (!inspectEnabled) {
      overlay.style.display = 'none';
      hoveredEl = null;
      document.documentElement.style.cursor = '';
    } else {
      ensureOverlay();
      document.documentElement.style.cursor = 'crosshair';
    }
  });

  document.addEventListener('mousemove', function(e) {
    if (!inspectEnabled) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === badge || el === document.documentElement || el === document.body) {
      overlay.style.display = 'none';
      return;
    }
    hoveredEl = el;
    const rect = el.getBoundingClientRect();
    ensureOverlay();
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    badge.textContent = buildSelector(el);
  }, true);

  document.addEventListener('click', function(e) {
    if (!inspectEnabled || !hoveredEl) return;
    e.preventDefault();
    e.stopPropagation();
    const el = hoveredEl;
    const selector = buildSelector(el);
    const snippet = (el.outerHTML || '').slice(0, 600);
    const text = (el.textContent || '').trim().slice(0, 120);
    inspectEnabled = false;
    overlay.style.display = 'none';
    document.documentElement.style.cursor = '';
    window.parent && window.parent.postMessage({
      type: 'NUCLEUS_ELEMENT_SELECTED',
      selector: selector,
      tagName: el.tagName.toLowerCase(),
      text: text,
      snippet: snippet
    }, '*');
  }, true);
  `
      : ''
  }
})();
</script>`;

  let output = htmlFile;

  // Strip local link/script references to inlined files so browser won't 404
  output = output.replace(
    /<link[^>]+href=["']\.?\/?[^"']+\.css["'][^>]*>/gi,
    ''
  );
  output = output.replace(
    /<script[^>]+src=["']\.?\/?[^"']+\.js["'][^>]*>\s*<\/script>/gi,
    ''
  );

  const styleTag = cssBlocks ? `<style>\n${cssBlocks}\n</style>` : '';
  const scriptTag = jsBlocks ? `<script>\n${jsBlocks}\n</script>` : '';

  if (output.includes('</head>')) {
    output = output.replace('</head>', `${styleTag}\n${nucleusRuntimeScript}\n</head>`);
  } else {
    output = `${styleTag}\n${nucleusRuntimeScript}\n${output}`;
  }

  if (output.includes('</body>')) {
    output = output.replace('</body>', `${scriptTag}\n</body>`);
  } else {
    output = `${output}\n${scriptTag}`;
  }

  return output;
}
