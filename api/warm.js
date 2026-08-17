const { decodeConfig } = require('../lib/config');
const { resolveCatalogIds } = require('../lib/catalogSources');
const { tmdbFetchManyPreserveOrder } = require('../lib/tmdb');

const TMDB_KEY = process.env.TMDB_API_KEY;

// Kolik ID se zpracuje na jedno volání. Bere se vždy jen tenhle kus, ať se
// to spolehlivě vejde do limitu běhu funkce i u obřích seznamů — index.html
// pak volá tenhle endpoint v cyklu s rostoucím offsetem, dokud nepřijde
// done:true.
const CHUNK = 250;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.query;
  const offset = parseInt(req.query.offset || '0', 10) || 0;
  const config = decodeConfig(req.query.key);
  if (!config || !config.key) return res.status(401).json({ error: 'Neplatný klíč.' });

  try {
    const resolved = await resolveCatalogIds(config.key, id);
    if (!resolved) return res.status(200).json({ done: true, total: 0, warmed: 0 });

    const total = resolved.ids.length;
    const chunkIds = resolved.ids.slice(offset, offset + CHUNK);

    if (chunkIds.length) {
      // Tohle samo o sobě zapisuje do Redis cache (viz lib/tmdb.js) —
      // výsledek tady ani nepotřebujeme, jen vedlejší efekt prohřátí.
      await tmdbFetchManyPreserveOrder(TMDB_KEY, resolved.kind, chunkIds);
    }

    const warmed = offset + chunkIds.length;
    return res.status(200).json({ done: warmed >= total, total, warmed });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
