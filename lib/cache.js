// Tenký wrapper nad Upstash Redis REST API. Bez těchhle env proměnných
// prostě jede naprázdno (mget/mset jsou no-op) — addon funguje dál, jen
// bez trvalé cache (a tedy pomaleji/nespolehlivě u velkých seznamů).
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function enabled() {
  return !!(REDIS_URL && REDIS_TOKEN);
}

async function pipeline(commands) {
  if (!commands.length || !enabled()) return null;
  try {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    return null;
  }
}

// Vrátí pole hodnot (parsované z JSON) ve stejném pořadí jako `keys`;
// chybějící/neplatné položky jsou null.
async function mget(keys) {
  if (!keys.length) return [];
  if (!enabled()) return keys.map(() => null);
  const results = await pipeline(keys.map((k) => ['GET', k]));
  if (!results) return keys.map(() => null);
  return results.map((r) => {
    if (!r || r.result == null) return null;
    try {
      return JSON.parse(r.result);
    } catch (e) {
      return null;
    }
  });
}

// entries: [[key, valueObj], ...]
async function mset(entries, ttlSeconds) {
  if (!entries.length || !enabled()) return;
  const commands = entries.map(([k, v]) => {
    const val = JSON.stringify(v);
    return ttlSeconds ? ['SET', k, val, 'EX', String(ttlSeconds)] : ['SET', k, val];
  });
  await pipeline(commands);
}

module.exports = { mget, mset, enabled };
