# ChainDetective: pravidla práce

Canonical pracovní plán a source of truth: `roadmap/roadmap-data.json`. `dist/roadmap-data.json` je generovaný runtime copy vytvořený přes `npm run bundle`; neupravuj jej ručně. `dist/roadmap.html` a `dist/roadmap.js` jsou pouze read-only zobrazení canonical dat. Původní podrobný audit: `dist/roadmap-v2-audit.html`; archiv není aktuální plán a jeho body nejsou automaticky schválené.

- Aktuální závazné pořadí po technickém a produktovém auditu je v `dist/roadmap.html`: 1. správnost výsledků a řízení úloh, 2. souvislý research workflow, 3. datový a výkonový základ, 4. sdílené Wallet Snapshots / Wallet Index, 5. porovnání Smart-wallet skupin, 6. historická pozorování a změny, 7. projektový a Social kontext. Původní plán je archivní reference, ne pracovní plán. Pozdější Signals, Alerts, Early Mover Score, PnL, relationship graph a pokročilé capital flows nyní neimplementovat.
- Pracuj primárně na jedné etapě a vždy jednom konkrétním milestonu.
- Aktuální výchozí bod: Etapa 1 – Správnost výsledků a řízení úloh. Auditní body jsou otevřená práce, dokud nejsou opravené a ověřené; pouhý zápis do roadmapy implementaci neschvaluje. Při pozdějších úkolech ověř aktuální stav hlavní roadmapy a pokyny uživatele.
- Před změnami funkcí nejprve popiš očekávané chování, GUI, rozsah a dopady. S implementací počkej na výslovný souhlas uživatele; již udělený souhlas pro konkrétní rozsah platí.
- Po implementaci ověř výsledek a oprav zjištěné problémy. Až poté přejdi k dalšímu milestonu.
- Nový nápad mimo aktuální milestone zapiš do vhodné budoucí etapy nebo zásobníku, bez automatického zahájení implementace. Původní archiv zachovávej; doplňky rozlišuj od původního obsahu.
- Bod, který přestane dávat smysl, nejprve společně přehodnoť. Budoucí etapa není automatické oprávnění začít kódovat.
- Vycházej ze současného GUI, Node.js a SQLite. Změnu technologie navrhuj jen při konkrétní doložené překážce.
- Na GitHub commituj a odesílej změny pouze na výslovný pokyn uživatele. Klíče a lokální databáze do repozitáře nepatří.

## ROADMAP MAINTENANCE

- `roadmap/roadmap-data.json` je canonical source of truth pro roadmap položky, statusy, priority a evidence. Browserová stránka stav pouze čte; `localStorage` není zdrojem ani cílem synchronizace. `npm run bundle` kopíruje data do `dist/` a vkládá je do standalone roadmapy.
- Používej existující stable task IDs. ID nepřejmenovávej ani nerecykluj bez explicitního důvodu a aktualizace navazujících odkazů/testů.
- Neměň pořadí etap, priority, názvy etap ani product direction bez explicitního požadavku uživatele.
- Během implementace Codex smí měnit pouze `status` a `evidence.verified`, `evidence.tests`, `evidence.completed_at`, `evidence.notes`.
- Bez výslovného souhlasu uživatele Codex nesmí měnit `id`, `title`, `description`, `phase_id`, `priority`, `dependencies` ani `acceptance_criteria`. Acceptance criteria jsou během implementace read-only. Pokud jsou chybné nebo nedostatečné, zastav se a problém nahlas; neupravuj je tak, aby odpovídaly implementaci.
- Při zahájení významné práce lze odpovídající task změnit na `in-progress`.
- Task lze změnit na `done` pouze po splnění všech jeho `acceptance_criteria` a úspěšném průchodu relevantních testů. Samotná existence podobného kódu nestačí.
- Experiment nebo PoC není automaticky production-ready a sám o sobě neprokazuje dokončení.
- Roadmap status update patří do stejné změny/commitu jako implementace, kterou popisuje; pokud změna s roadmapou nesouvisí, roadmapu neupravuj.
- Při označení `done` vyplň `evidence.completed_at`, pokud je datum bezpečně doložitelné. Pokud historii nelze doložit, ponech `null` a stručně uveď omezení v `evidence.notes`; datum ani dokončení si nevymýšlej.
- Evidence (`verified`, `tests`, `completed_at`, `notes`) musí odpovídat ověřeným faktům. `evidence.tests` obsahuje existující repo-relative cesty k testům a `evidence.notes` má nejvýše 300 znaků. `verified` je `true` pouze pro `done` tasky; ostatní stavy mají `verified: false` a `completed_at: null`.
- Před dokončením změny spusť validaci roadmapy v `npm run check` nebo `npm test`.
- Žádný automatický commit, push ani deploy. Tyto kroky prováděj pouze na výslovný pokyn uživatele.
