// Home page: the globe sits behind the page; each section sets a scene as it reaches the middle of the screen.
// the page passes a content version (?v=) so a rebuilt engine is never served from a stale cache
const { createGlobe } = await import(`./globe.js${new URL(import.meta.url).search}`);

function fillCounts(g) {
  const c = g.counts;
  const expert = c.kinds['University'] || { places: 0, people: 0 };
  const partner = c.kinds['Research partner'] || { places: 0, people: 0 };
  const values = {
    resources: c.resources, people: c.people, rd: c.rd, consulting: c.consulting,
    'experts-people': expert.people, 'experts-places': expert.places, partners: partner.places,
  };
  document.querySelectorAll('[data-count]').forEach((el) => {
    const v = values[el.dataset.count];
    if (v !== undefined) el.textContent = v;
  });
}

const host = document.getElementById('globe-bg');
const g = host ? await createGlobe(host, { mode: 'background', linkBase: '', scene: 'hero' }) : null;
if (!g) {
  document.body.classList.add('globe-off');
} else {
  fillCounts(g);
  let active = 'hero';
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const name = e.target.dataset.scene;
      if (name && name !== active) {
        active = name;
        g.setScene(name);
        document.body.dataset.scene = name;
      }
    }
  }, { rootMargin: '-48% 0px -48% 0px' });
  document.querySelectorAll('[data-scene]').forEach((s) => io.observe(s));
  window.earthGlobe = g;
}
