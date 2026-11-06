export const readerScript = `
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
for (const pre of document.querySelectorAll('pre')) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-code';
  button.textContent = 'Copiar código';
  button.addEventListener('click', async () => {
    const select = () => {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(pre);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    if (!copied) {
      try { await navigator.clipboard.writeText(pre.textContent || ''); copied = true; } catch {}
    }
    button.textContent = copied ? 'Copiado' : 'Código seleccionado: usa Copiar';
  });
  pre.after(button);
}
`
