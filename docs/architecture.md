# Architektura ChainDetective v0.3

## Evidence sledovaných peněženek

Modul `dist/smart-wallets.js` obsluhuje samostatnou sekci Smart wallets a formulář. `server/smart-wallets.mjs` používá stejnou SQLite connection jako ScanStore, přidává idempotentně tabulku `smart_wallets` a nemění uložené skeny. Adresa v malých písmenech je primární klíč; záznam uchovává název, štítky, zdroj, poznámku, stav, sítě a čas vytvoření/změny.

- `GET /api/smart-wallets` vrací evidenci včetně vyřazených adres.
- `POST /api/smart-wallets` přijímá `{addresses,name,tags,source,note,status,chainIds}` a vrací `{created,existing}`. Nejvýše 200 adres, 12 štítků, alespoň jedna známá síť; validace probíhá před transakcí. Konflikt adresy zachová existující data.
- `PUT /api/smart-wallets/{address}` upravuje celé metadata existující adresy; její identita a čas vytvoření se nemění.

Stavy `candidate`, `reviewed`, `excluded` jsou ruční klasifikace. Trvalé mazání není součástí rozhraní; vyřazenou adresu lze aktivovat změnou stavu. Stejná kontrola loopback původu a limit JSON těla platí pro obě API. Používají se parametrizované SQL příkazy a text se při vykreslení escapuje.

Evidence nevolá externí služby při uložení. Navazující analýza předvyplní nejvýše 20 adres a podporované živé sítě; uživatel spustí sken explicitně. Pro přenos z watchlistu se používají pouze Live snapshoty. Záznamy z demo datasetu se automaticky nepřenášejí. Regrese `tests/smart-wallets-regression.mjs` ověřuje atomické vložení, deduplikaci, zachování poznámek, změny hodnocení, restart SQLite a kontrolu původu.


## Alchemy pro Wallet Profiler

Zkopírujte .env.example do .env, nastavte ALCHEMY_API_KEY a restartujte server. Klíč zůstává na serveru; .env je v .gitignore. Bez klíče se používá Blockscout.

Wallet Profiler používá Alchemy Portfolio API (Tokens By Wallet), včetně metadat, dostupných USD cen a stránkování. Podporované sítě adaptéru: Ethereum, Base, Arbitrum, Optimism, zkSync Era, Scroll a Linea. Hledání držitelů ERC-20 dál používá Blockscout na prvních čtyřech sítích; Alchemy getOwnersForToken je NFT endpoint. Robinhood zatím není v adaptéru.

Při vyčerpaném kreditu, chybě přístupu nebo přetrvávajícím výpadku se daná kombinace adresy a sítě přepne na Blockscout, je-li dostupný. Krátkodobé limity 429 a výpadky se nejdříve dvakrát opakují. Přepnutí atomicky zahodí pouze pozice a kurzory této úlohy a načte zálohu od první stránky. Zdroje se v jedné úloze nemíchají. Zvolený zdroj a důvod přepnutí jsou uložené v SQLite a vrácené ve výsledku. Po restartu pokračuje úloha se svým uloženým poskytovatelem.

Na zkSync, Scroll a Linea záloha Blockscout není připojená: při chybě zůstávají dosud načtené pozice a sken je částečný. Kvóta nebo chyba přístupu omezí další pokusy o Alchemy na 30 minut, přetrvávající krátkodobá chyba na minutu. Nový sken po uplynutí této doby může Alchemy zkusit znovu. GET /api/providers zveřejňuje konfiguraci a pokrytí bez klíče. Cache rozlišuje skeny s konfigurací Alchemy od původních skenů Blockscout.

Testy wallet-provider-regression.mjs ověřují stránkování, rozlišení kvóty a 429, bezpečné přepnutí po uložené stránce, nedostupnou zálohu a nepřítomnost klíče ve výsledcích. Alchemy nebylo ověřeno živým klíčem; používají se deterministické HTTP odpovědi.

## Současná implementace

```text
Prohlížeč: dist/app.js + dist/data.js
                 │ lokální /api/scans
                 ▼
Node.js 24+: server.mjs
                 │
                 ▼
ScanEngine: server/scans.mjs ─── SQLite: .data/chaindetective.sqlite
                 │                         dotazy, úlohy, stránky,
                 │                         kurzory, pozice, chyby
                 ▼
WalletProviderRouter: server/wallet-provider.mjs
                 ├─ Alchemy Portfolio API (wallets, s klíčem)
                 └─ BlockscoutProvider: server/provider.mjs
                 │ řízené HTTP dotazy
                 ▼
Blockscout: Ethereum / Base / Arbitrum / Optimism
```

