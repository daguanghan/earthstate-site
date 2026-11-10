// Network explorer: the globe with layer chips, preset views and point cards.
// the page passes a content version (?v=) so a rebuilt engine is never served from a stale cache
const { createGlobe } = await import(`./globe.js${new URL(import.meta.url).search}`);

for (const root of document.querySelectorAll('[data-globe-explorer]')) {
  const stage = root.querySelector('.gx-stage');
  const g = stage ? await createGlobe(stage, { mode: 'explorer', linkBase: root.dataset.linkBase || '', scene: 'world' }) : null;
  if (!g) {
    root.classList.add('gx-failed');
    continue;
  }
  const c = g.counts;
  root.querySelectorAll('[data-count]').forEach((el) => {
    const v = c[el.dataset.count];
    if (v !== undefined) el.textContent = v;
  });
  const layers = { resources: true, rd: true, consulting: true };
  root.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.layer;
    layers[k] = !layers[k];
    b.setAttribute('aria-pressed', String(layers[k]));
    g.setLayers({ [k]: layers[k] });
  }));
  root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    g.setScene(b.dataset.view, { force: true });
  }));
  window.earthGlobe = g;
}
