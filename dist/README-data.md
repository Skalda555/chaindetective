# Datová vrstva ChainDetective v0.3

## Smart wallets

Nová evidence používá `/api/smart-wallets` a tabulku `smart_wallets` ve stejné serverové databázi `.data/chaindetective.sqlite`. Ukládá pouze ručně zadaná metadata adres; žádné štítky ani PnL od externího poskytovatele. Nevztahuje se na ni přepínač Demo/Live. Watchlist a uložené dotazy jsou nadále zvlášť v prohlížeči. Podrobnosti API a validace jsou v [architektuře](../docs/architecture.md).

`data.js` obsahuje demo dataset, společné datové funkce a klienta lokálního scan API. Živé požadavky na Blockscout provádí `server/provider.mjs`; průběh a výsledky ukládá `server/scans.mjs` do SQLite. Klient neobsahuje API klíče. Živý režim vyžaduje lokální Node.js 24+ server, standalone HTML bez serveru slouží pouze pro demo.

## Klientské rozhraní

- `NETWORKS`: `{id,chainId,name,short,color,explorer,api,live}`. `id` je textový identifikátor sítě; `chainId` zde označuje číselné EVM ID. Příznak `live` znamená přítomnost adaptéru, nikoli záruku dostupnosti poskytovatele.
- `TOKENS`: `{id,chainId,address,symbol,name,decimals,price,color}`. U tokenu je `chainId` textový identifikátor sítě a `id` je `${chainId}:${lowercaseAddress}`. Pevné katalogové ceny používá pouze demo.
- `DEMO_WALLETS`: 24 deterministických syntetických adres a portfolií. Katalogové kontrakty slouží pro orientaci; přiřazení adres, zůstatky a štítky nejsou skutečná investiční data.
- `searchHolders({tokens,chainIds,match:'all'|'any',minValue:0,source:'demo'|'live',onProgress,signal,refresh:false})` → `{wallets,tokens,source,warnings,coverage,job?,pagination?}`. V živém režimu se filtr minimální hodnoty aplikuje v rozhraní nad výsledky.
- `analyzeWallets({addresses,chainIds,source,onProgress,signal,refresh:false})` → stejný tvar; `tokens` obsahuje agregované pozice.
- `listServerScans()`, `getServerScan(id)`, `pauseServerScan(id)`, `resumeServerScan(id)`, `openServerScan(id,{onProgress,signal})` obsluhují uložené živé skeny.
- `aggregateHoldings`, `getToken`, `getNetwork`, `isAddress`, `normalizeAddress` jsou společné pomocné exporty.

Parametr `maxPages` z první verze se již nepoužívá. Živý sken nemá pevný limit stran ani limit 150 držitelů. Prohlížeč dotazuje stav přibližně jednou za sekundu. Holder výsledky se načítají po stránkách podle adres. Výsledky Wallet Analyzeru se agregují a filtrují na serveru a prohlížeč si vyžádá jen aktuální stránku tokenů; revize skenu brání smíchání různých stavů.

Wallet Analyzer přijímá nejvýše 500 unikátních adres. `SCAN_MAX_WALLETS` a `SCAN_TASK_CONCURRENCY` nastavují limit datasetu a počet souběžných úloh na sken (výchozí hodnoty 500 a 4). Provider request limity lze nastavit pomocí `ALCHEMY_REQUEST_CONCURRENCY`, `ALCHEMY_MIN_REQUEST_INTERVAL_MS`, `BLOCKSCOUT_REQUEST_CONCURRENCY` a `BLOCKSCOUT_MIN_REQUEST_INTERVAL_MS`. Souběžnost úloh se nesmí zaměňovat za rychlost požadavků provideru; každá vrstva má vlastní limit.

U wallet datasetu se token seskupuje podle sítě a kontraktu. `holderCount` je počet unikátních vlastníků tokenu mezi úspěšně dokončenými wallet/network úlohami; `analyzedWalletCount` je počet úspěšně dokončených wallet úloh v téže síti. `share = holderCount / analyzedWalletCount`. Neúspěšné nebo nepodporované úlohy se do jmenovatele nezapočítávají. Metadata známých Smart wallets (název, štítky a stav) se kopírují do uloženého dotazu.

