// Tenký wrapper nad sinator-backend API (x-api-key auth).
async function backendFetch(baseUrl, apiKey, path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    throw new Error(`Backend ${path} -> HTTP ${res.status}`);
  }
  return res.json();
}

module.exports = { backendFetch };
