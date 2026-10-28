// Page styles that survive strict Content-Security-Policy. A <style> element is
// blocked on sites without 'unsafe-inline' (GitHub, many banks); a constructed
// stylesheet adopted by the document is not. Falls back to <style> elsewhere.
//   const remove = addSheet(document, css, 'cw-bm-ui');
export function addSheet(doc, css, className = '') {
  const win = doc.defaultView;
  if (win?.CSSStyleSheet && 'adoptedStyleSheets' in doc) {
    try {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      return () => { doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet); };
    } catch { /* fall through */ }
  }
  const el = doc.createElement('style');
  if (className) el.className = className;
  el.dataset.cwUi = '';
  el.textContent = css;
  doc.head.append(el);
  return () => el.remove();
}