Server používá vestavěné Node moduly bez instalovaných balíčků. Obsluhuje statické rozhraní i API na `127.0.0.1:4173`. Standalone HTML podporuje demo; živé skeny vyžadují server. Demo obsahuje sedm sítí včetně zkSync Era, Scroll a Linea, které Wallet Profiler podporuje po konfiguraci Alchemy.

## ScanEngine a perzistence

Po normalizaci dotazu se pro držitele vytvoří úloha pro každý kontrakt a síť, pro analýzu úloha pro každou kombinaci adresy a sítě. Identita tokenu je vždy síť a kontrakt; adresy se normalizují na malá písmena. Pořadí vstupů nemění klíč cache.

SQLite tabulky `scans`, `tasks`, `positions` a `cursors` uchovávají stav a průběh. Každá stránka má atomický zápis pozic i dalšího kurzoru. Restart mezi stránkami tak neztratí dříve potvrzená data. Duplicitní pozice jsou omezené unikátním klíčem. Restart změní rozpracované skeny na pozastavené; automaticky nespustí nové síťové požadavky.

Server načítá další stránky bez původního limitu 150 držitelů, dokud indexer nevrátí konec. Pozastavení ruší rozpracovaný požadavek a zachová uložený kurzor. Pokračování opakuje dosud nepotvrzenou stránku. Chyba jedné úlohy nemaže ostatní výsledky; sken zůstává částečný a uživatel může pokračovat. Opakovaný kurzor způsobí explicitní chybu místo nekonečné smyčky.

Průnik AND se počítá v SQLite podle unikátních tokenů u každé adresy. OR vrací adresy s alespoň jedním vybraným tokenem. Výsledky API se stránkují a revize zabraňuje smíchání více stavů při čtení. Prohlížeč načte všechny stránky výsledku a poté nabízí filtrování, řazení a export.

Dokončený stejný dotaz se 15 minut znovu použije bez volání indexeru. Nový sken vynutí `refresh:true`. Rozpracovaný stejný dotaz se znovu použije a pokračuje v něm. Nejvýše dva aktivní skeny sdílejí řízení síťových požadavků. Historie zobrazuje poslední skeny; databáze se automaticky neprořezává. Její velikost proto roste s rozsahem načtených dat.

## Co znamená úplnost

Stav `complete` potvrzuje načtení všech stránek, které poskytl indexer, bez zaznamenaných chyb nebo neinterpretovatelných pozic. Pole `snapshotConsistent:false` zůstává výslovně uvedené: stránky se načítají v různých okamžicích a nejsou vázané na jeden blok. Změny zůstatků a pořadí během skenu mohou ovlivnit výsledek i při úspěšném stránkování. Uložené výsledky neslouží jako historická rekonstrukce blockchainu.

Při ověření 14. října 2026 živý sken ZRO na Ethereu uchoval 8 200 adres po restartu. Pokračování navázalo od 164. uložené strany a dosáhlo 11 100 pozic na 222 stranách; sken byl následně pozastaven. Toto číslo není celkový počet držitelů. Částečné průniky mohou minout společné adresy na dosud nenačtených stránkách.

Hodnoty v USD vycházejí z dostupného `exchange_rate`. Neznámé ceny nejsou nulové a částečné ocenění není hodnota celého portfolia. Přesný původní zůstatek zůstává uložený v `rawAmount`; zobrazená čísla používají JavaScript Number. Nativní ETH, NFT, DeFi pozice, historické PnL a entity nejsou součástí v0.2.

## Hranice poskytovatele a další kandidáti

`ScanEngine` dostává poskytovatele se dvěma asynchronními metodami: `metadata(task,signal)` a `page(task,signal)`. Aktuální adaptér vrací Blockscout metadata a stránku `{items,cursor}`. Odlišný poskytovatel bude potřebovat převod jeho dat na interní model a vlastní zacházení s limity. SQL vyhledávání průniku může později vyžadovat další rozhraní; současné metody představují stránkovaný základ.

