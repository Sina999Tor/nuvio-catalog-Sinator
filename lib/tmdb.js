// Doplní titul/poster/popis pro ID uložená v backendu (ten si drží jen
// tmdb_id + typ, ne plná metadata – kromě watchlistu).
const cacheLib = require('./cache');

const TMDB_BASE = 'https://api.themoviedb.org/3';

// Jednoduchá in-memory cache – žije jen po dobu běhu funkce (studeného
// startu). Trvalá cache mezi requesty jede přes lib/cache.js (Redis).
const memCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tmdbFetchOne(tmdbKey, kind, tmdbId, attempt = 0) {
  // kind: 'movie' | 'tv'
  const cacheKey = `${kind}:${tmdbId}`;
  if (memCache.has(cacheKey)) return memCache.get(cacheKey);
  if (!tmdbKey) return null;

  // append_to_response=external_ids — u seriálů to je JEDINÁ cesta, jak
  // dostat IMDb ID (u filmů ho TMDB vrací rovnou jako d.imdb_id, ale
  // append_to_response nevadí, jen se ignoruje).
  const url = `${TMDB_BASE}/${kind}/${tmdbId}?api_key=${tmdbKey}&language=cs-CZ&append_to_response=external_ids`;
  try {
    const r = await fetch(url);

    // TMDB rate-limit — u velkých seznamů se občas přihlásí, radši
    // chvilku počkat a zkusit znovu, než tu položku tiše zahodit.
    if (r.status === 429 && attempt < 3) {
      await sleep(400 * (attempt + 1));
      return tmdbFetchOne(tmdbKey, kind, tmdbId, attempt + 1);
    }

    if (!r.ok) return null;
    const d = await r.json();

    // IMDb ID: u filmů rovnou v odpovědi, u seriálů v external_ids.
    // DŮLEŽITÉ: používáme ho jako primární "id" pro Stremio/Nuvio, ne jen
    // jako doplňkové pole — vedlejší pole by nikam nevedlo, protože
    // Stremio/Nuvio směruje /stream dotazy podle idPrefixu samotného "id",
    // ne podle nějakého extra pole. Bez skutečného "tt..." ID by většina
    // stream-scraper doplňků (Torrentio a podobné, co rozumí jen IMDb ID)
    // tenhle titul nikdy nenašla. Pokud TMDB IMDb ID nezná (typicky u
    // čerstvě přidaných/regionálních titulů), spadneme zpátky na starý
    // formát "tmdb-<kind>-<id>" — meta detail bude fungovat, jen externí
    // stream doplňky ho nenajdou.
    const imdbId = kind === 'movie' ? d.imdb_id : (d.external_ids && d.external_ids.imdb_id);

    const meta = {
      id: imdbId || `tmdb-${kind}-${tmdbId}`,
      type: kind === 'movie' ? 'movie' : 'series',
      name: d.title || d.name || '',
      poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : undefined,
      background: d.backdrop_path ? `https://image.tmdb.org/t/p/original${d.backdrop_path}` : undefined,
      description: d.overview || '',
      releaseInfo: (d.release_date || d.first_air_date || '').slice(0, 4) || undefined,
      imdbRating: d.vote_average ? String(Math.round(d.vote_average * 10) / 10) : undefined,
      // Vlastní pomocná pole (Stremio/Nuvio je ignoruje, ale meta.js si
      // podle nich při dotazu na "tt..." ID dohledá zpátky TMDB záznam).
      _tmdbId: String(tmdbId),
      _tmdbKind: kind,
    };
    memCache.set(cacheKey, meta);
    return meta;
  } catch (e) {
    return null;
  }
}

// Dotazy na TMDB pojedou po dávkách s omezenou souběžností — u seznamů
// v řádu stovek/tisíců položek by naráz vypálených požadavků TMDB
// odmítalo (429) a ty položky by se z katalogu tiše ztratily.
const CONCURRENCY = 12;

// TTL pro trvalou (Redis) cache – 30 dní. Filmy/seriály se prakticky
// neztrácí, jen chceme, aby se čas od času poster/hodnocení obnovily.
const CACHE_TTL = 60 * 60 * 24 * 30;

// Hlavní funkce, kterou používá katalog i "prohřívání" cache. Postup:
// 1) zkusí Redis cache pro všechna ID najednou (jeden HTTP pipeline request)
// 2) na TMDB se ptá jen na to, co v cache nebylo
// 3) čerstvě stažené výsledky uloží zpátky do Redis
// NIKDY nezahazuje položku, u které selhalo TMDB vyhledání — vrátí náhradní
// záznam jen s ID, aby výstup vždy odpovídal počtu vstupních ID (důležité
// i pro budoucí případné stránkování).
async function tmdbFetchManyPreserveOrder(tmdbKey, kind, ids) {
  const list = (ids || []).filter(Boolean).map(String);
  if (!list.length) return [];

  const cacheKeys = list.map((id) => `tmdbmeta:${kind}:${id}`);
  const cached = await cacheLib.mget(cacheKeys);

  const out = new Array(list.length);
  const missingPositions = [];
  cached.forEach((val, idx) => {
    if (val) out[idx] = val;
    else missingPositions.push(idx);
  });

  const missingIds = missingPositions.map((idx) => list[idx]);
  const toCache = [];

  for (let i = 0; i < missingIds.length; i += CONCURRENCY) {
    const batchPositions = missingPositions.slice(i, i + CONCURRENCY);
    const batchIds = missingIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batchIds.map((id) => tmdbFetchOne(tmdbKey, kind, id)));
    results.forEach((meta, j) => {
      const pos = batchPositions[j];
      const rawId = batchIds[j];
      if (meta) {
        out[pos] = meta;
        toCache.push([`tmdbmeta:${kind}:${rawId}`, meta]);
        if (meta.id && meta.id.startsWith('tt')) {
          toCache.push([`imdb2tmdb:${meta.id}`, { kind, tmdbId: rawId }]);
        }
      } else {
        out[pos] = {
          id: `tmdb-${kind}-${rawId}`,
          type: kind === 'movie' ? 'movie' : 'series',
          name: `#${rawId} (nedostupné na TMDB)`,
        };
      }
    });
  }

  if (toCache.length) {
    await cacheLib.mset(toCache, CACHE_TTL);
  }

  return out;
}

module.exports = { tmdbFetchOne, tmdbFetchManyPreserveOrder };
