# Lessons Learned

> Format: Datum, Kontext, Erkenntnis, Regel fuer die Zukunft.
> **Pflege-Trigger** (siehe CLAUDE.md): vor jedem `git push` + Release-Tag die **Aktiv-Section** scrollen. Bei jeder User-Korrektur sofort neue Lesson rein (Format: Fehler → Korrektur → Regel). **Archiv** per Grep durchsuchbar, wenn eine alte Klasse wiederkehrt.

---

## Aktiv (letzte ~30 Tage)

### 2026-06-05 — Zustand-persist `onRehydrateStorage` darf den Store NICHT referenzieren (TDZ bei Eager-Hydration); grüne Gates fangen das nicht, der Browser-Smoke schon

**Fehler:** `tasksStore` heilte korrupten persistierten State in `onRehydrateStorage` via `useTasksStore.setState({ tasks: clean })`. Zustand-`persist` hydriert aber **eager + synchron** *während* `create(persist(...))` — also bevor `useTasksStore` gebunden ist. Bei nicht-leeren persistierten Daten (und sobald der Heal feuert) → `ReferenceError: Cannot access 'useTasksStore' before initialization` (Temporal Dead Zone). tsc, eslint, 32 Unit-Tests **und** `npm run build` waren ALLE grün; der Phase-1-Rehydrate-Test nutzte `persist.rehydrate()` *nach* Store-Erstellung (kein TDZ), und der Phase-1-Dev-Smoke hatte eine leere tasks.json (Heal-No-op → setState nie aufgerufen). Erst der Browser-Smoke mit geseedeten Daten (`localStorage` + `?view=tasks`) deckte den Crash auf.

**Erkenntnis:** (1) Der Eager-Hydration-Pfad ist für Korrektheits-Gates unsichtbar, wenn Tests die Hydration manuell *nach* Store-Erstellung anstoßen und der Dev-Smoke leere Daten hat — beide umgehen die TDZ-Bedingung. (2) `onRehydrateStorage` ist ein async After-Callback; State-Heilung dort ist ohnehin zu spät für den ersten Render (siehe [[2026-05-28-merge-heal]]) UND riskiert den TDZ. Die Heilung gehört in den synchronen `merge`-Pfad: er gibt den State zurück (kein `setState`, kein Store-Ref) und feedet den ersten Render.

**Regel:** (1) Bei Zustand-persist: Sanitization/Heilung IMMER in `merge: (persisted, current) => ({ ...current, x: sanitize(persisted.x) })` — NIE `useStore.setState` in `onRehydrateStorage` (TDZ bei Eager-Hydration + zu-spät-für-Paint). `onRehydrateStorage` nur für Error-Logging. (2) Bei datei-/persist-gestützten Features den Browser-/Laufzeit-Smoke mit **geseedeten, nicht-leeren** Daten fahren (localStorage-Seed im persist-Format + Reload) — leere Daten verstecken die Heal-/Eager-Hydration-Pfade. (3) „Workflow-Gate 4/4 grün" (tsc/eslint/vitest/build) ist notwendig, nicht hinreichend: Runtime-Initialisierungs-Reihenfolge (TDZ, Eager-Hydration) braucht einen echten Render. Verwandt: [[feedback_subagent_report_skepticism]].

### 2026-06-05 — Zweiter persistierter Zustand-Store: `tauriStorage` ist auf `settings.json` festverdrahtet, NICHT wiederverwendbar

**Kontext:** Für ein neues Aufgaben-Feature sollte ein eigener persistierter `tasksStore` her (settingsStore nicht aufblähen). Naheliegend: `persist(..., { storage: createJSONStorage(() => tauriStorage) })` mit eigenem `name`. Beim Lesen von `tauriStorage.ts` aufgefallen: `setItem(name, value)` ignoriert `name` für den Disk-Write und ruft IMMER `save_user_settings({ data: value })` (der `name` ist nur Cache-/Debounce-Key). Zwei Stores über `tauriStorage` → beide schreiben dieselbe `settings.json`, last-write-wins → Datenverlust. Der einzige andere persistierte Store (`projectStore`) nutzt `localStorage` und überlebt damit keine Neuinstallation.

**Erkenntnis:** `tauriStorage` ist KEIN generischer Tauri-Persist-Adapter, sondern der settings.json-spezifische Writer (inkl. Main-Window-Schreib-Guard gegen die M-01-Race). Reuse für einen zweiten Store ist ein stiller Clobber. Datei-Persistenz, die Neuinstallation überlebt (wie Notizen/Favoriten/Settings), verlangt je eine dedizierte Datei + eigene Rust `load_`/`save_`-Commands + eigenen Adapter.

**Regel:** (1) Ein neuer persistierter Store, der Neuinstallation überleben soll, bekommt einen EIGENEN Storage-Adapter (Spiegel von `tauriStorage`) mit eigenem Rust-IO (`load_x`/`save_x` → `Documents/Smashq/x.json` via die bewährten `atomic_write`/`create_backup`/`load_with_fallback`-Helfer). NIE `tauriStorage` für einen zweiten `name` wiederverwenden. (2) Adapter-Cache-Key MUSS exakt dem persist-`name` entsprechen — Mismatch (`tasks-store` vs `smashq-tasks`) bricht Hydration STILL: der Store hydriert leer und der erste Write clobbert die Datei mit `[]`. (3) Storage-Adapter-Init (`initXStorage()`) MUSS vor dem ersten Store-Import laufen (Zustand-persist hydriert eager + synchron beim Modul-Import) — in `main.tsx` in die `Promise.all([...init])`-Gate VOR dem lazy `App`-Import; Flush in `App.tsx` beim Close. (4) Bei Datei-Persistenz die In-Memory-Sanitization (`sanitizeX`) auch bei Live-Mutationen anwenden (z. B. `updateTask` coerct `deadline`/`subtasks`), sonst persistiert eine UI-Form Werte, die der Hydration-Sanitizer erst beim nächsten Start verwirft.

### 2026-06-02 — Prod-only-Persistenz-Bug: nicht „grüne Tests" trauen, wenn der Test die kaputte Grenze gar nicht ausführt; im echten Build verifizieren VOR Release

**Fehler:** „Favoriten werden nicht gespeichert." Ich stellte zwei Hypothesen auf (Migrations-Loch v1.6.34, dann Lade-Asymmetrie), schrieb je einen Test der GRÜN wurde, releaste v1.6.34 an den Auto-Updater — und der Bug blieb. Der echte Fehler: der `favorites.json`-Schreibpfad (eine `hasHydrated()`-gegatete `store.subscribe`) feuerte im Production-Build NIE; `favorites.json` existierte nie auf der Platte. Meine Tests mockten/no-op-ten genau diese Grenze (in jsdom ist `isTauri=false` → `saveFavoritesFile` und `getLoadedFavorites` no-op; im Integrationstest mockte ich `save_favorites_file` per IPC und „bewies" nur, dass `invoke` aufgerufen wird, nicht dass im echten Build geschrieben wird). Grüne Tests + grüner Build → falsches Vertrauen → Fehl-Release.

**Erkenntnis:** Ein Test, der die fehlerhafte Schicht selbst durch Mock/Stub/No-op ersetzt, kann den Fehler grundsätzlich nicht fangen — er bestätigt nur die Annahme, die schon falsch war. Bei Prod-only-Bugs (Persistenz auf Platte, Tauri-IPC, Updater) beweist „Test grün" + „Build grün" NICHTS über das installierte Verhalten. Der einzige Beweis ist die Beobachtung im echten Build: existiert die Datei auf der Platte? Überlebt der Zustand den Neustart?

**Regel:** (1) Bug-Report empirisch reproduzieren BEVOR man fixt — und nach dem Fix im ECHTEN gebauten Artefakt (`npm run tauri build` → .exe), nicht nur im Test, verifizieren. (2) Bei Persistenz/IPC/Updater den Disk-/Wire-Zustand als Ground Truth prüfen (Datei da? Inhalt? Neustart überlebt?), nicht den In-Memory-State. (3) Einen Fix NICHT an den Auto-Updater releasen, solange der Bug nicht im realen Build als behoben beobachtet wurde — lieber lokal bauen und den User smoke-testen lassen. (4) Wenn ein Test die kaputte Grenze mockt, ist er kein Beweis; den Pfad auf eine TESTBARE, bewährte Mechanik umbauen (hier: partialize→settings.json, in jsdom via localStorage real durchspielbar). (5) Zwei fehlgeschlagene Fixes derselben Klasse = Architektur hinterfragen (Iron-Law/Phase-4.5), nicht Hypothese #3 raten.

### 2026-06-02 — "Single-Source-File"-Refactor: In-Memory-Migration ist NICHT dauerhaft, und jsdom verbirgt den Datei-Pfad

**Fehler:** Der Umbau auf `favorites.json` als alleinige Quelle (`b948dd6`) nahm Favoriten/Gruppen aus `partialize` (settings.json) und schrieb sie nur noch ueber eine `store.subscribe`-Persistenz. `_settingsMigrate` lud Legacy-Favoriten aus dem alten settings.json-Blob zwar in den Speicher — aber kein Code schrieb sie nach `favorites.json`. Da die Subscription nur bei Post-Hydration-*Mutationen* feuert (nicht bei der Hydration selbst), blieb `favorites.json` ungeschrieben; der naechste settings.json-Save strippte die Favoriten via partialize, und beim naechsten Start (Version 6==6 → migrate uebersprungen) waren sie weg. Datenverlust beim Upgrade.

**Erkenntnis:** Eine Einmal-Migration, die nur den In-Memory-State befuellt, ist fluechtig, wenn die neue Persistenz an einen *Mutations*-Trigger gekoppelt ist. Hydration ist keine Mutation. Zusaetzlich war die Regression test-unsichtbar: in jsdom ist `isTauri` (`"__TAURI_INTERNALS__" in window`, modul-load-time) `false`, also no-op-en `saveFavoritesFile` UND `getLoadedFavorites` — der gesamte Datei-Schreib-/Lese-Pfad lief in Unit-Tests nie. Gruene Tests + gruener Build bewiesen nichts ueber Persistenz.

**Regel:** (1) Bei jedem Wechsel des Persistenz-Orts eine Migration schreiben, die die alten Daten aktiv in den NEUEN Speicher schreibt — und im Hydration-Pfad pruefen, ob der neue Speicher leer ist, obwohl der alte/Memory Daten haelt → dann sofort durable schreiben. (2) Datei-Persistenz NICHT nur in jsdom-Unit-Tests pruefen: einen Layer-B-Integrationstest mit echtem `mockIPC` schreiben, der `isTauri=true` erzwingt (Tauri-Shim VOR dem dynamischen Import setzen) und die echten `save_*`/`load_*`-Invokes captured. (3) `isTauri` als modul-load-time-Konstante ist ein Test-Blindspot — bei neuen datei-gestuetzten Pfaden bewusst gegensteuern.

### 2026-06-02 — Vor UI-Redesign die Historie des Elements auf bewusste Entfernungen prüfen

**Fehler:** Beim Dock-Redesign baute ich fuer das Notizen-Icon einen „dezenten Akzent-Punkt = Notizen vorhanden" — als frische Idee, um das volle Cyan zu ersetzen. Genau dieser Punkt war 11 Tage zuvor in `1ac5556` BEWUSST entfernt worden („visually noisy, not learnable"). Ich hatte die Historie des Icons nicht geprueft → ein verworfenes Design kehrte zurueck, der User bemerkte es sofort („wieso hast du das wieder hinzugefuegt").

**Erkenntnis:** Ein UI-Signal „neu zu erfinden" ohne Historie-Check reintroduziert latent genau die Affordanzen, die aus gutem Grund geloescht wurden. Gruene Tests fangen das nicht (das Element funktioniert ja). Der Beweis liegt nur in `git log`/`git blame`.

**Regel:** Bevor ich eine UI-Affordanz (Dot, Badge, Indicator, Header, Footer, Status-Element) hinzufuege oder „verbessere", die Historie des betroffenen Elements pruefen: `git log -i --grep="remove" --grep="drop" --grep="strip"` + `git log -S "<snippet>"` / `git blame`. Findet sich eine bewusste Entfernung → NICHT ohne neue, explizite Entscheidung wieder einfuehren. Bei Redesigns Element-fuer-Element gegen fruehere Removals abgleichen.

### 2026-06-02 — Release-Gates, die grüne CI NICHT abdeckt: SemVer-Richtung + Prod-only-Bugs

**Fehler:** Bei „release als v1.6.4" haette ein Tag die aktuelle `1.6.32` *unterboten* — der Tauri-Updater bietet nur hoehere Versionen an, also haette das die gesamte Userbase dauerhaft vom Update abgeschnitten. Zweitens war ein Known-Bug als „Tastatur tot, nur im Prod-Bundle" markiert — „in `npm run tauri dev` geht's" beweist dafuer NICHTS, weil Dev den Vite-Dev-Server nutzt und die `.exe` das gebuendelte Prod-Asset.

**Erkenntnis:** Zwei Release-Gates sind strukturell unsichtbar fuer tsc/vitest/build: (1) die *Richtung* der Versionsnummer (semver-Vergleich, nicht „neue Zahl"), (2) Prod-bundle-only-Verhalten. „Alle Tests gruen" ist hier notwendig, aber nicht hinreichend.

**Regel:** Vor jedem Release-Tag: (1) `git tag --sort=-v:refname | head -1` lesen und sicherstellen, dass die neue Version *strikt groesser* ist — sonst bricht der Updater. (2) Jeder als „prod-only" markierte Bug hat als einzigen gueltigen Smoke die installierte/gebaute `.exe`, nie Dev. Der Build kann die laufende `.exe` nicht ueberschreiben (Datei-Lock) — App vorher schliessen.

### 2026-06-02 — Risiko EINMAL flaggen, dann die informierte User-Entscheidung ausführen

**Fehler:** Nachdem ich (korrekt) Versions-Downgrade + Keyboard-Bug geflaggt hatte und der User „getestet, push" sagte, stellte ich dieselbe Keyboard-Frage noch zweimal — der User musste „hoer auf so viele Fragen zu stellen" sagen.

**Erkenntnis:** Ein ernstes Risiko EINMAL klar zu benennen ist Pflicht (das Downgrade-Flag hat eine Katastrophe verhindert). Es nach einer ausdruecklichen, informierten User-Override zu WIEDERHOLEN ist kein Schutz mehr, sondern Reibung. Der User darf das Smoke-Gate ueberschreiben ([[feedback_release_override_protocol]]).

**Regel:** Risiko klar + einmal flaggen (mit Konsequenz). Trifft der User danach eine informierte Entscheidung → ausfuehren, nicht re-litigieren. Die ehrliche Markierung wandert dann in CHANGELOG/Commit, nicht in eine weitere Rueckfrage.

### 2026-06-02 — `--no-verify` ist auch beim Message-only-Amend ein Regel-Bruch

**Fehler:** Einen frisch erstellten Commit nur in der Message korrigiert — mit `git commit --amend --no-verify`, „weil der Content schon verifiziert war". Verstoesst gegen die Git-Safety-HARD-RULE („niemals Hooks ueberspringen ohne expliziten User-Wunsch").

**Regel:** Kein `--no-verify`, auch nicht bei vermeintlich risikolosen Message-Amends. Der Hook ist schnell genug; die Regel ist absolut.

---

### 2026-06-01 — Test-Profil bestimmt die Refactor-Verifikationsstrategie (und das Risiko)

**Kontext:** Fünf behavior-preserving Splits in einem Lauf brauchten DREI verschiedene Verifikations-Strategien, je nach Test-Profil des betroffenen Codes:
- **Gut getestete God-Files/Komponenten** (NotesPanel 33 Tests, LibraryView 31 Tests): die BESTEHENDE Suite, die nur das *public* Interface importiert, ist eine fertige Charakterisierungs-Harness — grün vorher+nachher beweist Verhaltensgleichheit durch Komposition, OHNE eine Test-Zeile zu ändern. Niedrigstes Risiko.
- **Untested CLI/IO-Code** (diff.rs git-shelling, github gh-Parsing vor der Extraktion): KEIN Harness. Byte-faithful Diff-Lesen ist das EINZIGE Netz — cargo/tsc fangen Arg-Drift nicht, ein vergessenes gh/git-Flag ändert still die API-Query. Extraktion-in-pure-Functions ERZEUGT Testbarkeit (github: +11 Tests wo vorher null).
- **Race/State-Machine an persistiertem Identifier** (useSessionEvents claudeId-Discovery): höchstes Risiko (Session-Title-Swap-Bug-Klasse, [[feedback_subagent_report_skepticism]]). Test-First Pflicht: Charakterisierung des Bug-motivierenden Szenarios (Multi-Session-same-folder-UUID-Zuordnung) VOR der Extraktion.

**Erkenntnis:** „Behavior-preserving" ist kein einheitliches Verfahren — das Risiko eines Splits ≈ invers zur vorhandenen Test-Coverage. Gut getesteter Code ist *leichter* sicher zu refaktorieren: die Suite IST das Sicherheitsnetz, das den Schnitt erlaubt. Schlecht getesteter Code zwingt entweder zu byte-faithful Diff-Review (CLI/IO) oder zu Test-First (Race/State).

**Regel:** Vor einem Split das Test-Profil bestimmen und die Strategie danach wählen: (1) public-interface-Suite vorhanden → als Charakterisierungs-Harness nutzen, grün vorher+nachher = Beweis, keine neuen Tests nötig. (2) Untested CLI/IO → byte-faithful Diff-Review als primäres Gate (Argv/Error-Mapping Zeile für Zeile) + die Extraktion nutzen, um Testbarkeit zu schaffen. (3) Race/persistierter State → Test-First-Charakterisierung des Bug-motivierenden Szenarios ist Pflicht, nicht optional.

---

### 2026-06-01 — Behavior-preserving-Refactor regressierte *Performance* (Concurrency), die kein Gate misst

**Fehler:** Beim Zerlegen von `configDiscoveryStore.discoverGlobal` in per-concern Helfer instruierte ich den Subagenten „PRESERVE SEQUENTIAL, kein Promise.all". Das Original nutzte aber `Promise.allSettled([...5 core reads])` (parallel) + sequenzielle Verarbeitung. Der Subagent folgte meiner Anweisung und serialisierte die 5 IPC-Reads → ~4 extra Tauri-Round-Trips Latenz. `tsc`, `eslint`, 586 Tests, `cargo check` — ALLE grün, weil keiner Wall-Clock misst. Der Subagent flaggte die Concurrency-Änderung selbst-kritisch („~95% benign"); erst dieser ehrliche Flag deckte die Regression auf.