Peněženka má tvar `{address,label,chainIds,holdings,value,matchedTokens,matchCount,isDemo}`. Pozice obsahuje `{...token,tokenId,amount,value,rawAmount}`. Živé `value` je `null`, pokud není dostupná cena. `rawAmount` uchovává celočíselný zůstatek jako řetězec, zatímco `amount` je JavaScript Number pro zobrazení a může zaokrouhlovat.

Agregovaný token obsahuje `{...token,amount,totalValue,holders,holderCount,share,pricedPositions,unpricedPositions}`. `share` je zlomek 0–1 ze všech zadaných unikátních adres, včetně adres s neúspěšným dotazem. Částečné ocenění sčítá jen známé hodnoty. Tokeny se seskupují podle sítě a kontraktu, nikoli tickeru; stejná EVM adresa napříč sítěmi je jedna adresa. Validace adres je syntaktická, bez EIP-55 kontroly.


## Alchemy pro Wallet Profiler

Zkopírujte `.env.example` do `.env`, nastavte `ALCHEMY_API_KEY` a `BLOCKSCOUT_API_KEY` a restartujte server. Server při startu načte `.env`; proměnné již nastavené v procesu mají přednost. Klíče zůstávají na serveru a soubor je v `.gitignore`.

Wallet Analyzer automaticky posílá Ethereum, Base, Optimism a Arbitrum do Alchemy; Robinhood Chain jde rovnou přes Blockscout. Při chybě Alchemy může Ethereum, Optimism a Arbitrum převzít Blockscout Pro. Base běží pouze přes Alchemy, protože současný účet Blockscoutu vrací HTTP 402. Ruční volba Blockscoutu je pro Wallet Analyzer dostupná na Ethereum, Optimism, Arbitrum a Robinhood Chain. Holder scanner zůstává na Blockscoutu.

Fallback se spustí při retryable síťové chybě, HTTP 429/5xx, upstream ochraně, poškozené odpovědi nebo vyčerpaném kreditu. Neplatný vstup, chyba přístupu a platná odpověď s nulou tokenů fallback nespouštějí. Alchemy má nejvýše tři pokusy s exponenciálním odstupem a respektuje `Retry-After` do 10 sekund. Jistič se vede zvlášť pro provider a síť: po třech chybách se na 60 sekund otevře; po cooldownu se primární zdroj zkusí znovu. Vyčerpaný Alchemy kredit má 30minutový cooldown. Při fallbacku se smažou pouze pozice a kurzory dané síťové úlohy a nová služba načte data od první stránky. Zdroje se v jedné úloze nemíchají. Poskytovatel, `fallbackFrom`, důvod a čas poslední úspěšné stránky jsou uložené v SQLite a viditelné ve výsledku. Chyba jedné sítě zachová výsledky ostatních. Po restartu pokračuje úloha se svým uloženým poskytovatelem.

GET `/api/providers` zveřejňuje konfiguraci, podporované operace a sítě i aktivní jističe bez klíče. Cache rozlišuje skeny podle konfigurace providerů. Výsledek Wallet Analyzeru zobrazuje skutečný zdroj, případný fallback a čas načtení podle sítě.

`tests/wallet-provider-regression.mjs` ověřuje jednotlivé trasy, fallback, izolaci jističů, Base bez Blockscout zálohy, částečné výsledky, provenance a neveřejnost klíčů. Praktický živý smoke test se spouští pouze samostatně; `npm test` nevolá externí API.

## Živý poskytovatel

Blockscout je připojen pro **Ethereum, Base, Optimism, Arbitrum a Robinhood Chain**. Nepodporovaná síť má stav `unsupported` a upozornění, nikoli předstíraný úspěšný prázdný výsledek.

Použité Blockscout v2 cesty:

```text
GET /api/v2/tokens/{contract}
GET /api/v2/tokens/{contract}/holders
GET /api/v2/addresses/{address}/tokens?type=ERC-20
```

Server předává kurzory `next_page_params` a pokračuje do jejich vyčerpání. Prázdná stránka s dalším kurzorem sama sken neukončuje. Opakovaný kurzor ukončí danou úlohu chybou, aby sken neuvízl ve smyčce. Každá stránka se uloží v transakci společně s kurzorem; duplicitní kombinace úlohy, adresy a tokenu se započítá pouze jednou.

