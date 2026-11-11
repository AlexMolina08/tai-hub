export const readerScript = `
addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'tai-study-section' || typeof event.data.id !== 'string' || event.data.id.length > 200) return;
  document.getElementById(event.data.id)?.scrollIntoView({behavior:'instant',block:'start'});
});
document.addEventListener('click', event => {
  const anchor = event.target.closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href') || '';
  if (href.startsWith('#')) {
    event.preventDefault();
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch {}
    document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'});
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') parent.postMessage({type:'tai-study-escape'}, '*');
});
for (const image of document.querySelectorAll('img[src]')) {
  const viewport = document.createElement('div');
  viewport.className = 'image-viewport';
  viewport.style.cssText = 'max-width:100%;overflow:auto;overscroll-behavior:contain';
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', image.alt || 'Imagen del tema');
  image.before(viewport);
  viewport.append(image);
  const originalStyle = image.getAttribute('style');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-code image-zoom';
  button.textContent = 'Ampliar imagen';
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-pressed') !== 'true';
    viewport.style.maxHeight = expanded ? '70vh' : '';
    if (expanded) {
      const width = Math.max(image.naturalWidth, image.getBoundingClientRect().width * 2);
      image.style.cssText = 'display:block;max-width:none;width:' + width + 'px;height:auto';
    } else if (originalStyle === null) {
      image.removeAttribute('style');
    } else {
      image.setAttribute('style', originalStyle);
    }
    button.setAttribute('aria-pressed', String(expanded));
    button.textContent = expanded ? 'Ajustar imagen' : 'Ampliar imagen';
  });
  viewport.after(button);
}
for (const pre of document.querySelectorAll('pre')) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-code';
  button.textContent = 'Copiar código';
  button.addEventListener('click', async () => {
    const text = pre.getAttribute('data-copy') ?? pre.textContent ?? '';
    let fallback = pre.nextElementSibling?.nextElementSibling;
    if (fallback?.classList.contains('copy-fallback')) fallback.remove();
    const select = () => {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(pre);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    select();
    let copied = false;
    const copy = event => {
      if (!event.clipboardData) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    };
    document.addEventListener('copy', copy);
    try { copied = document.execCommand('copy'); } catch {}
    finally { document.removeEventListener('copy', copy); }
    if (!copied) {
      try { await navigator.clipboard.writeText(text); copied = true; } catch {}
    }
    if (!copied && pre.hasAttribute('data-copy')) {
      fallback = document.createElement('pre');
      fallback.className = 'copy-fallback';
      fallback.textContent = text;
      fallback.setAttribute('aria-label', 'Código preparado para copiar');
      button.after(fallback);
      const range = document.createRange();
      range.selectNodeContents(fallback);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    button.textContent = copied ? 'Copiado' : 'Código seleccionado: usa Copiar';
  });
  pre.after(button);
}
`
