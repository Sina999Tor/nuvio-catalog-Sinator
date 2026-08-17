// Doplní titul/poster/popis pro ID uložená v backendu (ten si drží jen
// tmdb_id + typ, ne plná metadata – kromě watchlistu).
const TMDB_BASE = 'https://api.themoviedb.org/3';

// Jednoduchá in-memory cache – žije jen po dobu běhu funkce (studeného
// startu), ale ušetří duplicitní requesty v rámci jednoho catalog volání.
const cache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tmdbFetchOne(tmdbKey, kind, tmdbId, attempt = 0) {
  // kind: 'movie' | 'tv'
  const cacheKey = `${kind}:${tmdbId}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  if (!tmdbKey) return null;

  const url = `${TMDB_BASE}/${kind}/${tmdbId}?api_key=${tmdbKey}&language=cs-CZ`;
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
    const meta = {
      id: `tmdb-${kind}-${tmdbId}`,
      type: kind === 'movie' ? 'movie' : 'series',
      name: d.title || d.name || '',
      poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : undefined,
      background: d.backdrop_path ? `https://image.tmdb.org/t/p/original${d.backdrop_path}` : undefined,
      description: d.overview || '',
      releaseInfo: (d.release_date || d.first_air_date || '').slice(0, 4) || undefined,
      imdbRating: d.vote_average ? String(Math.round(d.vote_average * 10) / 10) : undefined,
    };
    cache.set(cacheKey, meta);
    return meta;
  } catch (e) {
    return null;
  }
}

// Dotazy na TMDB pojedou po dávkách s omezenou souběžností — u seznamů
// v řádu stovek/tisíců položek by naráz vypálených požadavků TMDB
// odmítalo (429) a ty položky by se z katalogu tiše ztratily.
const CONCURRENCY = 12;

async function tmdbFetchMany(tmdbKey, kind, ids) {
  const uniq = [...new Set((ids || []).filter(Boolean).map(String))];
  const out = [];
  for (let i = 0; i < uniq.length; i += CONCURRENCY) {
    const batch = uniq.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((id) => tmdbFetchOne(tmdbKey, kind, id)));
    out.push(...batchResults);
  }
  return out.filter(Boolean);
}

// Stejné jako tmdbFetchMany, ale NIKDY nezahazuje položku, u které selhalo
// TMDB vyhledání — vrátí náhradní záznam jen s ID. Tohle je kritické pro
// stránkované katalogy: pokud by stránka vrátila méně metas, než kolik
// Nuvio/Stremio požádalo, klient si to vyloží jako konec seznamu a přestane
// donačítat další stránky — i kdyby zbývaly stovky dalších položek.
async function tmdbFetchManyPreserveOrder(tmdbKey, kind, ids) {
  const list = (ids || []).filter(Boolean).map(String);
  const out = [];
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => tmdbFetchOne(tmdbKey, kind, id)));
    results.forEach((meta, idx) => {
      if (meta) {
        out.push(meta);
      } else {
        const rawId = batch[idx];
        out.push({
          id: `tmdb-${kind}-${rawId}`,
          type: kind === 'movie' ? 'movie' : 'series',
          name: `#${rawId} (nedostupné na TMDB)`,
        });
      }
    });
  }
  return out;
}

module.exports = { tmdbFetchOne, tmdbFetchMany, tmdbFetchManyPreserveOrder };
