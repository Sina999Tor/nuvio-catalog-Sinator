const { tmdbFetchManyPreserveOrder } = require('../lib/tmdb');
const { decodeConfig } = require('../lib/config');
const { resolveCatalogIds } = require('../lib/catalogSources');

const TMDB_KEY = process.env.TMDB_API_KEY;

function watchlistToMeta(item) {
  return {
    id: `tmdb-${item.type === 'movie' ? 'movie' : 'tv'}-${item.id}`,
    type: item.type === 'movie' ? 'movie' : 'series',
    name: item.title || '',
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
    releaseInfo: item.year ? String(item.year) : undefined,
  };
}

// Watchlist v backendu má title/poster uložené jen když je appka poslala
// při přidání — pokud chybí poster_path, dotáhneme ho z TMDB (přes cache)
// stejně jako u ostatních katalogů, ale zachováme původní pořadí a počet.
async function watchlistMetas(items, kind) {
  const withPoster = [];
  const missingIds = [];
  for (const it of items) {
    if (it.poster_path) withPoster.push(it);
    else missingIds.push(String(it.id));
  }
  const fetched = await tmdbFetchManyPreserveOrder(TMDB_KEY, kind, missingIds);
  const byId = new Map();
  withPoster.forEach((it) => byId.set(String(it.id), watchlistToMeta(it)));
  fetched.forEach((m) => {
    const rawId = m.id.split('-').pop();
    byId.set(rawId, m);
  });
  return items.map((it) => byId.get(String(it.id))).filter(Boolean);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.query;
  const config = decodeConfig(req.query.key);
  if (!config || !config.key) return res.status(401).json({ metas: [] });

  try {
    const resolved = await resolveCatalogIds(config.key, id);
    if (!resolved) return res.status(200).json({ metas: [] });

    let metas;
    if (resolved.raw) {
      // watchlist — má vlastní rychlou cestu s uloženým title/posterem
      metas = await watchlistMetas(resolved.raw, resolved.kind);
    } else {
      // Nuvio/Stremio klienti spolehlivě nepodporují stránkování (skip) u
      // vlastních addonů, takže vracíme rovnou celý seznam. U velkých
      // seznamů (stovky+) je klíčové mít TMDB metadata předehřátá v Redis
      // cache (viz api/warm.js) — jinak by tenhle request mohl trvat
      // desítky vteřin a narazit na limit běhu funkce.
      metas = await tmdbFetchManyPreserveOrder(TMDB_KEY, resolved.kind, resolved.ids);
    }

    return res.status(200).json({ metas });
  } catch (e) {
    // Radši prázdný katalog než pád celé appky v Nuviu/Stremiu.
    return res.status(200).json({ metas: [] });
  }
};
