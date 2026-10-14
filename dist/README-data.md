# Datová vrstva ChainDetective

`data.js` je samostatný ES modul bez závislostí. Demo a živé dotazy jsou striktně oddělené. Žádné API klíče se neukládají v klientovi.

## Rozhraní

- `NETWORKS`: `{ id, chainId, name, short, color, explorer, api, live }`. `id` je text `ethereum`, `base`, `arbitrum`, `optimism`, `zksync`, `scroll`, `linea`; `chainId` je EVM číslo. `live` znamená přítomnost experimentálního adaptéru, nikoliv záruku dostupnosti poskytovatele.
- `TOKENS`: `{ id, chainId, address, symbol, name, decimals, price, color }`. `chainId` tokenu používá textový identifikátor sítě. `id` je `${chainId}:${lowercaseAddress}`. Katalogové ceny jsou pevné ilustrace pro demo; živá data je nikdy nepřebírají.
- `DEMO_WALLETS`: 24 deterministických syntetických adres, názvů a portfolií. Prvních 16 drží ARB a WETH na Arbitru. Katalogové kontrakty jsou skutečné; přiřazené adresy a pozice jsou vymyšlené a nepředstavují investiční signály. Shoda s reálnou adresou není posuzována.
- `searchHolders({tokens,chainIds,match:'all'|'any',minValue:0,source:'demo'|'live',onProgress,signal,maxPages:3})` → `{wallets,tokens,source,warnings,coverage}`.
- `analyzeWallets({addresses,chainIds,source,onProgress,signal,maxPages:3})` → stejný tvar, kde `tokens` jsou agregované pozice.
- `aggregateHoldings(wallets,addressCount)`, `getToken(address,chainId)`, `getNetwork(id)`, `isAddress(value)`, `normalizeAddress(value)` jsou pomocné exporty.

Peněženka: `{address,label,chainIds,holdings,value,matchedTokens,matchCount,isDemo}`. Pozice: `{...token,tokenId,amount,value,rawAmount?}`. USD `value` je `null`, pokud není dostupná cena. Screener sčítá pouze pozice vybraných kontraktů; analýza sčítá všechny načtené ERC-20. Částečně oceněné portfolio obsahuje součet známých cen, nikoli odhad celého portfolia.

Agregovaný token: `{...token,amount,totalValue,holders,holderCount,share,pricedPositions,unpricedPositions}`. `holders` je seznam unikátních adres. `share` je zlomek 0–1 ze všech zadaných unikátních adres včetně adres s neúspěšným dotazem. Tokeny se vždy seskupují podle sítě a kontraktu, nikdy pouze podle tickeru. Stejná EVM adresa na více sítích se při průniku bere jako jedna adresa.

Neznámé demo kontrakty nevracejí vymyšlené držitele; neznámé demo adresy nevracejí vymyšlená portfolia. Výsledek nese odpovídající upozornění. Adresy se kontrolují syntakticky (`0x` + 40 hex znaků), bez kontroly EIP-55.

## Živý adaptér a rozsah

Připojené experimentální instance: Ethereum, Base, Arbitrum a Optimism. zkSync Era, Scroll a Linea mají katalog a demo podporu; živý adaptér je výslovně nedostupný. U těchto sítí se vrací `unsupported`, nikoli předstíraný prázdný sken.

Použité Blockscout v2 cesty:

```text
GET /api/v2/tokens/{contract}
GET /api/v2/tokens/{contract}/holders
GET /api/v2/addresses/{address}/tokens?type=ERC-20
```

Modul přebírá `next_page_params` beze změny až do nastaveného limitu (výchozí 3, bezpečnostní maximum 5 stran na dotaz). Údaj o velikosti strany není vynucen. Každý HTTP dotaz má timeout 15 sekund; uživatel může sken zrušit přes `AbortSignal`. `coverage.details` obsahuje stav `ok`, `error` nebo `unsupported`, počet stran a informaci o dalším kurzoru.

Průnik držitelů se počítá pouze z načtených stránek. U velkých tokenů chybí další držitelé a mohou chybět skutečné společné adresy. Prázdný výsledek neprokazuje neexistenci držitelů. Při selhání některého tokenu v režimu AND se žádné adresy nemohou vydávat za potvrzené držitele všech tokenů. Při selhání všech dotazů se vyvolá chyba, nikoli úspěšný nulový výsledek. Chyby jednotlivých sítí se uvádějí v `warnings`.

Živé ceny pocházejí výlučně z `exchange_rate` indexeru. Chybějící či prázdná cena zůstává `null`, nikdy se nenahrazuje demo cenou ani nulou. Metadata `decimals:0` jsou platná; chybějící decimals u neznámého tokenu nevedou k předpokladu 18. `rawAmount` zachovává původní celočíselnou hodnotu; `amount` je JavaScript Number pro zobrazení a může mít u velkých hodnot zaokrouhlení. Nezahrnuje se nativní ETH, NFT ani DeFi či stakované pozice.

## Stav poskytovatele a produkční pokračování

Dokumentace ověřena 14. října 2026. Blockscout aktuálně ukončuje podporu API jednotlivých instancí a doporučuje Universal PRO API s klíčem. Verze 12 se postupně zavádí od 7. října 2026 a přináší změny API. Přímá dostupnost výše uvedených instancí nebyla v tomto omezeném vývojovém prostředí potvrzena: síťový požadavek narazil na omezení DNS a následné ověření bylo přerušeno. Aplikace proto ověřuje dostupnost během skutečného dotazu a vysvětluje HTTP, timeout a CORS chyby.

Následné ověření v prohlížeči 14. října 2026: živý OR dotaz ARB/WETH na Arbitrum načetl 150 držitelů ARB ze tří stran. WETH v tomto běhu vypršel po 15 sekundách. To potvrzuje pouze tento částečný průchod, nikoli trvalou dostupnost všech instancí. Aplikace drží upozornění na částečný výsledek viditelně nad tabulkou a podrobnosti v metodice.

Pro plnohodnotné vyhledávání všech držitelů je další krok serverový poskytovatel dat s klíčem uloženým na serveru, kontrolované stránkování a cache nebo vlastní indexer. Aktuální klientský adaptér je prototyp s omezeným rozsahem.

Primární zdroje: [Blockscout API dokumentace](https://docs.blockscout.com/devs/apis), [oficiální reference tokenových cest](https://github.com/blockscout/agent-skills/blob/main/blockscout-analysis/references/blockscout-api/tokens.md), [referenční schéma API](https://github.com/blockscout/blockscout-api-v2-swagger/blob/main/swagger.yaml), [registr explorerů](https://github.com/blockscout/chainscout/blob/main/data/chains.json).
