# ChainDetective: pravidla práce

Hlavní strategie a pracovní plán: `dist/roadmap.html`. Původní podrobný audit: `dist/roadmap-v2-audit.html`; archiv není aktuální plán a jeho body nejsou automaticky schválené.

- Výchozí pořadí: 1. pohodlná současná aplikace, 2. velká data, 3. Token/Wallet/Project, 4. Socials, 5. historie, 6. Signals a Alerts, 7. pokročilé Detective funkce. Závazný je směr a pořadí, nikoli každý podbod. Zásadní změnu nejprve prober s uživatelem a uveď technický důvod.
- Pracuj primárně na jedné etapě a vždy jednom konkrétním milestonu.
- Aktuální výchozí bod: Etapa 1, milestone 1.1 – Skeny a kontext výzkumu. Zápis roadmapy implementaci 1.1 neschválil. Při pozdějších úkolech ověř aktuální stav hlavní roadmapy a pokyny uživatele.
- Před změnami funkcí nejprve popiš očekávané chování, GUI, rozsah a dopady. S implementací počkej na výslovný souhlas uživatele; již udělený souhlas pro konkrétní rozsah platí.
- Po implementaci ověř výsledek a oprav zjištěné problémy. Až poté přejdi k dalšímu milestonu.
- Nový nápad mimo aktuální milestone zapiš do vhodné budoucí etapy nebo zásobníku, bez automatického zahájení implementace. Původní archiv zachovávej; doplňky rozlišuj od původního obsahu.
- Bod, který přestane dávat smysl, nejprve společně přehodnoť. Budoucí etapa není automatické oprávnění začít kódovat.
- Vycházej ze současného GUI, Node.js a SQLite. Změnu technologie navrhuj jen při konkrétní doložené překážce.
- Na GitHub commituj a odesílej změny pouze na výslovný pokyn uživatele. Klíče a lokální databáze do repozitáře nepatří.
