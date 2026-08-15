const { backendFetch } = require('../lib/backend');

const BASE_URL = process.env.SINATOR_BACKEND_URL || 'https://sinator-backend.vercel.app';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = req.query.key;

  const manifest = {
    id: 'cz.sinator.nuvio.catalog',
    version: '1.0.0',
    name: 'Sinator Katalogy',
    description: 'Katalogy z tvého Sinator backendu — sledované, watchlist, rozkoukané, hodnocení a vlastní složky.',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tmdb-'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: !key },
  };

  if (!key) {
    // Bez klíče vrátíme jen prázdný manifest s configurationRequired,
    // ať Stremio/Nuvio ukáže "Configure" a uživatel doplní API klíč.
    return res.status(200).json(manifest);
  }

  const staticCatalogs = [
    { type: 'movie', id: 'sinator-history-movies', name: 'Sinator – Sledované filmy' },
    { type: 'series', id: 'sinator-history-shows', name: 'Sinator – Sledované seriály' },
    { type: 'movie', id: 'sinator-watchlist-movies', name: 'Sinator – Watchlist filmy' },
    { type: 'series', id: 'sinator-watchlist-series', name: 'Sinator – Watchlist seriály' },
    { type: 'movie', id: 'sinator-progress-movies', name: 'Sinator – Rozkoukané filmy' },
    { type: 'series', id: 'sinator-progress-shows', name: 'Sinator – Rozkoukané seriály' },
    { type: 'movie', id: 'sinator-ratings-movies', name: 'Sinator – Oblíbené filmy' },
    { type: 'series', id: 'sinator-ratings-shows', name: 'Sinator – Oblíbené seriály' },
  ];
  manifest.catalogs.push(...staticCatalogs);

  // Moje složky = dynamické, natáhneme si je při generování manifestu,
  // ať se v Nuviu/Stremiu objeví jako samostatné katalogy.
  try {
    const lists = await backendFetch(BASE_URL, key, '/api/lists');
    for (const list of lists || []) {
      manifest.catalogs.push({
        type: 'movie',
        id: `sinator-list-${list.id}-movie`,
        name: `📁 ${list.name} (filmy)`,
      });
      manifest.catalogs.push({
        type: 'series',
        id: `sinator-list-${list.id}-series`,
        name: `📁 ${list.name} (seriály)`,
      });
    }
  } catch (e) {
    // Backend nedostupný / špatný klíč — vrátíme aspoň statické katalogy,
    // ať addon nespadne úplně.
  }

  return res.status(200).json(manifest);
};