| Poskytovatel | Současný stav a možné využití |
| --- | --- |
| Blockscout | Implementovaný zdroj držitelů a záloha portfolia; metadata ERC-20, držitelé a ERC-20 zůstatky adres. [Dokumentace](https://docs.blockscout.com/devs/apis). |
| Moralis / GoldRush | Možnosti dalšího srovnání pro seznamy držitelů, ocenění a portfolia; nejsou integrované. |
| Alchemy | Implementovaný volitelný zdroj ERC-20 portfolia přes Tokens By Wallet. Název `getOwnersForToken` v citovaném přehledu patří do NFT API a sám nedokládá enumeraci ERC-20 držitelů. [Oficiální přehled NFT API](https://www.alchemy.com/overviews/getnfts). |
| Chainbase | Kandidát pro indexovaná data a SQL průniky; před integrací je nutné ověřit dostupné tabulky, aktuální zůstatky a pokrytí sítí. [Dokumentace](https://docs.chainbase.com/getting-started/welcome). |
| Dune | Kandidát pro SQL analytiku a vybraná metadata; použití vyžaduje konkrétní dotaz, ověření dat a jejich aktuálnosti. Komunitní štítek sám není ověřením investiční výkonnosti. [API dokumentace](https://docs.dune.com/api-reference/overview/introduction). |
| Codex | Kandidát pro budoucí analytiku obchodů a peněženek. Dostupnost požadovaného PnL, sítí a metrik je třeba ověřit při návrhu integrace. [Dokumentace](https://docs.codex.io/). |

Alchemy je volitelně připojené pro Wallet Profiler; ostatní kandidáti připojení nejsou. Další službu je vhodné vybrat podle ověřeného pokrytí zadaných kontraktů, úplnosti stránkování či SQL výsledku, rychlosti a provozních nákladů. Vývoj Smart money a PnL bude samostatná funkce s popsanou metodikou.

## Provoz a rozšíření

SQLite je vhodné pro současný lokální provoz; před zálohou zastavte server a uchovejte celou `.data/`. Watchlist a uložené dotazy jsou zvlášť v prohlížeči. Běžný GitHub backup zdrojů databázi ani místní data prohlížeče nezahrnuje.

Veřejné nasazení bude potřebovat autentizaci, kvóty, správu úloh a retenci dat. Větší objemy mohou vyžadovat frontu, databázi s efektivnějšími analytickými indexy a serverové filtrování či export, protože prohlížeč nyní načítá celý uložený výsledek. API klíče budoucích poskytovatelů patří pouze na server. Pro skutečný snapshot k bloku je potřeba poskytovatel s odpovídajícím datovým modelem nebo vlastní indexer a ověření zůstatků.

`npm run check` prověřuje syntaxi klienta a serveru; `npm test` spouští klientské i serverové regrese. Testy serveru používají deterministického poskytovatele a dočasnou databázi. Ověřují mimo jiné průnik s držitelem až na čtvrté stránce, cache, přerušení a obnovení po restartu, deduplikaci, chyby a HTTP hranici. Neprokazují trvalou dostupnost veřejného API.


## Výběr zdroje v rozhraní

Hlavní aplikace se spouští s reálnými daty, bez demo přepínače a bez automatického síťového skenu. Roletka Zdroj dat nabízí Automaticky, Blockscout a Alchemy. Alchemy lze vybrat pouze pro portfolio s nastaveným serverovým klíčem. Ostatní služby jsou viditelné jako nepřipojené a nelze je vybrat. Samostatné HTML zachovává ukázkový dataset pro offline náhled. Demo watchlist a dotazy zůstávají uložené, ale hlavní aplikace je nezobrazuje.

Automaticky používá dosavadní směrování (Alchemy pro portfolio, jinak Blockscout). Ruční Blockscout vynutí tento zdroj. Ruční Alchemy zachovává dostupnou zálohu Blockscout. Pole provider v POST /api/scans přijímá auto, blockscout nebo alchemy; neznámé a nepřipojené adaptéry se odmítají. Výběr je součástí uloženého dotazu a identity cache. Úloha dále uchovává skutečně použitý zdroj, takže změna roletky nepřepíná rozpracované uložené skeny. Nepodporované sítě jsou v roletce síťových filtrů vypnuté.

Socials: social_watchlist(handle, created_at) uchovává lokální seznam účtů nezávisle na API klíči. Moni projects používá pevný limit 10 a cache podle filtru sítě. Úspěšná odpověď upraví rezervaci podle počtu projektů.
