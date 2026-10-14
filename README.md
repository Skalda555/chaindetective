# ChainDetective

První interaktivní verze analytického pracovního prostoru pro Ethereum a L2. UI je v češtině. Aplikace nevyžaduje připojení peněženky ani privátní klíče.

## Spuštění

Node.js 20 nebo novější, bez instalace závislostí:

```sh
npm run dev
```

Otevřete http://127.0.0.1:4173. Statický web se nachází v `dist/`; lze jej hostovat samostatně. Google Fonts je volitelný, při nedostupnosti fungují systémové fonty.

Alternativa bez Node.js: otevřete `standalone/ChainDetective.html` dvojklikem v běžném prohlížeči. Soubor obsahuje CSS i datový a aplikační kód. Znovu jej sestavíte příkazem `npm run bundle`. U file:// původu může veřejný indexer blokovat živé dotazy přes CORS; pro Live API je vhodnější lokální server. Uložená data v prohlížeči se mohou mezi file:// a HTTP verzí lišit.

Soukromá publikace Sites nebyla dokončena: zdrojový server git.chatgpt-team.site nebyl dostupný ani po opakování mimo sandbox. `.openai/hosting.json` zachovává již vytvořenou identitu Site pro další pokus. Online URL proto zatím nelze považovat za funkční nasazení.

## Funkce první verze

- Tokeny → peněženky: až 5 kontraktů s vlastní sítí, průnik AND nebo sjednocení OR, výběr sítí.
- Peněženky → tokeny: až 20 adres, agregace podle kontraktu a sítě, řazení podle hodnoty či počtu držitelů.
- Filtrování, řazení, stránkování, výběr adres pro navazující analýzu a CSV export.
- Detail pozic peněženky, kopírování adresy a odkazy do exploreru.
- Lokální watchlist a uložené dotazy, uložené pouze v prohlížeči. Uložení se nesynchronizuje mezi zařízeními.
- Ilustrační demo a samostatný experimentální režim veřejného Live API. Neznámé adresy v demu nevrací vymyšlené výsledky.
- Navigace připravená pro Smart money, toky kapitálu a upozornění; tyto moduly ještě nejsou implementované.

## Data a limity

Podrobnosti o veřejných API, podporovaných sítích a rozsahu skenování jsou v `dist/README-data.md`. Demo data jsou syntetická a nepopisují skutečné držitele, zisky ani tržní aktivitu. Hodnoty v USD v demu jsou ilustrační.

Ověření: `npm run check` a `npm test`. V prohlížeči byl ověřen demo průchod AND/OR, uložení dotazu a adresy, detail, navazující analýza a responzivní rozložení. Živý OR dotaz na ARB/WETH na Arbitrum vrátil 150 držitelů ARB ze 3 stran; WETH dotaz skončil timeoutem. Výsledky tak výslovně uvádějí částečné pokrytí. To neověřuje trvalou dostupnost dalších endpointů.

Live API používá veřejné indexery Blockscout a posílá jim pouze zadané veřejné adresy/kontrakty. Síť je součástí identity tokenu; stejný ticker není důkazem totožnosti. Výsledky pokrývají načtené stránky indexeru, nikoli celý blockchain. Chyba API není nulový zůstatek. Tokeny bez dostupné ceny mají neznámou hodnotu a nepovažují se automaticky za bezcenné. Agregace neobsahuje nativní ETH, NFT, DeFi pozice ani plnou investiční výkonnost.

## Doporučený další krok

Pro úplné produkční vyhledávání držitelů je potřeba serverová datová vrstva: placený indexer nebo vlastní index ERC-20 Transfer událostí, aktuální balance ověření, stránkování celého datasetu, cache, řízení limitů a opakovatelné snapshoty. Klíče k placeným službám patří pouze na server. Následovat může PostgreSQL pro seznamy a popisky, fronta scanů, průběžné přepočty, monitoring, autentizace a upozornění.

Držitele tokenu nelze získat jediným standardním RPC dotazem: ERC-20 neposkytuje enumeraci adres. Velké průniky vyžadují indexovaná data. Tato verze dává ověřitelný layout a základ workflow; nenahrazuje datové pokrytí a historické štítky komerčních služeb.
