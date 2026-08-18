const { tmdbFetchManyPreserveOrder } = require('../lib/tmdb');
const cacheLib = require('../lib/cache');

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';

// Když katalog/meta vrátí titul se skutečným IMDb ID (viz lib/tmdb.js),
// Nuvio/Stremio si ho pak při dalším otevření detailu vyžádá zpátky přesně
// v tomhle "tt..." formátu — musíme tedy umět jít od IMDb ID zpátky na
// TMDB id+kind. Nejdřív zkusíme Redis (zapsáno při prvním resolvnutí v
// lib/tmdb.js), a když tam není (cold item, cache vypršela), dotáhneme to
// přímo přes TMDB /find endpoint a výsledek si pro příště uložíme.
async function resolveImdbId(imdbId, typeHint) {
  const [cached] = await cacheLib.mget([`imdb2tmdb:${imdbId}`]);
  if (cached && cached.kind && cached.tmdbId) return cached;

  if (!TMDB_KEY) return null;
  const url = `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const wantTv = typeHint === 'series';
    const hit = (wantTv ? d.tv_results : d.movie_results)?.[0]
      || d.movie_results?.[0]
      || d.tv_results?.[0];
    if (!hit) return null;
    const kind = (wantTv || d.tv_results?.length) && !d.movie_results?.length ? 'tv' : (d.movie_results?.length ? 'movie' : 'tv');
    const resolved = { kind, tmdbId: String(hit.id) };
    await cacheLib.mset([[`imdb2tmdb:${imdbId}`, resolved]], 60 * 60 * 24 * 30);
    return resolved;
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id, type } = req.query;
  const rawId = String(id || '');

  let kind;
  let tmdbId;

  // id formát 1 (starý/fallback): tmdb-movie-603 / tmdb-tv-1399
  const mTmdb = rawId.match(/^tmdb-(movie|tv)-(\d+)$/);
  // id formát 2 (nový, primární): skutečné IMDb ID, tt1234567
  const mImdb = rawId.match(/^tt\d+$/);

  if (mTmdb) {
    kind = mTmdb[1];
    tmdbId = mTmdb[2];
  } else if (mImdb) {
    const resolved = await resolveImdbId(rawId, type);
    if (!resolved) return res.status(404).json({ meta: null });
    kind = resolved.kind;
    tmdbId = resolved.tmdbId;
  } else {
    return res.status(404).json({ meta: null });
  }

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
