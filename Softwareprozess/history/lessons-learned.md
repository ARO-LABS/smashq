# [ARCHIVED] Lessons Learned — Agentic Dashboard (bis 2026-03-16)

> **Archiviert am:** 2026-04-05
> **Grund:** Enthaelt historische Lessons aus der Phase vor der Umstellung auf
>   `tasks/`-Struktur (Pivot zum Session Manager, 2026-03-16). Alle inhaltlich
>   relevanten Lessons sind in `tasks/lessons.md` uebernommen worden (dortiger
>   Eintrag "2026-03-16 — Session Manager MVP (aus lessons-learned.md uebernommen)").
> **Aktive Datei:** `tasks/lessons.md`
> **Nicht mehr erweitern.** Neue Lessons gehen ausschliesslich in `tasks/lessons.md`.

---

## 2026-03-16 — Phase 3/4: CSP-Crash und Session Manager MVP

### Problem: App crasht sofort nach Start (Fenster schließt sich)
- **Ursache:** Content Security Policy (CSP) in `tauri.conf.json` war zu restriktiv
- **Details:** `script-src 'self'` blockierte Vite's HMR-Scripts (Dev-Modus) UND den `new Function()` Hack für dynamischen xterm.js Import. Google Fonts waren ebenfalls blockiert.
- **Fix:** CSP erweitert um `'unsafe-inline' 'unsafe-eval'`, Google Fonts Domains whitelistet, `ws://localhost:*` für Vite HMR
- **Regel:** Bei Tauri v2: CSP IMMER im Dev-Modus testen. `'unsafe-eval'` ist nötig wenn Vite oder dynamische Imports genutzt werden. CSP-Fehler sind unsichtbar — das Fenster bleibt leer/crasht ohne Fehlermeldung.

### Problem: Dynamischer xterm.js Import funktioniert nicht in Production
- **Ursache:** `new Function("s","return import(s)")` umgeht Vite's Static Analysis, aber in Tauri's Webview gibt es keinen Package-Resolver für bare Specifiers
- **Fix:** xterm.js direkt importieren (`import { Terminal } from "@xterm/xterm"`) + CSS importieren (`import "@xterm/xterm/css/xterm.css"`)
- **Regel:** Keine dynamischen Import-Hacks für Dependencies die im Bundle sein müssen. Dynamische Imports nur für Code-Splitting von eigenen Modulen.

### Problem: Desktop-Shortcut zeigte auf alten Build
- **Ursache:** NSIS-Installer wurde einmal installiert, dann Code geändert und neu gebaut, aber Installer nicht erneut ausgeführt
- **Regel:** Nach Code-Änderungen: Entweder `npm run tauri dev` nutzen ODER Release-Build UND Installer erneut ausführen. Der Desktop-Shortcut auf `target/release/agentic-dashboard.exe` aktualisiert sich automatisch beim Rebuild.

### Lerning: Agenten-Planung vs. User-Bedarf
- **Problem:** 3 Phasen lang (Anforderungsanalyse, Planung, Entwurf) aufwändig geplant mit 30+ Agenten, aber der User wollte eigentlich etwas Pragmatisches: Einen Claude Session Manager statt einer isometrischen 3D-Pipeline-Visualisierung.
- **Regel:** Früher fragen "Was bringt dir MORGEN einen Vorteil?" statt umfangreiche Architektur für hypothetische Features zu planen. Der erste nutzbare Prototyp hat mehr Wert als 100 Seiten Planung.

## 2026-03-16 — Session Manager: Bugfixes + Features

### Prozess: Test-First zahlt sich aus
- **Aktion:** Senior Test Manager Agent hat 11 echte Bugs gefunden, darunter 1 kritischen PTY-Prozess-Leak
- **Bug:** `removeSession()` entfernte nur aus dem Store, rief aber nie `close_session` im Backend auf → Zombie-Prozesse
- **Regel:** VOR neuen Features immer einen Test-Agenten über den bestehenden Code laufen lassen. Der findet Bugs die beim Entwickeln übersehen werden.

### Prozess: Parallel-Agenten für Feature + Tests
- **Aktion:** Feature-Implementation und Tests parallel von 2 Agenten geschrieben
- **Ergebnis:** 251 Tests am Ende, beide Agents referenzieren den gleichen Entwurf → konsistentes Interface
- **Regel:** Feature-Agent und Test-Agent parallel starten, beide bekommen den gleichen Entwurf. Tests dokumentieren das erwartete Verhalten, selbst wenn die Implementation noch läuft.
