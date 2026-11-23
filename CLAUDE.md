# Projektregeln – Carrera-App (Fork von Open Lap)

Streckenplaner mit Bestandsverwaltung plus Rennbetrieb für Carrera DIGITAL 132 in **einer** App.
Basis ist ein Fork von [Open Lap](https://github.com/tkem/openlap) (Apache 2.0).
Der Projektinhaber ist Programmier-Einsteiger: Erklärungen auf Deutsch (Sie-Form), Schritt für Schritt, ohne Fachjargon. Claude schreibt den Code, der Inhaber testet an der eigenen Bahn.

## Technik

- Angular 20 + Ionic 8 (`IonicModule.forRoot({ mode: 'ios' })`), TypeScript, Cordova (Umstieg auf Capacitor geplant)
- Start: `npm install`, dann `npm start` → `http://localhost:4200` in **Chrome** (Web Bluetooth läuft nicht in Safari)
- Build-Prüfung vor jedem Commit: `npx ng build` muss fehlerfrei durchlaufen
- Texte über ngx-translate: neue Schlüssel immer in `src/assets/i18n/en.json` **und** `de.json` eintragen

## Design-Grundlage: Emil-Kowalski-Skills

Die Skills unter `.claude/skills/` (aus [emilkowalski/skills](https://github.com/emilkowalski/skills), MIT, siehe `.claude/skills/LICENSE-emilkowalski-skills`) sind die verbindliche Grundlage für Gestaltung, Bewegung und Bedienung. Ergänzend: `docs/design/ui-cheatsheet.md` und `docs/design/performance-cheatsheet.md`.

| Situation | Skill |
|---|---|
| Neue Oberfläche, Komponente, Detail-Politur | `emil-design-eng`, `apple-design` |
| Seite für das Smartphone bauen oder prüfen | `mobile-native` (Basisregeln sind bereits umgesetzt) |
| Animation bauen | `animate`, mehrere Elemente gleichzeitig: `choreograph` |
| Ziehen, Wischen, Sheets (z. B. Teile-Auswahl im Streckeneditor) | `gestures` |
| Animation ruckelt | `animation-performance` |
| Bestehende Bewegung prüfen | `review-animations`, `improve-animations` |
| Zu viel Bewegung | `remove-animations` |
| Wo fehlt Bewegung? | `find-animation-opportunities` |
| Neue Ansicht mit Extremdaten testen (lange Namen, 0 oder 999 Teile) | `break-ui` |
| Varianten zur Auswahl zeigen | `prototype` |
| Richtige Bibliothek wählen | `pick-ui-library` – nur Angular-taugliche Bibliotheken übernehmen |

**Übertragung auf Angular/Ionic:** Die Skills nennen oft React- und Motion-Beispiele. Die Prinzipien (Kurven, Dauer, Eigenschaften, Unterbrechbarkeit) gelten unverändert; umgesetzt wird mit CSS-Transitions, der Web Animations API oder Ionic `createAnimation` / `createGesture` – keine React-Bibliotheken einführen.

**Nicht anwenden:** `animate-expo` (React Native), `ask-sonner` (React-Bibliothek). `write-swift` erst, falls später nativer Swift-Code entsteht.

## Gestaltungsregeln

- Apple Human Interface Guidelines; iOS-Systemfarben im Dunkelmodus (`src/theme/variables.scss`)
- **Intuitiv, keine verschachtelten Menüs:** Tab-Leiste (Garage, Strecke, Rennen, Statistik), höchstens zwei Ebenen tief
- Touch-Ziele mindestens 44 × 44 pt; Zoom nie sperren
- Hover-Effekte nur in `@media (hover: hover) and (pointer: fine)`
- Produktfotos von Carrera nicht verwenden – Teile-Vorschaubilder als SVG aus der Geometrie erzeugen
- „Carrera“ nur beschreibend nennen („für Carrera DIGITAL 132“), nicht im App-Namen oder Logo

## Arbeitsweise

- Jede Funktion in einem eigenen Branch (`feature/...`), Inhaber testet vor dem Zusammenführen
- Oberfläche nach Änderungen im Browser mit iPhone-Größe (390 × 844) prüfen; Touch-Verhalten, Safe Areas und Bluetooth lassen sich nur auf echter Hardware bestätigen – das ehrlich so benennen
- Lizenzhinweise von Open Lap (Apache 2.0) und den Skills (MIT) nicht entfernen; Änderungen am Fork sind im README vermerkt
- Umsetzungsplan und Stand: Projekt-Dokument `claude/Umsetzungsplan.md` (claude.ai-Projekt „Carrera App“)
