// Config (API klíč + výběr katalogů) je zabalený jako base64url JSON
// v jednom URL segmentu, ať uživatel nemusí řešit víc parametrů.
function decodeConfig(raw) {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

module.exports = { decodeConfig };
