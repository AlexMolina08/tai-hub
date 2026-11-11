import { createHash } from 'node:crypto'
const bootstrap = `(() => {
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.kind !== 'inspect' || typeof event.data.token !== 'string') return;
    const { token, checks } = event.data;
    if (!Array.isArray(checks) || checks.length > 30) return;
    // The markup and inline styles precede this script. getComputedStyle resolves them on demand,
    // even when the browser pauses animation callbacks for an offscreen preview.
    try {
      const values = checks.map(check => {
        const nodes = document.querySelectorAll(check.selector), node = nodes[0];
        if (check.kind === 'count') return String(nodes.length);
        if (!node) return null;
        if (check.kind === 'text') return node.textContent.trim().slice(0, 2000);
        if (check.kind === 'style') return getComputedStyle(node).getPropertyValue(check.property).trim().slice(0, 2000);
        if (check.kind === 'attribute') return (node.getAttribute(check.property) ?? '').slice(0, 2000);
        return '';
      });
      parent.postMessage({ kind: 'html-result', token, values }, '*');
    } catch { parent.postMessage({ kind: 'html-error', token }, '*'); }
  });
  parent.postMessage({ kind: 'html-ready' }, '*');
})();`
const hash = 'sha256-' + createHash('sha256').update(bootstrap).digest('base64')
export function labHtmlPlugin() {
  return {
    name: 'laboratory-html-preview',
    resolveId(id) { if (id === 'virtual:lab-html') return '\0' + id },
    load(id) { if (id === '\0virtual:lab-html') return `export const bootstrap = ${JSON.stringify(bootstrap)}; export const hash = ${JSON.stringify(hash)};` },
    transformIndexHtml(html) { return html.replace("'LAB_HTML_HASH'", `'${hash}'`) },
  }
}
