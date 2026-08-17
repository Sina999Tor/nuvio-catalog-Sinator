const { backendFetch } = require('../lib/backend');
const { decodeConfig } = require('../lib/config');

const BASE_URL = process.env.SINATOR_BACKEND_URL || 'https://sinator-backend.vercel.app';

const ALL_STATIC_CATALOGS = [
  { type: 'movie', id: 'sinator-history-movies', name: 'Sledované filmy' },
  { type: 'series', id: 'sinator-history-shows', name: 'Sledované seriály' },
  { type: 'movie', id: 'sinator-watchlist-movies', name: 'Watchlist filmy' },
  { type: 'series', id: 'sinator-watchlist-series', name: 'Watchlist seriály' },
  { type: 'movie', id: 'sinator-progress-movies', name: 'Rozkoukané filmy' },
  { type: 'series', id: 'sinator-progress-shows', name: 'Rozkoukané seriály' },
  { type: 'movie', id: 'sinator-ratings-movies', name: 'Oblíbené filmy' },
  { type: 'series', id: 'sinator-ratings-shows', name: 'Oblíbené seriály' },
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const config = decodeConfig(req.query.key);

  const manifest = {
    id: 'cz.sinator.nuvio.catalog',
    version: '1.2.0',
    name: 'Sinator Katalogy',
    description: 'Katalogy z tvého Sinator backendu — sledované, watchlist, rozkoukané, hodnocení a vlastní složky.',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tmdb-'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: !config || !config.key },
  };

  if (!config || !config.key) {
    // Bez klíče vrátíme jen prázdný manifest s configurationRequired,
    // ať Stremio/Nuvio ukáže "Configure" a uživatel doplní API klíč.
    return res.status(200).json(manifest);
  }

  // cats = seznam ID vybraných katalogů z configu; null/prázdné = všechny.
  const enabled = Array.isArray(config.cats) && config.cats.length ? new Set(config.cats) : null;

  for (const c of ALL_STATIC_CATALOGS) {
    if (!enabled || enabled.has(c.id)) {
      manifest.catalogs.push({
        ...c,
        name: `Sinator Katalogy – ${c.name}`,
        // Podpora stránkování — u velkých seznamů (stovky+ položek) si
        // Nuvio/Stremio při scrollování samo vyžádá další stránku (skip),
        // místo aby čekalo na natažení a obohacení úplně všeho najednou.
        extra: [{ name: 'skip', isRequired: false }],
        extraSupported: ['skip'],
      });
    }
  }

  // Moje složky = dynamické, natáhneme si je při generování manifestu.
  // config.lists může být:
  //   true / undefined  -> všechny složky (výchozí, zpětně kompatibilní)
  //   false              -> žádné složky
  //   [id, id, ...]      -> jen vybrané složky
  const wantLists = config.lists !== false;
  const selectedListIds = Array.isArray(config.lists) ? new Set(config.lists.map(String)) : null;
  if (wantLists) {
    try {
      const lists = await backendFetch(BASE_URL, config.key, '/api/lists');
      for (const list of lists || []) {
        if (selectedListIds && !selectedListIds.has(String(list.id))) continue;
        manifest.catalogs.push({
          type: 'movie',
          id: `sinator-list-${list.id}-movie`,
          name: `Sinator Katalogy – 📁 ${list.name} (filmy)`,
          extra: [{ name: 'skip', isRequired: false }],
          extraSupported: ['skip'],
        });
        manifest.catalogs.push({
          type: 'series',
          id: `sinator-list-${list.id}-series`,
          name: `Sinator Katalogy – 📁 ${list.name} (seriály)`,
          extra: [{ name: 'skip', isRequired: false }],
          extraSupported: ['skip'],
        });
      }
    } catch (e) {
      // Backend nedostupný / špatný klíč — vrátíme aspoň statické katalogy,
      // ať addon nespadne úplně.
    }
  }

  return res.status(200).json(manifest);
};
