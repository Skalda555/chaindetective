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

Parametr `maxPages` z první verze se již nepoužívá. Živý sken nemá pevný limit stran ani limit 150 držitelů. Prohlížeč dotazuje stav přibližně jednou za sekundu. Po dokončení či pozastavení načte uložené výsledky po 500 adresách do výsledné tabulky; toto je stránkování výstupu, nikoli omezení skenu indexeru. Změnu dat mezi stránkami hlídá revize skenu.

Peněženka má tvar `{address,label,chainIds,holdings,value,matchedTokens,matchCount,isDemo}`. Pozice obsahuje `{...token,tokenId,amount,value,rawAmount}`. Živé `value` je `null`, pokud není dostupná cena. `rawAmount` uchovává celočíselný zůstatek jako řetězec, zatímco `amount` je JavaScript Number pro zobrazení a může zaokrouhlovat.

Agregovaný token obsahuje `{...token,amount,totalValue,holders,holderCount,share,pricedPositions,unpricedPositions}`. `share` je zlomek 0–1 ze všech zadaných unikátních adres, včetně adres s neúspěšným dotazem. Částečné ocenění sčítá jen známé hodnoty. Tokeny se seskupují podle sítě a kontraktu, nikoli tickeru; stejná EVM adresa napříč sítěmi je jedna adresa. Validace adres je syntaktická, bez EIP-55 kontroly.


## Alchemy pro Wallet Profiler

Zkopírujte .env.example do .env, nastavte ALCHEMY_API_KEY a restartujte server. Klíč zůstává na serveru; .env je v .gitignore. Bez klíče se používá Blockscout.

Wallet Profiler používá Alchemy Portfolio API (Tokens By Wallet), včetně metadat, dostupných USD cen a stránkování. Podporované sítě adaptéru: Ethereum, Base, Arbitrum, Optimism, zkSync Era, Scroll a Linea. Hledání držitelů ERC-20 dál používá Blockscout na prvních čtyřech sítích; Alchemy getOwnersForToken je NFT endpoint. Robinhood zatím není v adaptéru.

Při vyčerpaném kreditu, chybě přístupu nebo přetrvávajícím výpadku se daná kombinace adresy a sítě přepne na Blockscout, je-li dostupný. Krátkodobé limity 429 a výpadky se nejdříve dvakrát opakují. Přepnutí atomicky zahodí pouze pozice a kurzory této úlohy a načte zálohu od první stránky. Zdroje se v jedné úloze nemíchají. Zvolený zdroj a důvod přepnutí jsou uložené v SQLite a vrácené ve výsledku. Po restartu pokračuje úloha se svým uloženým poskytovatelem.

Na zkSync, Scroll a Linea záloha Blockscout není připojená: při chybě zůstávají dosud načtené pozice a sken je částečný. Kvóta nebo chyba přístupu omezí další pokusy o Alchemy na 30 minut, přetrvávající krátkodobá chyba na minutu. Nový sken po uplynutí této doby může Alchemy zkusit znovu. GET /api/providers zveřejňuje konfiguraci a pokrytí bez klíče. Cache rozlišuje skeny s konfigurací Alchemy od původních skenů Blockscout.

Testy wallet-provider-regression.mjs ověřují stránkování, rozlišení kvóty a 429, bezpečné přepnutí po uložené stránce, nedostupnou zálohu a nepřítomnost klíče ve výsledcích. Alchemy nebylo ověřeno živým klíčem; používají se deterministické HTTP odpovědi.

## Živý poskytovatel

Blockscout je připojen pro **Ethereum, Base, Arbitrum a Optimism**. zkSync Era, Scroll a Linea jsou v živém Wallet Profileru dostupné s konfigurací Alchemy. Nepodporovaná síť má stav `unsupported` a upozornění, nikoli předstíraný úspěšný prázdný výsledek.

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

