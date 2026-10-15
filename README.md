# ChainDetective v0.3

Analytický pracovní prostor pro Ethereum a L2 s českým rozhraním. Vyhledává adresy podle držených ERC-20 kontraktů a agreguje tokeny ze zadaných peněženek. Nevyžaduje připojení peněženky ani privátní klíče.

## Roadmapa

Průběžný plán vývoje je v [dist/roadmap.html](dist/roadmap.html), v běžící aplikaci přes **Roadmapa** v levém menu ([otevřít](http://127.0.0.1:4173/roadmap.html)). Ceny DexScreener / DeFiLlama jsou na přání uživatele odložené.

## Spuštění

Použijte **Node.js 24 nebo novější**. Instalace balíčků není potřeba; server používá vestavěné moduly včetně `node:sqlite`.

```sh
npm run dev
```

Otevřete [http://127.0.0.1:4173](http://127.0.0.1:4173). Server obsluhuje rozhraní z `dist/` i lokální API. Živé dotazy vyžadují tento server. Volitelné Google Fonts mají systémovou náhradu.

Server ukládá skeny do `.data/chaindetective.sqlite`. Načtené stránky, zůstatky, metadata a kurzory tak přežijí obnovení prohlížeče i restart serveru. Při restartu se rozpracovaný sken pozastaví; pokračování spustíte z historie. Pro zálohu dat server nejprve ukončete a zkopírujte celou složku `.data/`. Databáze není součástí zdrojového repozitáře.

Alternativa bez serveru: otevřete `standalone/ChainDetective.html`. Tato varianta podporuje **pouze demo**; pro živá data otevřete lokální server. Standalone soubor se sestavuje příkazem `npm run bundle`. Watchlist a uložené dotazy jsou v úložišti konkrétního prohlížeče; mezi souborem `file://` a HTTP verzí se nesynchronizují.


## Alchemy pro Wallet Profiler

Zkopírujte .env.example do .env, nastavte ALCHEMY_API_KEY a restartujte server. Klíč zůstává na serveru; .env je v .gitignore. Bez klíče se používá Blockscout.

Wallet Profiler používá Alchemy Portfolio API (Tokens By Wallet), včetně metadat, dostupných USD cen a stránkování. Podporované sítě adaptéru: Ethereum, Base, Arbitrum, Optimism, zkSync Era, Scroll a Linea. Hledání držitelů ERC-20 dál používá Blockscout na prvních čtyřech sítích; Alchemy getOwnersForToken je NFT endpoint. Robinhood zatím není v adaptéru.

Při vyčerpaném kreditu, chybě přístupu nebo přetrvávajícím výpadku se daná kombinace adresy a sítě přepne na Blockscout, je-li dostupný. Krátkodobé limity 429 a výpadky se nejdříve dvakrát opakují. Přepnutí atomicky zahodí pouze pozice a kurzory této úlohy a načte zálohu od první stránky. Zdroje se v jedné úloze nemíchají. Zvolený zdroj a důvod přepnutí jsou uložené v SQLite a vrácené ve výsledku. Po restartu pokračuje úloha se svým uloženým poskytovatelem.

Na zkSync, Scroll a Linea záloha Blockscout není připojená: při chybě zůstávají dosud načtené pozice a sken je částečný. Kvóta nebo chyba přístupu omezí další pokusy o Alchemy na 30 minut, přetrvávající krátkodobá chyba na minutu. Nový sken po uplynutí této doby může Alchemy zkusit znovu. GET /api/providers zveřejňuje konfiguraci a pokrytí bez klíče. Cache rozlišuje skeny s konfigurací Alchemy od původních skenů Blockscout.

Testy wallet-provider-regression.mjs ověřují stránkování, rozlišení kvóty a 429, bezpečné přepnutí po uložené stránce, nedostupnou zálohu a nepřítomnost klíče ve výsledcích. Alchemy nebylo ověřeno živým klíčem; používají se deterministické HTTP odpovědi.

## Socials

Socials používá Moni API: profil účtu na X, Smart Mentions za 7 dní a první stránku významných sledujících (max. 20). Každá část se načítá až na kliknutí; otevření sekce ověří pouze místní konfiguraci. DataBot, objevování projektů a globální feed zatím nejsou připojené.

Klíč MONI_API_KEY patří do serverového .env. MONI_MONTHLY_BUDGET nastavuje místní měsíční rozpočet; výchozí je 300 bodů. Jde o odhad podle ceníku pro požadavky této aplikace, nikoli zůstatek účtu Moni ani celkovou spotřebu klíče. Počítají se i pokusy, u kterých se nedá potvrdit skutečné účtování. Profil stojí odhadem 8 bodů, zmínky 4, Smarts 5.

Cache v SQLite: profil a Smarts 24 hodin, zmínky hodinu. Souběžné stejné dotazy sdílejí požadavek; chyby se automaticky neopakují. Profil ani API klíč se nevkládají do veřejného JS. Data se identifikují podle handle; vazbu na tokenový kontrakt tato verze neřeší. Moni vrací u zmínek odkazy, nikoli plné texty příspěvků. Živě ověřeno na účtu @ethereum.

## Funkce

- Tokeny → peněženky: až 5 kontraktů s vlastní sítí, průnik AND nebo sjednocení OR.
- Peněženky → tokeny: až 20 adres, agregace podle kontraktu a sítě, řazení podle hodnoty či počtu držitelů.
- Filtrování, řazení, stránkování výsledků, navazující analýza a CSV export.
- Detail pozic, kopírování adres a odkazy do exploreru.
- Watchlist a uložené dotazy v prohlížeči.
- Serverová historie živých skenů, pozastavení se zobrazením uložených výsledků a pokračování od poslední uložené stránky.
- Opětovné použití dokončeného stejného dotazu po dobu 15 minut; tlačítko nového skenu vynutí nové načítání.
- Smart wallets: ruční a hromadná evidence adres v SQLite, poznámky, štítky, zdroj a ruční hodnocení.
- Navigace pro budoucí toky kapitálu a upozornění.

## Smart wallets

V levé navigaci otevřete **Smart wallets → Přidat peněženky**. Vložte jednu až 200 EVM adres (řádky, čárky nebo mezery), zvolte sítě a doplňte název, štítky oddělené čárkou, zdroj a poznámku. Společné údaje se při hromadném zadání použijí pro všechny nové adresy. Duplicity se normalizují; existující poznámky a hodnocení se při opětovném přidání nepřepisují. Neplatný seznam se odmítne celý.

Stavy jsou **Kandidát**, **Prověřená ručně**, **Vyřazená**. Hodnocení je uživatelské, ne automaticky vypočtená ziskovost. Vyřazení záznam nemaže a lze ho vrátit mezi kandidáty. Každá EVM adresa má jeden záznam s více sítěmi. Nabídka sítí pro evidenci je širší než aktuální pokrytí živé analýzy.

Seznam lze filtrovat podle textu, stavu a štítku. Vyberte nejvýše 20 adres a předejte je do analýzy tokenů; síťový sken následně spustíte tlačítkem Analyzovat peněženky. Předají se pouze podporované živé sítě. Ve výsledcích Live screeneru i v detailu adresy je tlačítko **+ Smart wallets** pro předvyplnění formuláře. Demo adresy se tímto způsobem nepřenášejí.

Tlačítko **Z Live watchlistu** předvyplní adresy ze skutečných uložených snapshotů; poznámky doplníte před uložením. Původní watchlist zůstává beze změny v prohlížeči. **Export JSON** stáhne celou evidenci včetně poznámek a hodnocení; automatický import tohoto JSON zatím není implementovaný.

Evidence se ukládá do tabulky `smart_wallets` ve stejné `.data/chaindetective.sqlite` jako skeny a přežije restart. Zálohujte celou `.data/` po korektním ukončení serveru. Databáze není na GitHubu ani v distribučním ZIP zdrojů. Standalone HTML bez lokálního serveru evidenci nepoužívá. Evidence neobsahuje automatické PnL ani sledování změn pozic.

## Co přináší v0.2

Živá data načítá server z Blockscoutu. Starý limit tří stran / přibližně 150 držitelů je odstraněn. Server pokračuje podle kurzorů indexeru až do poslední stránky, případně do pozastavení nebo chyby. Ukládá každou stránku v transakci spolu s dalším kurzorem a odstraňuje duplicitní pozice. Po přerušení nemusí načítat již uložené stránky znovu.

Průnik AND se počítá nad uloženými pozicemi všech zadaných kontraktů. Výsledek pozastaveného či chybujícího skenu je výslovně označený jako částečný: skutečné společné adresy se mohou objevit až na dalších stránkách. Při chybě lze pokračovat; neplatné záznamy a nepodporované sítě mají vlastní upozornění.

Současně mohou běžet nejvýše dva skeny. Žádosti indexeru jsou řízené a přechodné chyby se opakují. Historie API obsahuje posledních 12 skenů, rozhraní zobrazuje aktivní sken a až 5 dalších; starší data tím nejsou smazána.

## Zdroje a rozsah výsledků

| Režim | Sítě | Zdroj |
| --- | --- | --- |
| Live | Ethereum, Base, Arbitrum, Optimism | Veřejné Blockscout API přes lokální server |
| Demo | Ethereum, Base, Arbitrum, Optimism, zkSync Era, Scroll, Linea | Syntetický dataset |

Vlastní kontrakt se při přidání přepne do Live API. Pro ZRO vložte `0x6985884c4392d348587b19cb9eaaf157f13271cd` a Ethereum. Název a ticker se načtou z metadat indexeru. Při ověření 14. října 2026 server uložil 8 200 adres ZRO, zachoval je po restartu a pokračoval od uloženého kurzoru až na **11 100 pozic / 222 stran**. Sken je pozastavený. Toto je průběžný výsledek, nikoli dokončený seznam držitelů.

Stav „Všechny stránky načteny“ znamená, že byly zpracovány všechny stránky poskytnuté indexerem bez zaznamenané chyby. **Nejde o snapshot k jednomu bloku ani záruku úplnosti celého blockchainu.** Zůstatky a pořadí držitelů se mohou během dlouhého načítání měnit. Pokrytí obsahuje čas zahájení a poslední aktualizace; data staršího dokončeného skenu se při použití cache neaktualizují.

USD hodnoty pocházejí z cen indexeru. Neznámá cena zůstává neznámá; chyba API není nulový zůstatek. Screener sčítá jen vybrané tokeny, analýza načtené ERC-20. Nativní ETH, NFT, DeFi pozice, PnL a historické štítky tato verze nezpracovává. Demo ceny, zůstatky a přiřazení adres jsou ilustrační.

## Ověření a další rozvoj

```sh
npm run check
npm test
```

Regresní testy zahrnují společného držitele nalezeného až na čtvrté stránce, SQLite obnovu po restartu, pozastavení, chybu poskytovatele, cache, deduplikaci, opakující se kurzor a HTTP API. Živá dostupnost veřejných indexerů se může měnit.

Podrobnosti rozhraní jsou v [dist/README-data.md](dist/README-data.md), server a kandidáti dalších poskytovatelů v [docs/architecture.md](docs/architecture.md). Implementovaný je Blockscout a volitelný Alchemy Wallet Profiler. Chainbase, Dune a Codex jsou možnosti dalšího rozšíření, nejsou připojené. Klíče případných placených služeb patří na server.


## Výběr zdroje v rozhraní

Hlavní aplikace se spouští s reálnými daty, bez demo přepínače a bez automatického síťového skenu. Roletka Zdroj dat nabízí Automaticky, Blockscout a Alchemy. Alchemy lze vybrat pouze pro portfolio s nastaveným serverovým klíčem. Ostatní služby jsou viditelné jako nepřipojené a nelze je vybrat. Samostatné HTML zachovává ukázkový dataset pro offline náhled. Demo watchlist a dotazy zůstávají uložené, ale hlavní aplikace je nezobrazuje.

Automaticky používá dosavadní směrování (Alchemy pro portfolio, jinak Blockscout). Ruční Blockscout vynutí tento zdroj. Ruční Alchemy zachovává dostupnou zálohu Blockscout. Pole provider v POST /api/scans přijímá auto, blockscout nebo alchemy; neznámé a nepřipojené adaptéry se odmítají. Výběr je součástí uloženého dotazu a identity cache. Úloha dále uchovává skutečně použitý zdroj, takže změna roletky nepřepíná rozpracované uložené skeny. Nepodporované sítě jsou v roletce síťových filtrů vypnuté.

### Socials – rozšíření 15. 10. 2026
Projekty Moni: ruční načtení nejvýše 10 projektů, filtry všechny sítě / Ethereum / Base / Arbitrum, cache 6 hodin. Cena 1 bod za vrácený projekt; před voláním se rezervuje 10 bodů, po úspěchu se rozdíl vrátí. Chybné požadavky se započítávají konzervativně. Seznam účtů na X se ukládá do SQLite (nejvýše 100 účtů), bez volání Moni. Profil se načítá až kliknutím. Síť je štítek Moni, nikoli ověřený kontrakt.
