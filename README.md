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
   sinator-backendu (stejný jako `x-api-key`), zaškrtni katalogy, které chceš
   v Nuviu/Stremiu vidět, a vygeneruj odkaz.
6. Tenhle odkaz (`.../<config>/manifest.json`) nainstaluj do Stremia
   tlačítkem, nebo v Nuviu přidej stejnou URL ručně jako zdroj addonu.

## Jak to funguje

- `GET /:key/manifest.json` — natáhne `/api/lists` z backendu a pro každou
  tvou složku vygeneruje dva katalogy (filmy/seriály), plus 8 pevných
  katalogů (historie, watchlist, rozkoukané, hodnocení).
- `GET /:key/catalog/:type/:id.json` — stáhne data z backendu
  (`x-api-key: <key>`), pro položky bez uloženého titulu/posteru (vše kromě
  watchlistu) je dotáhne z TMDB (jazyk `cs-CZ`).
- `GET /:key/meta/:type/:id.json` — plné detaily jedné položky z TMDB.

## Poznámky

- API klíč je součástí URL (zabalený spolu s výběrem katalogů do jednoho
  base64 configu) — neposílej tenhle odkaz nikomu jinému.
- Katalogy si vybíráš zaškrtnutím na configurační stránce — pokud necháš
  všechny zaškrtnuté, nově přidané katalogy (kdybych jich časem přidal víc)
  se objeví samy, bez nutnosti odkaz znovu generovat.
- "Oblíbené" v katalozích = `/api/ratings` z backendu (žádný samostatný
  endpoint pro oblíbené v backendu není).
- U historie seriálů se slučují záznamy `history:shows` (celý seriál
  označený shlédnutý) i `history:episodes` (jednotlivé epizody) — zobrazí se
  jako jeden řádek za seriál, seřazeno podle posledního shlédnutí.
- U watchlistu se poster/název berou primárně z backendu (pokud je appka
  uložila); pokud chybí, doplní se z TMDB stejně jako u ostatních katalogů.
- Dotazy na TMDB jedou po dávkách (12 souběžně) s automatickým opakováním
  při rate-limitu (HTTP 429) — u velkých seznamů (stovky/tisíce položek) to
  může trvat déle, proto má `api/catalog.js` limit běhu nastavený na 60 s
  (`vercel.json` → `functions.maxDuration`). Na Hobby plánu Vercelu je 60 s
  strop; na placeném plánu jde nastavit i výš, kdyby to u extrémně velkých
  seznamů (tisíce+ položek) pořád nestíhalo.
