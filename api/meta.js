const { tmdbFetchOne } = require('../lib/tmdb');

const TMDB_KEY = process.env.TMDB_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.query;

  // id formát: tmdb-movie-603 / tmdb-tv-1399
  const m = String(id || '').match(/^tmdb-(movie|tv)-(\d+)$/);
  if (!m) return res.status(404).json({ meta: null });

  const [, kind, tmdbId] = m;
  const meta = await tmdbFetchOne(TMDB_KEY, kind, tmdbId);
  if (!meta) return res.status(404).json({ meta: null });

  return res.status(200).json({ meta });
};