Výchozí rozestup požadavků je 400 ms, timeout požadavku 20 sekund. U přechodných síťových chyb, timeoutů a HTTP 429/5xx následují nejvýše tři opakování s prodlevou. Po vyčerpání opakování zůstanou dříve uložené stránky zachované a úlohu lze znovu spustit. Poskytovatel používá adresy předdefinovaných sítí, nepřijímá libovolnou cílovou URL od klienta.

Živé ceny pocházejí z `exchange_rate`. Chybějící cena se nenahrazuje demo cenou nebo nulou. `decimals:0` je platné; neznámá desetinná místa nevedou k předpokladu 18. Nenulové neinterpretovatelné pozice mají počet `invalidRows` a sken není označen jako úplný. Oprava takových již zpracovaných stránek vyžaduje nový sken. Verze nezahrnuje nativní ETH, NFT ani DeFi pozice.

## Uložení a životní cyklus

Databáze je `.data/chaindetective.sqlite`; používá SQLite WAL. Obsahuje normalizovaný dotaz, stav skenu, úlohy, metadata, kurzory, počty stran, chyby a pozice. Neobsahuje přístupové klíče k peněženkám. Watchlist a uložené dotazy zůstávají v prohlížeči odděleně od serverových skenů.

Stavy skenu jsou `running`, `paused`, `partial`, `complete`. Pozastavení zachová poslední dokončenou stránku a kurzor; další pokračování naváže od něj. Po restartu serveru se rozpracované skeny nastaví na `paused`. Historie vrací posledních 12 skenů bez mazání starších záznamů. Současně mohou běžet dva skeny.

Stejný normalizovaný dotaz znovu použije rozpracovaný sken, případně dokončený sken do 15 minut od dokončení. `refresh:true` vytvoří nový sken bez použití cache. Cache je perzistentní záznam dokončeného výsledku; opětovné otevření neaktualizuje zůstatky ani ceny.

`coverage` zahrnuje `complete`, `bounded`, `startedAt`, `asOf`, `snapshotConsistent:false`, zprávu a podrobnosti jednotlivých úloh. `complete:true` znamená, že byly načteny všechny stránky indexeru a nejsou zaznamenané neplatné pozice. **Neznamená snapshot k jednomu bloku ani ověření úplnosti indexeru vůči blockchainu.** Během dlouhého skenu se data mohou měnit.

Průnik AND nad částečným skenem potvrzuje pouze nalezené shody, ale může minout další společné držitele. Prázdný výsledek nedokazuje jejich neexistenci. API chyby a neplatné pozice jsou v `warnings`; pozastavený, nepodporovaný nebo chybující sken zůstává částečný. Tato verze neprovádí historickou rekonstrukci ani následné RPC ověření každého zůstatku.

## HTTP API

| Metoda a cesta | Význam |
| --- | --- |
| `GET /api/health` | Verze lokálního backendu |
| `GET /api/scans` | Historie skenů |
| `POST /api/scans` | Spuštění nebo použití uloženého dotazu |
| `GET /api/scans/{id}` | Stav a průběh |
| `POST /api/scans/{id}/pause` | Pozastavení |
| `POST /api/scans/{id}/resume` | Pokračování |
| `GET /api/scans/{id}/result?offset=0&limit=500&revision=…` | Stránka výsledků neběžícího skenu |

API je určené pro lokální aplikaci na loopback rozhraní a kontroluje původ požadavků. Výsledkový endpoint má nejvýše 1 000 adres na odpověď; další adresy jsou dostupné přes `nextOffset`. Pro otevření průběžného výsledku je potřeba nejprve sken pozastavit. Toto API nemá autentizaci pro veřejné nasazení.

Ověření 14. října 2026: živý sken ZRO na Ethereu zachoval 8 200 uložených adres po restartu a po pokračování dosáhl 11 100 pozic na 222 stranách. Následně byl pozastaven. Nejde o dokončený dataset. Regrese v `tests/server-regression.mjs` ověřují také shodu na čtvrté stránce za původním limitem.

Další kandidáti a omezení jsou v [architektuře](../docs/architecture.md). Primární reference: [Blockscout API](https://docs.blockscout.com/devs/apis).

