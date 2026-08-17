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
3. Založ si zdarma Redis databázi na [upstash.com](https://upstash.com)
   (klidně novou, samostatnou od té, co používá `sinator-backend). V sekci
   REST API najdeš `UPSTASH_REDIS_REST_URL` a `UPSTASH_REDIS_REST_TOKEN`.
4. V nastavení Vercel projektu (Environment Variables) přidej:
   - `TMDB_API_KEY` — tvůj TMDB API klíč (povinné — bez něj katalogy kromě
     watchlistu nebudou mít poster/název, protože backend si u historie/
     rozkoukanosti/hodnocení/složek ukládá jen tmdb_id, ne plná metadata).
   - `UPSTASH_REDIS_REST_URL` a `UPSTASH_REDIS_REST_TOKEN` — trvalá cache
     pro TMDB metadata (viz "Proč Redis" níže). Bez nich addon pořád funguje,
     ale u velkých seznamů (stovky+ položek) nespolehlivě.
   - `SINATOR_BACKEND_URL` — volitelné, výchozí je
     `https://sinator-backend.vercel.app`. Nastav, jen pokud backend běží
     jinde.
5. Deploy.
6. Otevři `https://tvuj-addon.vercel.app/`, vlož API klíč ze
   sinator-backendu (stejný jako `x-api-key`), zaškrtni katalogy, které chceš
   v Nuviu/Stremiu vidět, a vygeneruj odkaz.
7. Klikni na **"Spustit prohřátí"** — natáhne TMDB metadata pro všechno, co
   máš v backendu, a uloží je do Redis cache. U velkých seznamů to může
   chvíli trvat (stránka ukazuje průběh), nech ji otevřenou, dokud nenapíše
   "Hotovo".
8. Tenhle odkaz (`.../<config>/manifest.json`) nainstaluj do Stremia
   tlačítkem, nebo v Nuviu přidej stejnou URL ručně jako zdroj addonu.

## Proč Redis (a proč ne stránkování)

Nuvio (na rozdíl od standardního Stremia) u vlastních addonů spolehlivě
nedonačítá další "stránky" katalogu (parametr `skip`) — u seznamu s 1000+
položkami se tak zastaví na první stránce a zbytek prostě nikdy nezobrazí.

Řešení je proto otočené: `api/catalog.js` vždy vrací **celý** seznam najednou,
ale rychle — protože metadata k jednotlivým titulům se čtou z Redis cache,
ne z TMDB při každém požadavku. Cache se naplní tlačítkem "Prohřát cache" na
configurační stránce (`api/warm.js`), které TMDB prochází po menších dávkách,
ať se to vejde do limitu běhu funkce i u tisícovkových seznamů.

Bez nastavené Redis cache addon pořád funguje (jen si TMDB natáhne za běhu),
ale u větších seznamů riskuje, že požadavek nestihne doběhnout v limitu
Vercel funkce (10 s na Hobby plánu) a katalog se v Nuviu ukáže neúplný nebo
prázdný.

## Jak to funguje

- `GET /:key/manifest.json` — natáhne `/api/lists` z backendu a pro každou
  tvou složku vygeneruje dva katalogy (filmy/seriály), plus 8 pevných
  katalogů (historie, watchlist, rozkoukané, hodnocení).
- `GET /:key/catalog/:type/:id.json` — zjistí kompletní seznam ID pro daný
  katalog (`lib/catalogSources.js`), pro každé dotáhne metadata z Redis
  cache / TMDB (`lib/tmdb.js`) a vrátí celý seznam najednou.
- `GET /:key/meta/:type/:id.json` — plné detaily jedné položky z TMDB.
- `GET /api/warm?key=...&id=...&offset=...` — interní endpoint pro
  configurační stránku; zpracuje dávku ~250 položek daného katalogu a uloží
  je do Redis cache. Volá se opakovaně s rostoucím `offset`, dokud
  nevrátí `done: true`.

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
  při rate-limitu (HTTP 429).
- Pokud se u nějakého ID nepovede najít metadata na TMDB (smazané ID, chybný
  typ film/seriál apod.), addon ho nezahazuje, ale vrátí náhradní záznam jen
  s ID (`#12345 (nedostupné na TMDB)`), místo aby ho tiše vynechal.
- Cache v Redis má TTL 30 dní — po tý době se položka při dalším zobrazení
  znovu stáhne z TMDB (obnoví se tak případně změněný poster/hodnocení).
- Po přidání spousty nových položek do backendu je dobré znovu spustit
  "Prohřát cache", ať se i ty nové objeví v Nuviu hned s metadaty.
- Čtení/zápis do Redis jde po dávkách max. 200 klíčů na jeden request (limit
  Upstash pipeline) — u katalogů s tisícovkami položek by jeden obří request
  se všemi klíči najednou spadl a tvářil se, že cache je prázdná, i kdyby
  byla plně prohřátá.
