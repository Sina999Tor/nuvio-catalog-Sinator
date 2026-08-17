const { tmdbFetchManyPreserveOrder } = require('../lib/tmdb');

const TMDB_KEY = process.env.TMDB_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.query;

  // id formát: tmdb-movie-603 / tmdb-tv-1399
  const m = String(id || '').match(/^tmdb-(movie|tv)-(\d+)$/);
  if (!m) return res.status(404).json({ meta: null });

  const [, kind, tmdbId] = m;

  // Stejná spolehlivá cesta jako katalog: nejdřív Redis cache (kterou máš
  // prohřátou), pak TMDB s retry na rate-limit.
  //
  // DŮLEŽITÉ: na rozdíl od api/catalog.js tenhle handler dřív neměl
  // try/catch okolo tmdbFetchManyPreserveOrder. Když cokoliv uvnitř
  // vyhodilo výjimku (např. Redis pipeline vrátil neočekávaný formát),
  // celá funkce spadla s HTTP 500 bez těla — Nuvio pak nedostalo žádný
  // použitelný JSON a u detailu ukázalo jen holé "tmdb-tv-..." ID místo
  // skutečného názvu. Teď se to (stejně jako u catalog.js) chytá a vrací
  // se aspoň placeholder meta, ať detail nikdy nespadne na prázdno.
  try {
    const [meta] = await tmdbFetchManyPreserveOrder(TMDB_KEY, kind, [tmdbId]);
    if (meta && meta.name) return res.status(200).json({ meta });
  } catch (e) {
    console.error('meta.js: chyba při načítání', id, e);
  }

  return res.status(200).json({
    meta: {
      id,
      type: kind === 'movie' ? 'movie' : 'series',
      name: `#${tmdbId} (nedostupné na TMDB)`,
    },
  });
};
