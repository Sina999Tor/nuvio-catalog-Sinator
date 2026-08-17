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

// Upstash má na jeden pipeline request limit počtu příkazů/velikosti těla —
// u katalogů s 1000+ položkami by jeden request se všemi klíči najednou
// spadl, a celý dotaz by se tiše vyhodnotil jako "nic v cache není", i když
// tam ve skutečnosti bylo. Proto se to posílá po menších dávkách.
const PIPELINE_CHUNK = 200;

// Vrátí pole hodnot (parsované z JSON) ve stejném pořadí jako `keys`;
// chybějící/neplatné položky jsou null.
async function mget(keys) {
  if (!keys.length) return [];
  if (!enabled()) return keys.map(() => null);

  const out = [];
  for (let i = 0; i < keys.length; i += PIPELINE_CHUNK) {
    const chunk = keys.slice(i, i + PIPELINE_CHUNK);
    const results = await pipeline(chunk.map((k) => ['GET', k]));
    if (!results) {
      out.push(...chunk.map(() => null));
      continue;
    }
    results.forEach((r) => {
      if (!r || r.result == null) {
        out.push(null);
        return;
      }
      try {
        out.push(JSON.parse(r.result));
      } catch (e) {
        out.push(null);
      }
    });
  }
  return out;
}

// entries: [[key, valueObj], ...]
async function mset(entries, ttlSeconds) {
  if (!entries.length || !enabled()) return;
  for (let i = 0; i < entries.length; i += PIPELINE_CHUNK) {
    const chunk = entries.slice(i, i + PIPELINE_CHUNK);
    const commands = chunk.map(([k, v]) => {
      const val = JSON.stringify(v);
      return ttlSeconds ? ['SET', k, val, 'EX', String(ttlSeconds)] : ['SET', k, val];
    });
    await pipeline(commands);
  }
}

module.exports = { mget, mset, enabled };