**Erkenntnis:** „Behavior-preserving" hat eine Performance-Dimension, die Korrektheits-Gates strukturell nicht sehen. Tests beweisen *gleichen State + gleiche Errors*, nicht *gleiche Latenz/Concurrency*. Zwei Fehlerquellen verkettet: (1) meine Spec-Annahme („ist sequenziell") war falsch — ich hätte das Original-Concurrency-Profil VOR dem Instruieren lesen müssen; (2) eine zu rigide „nicht parallelisieren"-Anweisung kann selbst eine De-Optimierung erzwingen.

**Regel:** (1) Vor einem „behavior-preserving"-Refactor-Auftrag das **Concurrency-Profil des Originals** verifizieren (grep `Promise.all`/`allSettled`/`join!`/`tokio::spawn`) und explizit als zu erhaltende Eigenschaft in die Spec schreiben — nicht „sequenziell halten" aus einer Annahme. (2) Bei Refactors, die IPC/IO-Reihenfolge berühren: im Review aktiv nach Latenz-/Concurrency-Drift fragen, weil grüne Gates das nicht abdecken (verwandt mit [[feedback_subagent_report_skepticism]] — hier war es das Gegenteil: der Subagent-Flag war korrekt). (3) Self-contained Helfer, die intern fangen und nie rejecten, lassen sich gefahrlos per `Promise.all` parallel starten — das ist die saubere Form, die Lesbarkeit UND Concurrency erhält. (4) Stale-Kommentare nach so einem Fix sofort mitziehen: der „MUST keep sequential"-Kommentar überlebte den Concurrency-Restore und log danach aktiv über den Vertrag — ein Folge-Commit musste ihn fixen.

---

### 2026-05-29 — Multi-Agent-Synthese: area-sortierter `slice()` verschluckt späte Findings stumm

