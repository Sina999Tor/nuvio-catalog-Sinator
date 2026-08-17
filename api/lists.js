const { backendFetch } = require('../lib/backend');

const BASE_URL = process.env.SINATOR_BACKEND_URL || 'https://sinator-backend.vercel.app';

// Tenký proxy endpoint jen pro configurační stránku (index.html) — natáhne
// seznam uživatelových složek (Trakt/Simkl/Sinator listy), ať si je může
// uživatel jednotlivě zaškrtnout/odškrtnout před vygenerováním odkazu.
// Voláme ho ze serveru (ne přímo z prohlížeče na sinator-backend), abychom
// se vyhnuli případným CORS problémům jako dřív u jiných částí appky.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'Chybí API klíč' });

  try {
    const lists = await backendFetch(BASE_URL, key, '/api/lists');
    return res.status(200).json({ lists: lists || [] });
  } catch (e) {
    return res.status(200).json({ error: 'Nepodařilo se načíst složky — zkontroluj API klíč.' });
  }
};
