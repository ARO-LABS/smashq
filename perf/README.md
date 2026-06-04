# Performance-Baseline

Dieser Ordner haelt die **Vergleichs-Metriken** fuer Performance-kritische
Funktionen. Ziel: bei jeder Aenderung gegen eine eingecheckte Baseline pruefen,
damit Regressionen sofort auffallen — nicht erst im fertigen Build.

## Dateien

| Datei                    | Quelle                          | Inhalt                                           |
| ------------------------ | ------------------------------- | ------------------------------------------------ |
| `baseline.frontend.json` | `vitest bench --outputJson`     | Maschinenlesbare Frontend-Bench-Ergebnisse       |
| `baseline.rust.txt`      | `cargo bench` (criterion)       | Snapshot der Rust-Bench-Headline-Zahlen          |

## Frontend (vitest bench)

Benchmarks liegen co-located als `src/**/*.bench.ts`.

```bash
npm run bench            # Benches einmal laufen lassen, Zahlen ansehen
npm run bench:compare    # Aktuellen Lauf gegen baseline.frontend.json diffen
npm run bench:save       # Baseline NEU festschreiben (nur nach bewusster Aenderung)
```

`bench:compare` markiert jede Funktion, die langsamer als die Baseline ist —
das ist der Regressions-Check waehrend der Entwicklung.

## Rust (criterion)

Benchmarks liegen in `src-tauri/benches/parsers.rs`.

```bash
cd src-tauri
cargo bench                              # Alle Benches, Delta vs. letztem Lauf
cargo bench -- --save-baseline main      # Lokale criterion-Baseline setzen
cargo bench -- --baseline main           # Gegen diese Baseline vergleichen
```

criterion speichert seine eigene Baseline unter `target/criterion/` (gitignored).
Die eingecheckte `baseline.rust.txt` ist der menschenlesbare Snapshot zum
Quervergleich ueber Maschinen hinweg.

## Workflow bei Performance-Arbeit

1. **Vorher messen:** `npm run bench` / `cargo bench` — Ist-Zustand festhalten.
2. **Aendern.**
3. **Nachher vergleichen:** `npm run bench:compare` / `cargo bench` — Delta pruefen.
4. **Baseline updaten** nur, wenn die Verbesserung bewusst ist und bleiben soll.

Eine unerwartete Verlangsamung in `bench:compare` ist ein Stopp-Signal:
Ursache finden, bevor weitergearbeitet wird.