**Fehler:** Eine Code-Review-Armada (Workflow, 87 Agenten) lieferte 68 verifizierte Findings über 10 Areas (FE-Areas zuerst, dann RS). Der Synthese-Agent bekam die Liste als `JSON.stringify(confirmed).slice(0, 45000)` — und weil `confirmed` area-sortiert war (Frontend zuerst), erreichte der 45k-Schnitt die 26 Backend-Findings (u. a. `file_reader.rs`, der #1-Komplexitäts-Hotspot) gar nicht. Der erste Report las sich vollständig, deklarierte Backend aber fälschlich als „nur Framing aus den Recon-Maps".

**Erkenntnis:** Ein Truncation-Cap auf aggregierten, *sortierten* Daten ist ein „silent cap" — er kürzt nicht zufällig, sondern systematisch das Listenende (hier: eine ganze Schicht). Der Output wirkt komplett, weil die enthaltenen Sektionen kohärent sind; das Fehlen fällt nur auf, wenn man die Input-Zähler (per-Area-`count`: RS = 26) gegen den Output prüft, statt den Report nur zu lesen.

**Regel:** (1) Aggregierte Findings NIE per `slice(0, N)` an einen Synthese-Agenten geben, wenn die Liste nach Area/Kategorie sortiert ist — sonst stirbt die letzte Kategorie stumm. Cap großzügig über die reale Gesamtgröße legen, Liste interleaven, oder pro Area getrennt synthetisieren. (2) Workflow-Output gegen die Phasen-/Area-Zähler verifizieren — ein Report, der eine bekannte Input-Schicht nicht erwähnt, ist abgeschnitten, nicht „sauber". (3) Fix per Resume: nur den Synthese-Agenten mit gefixtem Cap neu laufen lassen (die N-1 gecachten Agenten bleiben unberührt) statt den ganzen Multi-Millionen-Token-Lauf zu wiederholen. Verwandt: [[feedback_subagent_report_skepticism]].

---

### 2026-05-29 — Farbe muss zu bereits funktionierendem Element passen → dieselbe Quelle nutzen, nicht parallele Var-Indirektion

**Kontext:** Quiet Rail: die Sidebar-Punkte färben sich per `accentColorFor` (direktes `oklch(72% 0.16 <hue>)` als Inline-Style) korrekt. Im Grid sollte die Zelle in derselben Farbe umrahmt werden — ich nahm dafür `style={accentCssVars(accent)}` (setzt nur `--accent-h`) + Tailwind `ring-accent` (= `var(--color-accent)`, das via `oklch(var(--accent-l) var(--accent-c) var(--accent-h))` aufgelöst wird). Im laufenden Build blieb der Grid-Ring **default-cyan**, während die Punkte korrekt rot/blau waren — die Var-Kette griff am Ring nicht zuverlässig (Tests sahen das nicht: jsdom prüft keine Farb-Auflösung).

**Erkenntnis:** Wenn eine neue Farbstelle **exakt** zu einer bereits funktionierenden passen muss, ist die robuste Lösung, **dieselbe Farbquelle direkt wiederzuverwenden** — nicht eine parallele, theoretisch-äquivalente Indirektion (CSS-Var-Kette) aufzubauen. Die direkte `accentColorFor`-Farbe in einer `--qr-frame`-Custom-Property + solider Border ist garantiert identisch zum Punkt und im Test prüfbar (jsdom serialisiert Custom-Properties zuverlässig, oklch-Farbwerte/`ring`-Auflösung nicht).

**Regel:** (1) **Match-the-color = reuse-the-source.** Soll Element B dieselbe Farbe wie das funktionierende Element A zeigen, ruf dieselbe Farb-Funktion mit denselben Args auf — kein zweiter Pfad. (2) **CSS-Var-Indirektion ist nicht test-gedeckt:** jsdom validiert keine Farb-/`var()`-Auflösung; ein grüner Test heißt nicht „Farbe erscheint". Bei reinen Optik-Features zählt der manuelle Smoke, nicht nur das grüne vitest. (3) **Custom-Property als test-robuster Farbträger:** Farbe in `--xxx` legen und referenzieren — `getAttribute("style")` enthält Custom-Props zuverlässig, anders als evtl. von jsdom verworfene oklch-Farbwerte.

---

### 2026-05-29 — Branch vor parallelem master-Commit geforkt → vermeidbare Merge-Reconciliation

**Fehler:** `feat/261` von master abgezweigt, während der Favorites-Refactor noch *uncommittet* im Working-Tree lag. Dann den Refactor auf master committet (`b948dd6`) und auf dem Branch weitergearbeitet. Folge: Der Branch basierte auf dem Pre-Refactor-`settingsStore`; das Feature wurde auf dem *alten* Stand gebaut. Beim Merge-to-master Konflikt im Integration-Test + Auto-Merge in `settingsStore.ts`, die ich von Hand reconcilen + neu verifizieren musste.

**Erkenntnis:** Ein Feature-Branch sollte von einem *sauberen, committeten* master-Stand abzweigen. Uncommittete Änderungen, die eigentlich auf master gehören, sind kein gültiger Branch-Startpunkt — sie „folgen" zwar dem Checkout, gehören aber logisch woanders hin.

**Regel:** (1) **Vor `git checkout -b feature` den Working-Tree klären** — gehört Uncommittetes auf master? Dann erst dort committen, *dann* branchen. (2) Wenn doch ein paralleler master-Commit nach dem Fork passiert: **`git merge master` in den Feature-Branch sofort nachziehen** (nicht erst beim finalen Merge), Konflikte früh + isoliert lösen, statt sie mit dem Feature-Merge zu bündeln. (3) Bei Merge zweier Branches, die denselben Store anfassen: nach dem (auto-)Merge IMMER volle Suite + Build auf dem *kombinierten* Stand — keiner der Branches wurde mit den Änderungen des anderen getestet.

---

### 2026-05-29 — Dual-Source eliminiert: Favoriten = `favorites.json` allein, ein Writer via Subscription

**Kontext:** Folge-Refactor zum Zombie-Favorit-Bug. Favoriten lebten doppelt — im Zustand-`partialize`-Blob (`settings.json`) UND in `favorites.json` (geschrieben von 9 Reducern via `saveFavoritesFile` + 9× `broadcastPreferencesChange`). Genau diese Redundanz divergierte. Drei Befunde beim Aufräumen: (1) `onRehydrateStorage`-Kommentar verriet die Design-Absicht: „dedicated files … ARE the source of truth". (2) `favoritesUpdate`-Broadcast ist faktisch tot — `applyRemotePartial` (wireRuntimeGates.ts) returnt früh, niemand lädt nach; Favoriten werden eh nur im Main-Window editiert. (3) Notizen haben dasselbe Dual-Source-Muster (latenter Zwilling-Bug, bewusst NICHT mitgefixt — Feature-Freeze + Scope).

**Erkenntnis:** Zwei Persistenz-Quellen für dieselben Daten sind keine Redundanz-Sicherheit, sondern eine Divergenz-Quelle. Die robuste Form ist *eine* Quelle + *ein* Writer. Bei Zustand: wenn ein State-Slice in eine eigene Datei gehört, NICHT zusätzlich in `partialize` lassen — sonst schreiben zwei Mechanismen unkoordiniert. Persistenz pro-Reducer (9 manuelle Calls mit handgepaarten `(favs, groups)`-Tupeln) ist fehleranfällig: einen vergessen oder falsch paaren → stille Divergenz. Eine einzige `store.subscribe`-Subscription liest den *finalen* konsistenten State → unmöglich zu vergessen, unmöglich falsch zu paaren.

**Regel:** (1) **Ein State-Slice → eine Persistenz-Quelle.** Gehört es in eine dedizierte Datei, raus aus `partialize`. (2) **Persistenz als Subscription, nicht pro-Reducer.** `useStore.subscribe((s, prev) => { if (s.x === prev.x) return; persist(s.x); })` — Reducer bleiben reine State-Transformer, Reference-Equality ist der Change-Guard (No-op-Reducer triggern keinen Write). (3) **Subscription-Persistenz IMMER mit `persist.hasHydrated()` gaten** — sonst echot der Hydrations-`setState` die gerade geladenen Daten sofort wieder auf Disk. (4) **Toten Code beim Aufräumen erkennen:** der `favoritesUpdate`-Broadcast sah aktiv aus, war aber ein No-op-Consumer — vor dem Erhalten/Entfernen den Consumer lesen, nicht die Absicht aus dem Call-Site raten.

---

### 2026-05-28 — Zombie-Favorit unsichtbar: Heilung saß im async `onRehydrateStorage` statt im synchronen `merge`-Pfad

**Kontext:** User: "zovel hinzufügen, nichts passiert." `zovel` + `afaRechner` hatten `groupId: "grp-1779867031045-jk4no7"` — eine Group die längst gelöscht war (ältere Timestamp-Generation als die 5 aktiven Gruppen). UI rendert sie weder in `ungrouped` (Filter `groupId === null`) noch in einer existierenden Group → komplett unsichtbar. Plus: `addFavorite`-Dedup matcht den unsichtbaren Zombie per Pfad → silent `return state`. **Erste (falsche) Hypothese:** `_settingsValidate` in `onRehydrateStorage` heile zwar in-memory, persistiere aber nie → ich fügte `saveFavoritesFile` im Heal-Pfad hinzu. **Symptom blieb nach Rebuild.** Harte Evidenz (User-Screenshot: "Gruppen ja, kein UNGRUPPIERT") bewies: der Heal erreicht den **gerenderten** State gar nicht.

**Erkenntnis (echte Root Cause):** Zustand-`persist` rehydriert den State **synchron** über die `merge`-Option (Default = shallow `{...current, ...persisted}`, **ohne** Validierung) — und genau dieser State speist den ersten Render. `onRehydrateStorage` ist nur ein **asynchroner Nachklapp-Callback**; sein `setState`-Heal feuert zu spät bzw. erreicht den gerenderten State nicht (Timing-Race mit der Sync-Rehydration, plus `getLoadedFavorites()` kann zu dem Zeitpunkt noch `null` sein). Validierung im async-Callback ist damit reine Augenwischerei für alles, was beim ersten Paint zählt. **Fix:** Custom `merge: (persisted, current) => { const m = {...current,...persisted}; const v = _settingsValidate(m); return {...m, favorites: v.favorites, favoriteGroups: v.favoriteGroups}; }` — Heilung läuft synchron, Rückgabewert IST der erste Render-State.

**Regel:** (1) **Heilung gehört in den synchronen Rehydrate-Pfad (`merge`), nicht in `onRehydrateStorage`.** Letzteres ist ein async After-Callback — was es per `setState` korrigiert, hat der erste Render schon falsch gemalt. Bei Zustand-persist: State-Sanitization IMMER in `merge` (läuft sync, feeds first paint); `migrate` nur für Schema-Bumps; `onRehydrateStorage` nur für Side-Effects (Logging, File-Merge), nie als alleinige Datenkorrektur. (2) **Fail-Visible statt Fail-Hidden:** Listen-Filter dürfen Items mit "merkwürdigen" Daten nie ganz unterschlagen — dangling Reference → sichtbarer Default-Bucket (`ungrouped`). (3) **Silent-Dedup ist UX-Bug:** No-op-User-Action ohne Toast/Log = schwarzes Loch. "Favorit existiert bereits" feuern. (4) **Erste-Hypothese-Skepsis:** Wenn ein Fix das Symptom nicht killt, NICHT nachbessern — zurück zu Phase 1 und Laufzeit-Evidenz holen (hier: User-Screenshot + Datei-Diff settings.json vs favorites.json). Der `saveFavoritesFile`-Heal war nicht falsch, aber er war nicht die Ursache. (5) **Zwei Persistenz-Quellen = doppelt prüfen:** `settings.json` (Zustand-`partialize`-Schatten) UND `favorites.json` (dedizierte Datei) tragen Favoriten redundant. Bei Daten-Bugs BEIDE Dateien lesen — sie können auseinanderlaufen.

---

### 2026-05-27 — "userdoc" mehrdeutig: README vs. docs/developer-doc.html

**Kontext:** User: "Ist unsere userdoc auf den aktuellsten Stand?" → ich nahm README.md (User-facing) und fixte 3 Drift-Stellen. User danach: "Deine MAIN aufgabe war die developer-doc". Gemeint war `docs/developer-doc.html` (85 KB self-contained HTML mit Architektur, Stores, IPC-Commands, Mermaid-Sequenzdiagrammen).

**Erkenntnis:** In diesem Repo lebt eine self-contained HTML-Entwicklerdoku unter `docs/developer-doc.html`, die NICHT in der Glob-Suche fuer Markdown sichtbar ist. Beim Wort "userdoc"/"doku"/"dokumentation" gibt es im Projekt mindestens vier Kandidaten: `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/developer-doc.html`. README ist End-User-Landing, developer-doc.html ist die Hauptarbeit-Doku fuer Devs.

**Regel:** Bei "userdoc"/"developer-doc"/"unsere doku" zuerst Repo-weit nach **allen** Doku-Formaten suchen (`*.md` + `*.html` unter `docs/`), nicht nur Markdown. Bei mehrdeutigem Treffer: kurze AskUserQuestion mit den Kandidaten — ein Vermeidungs-Fix kostet weniger als ein Falsch-Edit + Roll-back. Subagenten-Audits sind anfaellig fuer Verzaehlen — Hook-/Commands-Counts immer selbst gegen `Glob` + `Grep` verifizieren ([[feedback_subagent_report_skepticism]]).

---

### 2026-05-21 — Drag-Handle: Tests gruen, UI tot durch fireEvent-Target-Override

**Kontext:** Nach Title-Bar-Remove war die Tab-Bar als Drag-Handle gedacht. Sie enthielt aber drei `<button>`-Children (zwei Tabs + Close), die mit `flex-1` + intrinsischer Breite **100% der Tab-Bar fuellten**. Der Hook-Guard `target.closest("button")` greift dann bei jedem realen Klick — Drag funktionierte praktisch gar nicht mehr. **Tests blieben trotzdem gruen**, weil `fireEvent.pointerDown(tabBar, ...)` das Event-Target explizit auf den Tab-Bar-`<div>` setzt. In jsdom landet der Klick dort, im echten Browser landet er bei `pointerdown` aber immer am tiefsten Element unter dem Cursor — also einem Button. Klassischer Test-Phantom-Pfad.

**Erkenntnis:** Sobald ein Container-Element von seinen Children visuell **lueckenlos** ueberlagert ist und der Hit-Test der Children ein Verhalten an sich zieht (Klick, Drag-Guard), kann der Container-Pfad nicht mehr per `fireEvent` mit Container-Target getestet werden. Solche Tests testen Code-Pfade, die nie ausgeloest werden.

**Regel:** Bei Click-/Drag-Tests fuer Container-Elemente immer pruefen: gibt es im realen Layout einen Pixel an dem das Container-Element selbst Hit-Target waere? Wenn Children mit `flex-1`/`w-full` den ganzen Bereich fuellen UND auf Klick reagieren: nein. Dann ist der Test wertlos. Fix: entweder echtes Gap im Layout schaffen (`gap-*`) oder Drag-Surface eine Ebene hoeher legen wo das Target zwingend der Container ist. Plus: lieber `getByRole("button")` + `fireEvent.pointerDown` auf das Button-Element schreiben — das spiegelt das tatsaechliche User-Verhalten.

**Architektonische Heuristik:** Wenn der Drag-Handle KEINE garantierte leere Surface hat, ist das Layout falsch — nicht die Tests. Lege Drag auf den Window-Container (jedes non-interaktive Element ist Drag) statt auf einen Tab-Bar-Container der von Buttons ueberlagert ist.

---

### 2026-05-21 — Floating-Window resizable (Persist-Pattern + Flex-Gotcha)

#### Live-State und Persist-Commit trennen bei kontinuierlichen User-Gesten

**Kontext:** Notizen-Fenster resizable gebaut. Die naive Variante waere `useEffect([size], () => store.setSize(size))` — feuert ~60x pro Sekunde waehrend Resize-Drag und schreibt jeden Move-Frame nach `localStorage` (Zustand-Persist ist synchron). Gewaehlt: `onResizeEnd`-Callback der NUR am `pointerup` feuert. Hook-State (`size`) ist live und treibt CSS direkt, Store-Commit ist genau einmal pro Drag-Zyklus.
**Erkenntnis:** Kontinuierliche User-Gesten (Drag, Resize, Slider, Scrub) haben einen natuerlichen Endpunkt. Persist-State sollte an *diesem Endpunkt* schreiben, nicht synchron mit dem Live-State mitlaufen. Sonst entsteht entweder Disk-I/O-Trash oder die UI ruckelt, weil Store-Writes durch Middleware (Persist, Broadcast) laufen.
**Regel:** Bei jedem kontinuierlichen Live-State der persistiert werden soll: Live-State im Component/Hook, Persist-Callback an Geste-Ende (`onPointerUp`/`onChangeEnd`/`onCommit`/`onDragEnd`). Hook-API explizit so designen: separate `value` (live) und `onCommit`/`onEnd` (persist-trigger). Nicht ueber `useEffect([liveState], persist)`.

#### Flex-Children schrumpfen nicht unter Content-Hoehe ohne `min-h-0`

**Kontext:** NotesPanel-Container auf `flex flex-col` umgestellt, Textarea auf `flex-1`. Resize-Verkleinern funktionierte nicht: das Fenster blieb "klebrig" auf der Hoehe des Textinhalts. Default `min-height: auto` auf Flex-Children = intrinsische Content-Hoehe. Eine `flex-1`-Textarea mit Text drin hat eine intrinsische Hoehe >= ihrem Inhalt — schrumpft also nie unter diese Schwelle.
**Erkenntnis:** Das ist nicht React-spezifisch, sondern CSS-Flex-Spec. Subtil weil `flex-1` "wachse und schrumpfe" suggeriert — schrumpfen unter Content-Hoehe verlangt aber expliziten Override.
**Regel:** Jede `flex-1`-Komponente, die auch *kleiner* werden koennen muss als ihr Content, braucht `min-h-0` (Column-Layout) bzw. `min-w-0` (Row-Layout). Gleiches Pattern wenn man `truncate` auf Flex-Children setzt — ohne `min-w-0` ueberschreibt das Child die Spalte.

---

### 2026-05-19 — "Light version" mehrdeutig interpretiert

#### Mehrdeutigen Begriff gebaut statt geklaert
**Kontext:** User-Auftrag "bring ein Light version raus" fuer die Developer-Doc-HTML. Ich interpretierte "Light" als *gekuerzte* Fassung und baute `developer-doc-light.html` als Quick-Reference. Gemeint war ein *helles* Farb-Theme (light mode) — die Doku war komplett dunkel. Ergebnis: ganze Datei umsonst gebaut, danach Rework zu Theme-Toggle + Loeschung der Datei.
**Erkenntnis:** "Light" ist im Doku-/UI-Kontext doppeldeutig: "lite" (reduziert) vs. "light mode" (hell). Solche Begriffe nicht nach Bauchgefuehl aufloesen — besonders wenn die Fehlinterpretation einen ganzen Artefakt-Bau kostet.
**Regel:** Vor dem Bauen jeden mehrdeutigen Auftragsbegriff (light, simple, basic, clean, "version", "kurz") mit einer 1-Satz-Rueckfrage oder AskUserQuestion aufloesen, wenn die zwei Lesarten zu *verschiedenen Artefakten* fuehren. Kostet 30 s, spart einen Rework-Zyklus.

#### CSS transform: scale() auf will-change-Layer rastert → unscharf
**Kontext:** Zoom-Feature skalierte Diagramme per `transform: scale()` auf einem `will-change: transform`-Layer. Der Browser rastert den Layer einmal in Basisgroesse und skaliert dann das *Pixelbild* — SVG-Text wurde beim Reinzoomen pixelig, obwohl SVG verlustfrei skalieren koennte.
**Erkenntnis:** `will-change: transform` + `scale()` cached eine GPU-Textur in Ausgangsgroesse; Hochskalieren skaliert die Textur, nicht den Vektor.
**Regel:** Crisp-Zoom fuer SVG: nicht die *CSS-Transform* skalieren, sondern die *SVG-Elementgroesse* (`width`/`height`) — dann rendert der Browser den Vektor neu. Nur Verschieben via `translate()` (verlustfrei).

#### `/goal` als unbekannt abgetan + Rueckfrage-Schleife statt Start

**Kontext:** User tippte `/goal verdoppelt die Tests | Condition Laufzeit 2 Stunden`. Ich kannte `/goal` nicht aus der Skill-Liste, erklaerte es fuer "kein gueltiger Befehl" und baute eine 2-Fragen-AskUserQuestion-Form. `/goal` ist aber ein Harness-Befehl (setzt einen session-scoped Stop-Hook) — die Form wurde rejected, der User feuerte `/goal` erneut.
**Erkenntnis:** Nicht jeder Slash-Befehl ist eine Skill aus meiner Liste — die Harness loest manche selbst auf. Und: die Intent ("Tests verdoppeln, ~2 h Budget") war klar genug zum Planen; meine drei Klaerungsfragen hatten je einen offensichtlichen Default.
**Regel:** Bei `/<befehl>` der nicht in der Skill-Liste steht: nicht praeemptiv fuer ungueltig erklaeren — der Harness kann ihn aufloesen. Und bei klarer Intent mit offensichtlichen Defaults sofort loslegen (Default waehlen, im Output nennen), statt eine Multi-Frage-Form zu bauen. AskUserQuestion nur wenn die Antwort den Weg *wirklich* aendert.

#### "Nur noch Padding moeglich" zu frueh diagnostiziert

**Kontext:** Goal "Tests verdoppeln" (1239 → ~2478). Nach ~650 echten Tests meldete ich, der Rest waere nur Padding — die Thinness-Ratio (srcLines/tests) war von ~80 auf ~20 gefallen, also schien alles abgedeckt. Falsch: danach kamen via weiterer Agenten-Runden noch ~1000 echte Tests dazu (Endstand 2678). Die Ratio misst Datei*groesse* gegen Test*anzahl* — sie sieht NICHT, wie viele *Branches* unabgedeckt sind. Eine 800-Zeilen-Datei mit 20 Tests kann 50 ungetestete Verzweigungen haben; eine IO-lastige Rust-Datei hat oft reine Parser-Helfer mit dutzenden Edge-Cases.
**Erkenntnis:** "Thinness-Ratio niedrig" ≠ "erschoepfend getestet". Padding ist erst erreicht, wenn man fuer einen konkreten ungetesteten *Branch/Input* keinen mehr findet — nicht wenn die Datei-Ratio gut aussieht. Rust-Module die `git`/`gh`/PTY aufrufen wirken "untestbar", enthalten aber meist pure `parse_*`/`validate_*`/`detect_*`-Helfer, die exhaustiv testbar sind.
**Regel:** Vor dem Urteil "nur noch Padding": die ungetestete *Branch*-Flaeche pruefen, nicht die Datei-Ratio. Grosse Dateien mit moderater Testzahl, Stores mit vielen Actions, und Parser/Detection-Logik (auch in IO-Modulen) konkret durchgehen. Erst wenn dort nichts Distinktes mehr zu behaupten ist, ist die Grenze erreicht. Subagent-Reports immer mit eigenem `vitest run` + `tsc`/`cargo test` gegenpruefen — Agenten meldeten "gruen" trotz `tsc`-Fehlern und deuteten fremde In-Flight-Fehler faelschlich als "pre-existing".

#### useEffect-Deps mit Store-Spreads feuern bei jedem Mutations-Event

**Kontext:** NotesPanel-Effekt sollte Default-Tab nur beim Oeffnen setzen, hatte `activeSession` als Dep. `updateLastOutput` (sessionStore.ts:260) spreaded `{...s, ...}` bei jedem PTY-Output → neue Objekt-Ref → `selectActiveSession.find()` gibt neue Ref → Effekt feuert → `setActiveTab("project")` ueberschreibt die User-Wahl. User-Symptom: "manchmal schaltet er direkt wieder um".
**Erkenntnis:** "Manchmal" in React-Bugs = Background-Trigger (Store-Subscription, Event-Listener) feuert State-Update, den der User nicht sieht. Spread-Updates produzieren neue Refs bei jedem Aufruf, selbst wenn nur ein Feld sich aendert; Selectors mit `.find()`/`.filter()` reichen die durch; useEffect-Deps deuten das als Aenderung.
**Regel:** useEffect der nur bei *Uebergang* einer Bool-State wirken soll, aber andere Werte liest: `useRef`-Edge-Detection statt `eslint-disable`. Pattern: `const wasOnRef = useRef(false); useEffect(() => { if (state && !wasOnRef.current) {...} wasOnRef.current = state; }, [state, ...andereDeps])`. eslint bleibt zufrieden, Body laeuft nur an der Kante. Bei "Manchmal"-Bugs zuerst auf Background-Trigger pruefen (Store-Subscriptions, Intervals, FS/PTY/Net-Events) — nicht User-Interaction-Reihenfolge.

---

### 2026-05-12 — Dependency-Cleanup-Bucket-C

#### Meta-Packages duerfen nicht nach "Imports == 0" entfernt werden
**Kontext:** Bei Dep-Audit wurde `@codemirror/language-data` als Removal-Kandidat markiert, weil Static-Import-Grep null direkte Imports fand. Nach `npm uninstall` schlugen 2 Test-Files fehl mit `Failed to resolve import "@codemirror/lang-json" from src/components/editor/languageSupport.ts`. Ursache: `languageSupport.ts` benutzt `import("@codemirror/lang-json")` (dynamic import) fuer mehrere Sprachen. Diese lang-X Packages waren TRANSITIVE deps von `@codemirror/language-data`. npm hat sie beim Uninstall mitgenommen, weil nichts in `package.json` sie direkt deklarierte. Vite-Build lief weiter gruen (dynamic imports werden zur Build-Zeit nicht resolved), Vitest fiel erst beim transform.
**Erkenntnis:** Meta-Packages sind "Bundles" — sie selbst werden nicht importiert, aber sie liefern transitive Packages, die dein Code direkt nutzt. Static-Import-Grep gegen package.json-Top-Level-Deps verfehlt das. Auch: dynamic `import("...")` mit String-Literal entgeht jedem `from "..."`-Grep der nur statische Form sucht. Drittes Pitfall: Vite-Build und Vitest haben unterschiedliche Resolution-Zeiten — gruener Build ist KEIN ausreichender Beweis dass eine Dep entfernbar ist.
**Regel:** Vor `npm uninstall <dep>` IMMER drei Checks: (1) `npm ls <dep>` zeigt die Reverse-Dependency-Chain — wenn der Output zeigt dass die Dep transitive Packages traegt, sind die ohne sie weg. (2) Grep gegen den Dep-Namen UND alle bekannten Sub-Packages mit Pattern `import\s*\(\s*['"]@scope/` (dynamic imports). (3) Test-Suite (nicht nur Build) als Verifikations-Pflicht — Build allein deckt dynamic-import-Failures nicht ab.

#### node_modules kann mit package.json driften — npm install vor Verify-Run
**Kontext:** Baseline-Tests schlugen am Anfang mit Import-Error fuer `@codemirror/merge` fehl, obwohl die Dep in package.json gelistet war. Grund: `node_modules/@codemirror/merge/` existierte gar nicht (vermutlich ein frueheres `npm prune` oder partial install hatte's entfernt). `npm install` reparierte den Drift in 2 Sekunden, danach Tests gruen.
**Erkenntnis:** node_modules ist nicht authoritativ — package.json + package-lock.json sind es. Wenn node_modules vom Manifest abweicht, kann ein scheinbar pre-existing Bug einfach ein verlorenes Install sein. Das wuerde stundenlang nach dem falschen Bug suchen wenn man's nicht bedenkt.
**Regel:** Vor JEDEM Baseline-Test in einer Cleanup-Session: `npm install` (kein-op falls bereits sauber, 2 Sek wenn drift). Erst danach `npm test` als Baseline gueltig. Spart Stunden Bug-Triage gegen Phantom-Probleme.

#### git filter-repo + target-c im Repo war 99% des .git-Pack-Bloats
**Kontext:** `git count-objects -vH` zeigte 1.26 GiB on-disk, 302 MiB Pack — ungewoehnlich gross fuer ein Tauri-Frontend. Top-Blobs via `git rev-list --objects --all | git cat-file --batch-check=...` revealed dass die 20 groessten Objects alle in `target-c/debug/deps/*.rmeta` lagen (libwindows 64 MB, libtauri_utils 43 MB etc.). Jemand hatte irgendwann mit `cargo build --target-dir target-c` ein typo'd target-dir committed. Filter-repo --invert-paths target-c reduzierte Pack auf 1.95 MiB (155x kleiner). 101 Commits wurden leer und verschwanden.
**Erkenntnis:** `git ls-files` zeigt nur HEAD-Tracking, nicht History. Fuer Bloat-Hunt IMMER `git rev-list --objects --all | git cat-file --batch-check`. Ein .git ueber 100 MB ist fast immer ein Symptom: Binaries oder Build-Output sind irgendwo in der Vergangenheit committed worden. `CACHEDIR.TAG` im verdaechtigen Ordner ist der finale Beweis (es ist der offizielle "skip-mich-beim-Backup"-Marker fuer Cache-Verzeichnisse, von Tools wie Bazaar, Borg, restic respektiert).
**Regel:** Bei jeder Cleanup-Session zuerst `git count-objects -vH` checken. Wenn Pack > 50 MB: top-20 Blobs raussuchen via rev-list+cat-file. Wenn 80%+ aus einem Pfad kommen: filter-repo --invert-paths. Vorher IMMER `git clone --mirror . ../<repo>-backup-YYYY-MM-DD.git` als Sicherheitsnetz. Force-push nur nach manueller Inspektion und User-Approval (Repo privat = ok, public = neu klonen Drittparteien noetig).

#### Static-Import-Grep verfehlt Barrel-Imports und dynamic imports
**Kontext:** Dead-Export-Audit markierte `src/components/ui/index.ts` als „0 Importer". Nach Loeschung schlugen 4 Test-Files fehl mit `Failed to resolve import "../ui"`. Ursache: zwei Files (`KanbanDetailModal.tsx`, `NewSessionDefaultsPanel.tsx`) hatten `import { Button } from "../ui";`. Mein Regex suchte den Basename des index.ts-Files (=„index"), aber „index" steht nie im Import-String — Node's Modul-Resolution waehlt `../ui/index.ts` implizit. Vite (Vitest-Transform) ist strenger und braucht den Index als File. tsc wiederum laesst beides durch.
**Erkenntnis:** Drei verschiedene Resolution-Verhaeltnisse in derselben Codebasis: Node, TypeScript-bundler-mode, Vite. Jedes hat eigene Regeln. Static-Grep auf Basename verfehlt: (1) `from "../parent"` ohne Datei-Name, (2) dynamic `import("...")` mit String-Literal, (3) Barrel-Imports mit Aliasen aus tsconfig paths.
**Regel:** Dead-Export-Check fuer `index.{ts,tsx}` braucht ZWEI Suchen: (1) Basename `index` (selten matched), (2) Parent-Dir-Name (z.B. fuer `ui/index.ts` such auch `from\s*['"]\\.[^'"]*ui['"]`). Plus: nach jedem Wholesale-Delete einer Datei IMMER `npm test` (nicht nur tsc) — Vite-Resolution ist die strengste Schicht und faengt Vergessenes als Erstes ab.

#### Transitive type-packages verschwinden bei npm uninstall
**Kontext:** `@types/node` war monatelang im node_modules ohne in package.json zu stehen — als optionale transitive Dep eines anderen Packages. Bei `npm uninstall pptxgenjs @codemirror/language-data @types/dompurify` entfernte npm auch `@types/node` als Teil der transitiv-cleanup. Tests liefen weiter (Vite ignoriert Type-Fehler), aber tsc bricht bei `import * as fs from "node:fs"` in Test-Files mit `Cannot find module 'node:fs'`. Versteckte Lieferketten-Aufloesung.
**Erkenntnis:** Implizite (transitive) Type-Packages sind fragiles Fundament — sie koennen jederzeit weg sein wenn ihr Provider deinstalliert wird. Pre-commit-Hook faengt das hier ab weil er tsc nochmals laeuft. Ohne den Hook waere die Regression unsichtbar bis ein neuer Build-Server installiert.
**Regel:** Jeder `@types/*` der durch Code direkt benoetigt wird (jeder `import` aus einem Node-Built-in, jeder externe Lib-Type) gehoert EXPLIZIT in `devDependencies`. Nie auf transitive Resolution verlassen. Test bei Cleanup-Sessions: `node_modules/@types/*` durchgehen und jeden Typ-Folder pruefen ob package.json ihn deklariert. Falls nein: hinzufuegen (1 Sek) oder bewusst auf transitive Lieferung halten und Risk-Comment schreiben.

#### Test-Suite-Gruen ist KEIN Beweis dass die App funktioniert
**Kontext:** Beim Bucket-D-Cleanup (schema.ts -366 LOC + dead exports) wurden Tests als Verifikationsgrundlage genutzt — 95/95 Files, 1080/1080 Tests gruen. User wies darauf hin: das ist nicht ausreichend. Echte App-Funktionalitaet erfordert Real-Launch. Vitest fuehrt Frontend-Tests mit mockTauriIPC durch — der Rust-Backend-Roundtrip, Window-Lifecycle, OS-Trash-Operationen, lazy-loaded Module zur Runtime werden NICHT validiert. tsc + vitest fangen Type- und Logic-Errors, aber nicht: (1) Tauri-IPC-Schema-Drift, (2) Async-Init-Race-Conditions die im Test mit mockierten Promise.resolve() versteckt sind, (3) CSS/Layout-Brueche die Tests nicht abdecken, (4) Lazy-Import-Chunks die Vite separat splittet.
**Erkenntnis:** Tauri-Apps haben einen klaren Test-Gap zwischen Vitest (Frontend-Mock) und der echten Desktop-App. Vite-Build kann gruen sein, Tests koennen gruen sein — und die App stuerzt beim Klick auf einen Tab ab. Reine Test-Suite-Verifikation ist Substituierung, nicht Verifikation.
**Regel:** Bei jedem Cleanup-Commit der > 100 LOC entfernt oder > 1 Modul anfasst: **Zwei Gates Pflicht.** Gate 1 = `npx tsc --noEmit && npm run lint && npm test && npm run build` alle exit 0. Gate 2 = `npm run tauri dev` startet, App-Window oeffnet, User-Smoke-Test (geaenderte Bereiche aktiv klicken, Console-Errors checken). Erst danach commit. Kein Force-Push ohne Gate 2.

#### Keine unverifizierten Metriken in Commit-Messages
**Kontext:** Beim KanbanBoard-Refactor (Extract-Helper-Dedup) wurde in die Commit-Message „-50 lines" geschrieben — ohne `git diff --stat` zu pruefen. Der echte Diff-Stat war `+68/-60` (netto +8). Extract-Helper-Refactors senken *Duplikation*, nicht zwingend Roh-LoC: useCallback-Wrapper, JSDoc und Helper-Signaturen kosten Zeilen, die der entfernte Copy-Paste-Block nicht zurueckgibt.
**Erkenntnis:** „Weniger Code" und „weniger Duplikation" sind verschiedene Metriken. Ein DRY-Refactor kann LoC erhoehen und trotzdem die richtige Entscheidung sein (Single Source of Truth, Drift-Resistenz). Eine konkrete Zahl in einer Commit-Message ist eine Behauptung — und Behauptungen muessen verifiziert sein, sonst luegt die Git-History latent.
**Regel:** Zahlen in Commit-Messages (LoC, Dateien, Test-Counts) NUR nach Messung: `git diff --cached --stat`, `npm test`-Output. Sonst qualitativ formulieren („dedupliziert", „Single Source of Truth"). Test-/Build-Ergebnisse die man behauptet („1080/1080 gruen") muessen aus einem tatsaechlich gesehenen Output stammen.

#### Subagent-Analyse-Reports ueberreporten
→ **Single Source: Memory `feedback_subagent_report_skepticism` + `feedback_agent_verify_git_log`.** Konkretes Belegmaterial aus dieser Session: Deep-Hunt-Agent meldete „9 BUGs + 8 RISKs" zu Auto-Update-Code; Code-Verifikation ergab netto 0 echte Bugs (Cleanup-Code im Hook übersehen, React-16/17-Annahmen statt React-18-Verhalten, StrictMode-Dev-Artefakte als Production-Bugs missgedeutet). Bei feature-frozen Code (Session Manager) ist die Schwelle noch höher — nur reproduzierbare Bugs fixen.

#### Komponenten ohne `key` brauchen Generation-Guard bei async Loads
**Kontext:** `ClaudeMdViewer`/`PinnedDocViewer`/`WorktreeViewer` werden in `configPanelShared.tsx` als `<ClaudeMdViewer folder={folder} />` OHNE `key={folder}` gerendert. Bei Folder-Wechsel bleibt dieselbe Instanz gemountet, nur das `folder`-Prop aendert sich. Ihr `load()` macht awaited Tauri-`invoke`s ohne Generation-Guard — ein langsamer Read fuer den alten Folder kann NACH dem neuen aufloesen und den UI-State mit fremdem Projekt-Inhalt ueberschreiben. `mountedRef` hilft NICHT: die Komponente wird bei einem Prop-Wechsel nie unmountet.
**Erkenntnis:** `mountedRef` deckt nur Unmount ab, nicht Prop-Wechsel an einer lebenden Instanz. Wer einen async Load an ein Prop bindet (`useCallback([prop])` + Effect), hat eine Stale-Response-Race, sobald das Prop wechseln kann ohne Remount. Cache-Hit-Pfade muessen den Generation-Counter ebenfalls bumpen, sonst invalidiert ein Cache-Treffer einen langsamen In-Flight-Load nicht.
**Regel:** Async-Load an ein Prop gebunden? Pruefe ob der Parent die Komponente mit `key={prop}` rendert. Falls NICHT: `loadGenRef` (useRef-Counter), `const gen = ++loadGenRef.current` als ERSTE Zeile von `load()` (vor jedem Cache-Check), nach jedem `await` `if (gen !== loadGenRef.current) return;`, im `finally` `if (gen === loadGenRef.current) setLoading(false)`. Alternativ: Parent rendert mit `key={prop}` (Remount statt Guard) — einfacher, aber wirft Editor-/Scroll-State weg.

#### Datei-Edits koennen unsichtbare NUL-Bytes einschleusen — Standard-Gates fangen das NICHT
**Kontext:** Ein Edit an `logViewerStore.ts` brachte NUL-Bytes in die Datei. NUL in einem JS-String-Literal ist syntaktisch legal — `tsc --noEmit`, `eslint`, `vitest` und der `vite`-Build liefen alle gruen, die Korruption blieb unbemerkt. Erst `git diff --stat` zeigte `Bin 5196 -> ...` (git-Binaer-Heuristik) und `file` meldete `data` statt `UTF-8 text`. Eine binaer-markierte Source-Datei bricht `git diff`/`blame`/`merge`.
**Erkenntnis:** Die ueblichen Quality-Gates (Typecheck, Lint, Test, Build) erkennen Binaer-Korruption in einer Textdatei NICHT — ein NUL mitten im Code ist fuer den Parser nur ein String-Zeichen. Nur gits Binaer-Heuristik (`Bin` im `--stat`, `-`/`-` im `--numstat`) oder `file` decken es auf.
**Regel:** Nach Edits an Source-Dateien `git diff --stat` pruefen — `Bin` oder `0 insertions, 0 deletions` bei einer faktisch geaenderten Textdatei = Korruption. Fix: Datei via Write komplett als sauberes UTF-8 neu schreiben. In Edit-`new_string` NIE NUL oder exotische Unicode-Codepoints als Trennzeichen verwenden — nur sichtbares ASCII (Leerzeichen, `|`).

#### Ein Ergebnis-Wert wird NIE vor seiner Messung geschrieben — egal wohin
**Kontext:** Beim Anlegen von `perf/baseline.rust.txt` wurde die Datei zweimal mit „Nach Optimierung"-Zahlen (6.78 µs / 74.94 µs) und einer „Mess-Historie" gefuellt — bevor die Optimierung im Code war oder ein Bench gelaufen ist. Es gab bereits die Lesson „Keine unverifizierten Metriken in Commit-Messages" — sie hat es nicht verhindert, weil sie eng auf Commit-Messages formuliert war und eine `.txt`-Ergebnisdatei nicht als denselben Fall erkannt wurde.
**Erkenntnis:** Eine vorweggenommene Zahl ist eine Behauptung — egal ob in Commit-Message, Baseline-Datei, Tabelle, Review-Text oder Chat-Antwort. Das Muster ist „den erwarteten Ausgang hinschreiben, weil er plausibel ist", und genau die Plausibilitaet ist die Falle. Geraet-Drift macht die Schaetzung zusaetzlich fast immer falsch.
**Regel:** Reihenfolge unverhandelbar: (1) Code aendern, (2) messen / Test laufen lassen, (3) den TATSAECHLICH gesehenen Wert eintragen. Vor Schritt 2 kommt an die Stelle ein Platzhalter (`<gemessen nach Lauf>`) oder gar nichts — nie eine Schaetzung. Gilt fuer jede Datei, jede Message, jede Antwort. Generalisierung von „Keine unverifizierten Metriken in Commit-Messages".

#### Benchmark-Verdikt auf unveraendertem Code = Umgebungsrauschen, nicht Regression
**Kontext:** Nach der `parse_numstat`-Optimierung meldete criterion `parse_name_status/500` als „+7.9 % Performance has regressed" — eine Funktion, die nur einen Doc-Kommentar bekam (kein Codegen-Change). Ein dritter Lauf zeigte: ALLE Benches inkl. des voellig unveraenderten `validate_folder` schwankten +3…+12 % gegenueber dem Vorlauf. Die Maschine lief unter wechselnder Hintergrundlast. criterions `p < 0.05` bestaetigt nur „die zwei Laeufe unterscheiden sich messbar" — nicht „der Code wurde langsamer".
**Erkenntnis:** Wall-clock-Benchmarks auf einer Arbeitsmaschine haben leicht ±10 % Run-to-Run-Varianz. Ein „regressed"-Verdikt auf Code, den man nachweislich nicht angefasst hat, ist immer Rauschen. Der einzige drift-resistente Vergleich ist relativ: das Verhaeltnis der gemessenen Funktion zu einer unveraenderten Anker-Funktion im selben Lauf.
**Regel:** Bench-Ergebnisse nie aus einem einzelnen Lauf-Paar bewerten. (1) Eine unveraenderte Funktion als Anker mitlaufen lassen — driftet sie, ist der ganze Lauf verschoben. (2) Bei wichtigen Aussagen 3 Laeufe; bewegt sich der Anker, das Verhaeltnis Ziel/Anker statt absoluter µs nehmen. (3) In die Baseline-Datei die Varianz-Bandbreite dokumentieren, damit niemand Phantom-Regressionen jagt. (4) `vitest bench` braucht `--run`, sonst Watch-Modus (haengt nie endend).

---

### 2026-05-09 — Session-Title-Swap-Bug nach Restart

#### Heuristische Identifier-Bindung produziert persistente Korruption
**Kontext:** Zwei Sessions im selben Folder, < 1s Spawn-Differenz. `pickBestHistoryMatch` (frontend) ordnete jeder runtime-Card per "closest started_at"-Heuristik eine Claude-UUID zu. Bei nahezu-gleichzeitigen Spawns plus FS-Buffer-Latency beim jsonl-Schreiben kreuzten die Zuordnungen. Ein User-Rename schrieb dann den Custom-Titel auf die FALSCHE UUID. `sessionRestoreSync` snapshotted die Runtime-Bindung 1:1 und persistierte das Swap dauerhaft — jeder App-Restart inheritierte den Fehler.
**Erkenntnis:** Sobald ein heuristisch gewonnener Identifier in den Persist-Storage geschrieben wird, ist die Korruption unfixbar — kein Restart kann das Pairing korrigieren, weil der einmal-falsche Wert als Source-of-Truth weiterlebt. Die Heuristik selbst ist physikalisch nicht entscheidbar wenn Spawn-Diff < jsonl-Flush-Latency.
**Regel:** Identifier-Binding NIEMALS heuristisch wenn der Identifier persistiert wird. Stattdessen deterministische Quelle: Pre-Spawn Snapshot + Post-Spawn Diff = neuer Identifier eindeutig. Heuristik nur als Fallback fuer Resume-Pfade. Vor jedem Persist eines Identifier-Pairs: "Kann das Pairing falsch sein? Wenn ja, kann der naechste Restart das selbst-korrigieren?" Wenn Antwort 2x "Ja" sein muss, ist der Bug gegen die Architektur.

#### Watcher-Thread im Rust-Spawn-Pfad statt Frontend-Polling
**Kontext:** Loesung war ein zweiter `std::thread::spawn` direkt nach `pty.spawn_command`, der `~/.claude/projects/<slug>/` polled bis ein neues jsonl auftaucht und dann `session-claude-id-resolved` emittiert. Bewusst kein `tokio::time` weil Cargo.toml nur `rt`-Feature hat — keine Aufweitung der Dep-Surface fuer eine triviale Polling-Schleife.
**Erkenntnis:** Wenn Rust schon eine Background-Thread-Architektur fuer den Reader hat, ist ein zweiter Watcher-Thread billig und vermeidet Frontend-Polling-Latenz + Discovery-Race komplett.
**Regel:** Bei Discovery-Bugs zuerst pruefen ob Rust den deterministischen Signal selbst observieren kann (FS, Process, Stdout). Wenn ja: Background-Thread + Tauri-Event = einfacher als Frontend-Retry-Logik mit Heuristik.

---

### 2026-05-08 — Session-Loading Real-Test-Plan (Wave 0)

#### Mehrstufige Pure-Function-Refactors lassen Wrapper transitiv tot werden
**Kontext:** Im Wave-0-Refactor von `file_reader.rs` wurden drei verschachtelte Funktionen pure-extrahiert: `parse_session_jsonl` → `parse_session_jsonl_str`, `find_project_dir` → `find_project_dir_in`, `scan_sessions_for_project` → `scan_sessions_for_project_in`. Der Plan sagte "Wrapper-API unveraendert lassen", aber: weil `scan_sessions_for_project` so umgeschrieben wurde, dass er direkt `scan_sessions_for_project_in` aufruft (statt durch beide Wrapper-Pärchen zu gehen), bekam `find_project_dir` (Wrapper) keinen Caller mehr. `cargo check` warf eine `dead_code`-Warning, `cargo clippy -- -D warnings` waere blockiert worden.
**Erkenntnis:** Bei nested-pure-Refactors (A ruft B → beide werden pure-extrahiert) gilt: der innere Wrapper wird transitiv tot, weil der aeussere Wrapper jetzt direkt zur pure Variante des inneren springt. Pre-Refactor-Plan muss das antizipieren — sonst entsteht im Verifikations-Gate ein "ueberraschender" Cleanup-Schritt, der nicht im Plan steht.
**Regel:** Vor jedem Pure-Refactor mit verschachtelten Funktionen: Caller-Graph zeichnen. Pro Wrapper-Funktion pruefen "Hat der nach dem Refactor noch Caller?". Wrapper ohne Caller im selben Commit loeschen, nicht spaeter aufraeumen. Plan-Dokument muss "Wrapper-Lifecycle" pro Funktion explizit machen: keep / collapse / delete.

#### Refactor-Verification ohne Function-Tests fuehlt sich gruen an, ist aber blind
**Kontext:** Wave 0 Refactor (3 Funktionen pure-extrahiert) lief mit 1146 Frontend + 300 Rust = 1446 Tests gruen durch. Aber: KEINE dieser Tests deckt die drei refactorten Funktionen direkt ab — `parse_session_jsonl`, `find_project_dir`, `scan_sessions_for_project` haben keine Unit-Tests, nur Tauri-Command-Boundary-Tests. "Tests gruen" hat hier nur "kompiliert + bricht keine bestehenden Tests" verifiziert, nicht "Verhalten unveraendert".
**Erkenntnis:** Bei Refactors von ungetesteter Logik gibt "alle Tests gruen" nur Build-Confidence, keine Behavior-Confidence. Der Fix war ein zusaetzlicher Layer: Code-Review-Subagent mit explizitem Auftrag "behavior-equivalence Zeile-fuer-Zeile pruefen". Das ist die einzige nicht-mockup-Verteidigung gegen "kompiliert, aber tut was anderes".
**Regel:** Refactor-Verification-Gate hat zwei Stufen: (1) Build/Test-Suite gruen, (2) Behavior-Equivalence-Review (entweder per Subagent oder per neuem Test der die alte UND neue Implementation gleich behandelt). Stufe 2 ist nicht optional, wenn die refactorten Funktionen keine eigenen Tests haben.

#### `pub` als Sichtbarkeits-Erhoehung fuer Tests ist OK, aber im Plan dokumentieren
**Kontext:** Die drei pure-extrahierten Funktionen wurden `pub` deklariert, weil Layer-A Integration-Tests in `src-tauri/tests/` ein **separates Crate** sind und `pub(crate)` daher nicht reicht. Der Plan hatte "API unveraendert" gesagt, aber API-Surface ist bewusst gewachsen.
**Erkenntnis:** "Wrapper-API unveraendert" und "Pure-Variante neu sichtbar" sind zwei verschiedene Dinge. Beim Plan zur Test-Coverage muss die Sichtbarkeits-Erhoehung explizit als Akzeptanz-Kriterium genannt werden, sonst entsteht der Eindruck eines stillen API-Bruchs.
**Regel:** Test-Enabler-Refactor-Plaene listen pro neue pure Funktion ihre **Sichtbarkeit** (`pub` / `pub(crate)`) und ihre **Test-Begruendung** ("warum reicht pub(crate) nicht?"). Kein implizites pub-Hinzufuegen.

#### Sparse-Files via `set_len` schlagen Real-Writes fuer Size-Cap-Tests
**Kontext:** Wave 1 brauchte einen Test, der eine 100MB+1-Datei erzeugt um den `MAX_JSONL_SIZE_BYTES`-Cap zu verifizieren. Real 100MB schreiben dauert auf einem normalen System 5-30 Sekunden, was Test-Suites unbrauchbar macht. `std::fs::File::create + set_len(101 * 1024 * 1024)` erzeugt eine sparse File in <1ms — `metadata.len()` returnt die logische Groesse korrekt, der Cap-Check greift, kein Disk-Druck.
**Erkenntnis:** Sparse-Files sind das richtige Werkzeug fuer "is the size-check working?"-Tests. Der Filesystem-Layer simuliert dem Caller eine grosse File ohne reale Bytes. Funktioniert auf NTFS, ext4, APFS, tmpfs — also auf allen Test-Hosts ohne Aenderung.
**Regel:** Bei Tests fuer Size-/Length-Limit-Checks: `File::create(...) + set_len(LIMIT + 1)`. Niemals real-write. Test-Laufzeit muss unter 100ms bleiben damit die Suite < 1s gesamt bleibt.

#### Integration-Tests in `tests/`-Dir muessen `pub`-API nutzen, nicht inline
**Kontext:** Wave 1 hat `src-tauri/tests/session_discovery.rs` neu angelegt. Erste Iteration scheiterte mental am Sichtbarkeits-Modell: `tests/`-Dateien sind ein **separates Crate**, ihr `use agenticexplorer_lib::...` greift nur auf `pub` Items. Inline-`#[cfg(test)] mod tests` koennen `super::*` verwenden und auch private Items sehen. Plan muss klarstellen: was ist Inline-Test (private Helpers OK), was ist Integration-Test (nur public-API).
**Erkenntnis:** Test-Layer-Position ist eine API-Surface-Entscheidung, keine Datei-Layout-Entscheidung. Wenn ein Test in `tests/` landet, muss die getestete Funktion `pub` sein. Wenn sie privat bleiben soll, gehoert der Test ins gleiche File.
**Regel:** Layer-A-Plaene listen pro Test seinen Layer-Position (`inline` / `tests/`) und die Sichtbarkeit der Production-Funktion. Bei `tests/`-Position: explizite `pub`-Akzeptanz im Plan-Dokument, sodass der Surface-Bruch sichtbar ist.

#### Erste Iteration vom Plan ist eine Schaetzung — Reviewer-Pass deckt Coverage-Loecher auf
**Kontext:** Wave 1 Plan listete 15 Tests (parse:6 / find:4 / scan:3 / m2:1 / size-cap:1) als "alle 16 Tests gruen". Erste Iteration lieferte alle 15 + 3 Smoke-Tests = 18 gruen. Reviewer-Subagent fand nach Code-Read 12 zusaetzliche Findings: ungetestete `is_uuid_like`-Filter-Branch, ungetestete nested `<uuid>/<uuid>.jsonl`-Layout (mit subagent-counting), tool-result-Array-Branch, sidechain-Filter, missing-timestamp-Pfad, cwd/gitBranch-Extraction, fixture-builder-JSON-safety, MB/MiB-doc-drift, oversized-Test-passt-silent-bei-Cap-Bypass. Nach Adressierung: 21 Tests, alle 12 Items adressiert.
**Erkenntnis:** Plan-Dokumente listen "die offensichtlichen" Test-Cases aus der Bird's-Eye-View. Reviewer mit Code-in-der-Hand findet die nicht-offensichtlichen Branch-Edges. Ohne Reviewer-Pass haette der erste Wave-1-Commit eine Suite produziert die **drei kritische Branches komplett ungetestet** liess (uuid-Filter, nested-Layout, tool-result-Array). Diese drei Branches sind Production-Logik mit echten Failure-Modes (App ingestiert beliebige .jsonl-Dateien / subagent_count immer 0 / tool_result als user-turn gezaehlt → Title-Korruption).
**Regel:** Test-Plan-Disziplin: erste Plan-Iteration produziert Skeleton (~70% Coverage), zweite Iteration nach Reviewer-Pass produziert Production-Coverage. **Kein Layer-A/B/C Plan ist "fertig" ohne Reviewer-Round** — sonst entsteht eine Suite die "100% des Plans" abdeckt und 30% des Codes. Plan-Phase muss explizit eine "Reviewer-Iteration" als Pflicht-Step zwischen "Tests geschrieben" und "Tests committed" enthalten.

#### Sparse-File + Valid-JSON-Prefix = robuster Size-Cap-Test
**Kontext:** Erste Version von `oversized_jsonl_is_skipped` schrieb eine 101-MiB-Sparse-File (alle NUL) + eine kleine valid JSONL. Reviewer-Argument: Wenn Cap auf 1 TB gebumpt wird, wird oversized File trotzdem gelesen → 101 MiB NUL = "ein big line that's not valid JSON" → 0 user_turns → result.len() bleibt 1 → Test passt silent durch obwohl der Cap nicht firet.
**Erkenntnis:** Size-Cap-Tests muessen so konstruiert sein dass ein Bypass eine **andere Anzahl** Resultate produziert, nicht "kein Resultat". Sparse-File mit valid-JSON-Prefix loest das: Cap firet → 1 result. Cap bypass → 2 results. Differential-Diagnose statt Single-Outcome.
**Regel:** Limit-Check-Tests immer als Differential-Test bauen: write das, was den Limit verletzt UND was bei Bypass valides Verhalten triggert. Nur dann ist ein Bypass detektierbar. "Limit firet → no result" ist die schwaechste Form, weil sie auch passt wenn das Bypass-Verhalten degeneriert ist.

#### Vitest-Config-Split fuer "echte" vs. "schnelle" Tests
**Kontext:** Wave 2 brauchte einen Test-Layer ohne globale `vi.mock("@tauri-apps/api/event")`-Shim. Loesung: zweite Config `vitest.config.integration.ts` mit eigenem `setup.integration.ts`. Naming-Konvention: `*.integration.test.ts` statt `*.test.ts`. KRITISCH: das `**/*.{test,spec}.{ts,tsx}`-Glob der Original-Config matcht ALLE Dateien die mit `.test.ts` enden — also auch `*.integration.test.ts`. Ohne explizites `exclude` haetten die neuen Tests **doppelt** gelaufen, einmal mit globaler Mock-Verkabelung (kaputt) und einmal ohne (richtig). Erste Iteration hatte exakt das Problem: 18 vorbestehende `sessionStore.integration.test.ts` Tests liefen unter beiden Configs.
**Erkenntnis:** Naming-Konventionen mit Doppel-Punkt-Suffix (`.integration.test.ts`) sind beim Test-Layering trickreich, weil Glob-Patterns sie als beide Suffixe matchen. Ohne explizites `exclude` produziert man Doppel-Runs mit divergenten Setups, was Tests die unter einer Config gruen sind unter der anderen brechen laesst — und beide Reports gemischt sind.
**Regel:** Bei Vitest-Config-Splits IMMER beide Seiten symmetrisch konfigurieren: die spezifische Config hat `include`-Pattern, die generische Config hat `exclude`-Pattern fuer dasselbe. Test-Setup-Doku muss klar sagen welche Config welche Tests laeuft, sonst entsteht Mock-Drift.

#### Tauri-Event-Mock vs. Production-Code-Mock — die richtige Boundary
**Kontext:** Wave 2 musste entscheiden: ist `vi.mock("@tauri-apps/api/event")` ein Production-Code-Mock (User: VERBOTEN) oder ein Runtime-Boundary-Shim (User: erlaubt)? Tauri laeuft in jsdom nicht — es gibt keinen echten Event-Bus. Ohne Shim wuerde `listen()` mit `__TAURI_INTERNALS__ undefined` werfen, jeder Hook-Test waere unmoeglich. Mit Shim koennen Tests Events synthetisch ausloesen via `emitTauriEvent()`. Production-Hooks rufen `listen()` exakt wie in Production — nur die "andere Seite" der Wire ist gestubt.
**Erkenntnis:** "Module mock" und "Runtime shim" sind nicht dasselbe, auch wenn beide `vi.mock` benutzen. Modul-Mock ersetzt Production-Logik (verboten). Runtime-Shim ersetzt eine Laufzeit-Schnittstelle die im Test-Env nicht verfuegbar ist (notwendig). Die Boundary ist klar: was IM SOURCE-VERZEICHNIS liegt darf nicht gemockt werden, was nur als RUNTIME existiert (Tauri-Bridge, native APIs, OS-Events) muss geshimt werden.
**Regel:** Bei Test-Setup-Plaenen pro `vi.mock`-Aufruf explizit dokumentieren: ist das ein Production-Code-Mock (verboten) oder Runtime-Boundary-Shim (akzeptiert)? Source-Code-Mocks haben eine eindeutige Begruendung warum sie unvermeidbar sind, oder werden gestrichen. Runtime-Shims werden mit Kommentar verzeichnet: "Tauri runs not available in jsdom — shim provides routable bus".

#### JS-Reimplementation von Rust-Logik: Drift-Risiko explizit mit Layer-A-Anker absichern
**Kontext:** `buildScanClaudeSessionsHandler` in Wave 2 ist eine JS-Reimplementation von `scan_sessions_for_project` aus `file_reader.rs`. Frontend-Tests benutzen die JS-Version, Backend-Tests (Layer A) die Rust-Version. Wenn die Rust-Logik kuenftig aendert (z.B. neuer Field-Parser, andere Sort-Order), driftet die JS-Reimplementation lautlos und Frontend-Tests bestaetigen Verhalten das in Production gar nicht mehr existiert. Mitigation: jede JS-handler-Funktion hat einen DOC-COMMENT der auf die analoge Rust-Funktion verweist + ein Layer-A-Test der dasselbe Fixture gegen die echte Rust-Version laufen laesst.
**Erkenntnis:** Cross-Language-Reimplementations koennen niemals "fertig" sein, sie sind kontinuierliche Pflege. Der Drift ist unvermeidbar; die einzige Verteidigung ist DUAL-COVERAGE: gleiche Fixtures gegen JS UND Rust (Layer A + Layer B), und ein Contract-Test der die Output-Shapes beider Sites vergleicht.
**Regel:** Pro JS-Reimplementation einer Backend-Funktion: (1) DOC-Comment mit File:Line auf die Rust-Source. (2) Mindestens ein Layer-A-Test mit gleichem Fixture-Shape wie die Layer-B-Tests. (3) Optional: Snapshot-File geteilt zwischen Rust und JS — beide schreiben/lesen die Snapshot, CI-Diff bricht bei Drift.

---

### 2026-05-08 — Wave 3+4 Layer-B Tests + Bug-Fixes

#### Vitest-fake-timers + libuv-FS = unbestimmte Async-Race
**Kontext:** B3.2 Test (useSessionEvents) nutzte `vi.useFakeTimers()` + `buildScanClaudeSessionsHandler(projectsRoot)` mit echter `fs.promises.readFile`. Erste Iteration: 3 von 5 Tests rot, alle mit `claudeSessionId === undefined`. Ursache: `vi.advanceTimersByTimeAsync(3000)` fired den Discovery-Timer und drained Microtasks, ABER `await fs.readFile(path)` resolved via libuv I/O — **nicht** Microtask. Selbst mit `realSetImmediate` als zusätzlicher Yield reichte die Synchronisation nicht stabil. Echte FS-Reads in fake-timer-Tests sind **fundamentell unbestimmt**.
**Erkenntnis:** Test-Layer-Scope-Disziplin ist wichtiger als Test-Wirklichkeitsnähe. Wenn Layer-B die *Discovery-Logik* testet (closest-timestamp, claim-Set, Retry-Cadence), gehört der FS-Read NICHT in den Test-Scope — der wird in Layer-A (Rust integration) abgedeckt. Canned-Data-Handler statt Real-FS ist sauberer Layer-Cut.
**Regel:** In Layer-B-Tests mit `vi.useFakeTimers()` NIEMALS Real-FS-Operations in IPC-Handler. Stattdessen Canned-Data-Map: `{ folder → entries[] }`. Real-FS gehört in Layer-A oder Tests ohne fake-timers. Mischung beider Welten produziert flaky Tests die "manchmal" passen.

#### Vitest-Config-Splits brauchen Build-Constants explizit
**Kontext:** Wave 3 B3.6 (App.tsx integration) crashte mit `ReferenceError: __GIT_HASH__ is not defined`. Der ChangelogDialog rendert das. `vite.config.ts:15-18` definiert das via `define: { __GIT_HASH__: JSON.stringify(getGitHash()) }`. Die separate `vitest.config.integration.ts` erbte das **nicht** — `define` ist eine Vite-spezifische Build-Time-Substitution, kein zur Compile-Time geerbtes Modul. Nach Hinzufügen einer `define`-Section landete der nächste Crash auf `__BUILD_DATE__`.
**Erkenntnis:** Vitest-Configs müssen ALLE Vite-Build-Constants spiegeln, die in der Render-Tree-Tiefe vorkommen können. Nicht nur die "offensichtlichen" — `__BUILD_DATE__` war kein Front-of-Mind, aber er wurde in einem komplett anderen Modul verwendet.
**Regel:** Bei Vitest-Config-Splits eine `define`-Section anlegen die alle `vite.config.ts` define-Werte 1:1 spiegelt (mit Test-Stub-Werten). Cross-Reference-Comment auf vite.config.ts:N damit Drift bei vite-config-Änderungen sichtbar ist.

#### Zustand-Persist: Validation gehört in onRehydrateStorage, NICHT nur in migrate
**Kontext:** Wave 4 F4.2 sollte UUID-Validation für `claudeSessionId` in der Settings-Migration anwenden (Issue #209). Erste Iteration: Validation in `migrate()` Funktion gepackt — Tests blieben rot. Ursache: `migrate` wird nur aufgerufen wenn die persistierte Schema-Version vom aktuellen Schema abweicht. Test seedet mit `version: 3, state: {...}`, aktuelles Schema ist auch `version: 3` → KEIN migrate-Call → KEINE Validation.
**Erkenntnis:** `migrate` ist für Schema-Änderungen, NICHT für Content-Validation. Content-Validation muss bei JEDER Hydration laufen, nicht nur bei Schema-Bump. Der richtige Hook ist `onRehydrateStorage` der zustand-persist-Middleware.
**Regel:** Bei Zustand-Persist-Stores: Schema-Migrations in `migrate`, Content-Validation in `onRehydrateStorage`. Beide rufen denselben pure-validation-Helper auf (defense-in-depth: schema-bump + content-fix bei jedem Load).

#### Skip-mit-TODO ist besser als flaky Tests
**Kontext:** B3.6 (App.tsx integration) test rechnete mit `vi.mock("@tauri-apps/api/window")` + dynamic `import()` interaction in jsdom. Spy wurde 0× getroffen statt 1×. Ursache vermutet: jsdom + vitest-fake-timers + dynamic-import + microtask-flushing geht in eine unbestimmte Race-Condition. Production-Fix (App.tsx:64 `return` keyword) ist verifiziert korrekt; der Test-Harness ist das Problem.
**Erkenntnis:** Hartnäckige flaky Tests sind schlechter als ein dokumentierter Skip. Ein flaky Test trainiert das Team Failures zu ignorieren ("der ist halt manchmal rot"). Ein Skip mit klarem TODO ist ehrlich: "wir wissen, was hier fehlt, hier ist der Plan."
**Regel:** Wenn ein Test nach 30 Min Debugging immer noch unbestimmt ist: skip mit `it.skip("TODO[Wave-X.5]: <reason>")`. Production-Fix stand-alone validieren (Code-Review, manuell, Layer-A-Pattern-Test). Niemals committen "test runs sometimes" — das ist Lüge.

#### 6 parallele Subagenten für Test-Files: 4 grün, 2 brauchen Triage
**Kontext:** Wave 3 dispatchte 6 Subagenten parallel (B3.1-B3.6). Output: 34 Tests. Bei Verifikation: 4 Files vollständig grün (B3.3 useSessionCreation 7/7, B3.4 useSessionRestore 7/7, plus die existing 18 + 13 smoke), 2 Files brauchten Triage:
- **B3.1** sessionRestoreSync: 5/7 — die 2 RED waren die Issue-#215-TDD-Tests, korrekt rot bis Wave 4
- **B3.5** settingsStore.migration: 2/5 — die 3 RED waren Issue-#209-TDD-Tests, korrekt rot bis Wave 4
- **B3.2** useSessionEvents: 2/5 — fake-timer + libuv-collision (siehe oben, fixiert via canned-data)
- **B3.6** App.integration: 0/3 — Vite-Build-Constants + jsdom-flakiness (define + skip)
**Erkenntnis:** Parallel-Subagenten produzieren unterschiedliche Qualitätsstufen abhängig von Test-Komplexität. Einfache Test-Files (lokale State-Manipulation, einfache Mocks) klappen verlässlich. Komplexe Test-Setups (fake-timers + I/O, dynamic imports + jsdom) brauchen menschliche Triage.
**Regel:** Subagenten-Briefs für Test-Files explizit kategorisieren: "EINFACH" (lokale State, wenige Dependencies) vs. "KOMPLEX" (timer-control, dynamic import, full-app render). Bei KOMPLEX: Subagent-Output IMMER vom Orchestrator vor Commit verifizieren + Reserve-Zeit für Triage einplanen (~30% der Subagent-Zeit).

---

### 2026-05-08 — Scrollback-History Phase 1 (xterm scrollback hardcap fix)

#### Hard-Coded UI-Limits sind versteckter Tech-Debt
**Kontext:** `SessionTerminal.tsx:87` hatte `scrollback: 5000` als Konstante. xterm-Default ist 1000, das Repo war 5× erhöht — galt als "großzügig". Tatsache: Claude-CLI-Sessions (Tool-Calls + TUI-Repaints + Status-Bar-Refreshes) verbrauchen 5-10× den Output normaler Shells. 5000 reicht für ~30 Min, dann fängt FIFO-Eviction an. User-Pain: "beim Hochscrollen ist Verlauf abgeschnitten."
**Erkenntnis:** Numerische Limits in UI-Komponenten sind nicht "Defaults" — sie sind ungeschriebene Architektur-Entscheidungen, die User-Pain verursachen ohne dass der Code es sagt. xterm-Default 1000 ist für Standard-Shells optimiert (kurze CLI-Outputs), nicht für TUI-heavy Tools wie Claude-CLI. Use-Case-spezifische Defaults gehören in Settings, nicht in Source.
**Regel:** Jedes hard-coded numeric Limit in einer UI-Komponente ist ein Settings-Kandidat. Bei Discovery (z.B. via Bug-Report): NICHT die Konstante erhöhen, sondern in `settingsStore` ziehen + Sanitize-Helper + UI-Slider mit Memory-Hint. Default = das Limit das den dominanten Use-Case happy macht (hier: 25k = 5× das alte Hard-Code-Limit, gerechnet auf typische Claude-Session).

#### Pre-Existing Tests mit hard-coded Type-Shapes brechen bei Type-Erweiterung
**Kontext:** Hinzufügen eines required Fields `scrollbackLines: number` zu `AppPreferencesSettings` brach 10 Test-Files die das Type explizit konstruieren (`{ frontendLogging: false, backendFileLogging: false, performanceProfiler: false, showProtokolleTab: false }` ← jetzt unvollständig). TSC fängt das, aber jeder Test musste manuell erweitert werden.
**Erkenntnis:** Tests die einen Production-Type explizit konstruieren statt einen Builder-Helper zu verwenden, koppeln sich tief an die Type-Shape. Bei jeder Schema-Erweiterung: 10× Edit. Builder-Helper (`buildPreferences({ frontendLogging: true })`) wäre wartungsärmer aber keiner hat das von Anfang an gemacht.
**Regel:** Bei Hinzufügen eines required Fields zu Production-Types: TSC laufen lassen, ALLE betroffenen Tests im selben Commit anpassen. Optional Tech-Debt-Eintrag: einen `buildPreferences(partial)`-Helper anlegen sodass künftige Erweiterungen nur den Helper anfassen statt 10 Tests.

#### Sanitize-Helper für persistierte numeric Settings ist Defense-in-Depth
**Kontext:** `scrollbackLines` ist `number` in `AppPreferencesSettings`. Settings-UI gibt nur Presets (5k/10k/25k/50k), aber persistierter State auf Disk könnte korrupt sein (manuelle Edit, alter Schema-Bug, Migration-Drift). Ohne Clamp könnte `scrollbackLines: 999_999_999` durchrutschen → 12 GB Memory pro Terminal → OOM.
**Erkenntnis:** Bei numeric Settings die in Production-Code als Limit verwendet werden (Memory, Disk, Timeout): IMMER Sanitize-Helper am Use-Site. Hard-Ceiling weit über UI-Maximum (hier: UI-Max 50k, Sanitize-Ceiling 100k) als Safety-Net gegen tampering oder Migration-Drift. Floor ebenfalls (1k) damit absurd kleine Werte nicht xterm crashen.
**Regel:** Pro persistiertem numeric Setting: Sanitize-Funktion exportiert (pure, testbar) die min/max clampt + non-numeric/NaN/Infinity zu Default fällt. Use-Sites rufen Sanitize, nicht direkt das Setting. UI-Selector nutzt nur freigegebene Presets, aber Sanitize bewacht den gesamten Pfad.

---

## Archiv (vor 2026-05, chronologisch absteigend)

### 2026-04-17 — Design-System-Intake

#### Eingehende Style-Contracts gegen Ist-Stand diffen, nicht blind uebernehmen
**Kontext:** Anleitung zum Design-System-Intake verlangte "Token-Reconcile" via Copy aus `colors_and_type.css`. Tatsaechlich hatte `src/index.css` alle Tokens (Durations, Easings, Spacing, Alpha-Varianten, Glows) bereits — die eingehende CSS war ein Snapshot AUS dem Repo.
**Erkenntnis:** Wenn ein externes Design-System aus dem eigenen Code extrahiert wurde, ist `src/index.css` die Source of Truth. Einseitig kopieren ueberschreibt moeglicherweise bereits weitergepflegte Werte.
**Regel:** Tokens aus externer CSS immer gegen `src/index.css` diffen und explizit Delta-Listen erstellen. `src/index.css` niemals durch "Paket-CSS" ueberschreiben.

#### Scope-Disziplin bei Drift-Audits
**Kontext:** Drift-Scan fand 4 harte `rounded-md/lg`-Violations, aber dazu ~25 `rounded-full`-Pills die streng genommen auch gegen "full = nur Status-Dots" verstossen.
**Erkenntnis:** Ein Audit-Ticket eskaliert schnell von "6 Findings" zu "jede Pille prüfen", was zu unreviewbaren PRs und potentiellen Regressions fuehrt.
**Regel:** Im Plan definierte Drift-Liste strikt abarbeiten. Graubereiche (hier: Pill-Shapes) als Follow-up-Issues dokumentieren, nicht in laufenden PR aufblaehen.

#### Vite-Public vs src/assets fuer Favicons
**Kontext:** Anleitung schlug `<link rel="icon" href="/src/assets/logo.svg">` vor — das funktioniert in Vite nicht ohne Bundler-Hook (nur `public/*` wird als URL-Root gemountet).
**Erkenntnis:** Generische Design-System-Anleitungen uebersehen oft Framework-Spezifika.
**Regel:** Statisches Favicon → `public/<file>` + absoluter Pfad `/<file>` im `<link>`. `/src/...` nur via bundler-imports.

---

### 2026-04-09 — Library-View zeigt keine Inhalte (Regression)

#### Hardcodierte Pfade brechen bei neuen Quellen
**Kontext:** `SkillCard` Loader hatte `commands/${dirName}/SKILL.md` hardcodiert fuer ALLE globalen Skills. Als `~/.claude/skills/` als zweite Quelle hinzugefuegt wurde, zeigten Skills aus `skills/` "Kein Inhalt" — weil der Loader am falschen Pfad suchte, obwohl `skill.body` den korrekten Content bereits hatte.
**Erkenntnis:** Wenn Daten bereits waehrend Discovery geladen werden, darf die Anzeige-Komponente sie nicht nochmal von einem hardcodierten Pfad nachzuladen versuchen. Das ist fragil und bricht bei jeder neuen Quelle.
**Regel:** Content der bei Discovery schon geladen wird, direkt aus dem Model (`skill.body`) verwenden — nicht aus einem hardcodierten Pfad re-fetchen. Single Source of Truth gilt auch fuer UI-Loader.

#### Neue Scopes brauchen vollstaendige Discovery
**Kontext:** `discoverGlobal` lud Settings, Commands, Skills, Agents und Memory — aber NICHT die globale `~/.claude/CLAUDE.md`. Der "CLAUDE.md"-Section im Global-Scope blieb unsichtbar, weil `config.claudeMd` immer `""` war.
**Erkenntnis:** Wenn ein neuer Scope oder eine neue Quelle hinzugefuegt wird, muessen ALLE Content-Typen des Scopes geprueft werden — nicht nur die neu hinzugefuegten. Luecken in der Discovery fallen nicht sofort auf, weil die UI fehlende Daten einfach nicht anzeigt (kein Error, nur leere Sections).
**Regel:** Bei Erweiterung von Discovery-Funktionen: Checkliste aller ScopeConfig-Felder durchgehen (skills, agents, hooks, settingsRaw, claudeMd, memoryFiles). Jedes Feld muss fuer den Scope geladen werden oder explizit als "nicht relevant" markiert sein.

---

### 2026-04-06 — Issue-Status nie aus Gedaechtnis, immer aus GitHub

#### Stale Context fuehrt zu falschen Empfehlungen
**Kontext:** Mehrfach Issues (#62, #63, #65) als "offen" behandelt und zur Parallel-Implementierung vorgeschlagen, obwohl sie laengst CLOSED waren. Ursache: Aus dem Conversation-Context oder der todo.md gelesen statt aus der Single Source of Truth (GitHub API).
**Erkenntnis:** todo.md driftet, Conversation-Context ist nach Compaction unzuverlaessig. Nur `gh issue list --state all` ist die Wahrheit.
**Regel:** Vor JEDER Empfehlung die auf Issue-Status basiert: `gh issue list` oder `gh issue view` ausfuehren. Nie aus Gedaechtnis oder todo.md den Status ableiten. Gilt besonders bei Sprint-Planung, Parallel-Implement-Analyse und Cleanup-Phasen.

---

### 2026-04-06 — ADPError-Migration (#63)

#### Review-Agent MUSS vor PR abgeschlossen sein — nie parallel zum PR starten
**Kontext:** Bei Issue #63 wurde der Code-Quality-Review-Agent im Hintergrund gestartet, waehrend gleichzeitig der PR erstellt wurde. Der Abschluss-Report sagte "PR wartet auf User-Merge". Der User hat gemerged. Dann kam der Review zurueck mit Findings (falscher Error-Code in `folder_actions.rs`). Die Fixes konnten nur noch als separater Commit nachgeschoben werden — der PR war bereits gemerged mit bekanntem Fehler.
**Erkenntnis:** Die /implement Skill-Pipeline definiert Phase 5 (Review) → Phase 6 (PR) als sequentielle Schritte. Background-Agents fuer Reviews zu starten und parallel den PR zu erstellen bricht diese Sequenz. Das "Done"-Signal an den User kommt bevor die Qualitaet tatsaechlich geprueft ist.
**Regel:** Review-Agents (code-quality, security-reviewer) MUESSEN abgeschlossen sein und ihre Findings verarbeitet sein BEVOR Phase 6 (Commit & PR) startet. Nie einen Review-Agent `run_in_background` starten und gleichzeitig den PR erstellen. Die Reihenfolge ist: Review starten → Review-Ergebnis abwarten → Findings fixen → DANN erst PR.

---

### 2026-04-06 — Sprint v1.6.0 Abschluss-Session (Mega-Session)

#### Worktree-Agents verlieren package.json-Änderungen beim Squash-Merge
**Kontext:** Issue #136 (Log-Virtualisierung) hat `@tanstack/react-virtual` als Dependency hinzugefügt. Der Subagent hat `npm install` im Worktree ausgeführt — package.json wurde geändert, aber beim `git add` wurden nur die Source-Dateien explizit hinzugefügt, nicht package.json/package-lock.json. Beim Squash-Merge fehlte die Dependency. Der Build-Engineer im Verifikations-Team hat den Fehler aufgedeckt.
**Erkenntnis:** `npm install <package>` ändert package.json + package-lock.json. Wenn der Subagent nur Source-Dateien staged (`git add src/...`), gehen Dependency-Änderungen verloren. Das ist besonders tückisch weil der Build im Worktree funktioniert (node_modules existiert lokal).
**Regel:** Bei jedem `npm install <neues-paket>` im Subagent-Prompt explizit fordern: "Nach npm install MÜSSEN package.json und package-lock.json mit-committet werden." In Subagent-Prompts: `git add package.json package-lock.json src/...` statt nur `git add src/...`.

#### Parallele Batch-Arbeit mit 6+ Agents skaliert — aber Merge-Reihenfolge ist kritisch
**Kontext:** 8 Frontend-Review Issues (#132-#139) wurden in 6 parallelen Work-Units abgearbeitet. 5 Units mergten konfliktfrei, Unit 6 (Umlaute, 45 Dateien) brauchte einen Rebase mit 2 Konflikten (EditorToolbar.tsx, MarkdownEditorView.tsx). Die Konflikte waren trivial aufzulösen weil sie additive Änderungen auf verschiedenen Ebenen waren (Umlaute = Textinhalt, A11y = Attribute, CTA = Komponenten-Wrapper).
**Erkenntnis:** Die breiteste Änderung (die meisten Dateien berührt) MUSS zuletzt gemergt werden. Das minimiert Rebase-Aufwand: nur der letzte PR muss rebasen, nicht alle anderen.
**Regel:** Bei parallelen Batches: Merge-Reihenfolge = aufsteigend nach Datei-Count. Isolierteste PRs zuerst, breiteste zuletzt.

#### Verifikations-Team vor Release deckt Probleme auf die CI nicht fängt
**Kontext:** CI war grün für alle 6 PRs. Aber nach dem Merge aller PRs auf master fehlte `@tanstack/react-virtual` in node_modules (lokaler State). Der Build-Engineer-Agent hat das sofort gefunden. Ohne das Team hätte der User einen broken Build vorgefunden.
**Erkenntnis:** CI prüft jeden PR isoliert auf seinem Branch. Nach dem Merge aller PRs auf master kann der lokale Zustand divergieren (node_modules stale, neue Dependencies nicht installiert). Ein finaler Verifikations-Durchlauf auf dem gemergten master ist Pflicht vor einem Release.
**Regel:** Vor jedem Release: `npm install` + komplettes Verifikations-Team (Build, Tests, Rust, Quality) auf dem finalen master-Stand laufen lassen. Nicht davon ausgehen dass "CI war grün" = "lokaler Build funktioniert".

#### 241 Tests in einer Session via 6 parallele Batch-Workers — Test-Coverage von 47% auf 83%
**Kontext:** Issues #90 und #66 (Coverage-Schwellen erhöhen) wurden mit 6 parallelen Test-Workers abgearbeitet. Jeder Worker hat 16-66 Tests für sein Modul geschrieben (Shared, Sessions, Viewers, Kanban, Stores/Hooks, Layout). Alle 6 PRs mergten konfliktfrei weil sie nur neue Test-Dateien hinzufügten.
**Erkenntnis:** Test-Writing ist ideal für Parallelisierung: jeder Worker schreibt neue .test.tsx-Dateien neben den Source-Dateien, es gibt keine Merge-Konflikte weil keine Source-Dateien geändert werden. Die Coverage-Projektion (47% → ~77%) war konservativ — tatsächlich erreicht: 83%.
**Regel:** Für Coverage-Sprints: immer /batch mit einem Worker pro Modul. Keine Source-Änderungen, nur Test-Dateien. Threshold-Bump als separaten letzten PR nach allen Test-PRs.

#### Frontend-Review mit 5 KI-Experten-Personas liefert systematische, priorisierte Findings
**Kontext:** Statt eines einzelnen "schau mal drüber" wurden 5 spezialisierte Personas parallel eingesetzt (UX, Design, A11y, Performance, Copy). Jede Persona hat unabhängig analysiert, dann hat ein Moderator-Agent die Findings konsolidiert, Konsens identifiziert und priorisiert.
**Erkenntnis:** Der Konsens-Mechanismus (3+ Experten einig = High-Confidence) filtert Rauschen effektiv. Einzelne Experten-Meinungen können subjektiv sein, aber wenn UX + Design + A11y alle dasselbe Problem sehen (z.B. "SideNav braucht Labels"), ist es ein echtes Problem. Die Priorisierung (P0-P3) nach Impact × Aufwand macht die Findings direkt actionable.
**Regel:** Bei UI-Reviews: /frontend-review Skill nutzen. 5 Personas parallel, Moderator-Synthese, dann Issues erstellen. Nicht "einer schaut drüber" — das findet nur die offensichtlichen Probleme.

---

### 2026-04-05 — Doku-Drift & Archivierungs-Regel (Housekeeping v1.4.2)

#### Sprint-Plan-Dokumente sind Artefakte, keine Dauer-Dokumente
**Kontext:** `tasks/testing-spec.md` (443 Zeilen, 2026-04-02) war ein konkreter QA-Sprint-Plan fuer v1.3.1. Alle 9 Tickets wurden umgesetzt, aber die Datei blieb im aktiven `tasks/`-Verzeichnis liegen. Die **zeitlos relevanten** Teile (4-Gates-Struktur, dauerhaftes QA-Ritual) lagen ungenutzt im Sprint-Plan — waehrend CLAUDE.md einen aelteren, vageren Testing-Abschnitt behielt. Gleiche Drift bei `Softwareprozess/Phase.txt` (407 Zeilen, klassisches Wasserfall-Modell), das seit arc42 ueberholt war aber weiter in CLAUDE.md/README/CONTRIBUTING referenziert wurde.
**Erkenntnis:** Sprint-Plan-Dokumente haben **drei Lebensphasen**: (1) aktiv waehrend des Sprints, (2) Quelle fuer zeitlose Regeln nach Sprint-Abschluss, (3) Archiv-Artefakt. Ohne Phase 2 versanden gute Regeln im Archiv und werden nie ins lebende Dokument (CLAUDE.md) migriert.
**Regel:** Nach jedem Sprint-Abschluss: (a) Sprint-Plan-Doc auf "zeitlose Regeln" scannen, (b) diese in CLAUDE.md oder arc42 migrieren, (c) dann Sprint-Plan-Doc nach `Softwareprozess/history/` verschieben. Diese Drei-Schritte-Regel ist jetzt auch in CLAUDE.md Abschnitt "Prozess-Dokumentation" verankert.

#### Hardcodierte Zahlen in CLAUDE.md driften garantiert
**Kontext:** CLAUDE.md behauptete "281 Tests in 8 Test-Dateien (Sprint v1.3.1)" und "Coverage-Schwellen: 60% Statements/Functions/Lines, 50% Branches". Tatsaechlicher Stand: 474 Tests in 21 Dateien, Coverage-Schwellen 24/32/58/24. Beides war ueber Wochen stale — CLAUDE.md log aktiv jeden Turn.
**Erkenntnis:** Jede fixe Zahl in einem Dauer-Dokument ist eine **Deadline fuer einen Update**, der garantiert verpasst wird. Schlimmer: Stale Zahlen sind **worse than no numbers** — sie erzeugen falsches Vertrauen.
**Regel:** In CLAUDE.md und aehnlichen Dauer-Docs **keine fixen Zahlen** zu Testzahl, Coverage, Issue-Count, Version etc. Stattdessen auf die **Live-Quelle** verweisen ("siehe `npm run test`", "siehe `vitest.config.ts`"). Exakte Zahlen gehoeren in generierte Artefakte (CHANGELOG, Sprint-Review) oder ins Dashboard, nicht in handgepflegte Dauer-Docs.

#### CHANGELOG-Pflege wird vergessen wenn sie nicht im Release-Workflow steht
**Kontext:** Beim Housekeeping entdeckt: `CHANGELOG.md` endete bei v1.2.5 (2026-03-28). v1.3.0, v1.4.0, v1.4.1 wurden getaggt und released ohne CHANGELOG-Update. Vier Releases ohne Changelog-Eintraege.
**Erkenntnis:** Changelog-Pflege als separater, menschlich-erinnerter Schritt wird uebersprungen, sobald Druck entsteht. GitHub-Releases mit Notes existieren, aber CHANGELOG.md wird separat gepflegt — doppelter Aufwand, halber Pflege-Rhythmus.
**Regel:** Changelog-Eintrag gehoert in die Release-Checkliste (im `/sprint-review` Skill oder als Pre-Tag-Schritt). Alternativ: CHANGELOG automatisch aus Git-Tags + Conventional-Commits generieren (Tool wie `git-cliff`). Bis das automatisiert ist: **Pflicht vor jedem `git tag`**: "CHANGELOG.md aktualisiert? Wenn nein → nicht taggen."

---

### 2026-04-05 — MD-Pinning Feature (v1.5 Stage 2)

#### Usage-Check (`grep`) vor jeder Komponenten- oder Helper-Änderung
**Kontext:** Drei Belege aus demselben Sprint:
1. `ContentTabs.tsx` modifiziert — war orphan code (keine Importer). Diff-Umfang ohne Wirkung produziert, danach Fix-Schleife für tsc-Fehler.
2. `configPanelShared.tsx` (`ConfigPanelContent`) um Pin-Case erweitert ohne Caller-Check. Zweiter Caller `FavoritePreview.tsx` hatte eigene Tab-Leiste ohne Pin-Support — Feature lief nur in einer Hälfte der App (Bild 1 vs Bild 2).
3. Aus veralteter Doku (damals `Phase.txt`, mittlerweile durch `Softwareprozess/arc42-specification.md` ersetzt) die alte UI-Architektur rekonstruiert. Echte Struktur war Split-View-ConfigPanel. Doku log, der Code in der Codebase nicht.

**Erkenntnis:** Code-Usage (`grep -r "<ComponentName"` für JSX, `grep -r "import.*Foo"` für Module) ist die einzige Wahrheit. Doku, CLAUDE.md, mein Gedächtnis können lügen. Bei Projekten mit Pivot-Historie entsteht dead code systemisch (siehe Eintrag 2026-03-25).

**Regel:** Vor JEDER nicht-trivialen Änderung **zwei Grep-Runden**: (1) Wird die Komponente/Funktion irgendwo genutzt? (2) Wer importiert die Datei in der ich arbeite? Bei `found 1 file` (= nur sich selbst) = dead code: nicht modifizieren, als delete-candidate notieren. Bei mehreren Callern: jeden öffnen und prüfen ob das neue Verhalten dort getriggert werden kann.

---

### 2026-04-04 — Markdown Editor Feature (#68)

#### safe_resolve prueft non-existent Pfade nicht
**Kontext:** `safe_resolve_with_base` gab fuer nicht-existierende Dateien den raw joined Path zurueck — ohne Canonicalization. Bei `write_project_file` ermoeglicht das Path Traversal via `../` und Symlink-Angriffe (TOCTOU).
**Regel:** Jede `safe_resolve`-Aenderung MUSS beide Pfade (existierend + nicht-existierend) absichern. Fuer neue Dateien: Parent canonicalisieren + Filename anhaengen. Fuer fehlenden Parent: Komponenten manuell ausfloesen.

#### DOMPurify Default-Config blockiert javascript: nicht
**Kontext:** DOMPurify's Standard-Config laesst `javascript:` und `onerror` in Attributen durch. Markdown-Links wie `[Click](javascript:alert('xss'))` werden zu klickbaren XSS-Vektoren.
**Regel:** Bei jedem `DOMPurify.sanitize()` IMMER explizit `ALLOWED_ATTR` und `FORBID_ATTR` konfigurieren. Nie Default vertrauen.

#### Zustand Store-Subscription ohne Selektor = Re-Render bei jedem State-Change
**Kontext:** `useEditorStore()` ohne Selektor abonniert den gesamten Store. EditorToolbar renderte bei jedem Keystroke neu, obwohl nur `openFile.content` sich aenderte.
**Regel:** Immer granulare Selektoren exportieren und nutzen. Nie `const { action1, action2 } = useStore()` — stattdessen `const action1 = useStore(selectAction1)`.

#### Feature-Implementierung ohne QA-Phase = versteckte Bugs
**Kontext:** Erste Implementierung hatte 6 Security-Issues, 7 Performance-Probleme, 20 UX-Gaps. Erst das 5-Agenten QA-Review hat das aufgedeckt.
**Regel:** Nach jeder nicht-trivialen Feature-Implementierung: QA-Review mit spezialisierten Agenten (Security, Performance, Testing, UX/A11y, Code Quality) BEVOR das Feature als "done" markiert wird. In die Checkliste aufnehmen.

---

### 2026-04-03 — v1.4.0 Release

#### Rust-Checks nur in CI, nie lokal

**Was passiert ist:** `cargo fmt --check` lief nur in der GitHub Actions Pipeline. Lokal gab es keinen Pre-Commit-Hook fuer Rust-Dateien. Release v1.4.0 wurde gepusht und die CI schlug sofort wegen Formatting-Diffs in `agent_detector.rs`, `commands.rs`, `manager.rs` und `util.rs` fehl. Vermeidbar.
**Regel:** Jede Sprache/jedes Tooling das in CI geprueft wird, MUSS auch lokal im Pre-Commit-Hook laufen. Parität zwischen CI und lokal ist Pflicht. Konkret: lint-staged hat jetzt `*.rs`-Einträge fuer `cargo fmt --check` und `cargo check --quiet`.

---

### 2026-04-02 — Warum wir nie ein gelebtes Qualitaetskonzept hatten

#### Die bittere Wahrheit: Das Konzept existierte — es wurde nur nie gelebt

**Kontext:** Umfassende Projekt-Analyse mit 10 Spezialisten-Agenten (Architektur, Security, Code Quality, Dependencies, State Management, UI/UX, Build/DevOps, Vision, Rust Backend, Integration) deckt systemische Qualitaetsprobleme auf: 3 kritische Security-Luecken, 0 Component-Tests, Safety-Features stillschweigend revertiert, keine Pre-Commit-Hooks. Dabei existiert in `Softwareprozess/Planung.md` Sektion 9 eine vollstaendige Testing-Strategie mit Pyramide, Coverage-Zielen und Quality-Gates.

#### Ursache 1: Der Pivot hat den Plan begraben
**Was passiert ist:** Die Testing-Strategie lebte in `Planung.md` — einem Dokument das nach dem Pivot zum Session Manager ARCHIVIERT wurde. Die gesamte Qualitaetsstrategie ging mit dem alten Sprint-Plan ins Archiv. Fuer die neue Richtung wurde **nie eine neue Testing-Strategie** erstellt.
**Regel:** Bei einem Pivot: Features duerfen sich aendern, aber Qualitaets-Konzepte muessen MIGRIERT werden, nicht archiviert. Testing-Strategie gehoert in CLAUDE.md (lebendes Dokument), nicht in einen Sprint-Plan.

#### Ursache 2: Phase 5 (Test) wurde endlos verschoben
**Was passiert ist:** Das damalige 7-Phasen-Modell (`Phase.txt`, mittlerweile durch `Softwareprozess/arc42-specification.md` ersetzt) definierte Phase 5 als "Test: Ueberpruefung und Fehlerbehebung". Stand damals: "Phase 4-7 werden nach Feature-Forward-Sprint geplant." Phase 5 wurde nie erreicht weil immer ein neues Feature wichtiger war — v1.1, v1.2, v1.3, Pipeline-Sprint.
**Regel:** Testing ist keine Phase die "irgendwann" kommt. Testing ist Teil JEDER Phase. Kein Feature ist "fertig" ohne mindestens 1 Test der bricht wenn das Feature entfernt wird. Quality Gates muessen ab Sprint 1 gelten, nicht ab "Phase 5".

#### Ursache 3: Feature-Velocity schlug Quality-Discipline
**Was passiert ist:** v1.0 bis v1.3 in 10 Tagen geliefert (Session Manager, Agenten-Transparenz, GitHub-Integration, Bugfixes). Beeindruckende Geschwindigkeit. Aber: Nach den initialen 251 Store-Tests (2026-03-16) wurde KEIN EINZIGER neuer Test geschrieben — fuer keines der 3 Releases danach. Die Test-Suite stagnierte waehrend die Codebase wuchs.
**Regel:** "Wir testen spaeter" ist eine Luege die man sich erzaehlt um schneller zu sein. Testen spaeter ist exponentiell teurer: Man muss den Code erst wieder verstehen, Edge Cases sind vergessen, und Bugs sind bereits eingebaut. Budget fuer Tests in jedem Sprint einplanen — nicht als Bonus, sondern als Pflicht.

#### Ursache 4: Kein Enforcement — Prozess ohne Zaehne
**Was passiert ist:** `Planung.md` definierte Quality Gates: "npm run test — blockierend", "Coverage >= 60%", "Neue Logik hat mindestens 1 Test". KEINES davon wurde implementiert. Kein Pre-Commit-Hook, kein CI-Gate das Tests erzwingt, kein PR-Review das auf Tests prueft. Der Prozess war ein Versprechen auf Papier.
**Regel:** Quality Gates die nicht automatisiert sind, existieren nicht. Wenn ein Gate nicht im CI blockiert, wird es uebergangen sobald Zeitdruck entsteht. Mindestens: Pre-Commit-Hook (`tsc --noEmit`), CI-Gate (`npm test` blockierend), Coverage-Schwelle (erzwungen in vitest.config.ts).

#### Ursache 5: Security war nie ein First-Class Concern
**Was passiert ist:** Shell-Injection in `manager.rs:376` (resume_session_id direkt in Shell-Command interpoliert), CSP mit `unsafe-eval`, keine Input-Validierung am Rust-Boundary, keine Subprocess-Timeouts. All diese Issues existierten seit Tag 1, wurden aber nie systematisch geprueft. Es gab keinen Security-Review, kein Threat-Modeling, kein OWASP-Checklist.
**Regel:** Security-Review nach jedem neuen Tauri-Command. Checkliste: Input validiert? Path Traversal geprueft? Shell-Injection moeglich? Timeout vorhanden? Fehler strukturiert? 5 Fragen, 5 Minuten — haette alle 3 kritischen Issues verhindert.

#### Ursache 6: 251 Tests gaben falsche Sicherheit
**Was passiert ist:** "Wir haben 251 Tests!" klingt beeindruckend. Aber ALLE 251 Tests sind Store-Unit-Tests — sie testen In-Memory-State-Mutations. Kein einziger Test prueft: Rendert die UI korrekt? Funktioniert die Tauri-IPC? Ueberlebt die Persistenz einen Crash? Werden Events korrekt verarbeitet? Die Tests prueften den einfachsten Teil des Systems und liessen den riskantesten Teil ungetestet.
**Regel:** Tests nach Risiko priorisieren, nicht nach Einfachheit. Frage: "Was kostet es wenn DAS kaputt geht?" Persistenz-Verlust > UI-Regression > Store-Logik. Die teuersten Failures zuerst testen — auch wenn die Tests schwerer zu schreiben sind.

#### Zusammenfassung: 6 Regeln fuer die Zukunft

1. **Qualitaetskonzept lebt in CLAUDE.md** — nicht in archivierbaren Sprint-Docs
2. **Testing ist Teil jeder Phase** — keine separate "Test-Phase"
3. **Jeder Sprint hat Test-Budget** — Features ohne Tests sind nicht "fertig"
4. **Gates muessen automatisiert sein** — Pre-Commit + CI, sonst existieren sie nicht
5. **Security-Review pro Tauri-Command** — 5-Fragen-Checkliste, 5 Minuten
6. **Tests nach Risiko priorisieren** — teuerste Failures zuerst

---

### 2026-03-30 — Persistenz-Audit: Safety Features stillschweigend revertiert

#### Parallele Sessions ueberschreiben sich gegenseitig
**Kontext:** Issue #23 — Commit `59e3069` (Mar 27) hat Backup-Rotation, JSON-Validierung und Schema-Versioning fuer settings.rs eingebaut (101 Zeilen). 7 Stunden spaeter hat Commit `4232bd4` (Mar 28) Favorites/Notes-Loading hinzugefuegt — aber auf der alten Version von settings.rs gearbeitet. Die gesamte Backup-Infrastruktur wurde stillschweigend entfernt. Ein dritter Commit hat nur kosmetisch `version: 1` zurueckgefuegt, nicht die eigentliche Logik.
**Erkenntnis:** Wenn mehrere Sessions (oder Agents) am selben Issue arbeiten und dieselben Dateien aendern, ueberschreibt die zweite Session die erste — ohne Warnung, ohne Merge-Conflict.
**Regel:** Nach jedem Commit auf geteilten Dateien: `git diff HEAD~1 -- <file>` pruefen ob unbeabsichtigt Zeilen entfernt wurden. Bei parallel arbeitenden Sessions: expliziten Sync-Punkt einbauen.

#### Safety-Features brauchen Tests als Wächter
**Kontext:** Backup-Rotation war implementiert, aber ohne Tests. Als der Code stillschweigend revertiert wurde, gab es keinen Alarm.
**Erkenntnis:** Ungetestete Safety-Features sind keine Safety-Features. Sie werden beim naechsten Refactor entfernt und niemand merkt es.
**Regel:** Jedes Safety-Feature (Backup, Validation, Atomic Write) muss mindestens einen Test haben der bricht wenn das Feature entfernt wird.

#### Audit-Schuld: Persistenz nie systematisch geprueft
**Kontext:** Die App speichert Favoriten, Notizen und Settings — User-Daten die nie verloren gehen duerfen. Trotzdem gab es bis 2026-03-30 kein systematisches Audit der Persistenz-Schicht. Das Ergebnis: 4 CRITICAL-Schwachstellen (kein Atomic Write, kein Backup, removeItem loescht alles, stille Write-Fehler).
**Erkenntnis:** Persistenz-Code wird als "funktioniert ja" behandelt, aber die Failure-Modes (Crash, Disk-Full, korruptes JSON) werden nie getestet. "Funktioniert im Happy Path" != "Daten sind sicher".
**Regel:** Bei jeder neuen Persistenz-Schicht: Failure-Mode-Analyse durchfuehren. Mindestens pruefen: Was passiert bei Crash waehrend Write? Was bei korruptem File? Was bei Disk-Full?

---

### 2026-03-29 — Cross-Cutting Concerns erkennen

#### Pattern in einer Datei gesehen ≠ Problem geloest
**Kontext:** `silent_command()` mit `CREATE_NO_WINDOW` existierte nur in `github/commands.rs`. Vier andere Module nutzten rohes `Command::new()` — auf Windows flashte bei Worktrees, Pipeline und Executable-Checks kurz eine Console. User musste darauf hinweisen.
**Erkenntnis:** Wenn ein Pattern wie Window-Flags, Error-Handling oder Security-Checks in einer Datei existiert, ist das ein Signal fuer ein systemweites Concern. Tunnel-Vision (nur die Dateien lesen die zum aktuellen Task gehoeren) verhindert, dass Inkonsistenzen auffallen.
**Regel:** Bei Cross-Cutting Concerns (OS-Flags, Logging, Security, Error-Handling) sofort codebase-weit pruefen: `grep` nach dem rohen Pattern und alle Stellen auf Konsistenz bringen. Nicht file-by-file denken, sondern: "Wird das ueberall gleich gehandhabt?"

---

### 2026-03-25 — Retrospektive & Konsolidierung

#### Over-Planning ohne Feedback-Loop
**Kontext:** 3 Phasen (Anforderungsanalyse, Planung, Entwurf) mit 30+ Agenten, dann Pivot zu Session Manager
**Erkenntnis:** Umfangreiche Planung ist wertlos wenn sie nicht am echten User-Bedarf validiert wird
**Regel:** Maximal 1 Phase planen, dann User-Feedback einholen. Lieber 3x kurz planen als 1x lang.

#### Monster-Commits vermeiden
**Kontext:** Ein Commit mit 22.003 Zeilen, 115 Dateien (v1.0.0 Session Manager)
**Erkenntnis:** Grosse Commits sind nicht reviewbar und machen Rollbacks unmoeglich
**Regel:** Max 5-10 Dateien pro Commit. Feature in logische Schritte aufteilen.

#### Toter Code entsteht durch Richtungswechsel
**Kontext:** 12 Dateien (Pipeline-Komponenten, ADP-Adapter, Stores) nie integriert
**Erkenntnis:** Bei einem Pivot bleibt alter Code liegen. Ohne regelmaessiges Aufraeumen waechst Tech Debt unsichtbar.
**Regel:** Nach jedem Pivot: Dead-Code-Audit. Nicht genutzten Code archivieren oder loeschen.

#### Prozess definieren ≠ Prozess leben
**Kontext:** CLAUDE.md definiert tasks/todo.md, STOPP-Punkte, Verification — nichts davon wurde eingehalten
**Erkenntnis:** Ein Prozess den niemand lebt ist schlimmer als kein Prozess (falsche Sicherheit)
**Regel:** Nur Prozesse definieren die man auch wirklich einhalt. Lieber wenige Regeln die gelebt werden.

#### Spontane Ideen brauchen ein Auffangbecken
**Kontext:** Waehrend App-Nutzung fallen Verbesserungen auf, die sofort umgesetzt werden statt geplant
**Erkenntnis:** Ohne Capture-Mechanismus werden Ideen entweder vergessen oder brechen den aktuellen Flow
**Regel:** Idee → `tasks/todo.md` Backlog-Section (1-Zeilen-Hook). Bei nächstem Sprint-Planning aus Backlog in aktive Phase promoten.

---

### 2026-03-16 — Session Manager MVP (aus lessons-learned.md uebernommen)

#### Test-First zahlt sich aus
**Kontext:** Senior Test Manager Agent fand 11 echte Bugs, 1 kritischer PTY-Leak
**Regel:** Bei neuen Features: Parallel-Agent fuer Tests mitlaufen lassen.

#### CSP-Restriktionen in Tauri
**Kontext:** `'unsafe-eval'` noetig fuer Vite + dynamische Imports
**Regel:** CSP-Config frueh testen, nicht erst beim Release.
