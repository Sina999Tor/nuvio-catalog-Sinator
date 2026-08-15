# sinator-nuvio-catalog

Stremio/Nuvio katalogový doplněk napojený na tvůj `sinator-backend`. Zobrazuje
v Nuviu jako katalogy: sledované filmy/seriály (historie), watchlist,
rozkoukané, oblíbené (hodnocení) a vlastní složky — každá jako samostatný
katalog.

**Neřeší streamy** — jen procházení/knihovnu. Na přehrávání zdrojů dál
používáš svůj stávající `sinator-nuvio-addon` (nebo jiný stream addon).

## Nasazení

1. Nahraj tenhle obsah do nového GitHub repa (např. `sinator-nuvio-catalog`).
2. Import do Vercelu jako nový projekt.
3. V nastavení projektu (Environment Variables) přidej:
   - `TMDB_API_KEY` — tvůj TMDB API klíč (povinné — bez něj katalogy kromě
     watchlistu nebudou mít poster/název, protože backend si u historie/
     rozkoukanosti/hodnocení/složek ukládá jen tmdb_id, ne plná metadata).
   - `SINATOR_BACKEND_URL` — volitelné, výchozí je
     `https://sinator-backend.vercel.app`. Nastav, jen pokud backend běží
     jinde.
4. Deploy.
5. Otevři `https://tvuj-addon.vercel.app/`, vlož API klíč ze
   sinator-backendu (stejný jako `x-api-key`), vygeneruj odkaz.
6. Tenhle odkaz (`.../<klíč>/manifest.json`) nainstaluj do Stremia tlačítkem,
   nebo v Nuviu přidej stejnou URL ručně jako zdroj addonu.

## Jak to funguje

- `GET /:key/manifest.json` — natáhne `/api/lists` z backendu a pro každou
  tvou složku vygeneruje dva katalogy (filmy/seriály), plus 8 pevných
  katalogů (historie, watchlist, rozkoukané, hodnocení).
- `GET /:key/catalog/:type/:id.json` — stáhne data z backendu
  (`x-api-key: <key>`), pro položky bez uloženého titulu/posteru (vše kromě
  watchlistu) je dotáhne z TMDB (jazyk `cs-CZ`).
- `GET /:key/meta/:type/:id.json` — plné detaily jedné položky z TMDB.

## Poznámky

- API klíč je součástí URL (standardní způsob konfigurace Stremio addonů) —
  neposílej tenhle odkaz nikomu jinému.
- "Oblíbené" v katalozích = `/api/ratings` z backendu (žádný samostatný
  endpoint pro oblíbené v backendu není).
- U historie seriálů se slučují záznamy `history:shows` (celý seriál
  označený shlédnutý) i `history:episodes` (jednotlivé epizody) — zobrazí se
  jako jeden řádek za seriál, seřazeno podle posledního shlédnutí.
