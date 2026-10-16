# ChainDetective: pravidla práce

Hlavní strategie a pracovní plán: `dist/roadmap.html`. Původní podrobný audit: `dist/roadmap-v2-audit.html`; archiv není aktuální plán a jeho body nejsou automaticky schválené.

- Aktuální závazné pořadí po technickém a produktovém auditu je v `dist/roadmap.html`: 1. správnost výsledků a řízení úloh, 2. souvislý research workflow, 3. datový a výkonový základ, 4. sdílené Wallet Snapshots / Wallet Index, 5. porovnání Smart-wallet skupin, 6. historická pozorování a změny, 7. projektový a Social kontext. Původní plán je archivní reference, ne pracovní plán. Pozdější Signals, Alerts, Early Mover Score, PnL, relationship graph a pokročilé capital flows nyní neimplementovat.
- Pracuj primárně na jedné etapě a vždy jednom konkrétním milestonu.
- Aktuální výchozí bod: Etapa 1 – Správnost výsledků a řízení úloh. Auditní body jsou otevřená práce, dokud nejsou opravené a ověřené; pouhý zápis do roadmapy implementaci neschvaluje. Při pozdějších úkolech ověř aktuální stav hlavní roadmapy a pokyny uživatele.
- Před změnami funkcí nejprve popiš očekávané chování, GUI, rozsah a dopady. S implementací počkej na výslovný souhlas uživatele; již udělený souhlas pro konkrétní rozsah platí.
- Po implementaci ověř výsledek a oprav zjištěné problémy. Až poté přejdi k dalšímu milestonu.
- Nový nápad mimo aktuální milestone zapiš do vhodné budoucí etapy nebo zásobníku, bez automatického zahájení implementace. Původní archiv zachovávej; doplňky rozlišuj od původního obsahu.
- Bod, který přestane dávat smysl, nejprve společně přehodnoť. Budoucí etapa není automatické oprávnění začít kódovat.
- Vycházej ze současného GUI, Node.js a SQLite. Změnu technologie navrhuj jen při konkrétní doložené překážce.
- Na GitHub commituj a odesílej změny pouze na výslovný pokyn uživatele. Klíče a lokální databáze do repozitáře nepatří.
