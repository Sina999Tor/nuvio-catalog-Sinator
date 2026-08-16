const { backendFetch } = require('../lib/backend');
const { tmdbFetchMany } = require('../lib/tmdb');
const { decodeConfig } = require('../lib/config');

const BASE_URL = process.env.SINATOR_BACKEND_URL || 'https://sinator-backend.vercel.app';
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

// Z pole položek historie/progressu (kde stejné id může mít víc záznamů —
// rewatch, jednotlivé epizody...) vybere pro každé id jen tu s nejnovějším
// časem a vrátí ID seřazená od nejnovějšího.
function latestUniqueIds(items, tsField) {
  const byId = new Map();
  for (const it of items || []) {
    const prev = byId.get(it.id);
    if (!prev || (it[tsField] || 0) > (prev[tsField] || 0)) byId.set(it.id, it);
  }
  return [...byId.values()]
    .sort((a, b) => (b[tsField] || 0) - (a[tsField] || 0))
    .map((i) => i.id);
}

// Watchlist v backendu má title/poster uložené jen když je appka poslala
// při přidání — pokud chybí poster_path, dotáhneme ho z TMDB stejně jako
// u ostatních katalogů, ale zachováme původní pořadí (podle added_at).
async function watchlistMetas(items, kind) {
  const withPoster = [];
  const missingIds = [];
  for (const it of items) {
    if (it.poster_path) withPoster.push(it);
    else missingIds.push(String(it.id));
  }
  const fetched = await tmdbFetchMany(TMDB_KEY, kind, missingIds);
  const byId = new Map();
  withPoster.forEach((it) => byId.set(String(it.id), watchlistToMeta(it)));
  fetched.forEach((m) => {
    const rawId = m.id.split('-').pop();
    byId.set(rawId, m);
  });
  return items.map((it) => byId.get(String(it.id))).filter(Boolean);
}

// Historii natáhneme po stránkách, dokud backend nevrátí kratší stránku
// než limit — jinak by se u lidí s > 200 zhlédnutými položkami část ořízla.
async function fetchAllHistory(apiKey, type) {
  const limit = 200;
  let page = 1;
  let all = [];
  while (page <= 25) { // pojistka: max 5000 položek
    const items = await backendFetch(BASE_URL, apiKey, `/api/history?type=${type}&page=${page}&limit=${limit}`);
    all = all.concat(items || []);
    if (!items || items.length < limit) break;
    page++;
  }
  return all;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.query;
  const config = decodeConfig(req.query.key);
  if (!config || !config.key) return res.status(401).json({ metas: [] });
  const apiKey = config.key;

  try {
    let metas = [];

    if (id === 'sinator-history-movies') {
      const items = await fetchAllHistory(apiKey, 'movies');
      metas = await tmdbFetchMany(TMDB_KEY, 'movie', latestUniqueIds(items, 'watched_at'));
    } else if (id === 'sinator-history-shows') {
      const [shows, episodes] = await Promise.all([
        fetchAllHistory(apiKey, 'shows'),
        fetchAllHistory(apiKey, 'episodes'),
      ]);
      const ids = latestUniqueIds([...(shows || []), ...(episodes || [])], 'watched_at');
      metas = await tmdbFetchMany(TMDB_KEY, 'tv', ids);
    } else if (id === 'sinator-watchlist-movies' || id === 'sinator-watchlist-series') {
      const wantType = id === 'sinator-watchlist-movies' ? 'movie' : 'tv';
      const kind = wantType === 'movie' ? 'movie' : 'tv';
      const items = await backendFetch(BASE_URL, apiKey, '/api/watchlist');
      const filtered = (items || [])
        .filter((i) => i.type === wantType)
        .sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
      metas = await watchlistMetas(filtered, kind);
    } else if (id === 'sinator-progress-movies') {
      const items = await backendFetch(BASE_URL, apiKey, '/api/progress?type=movies');
      metas = await tmdbFetchMany(TMDB_KEY, 'movie', (items || []).map((i) => i.id));
    } else if (id === 'sinator-progress-shows') {
      const items = await backendFetch(BASE_URL, apiKey, '/api/progress?type=shows');
      metas = await tmdbFetchMany(TMDB_KEY, 'tv', (items || []).map((i) => i.id));
    } else if (id === 'sinator-ratings-movies') {
      const items = await backendFetch(BASE_URL, apiKey, '/api/ratings?type=movies');
      const ids = (items || []).sort((a, b) => (b.rated_at || 0) - (a.rated_at || 0)).map((i) => i.id);
      metas = await tmdbFetchMany(TMDB_KEY, 'movie', ids);
    } else if (id === 'sinator-ratings-shows') {
      const items = await backendFetch(BASE_URL, apiKey, '/api/ratings?type=shows');
      const ids = (items || []).sort((a, b) => (b.rated_at || 0) - (a.rated_at || 0)).map((i) => i.id);
      metas = await tmdbFetchMany(TMDB_KEY, 'tv', ids);
    } else if (id && id.startsWith('sinator-list-')) {
      const m = id.match(/^sinator-list-(.+)-(movie|series)$/);
      if (m) {
        const [, listId, kindLabel] = m;
        const wantType = kindLabel === 'movie' ? 'movie' : 'tv';
        const items = await backendFetch(BASE_URL, apiKey, `/api/lists/${encodeURIComponent(listId)}/items`);
        const filtered = (items || [])
          .filter((i) => i.type === wantType)
          .sort((a, b) => (b.added_at || 0) - (a.added_at || 0))
          .map((i) => i.id);
        metas = await tmdbFetchMany(TMDB_KEY, wantType, filtered);
      }
    }

    return res.status(200).json({ metas });
  } catch (e) {
    // Radši prázdný katalog než pád celé appky v Nuviu/Stremiu.
    return res.status(200).json({ metas: [] });
  }
};
