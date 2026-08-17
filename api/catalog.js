const { backendFetch } = require('../lib/backend');
const { tmdbFetchManyPreserveOrder } = require('../lib/tmdb');
const { decodeConfig } = require('../lib/config');

const BASE_URL = process.env.SINATOR_BACKEND_URL || 'https://sinator-backend.vercel.app';
const TMDB_KEY = process.env.TMDB_API_KEY;

// Kolik položek se pošle na jeden request. Nuvio/Stremio si při scrollování
// dolů samo vyžádá další stránku (parametr skip) — díky tomu i katalog s
// 1300+ položkami zvládne Vercel Hobby (10s limit na běh funkce), protože
// se na TMDB pokaždé ptáme jen na tuhle jednu stránku, ne na celý seznam.
const PAGE_SIZE = 100;

function parseSkip(extraRaw) {
  if (!extraRaw) return 0;
  try {
    const decoded = decodeURIComponent(extraRaw);
    const params = new URLSearchParams(decoded);
    const skip = parseInt(params.get('skip') || '0', 10);
    return Number.isFinite(skip) && skip > 0 ? skip : 0;
  } catch (e) {
    return 0;
  }
}

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
// u ostatních katalogů, ale zachováme původní pořadí (podle added_at) a
// počet (žádné tiché zahazování, viz komentář u tmdbFetchManyPreserveOrder).
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

// Historii natáhneme po stránkách, dokud backend nevrátí kratší stránku
// než limit — jinak by se u lidí s > 200 zhlédnutými položkami část ořízla.
// Tohle je čtení z backendu (Redis) a je levné/rychlé samo o sobě — drahé
// je až dotazování TMDB, to se dělá až na vyfiltrovanou stránku níž.
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
  const skip = parseSkip(req.query.extra);

  try {
    let metas = [];

    if (id === 'sinator-history-movies') {
      const items = await fetchAllHistory(apiKey, 'movies');
      const pageIds = latestUniqueIds(items, 'watched_at').slice(skip, skip + PAGE_SIZE);
      metas = await tmdbFetchManyPreserveOrder(TMDB_KEY, 'movie', pageIds);
    } else if (id === 'sinator-history-shows') {
      const [shows, episodes] = await Promise.all([
        fetchAllHistory(apiKey, 'shows'),
        fetchAllHistory(apiKey, 'episodes'),
      ]);
      const pageIds = latestUniqueIds([...(shows || []), ...(episodes || [])], 'watched_at').slice(skip, skip + PAGE_SIZE);
      metas = await tmdbFetchManyPreserveOrder(TMDB_KEY, 'tv', pageIds);
    } else if (id === 'sinator-watchlist-movies' || id === 'sinator-watchlist-series') {
      const wantType = id === 'sinator-watchlist-movies' ? 'movie' : 'tv';
      const items = await backendFetch(BASE_URL, apiKey, '/api/watchlist');
      const filtered = (items || [])
        .filter((i) => i.type === wantType)
        .sort((a, b) => (b.added_at || 0) - (a.added_at || 0))
        .slice(skip, skip + PAGE_SIZE);
      metas = await watchlistMetas(filtered, wantType);
    } else if (id === 'sinator-progress-movies') {
      const items = await backendFetch(BASE_URL, apiKey, '/api/progress?type=movies');
      const pageIds = (items || []).map((i) => i.id).slice(skip, skip + PAGE_SIZE);
      metas = await tmdbFetchManyPreserveOrder(TMDB_KEY, 'movie', pageIds);
    } else if (id === 'sinator-progress-shows') {
      const items = await backendFetch(BASE_URL, apiKey, '/api/progress?type=shows');
      const pageIds = (items || []).map((i) => i.id).slice(skip, skip + PAGE_SIZE);
      metas = await tmdbFetchManyPreserveOrder(TMDB_KEY, 'tv', pageIds);
    } else if (id === 'sinator-ratings-movies') {
      const items = await backendFetch(BASE_URL, apiKey, '/api/ratings?type=movies');
      const pageIds = (items || [])
        .sort((a, b) => (b.rated_at || 0) - (a.rated_at || 0))
        .map((i) => i.id)
        .slice(skip, skip + PAGE_SIZE);
      metas = await tmdbFetchManyPreserveOrder(TMDB_KEY, 'movie', pageIds);
    } else if (id === 'sinator-ratings-shows') {
      const items = await backendFetch(BASE_URL, apiKey, '/api/ratings?type=shows');
      const pageIds = (items || [])
        .sort((a, b) => (b.rated_at || 0) - (a.rated_at || 0))
        .map((i) => i.id)
        .slice(skip, skip + PAGE_SIZE);
      metas = await tmdbFetchManyPreserveOrder(TMDB_KEY, 'tv', pageIds);
    } else if (id && id.startsWith('sinator-list-')) {
      const m = id.match(/^sinator-list-(.+)-(movie|series)$/);
      if (m) {
        const [, listId, kindLabel] = m;
        const wantType = kindLabel === 'movie' ? 'movie' : 'tv';
        const items = await backendFetch(BASE_URL, apiKey, `/api/lists/${encodeURIComponent(listId)}/items`);
        const pageIds = (items || [])
          .filter((i) => i.type === wantType)
          .sort((a, b) => (b.added_at || 0) - (a.added_at || 0))
          .map((i) => i.id)
          .slice(skip, skip + PAGE_SIZE);
        metas = await tmdbFetchManyPreserveOrder(TMDB_KEY, wantType, pageIds);
      }
    }

    return res.status(200).json({ metas });
  } catch (e) {
    // Radši prázdný katalog než pád celé appky v Nuviu/Stremiu.
    return res.status(200).json({ metas: [] });
  }
};
