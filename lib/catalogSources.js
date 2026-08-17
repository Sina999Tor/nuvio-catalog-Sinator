const { backendFetch } = require('./backend');

const BASE_URL = process.env.SINATOR_BACKEND_URL || 'https://sinator-backend.vercel.app';

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

// Vrátí { kind: 'movie'|'tv', ids: [...], raw?: [...] } pro daný catalog id,
// nebo null, pokud id neodpovídá žádnému známému katalogu. `raw` je jen u
// watchlistu (obsahuje i uložený title/poster, ať se nemusí znovu tahat
// z TMDB, když ho backend už má).
async function resolveCatalogIds(apiKey, catalogId) {
  if (catalogId === 'sinator-history-movies') {
    const items = await fetchAllHistory(apiKey, 'movies');
    return { kind: 'movie', ids: latestUniqueIds(items, 'watched_at') };
  }
  if (catalogId === 'sinator-history-shows') {
    const [shows, episodes] = await Promise.all([
      fetchAllHistory(apiKey, 'shows'),
      fetchAllHistory(apiKey, 'episodes'),
    ]);
    return { kind: 'tv', ids: latestUniqueIds([...(shows || []), ...(episodes || [])], 'watched_at') };
  }
  if (catalogId === 'sinator-watchlist-movies' || catalogId === 'sinator-watchlist-series') {
    const wantType = catalogId === 'sinator-watchlist-movies' ? 'movie' : 'tv';
    const items = await backendFetch(BASE_URL, apiKey, '/api/watchlist');
    const filtered = (items || [])
      .filter((i) => i.type === wantType)
      .sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
    return { kind: wantType, ids: filtered.map((i) => i.id), raw: filtered };
  }
  if (catalogId === 'sinator-progress-movies') {
    const items = await backendFetch(BASE_URL, apiKey, '/api/progress?type=movies');
    return { kind: 'movie', ids: (items || []).map((i) => i.id) };
  }
  if (catalogId === 'sinator-progress-shows') {
    const items = await backendFetch(BASE_URL, apiKey, '/api/progress?type=shows');
    return { kind: 'tv', ids: (items || []).map((i) => i.id) };
  }
  if (catalogId === 'sinator-ratings-movies') {
    const items = await backendFetch(BASE_URL, apiKey, '/api/ratings?type=movies');
    const ids = (items || []).sort((a, b) => (b.rated_at || 0) - (a.rated_at || 0)).map((i) => i.id);
    return { kind: 'movie', ids };
  }
  if (catalogId === 'sinator-ratings-shows') {
    const items = await backendFetch(BASE_URL, apiKey, '/api/ratings?type=shows');
    const ids = (items || []).sort((a, b) => (b.rated_at || 0) - (a.rated_at || 0)).map((i) => i.id);
    return { kind: 'tv', ids };
  }
  const m = String(catalogId || '').match(/^sinator-list-(.+)-(movie|series)$/);
  if (m) {
    const [, listId, kindLabel] = m;
    const wantType = kindLabel === 'movie' ? 'movie' : 'tv';
    const items = await backendFetch(BASE_URL, apiKey, `/api/lists/${encodeURIComponent(listId)}/items`);
    const ids = (items || [])
      .filter((i) => i.type === wantType)
      .sort((a, b) => (b.added_at || 0) - (a.added_at || 0))
      .map((i) => i.id);
    return { kind: wantType, ids };
  }
  return null;
}

module.exports = { resolveCatalogIds };
