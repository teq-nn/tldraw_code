# Spec: Canvas-first Grilling & Wayfinder mit Claude Code

## Problem Statement

Grilling- und Wayfinder-Sessions (Matt Pocock Skills) mit Claude Code sind inhaltlich wertvoll, aber kognitiv anstrengend: Alles läuft als Text im Terminal. Fragen, Begründungen, Alternativen und der Stand der Entscheidungen müssen gelesen und im Kopf zusammengehalten werden. Der Überblick über die Frontier (offene, geklärte, blockierte Entscheidungen) geht schnell verloren, und Vergleiche von Alternativen (z. B. Datenformate, UI-Varianten) werden nur verbal beschrieben, statt gezeigt.

## Solution

Die gesamte Interaktion mit Claude Code findet auf einem tldraw-Canvas statt, so als würden zwei Personen gemeinsam ein Whiteboard bearbeiten:

- Die Wayfinder-Frontier wird als Graph dargestellt (Entscheidungen als Knoten, Abhängigkeiten als Kanten, Status farbcodiert).
- Claude stellt Fragen als kurze Fragekarten mit Antwort-Buttons und markierter Empfehlung. Der Nutzer antwortet per Klick, Sticky Note oder Annotation im Canvas, nicht im Terminal.
- Claude wählt die Form jeder Frage so, dass möglichst wenig gelesen werden muss: Faktenfragen als Karte, Struktur- und Flussfragen als nebeneinanderliegende Diagramme, UI-Fragen als klickbare Prototypen nebeneinander.
- Der Nutzer kann auch selbst zeigen: Ein angeklickter Knoten wird zum nächsten Grilling-Thema, Kritzeleien auf Prototypen werden als Feedback verstanden.
- Getroffene Entscheidungen werden am Knoten angeheftet. Verworfene Varianten bleiben eingeklappt als Begründung erhalten.

## User Stories

1. Als Entwickler möchte ich eine Grilling-Session starten, die sich komplett im Canvas abspielt, damit ich nicht lange Texte im Terminal lesen muss.
2. Als Entwickler möchte ich die Wayfinder-Frontier als Graph sehen, damit ich auf einen Blick erkenne, welche Entscheidungen offen, geklärt oder blockiert sind.
3. Als Entwickler möchte ich, dass Abhängigkeiten zwischen Entscheidungen als Kanten sichtbar sind, damit ich verstehe, warum eine Entscheidung noch nicht getroffen werden kann.
4. Als Entwickler möchte ich, dass die aktuelle Frontier visuell hervorgehoben ist, damit ich weiß, woran gerade gearbeitet wird.
5. Als Entwickler möchte ich, dass der Graph automatisch sauber gelayoutet wird, damit ich Knoten nicht manuell anordnen muss.
6. Als Entwickler möchte ich Fragen als kurze Karten mit höchstens einem Satz erhalten, damit meine Lesebelastung gering bleibt.
7. Als Entwickler möchte ich 2–4 Antwortoptionen als Buttons bekommen, damit ich mit einem Klick antworten kann.
8. Als Entwickler möchte ich, dass Claudes Empfehlung auf der Fragekarte markiert ist, damit ich schnell zustimmen kann, wenn ich keine eigene Meinung habe.
9. Als Entwickler möchte ich per Sticky Note neben einer Fragekarte frei antworten können, damit ich nicht auf vorgegebene Optionen beschränkt bin.
10. Als Entwickler möchte ich „Weiter grillen" wählen können, damit ich eine Frage vertiefen kann, statt sie sofort zu entscheiden.
11. Als Entwickler möchte ich, dass beantwortete Fragen zu einem kurzen Label am zugehörigen Knoten schrumpfen, damit der Graph selbst die Historie ist.
12. Als Entwickler möchte ich einen Knoten anklicken können, um ihn zum nächsten Grilling-Thema zu machen, damit ich die Reihenfolge mitbestimmen kann.
13. Als Entwickler möchte ich, dass Claude bei Struktur- oder Datenflussfragen zwei Diagramme nebeneinander zeigt, damit ich Alternativen visuell statt verbal vergleiche.
14. Als Entwickler möchte ich, dass Unterschiede zwischen zwei Diagrammen farbig hervorgehoben sind, damit ich sie sofort erkenne.
15. Als Entwickler möchte ich, dass Vergleichsdiagramme im gleichen Layout-Stil gerendert werden, damit die Unterschiede nicht durch Layout-Zufälle verzerrt werden.
16. Als Entwickler möchte ich Diagramme als native Canvas-Shapes erhalten, damit ich Knoten verschieben, markieren und hineinkritzeln kann.
17. Als Entwickler möchte ich bei UI-Entscheidungen 2–3 klickbare Prototypen nebeneinander sehen, damit ich Varianten ausprobieren statt mir vorstellen muss.
18. Als Entwickler möchte ich zu jedem Prototyp einen Satz zum Unterschied lesen, damit ich weiß, worauf ich achten soll.
19. Als Entwickler möchte ich direkt auf einen Prototyp kritzeln oder eine Notiz kleben können, damit mein Feedback räumlich präzise ist.
20. Als Entwickler möchte ich, dass Claude meine Annotation dem richtigen Prototyp zuordnet und eine neue Iteration daneben baut, damit ich iterativ verfeinern kann.
21. Als Entwickler möchte ich, dass Prototypen vorhandene Komponenten und Styles aus meinem Repo nutzen, damit sie realistisch aussehen.
22. Als Entwickler möchte ich, dass die gewählte Variante als Thumbnail oder Link am Entscheidungsknoten angeheftet wird, damit die Entscheidung dokumentiert ist.
23. Als Entwickler möchte ich, dass verworfene Varianten eingeklappt erhalten bleiben, damit die Begründung später nachvollziehbar ist.
24. Als Entwickler möchte ich, dass Claude selbst entscheidet, ob eine Frage als Karte, Diagrammvergleich oder Prototyp gestellt wird, damit ich immer die leichteste Form bekomme.
25. Als Entwickler möchte ich, dass der Graph nach jeder Antwort automatisch aktualisiert wird, damit der Canvas immer den aktuellen Stand zeigt.
26. Als Entwickler möchte ich, dass die Tickets im Repo die Quelle der Wahrheit bleiben, damit der Canvas nur eine Ansicht ist und nichts verloren geht.
27. Als Entwickler möchte ich eine Session unterbrechen und später fortsetzen können, damit ich nicht alles in einem Durchgang erledigen muss.
28. Als Entwickler möchte ich sehen, ob Claude gerade arbeitet oder auf mich wartet, damit ich weiß, wann ich dran bin.
29. Als Entwickler möchte ich, dass eine unbeantwortete Frage nach einem Timeout nicht die Session abbricht, damit ich Pausen machen kann.
30. Als Entwickler möchte ich, dass Claude den Canvas-Zustand inklusive Screenshot sieht, damit es meine Skizzen semantisch versteht.
31. Als Entwickler möchte ich, dass Claude nur eine Frage gleichzeitig stellt, damit ich nicht überfordert werde.
32. Als Entwickler möchte ich den Canvas lokal im Browser öffnen, während Claude Code im Repo läuft, damit ich keine zusätzliche Infrastruktur brauche.

## Implementation Decisions

- **Canvas-Technologie:** tldraw statt Excalidraw, wegen vollständiger Editor-API, Custom Shapes und Store-Listenern.
- **Basis:** tldraws MIT-lizenziertes Agent Starter Kit als Ausgangspunkt, statt eines kompletten Eigenbaus. Dessen Chat-Backend wird durch Claude Code ersetzt.
- **Brücke:** Ein lokaler MCP-Server verbindet Claude Code mit der Canvas-App im Browser über WebSocket.
- **Tool-Schnittstelle des MCP-Servers:**
  - `render_graph(graph)`: rendert bzw. aktualisiert den Frontier-Graphen.
  - `add_node` / `update_node`: einzelne Entscheidungsknoten ändern.
  - `ask(question, options, recommendation)`: legt eine Fragekarte an und blockiert (Long-Poll), bis der Nutzer im Canvas antwortet. Die Antwort kommt als Tool-Result zurück.
  - `render_diagram(spec)`: nimmt Mermaid oder eine JSON-Graph-Spec entgegen und erzeugt native Shapes.
  - `compare(items, question)`: legt 2–3 Diagramme oder Prototypen in Frames nebeneinander, hebt Unterschiede hervor und hängt eine Fragekarte an.
  - `render_prototype(html, label)`: zeigt eine eigenständige HTML-Datei in einer Custom Shape mit sandboxed iframe.
  - `read_canvas(region?)`: liefert Shape-Daten plus Screenshot des relevanten Bereichs.
- **Layout:** Claude liefert nur Struktur, das Layout übernimmt ELK oder dagre. LLMs sind schlecht im Platzieren von Koordinaten.
- **Timeout-Verhalten:** `ask` gibt nach einer festen Zeit „noch keine Antwort" zurück. Claude stellt die Frage dann erneut bzw. wartet weiter, ohne die Session abzubrechen.
- **Datenmodell:** Wayfinder-Tickets bleiben Dateien bzw. Issues im Repo und sind die Quelle der Wahrheit. Der Canvas ist eine abgeleitete Ansicht. Status-Werte: offen, geklärt, blockiert. Frontier wird aus den Abhängigkeiten berechnet.
- **Custom Shapes:** Fragekarte (Text, Buttons, Empfehlungsmarker), Entscheidungsknoten (Status, eingeklappte Varianten, Thumbnail), Prototyp-Frame (iframe).
- **Skill-Varianten:** Canvas-Versionen der Grilling- und Wayfinder-Skills mit den Regeln: Fragen ausschließlich über `ask`, genau eine pro Aufruf, immer mit Optionen und Empfehlung; Frageform wählen nach Faktenfrage → Karte, Struktur/Fluss → Diagrammvergleich, UI → Prototypen; nach jeder Antwort Graph aktualisieren.
- **Wahrnehmung:** Bei jedem Schritt erhält Claude Shape-Daten und einen Screenshot, da Agenten nur beim Prompten neuen Kontext bekommen und Shape-Daten allein die Bedeutung von Skizzen nicht transportieren.
- **Annotation-Zuordnung:** Annotationen werden über räumliche Überlappung bzw. Nähe dem jeweiligen Prototyp- oder Diagramm-Frame zugeordnet.

## Testing Decisions

- **Gute Tests** prüfen nur externes Verhalten, keine Implementierungsdetails.
- **Vorgeschlagener Seam (höchstmöglich, ein einziger):** die Tool-Schnittstelle des MCP-Servers. Tests rufen Tools auf und prüfen das Ergebnis gegen einen simulierten Canvas-Client (Fake-WebSocket-Gegenstelle), der Shapes empfängt und Nutzerantworten einspielen kann. *Dieser Seam ist ein Vorschlag und noch nicht mit dem Nutzer abgestimmt.*
- **Zu testende Module:**
  - MCP-Server: Tool-Aufrufe erzeugen die erwarteten Canvas-Befehle; `ask` blockiert, liefert die Antwort und verhält sich beim Timeout korrekt.
  - Graph-Ableitung: Tickets aus dem Repo ergeben den korrekten Graphen inklusive Frontier und Status.
  - Diagramm-Konvertierung: Mermaid/JSON-Spec ergibt korrekte Knoten und Kanten.
- **Prior Art:** Kein bestehendes Repo vorhanden, daher keine vorhandenen Tests als Vorlage.

## Out of Scope

- Multi-Agent-Orchestrierung mehrerer Agenten auf dem Canvas (wie bei tldraw Fairies).
- Echter Multiplayer mit mehreren menschlichen Nutzern.
- Spracheingabe.
- Hosting bzw. Cloud-Betrieb; alles läuft lokal.
- Bidirektionale Synchronisation, bei der Änderungen im Canvas die Repo-Tickets direkt umschreiben (außer über Claudes Aktionen).
- Excalidraw-Unterstützung.

## Further Notes

- **Inspiration:** tldraw Fairies (Experiment vom Dezember 2025, inzwischen aus tldraw.com entfernt) sowie ein im Talk „The Spatial Harness" (Max Drake) gezeigtes Tech-Tree-Konzept, das einen Abhängigkeitsgraphen als Manager für Coding-Agenten nutzt. Ob Tech Tree und die dort gezeigte tldraw-Desktop-App mit Scripting-API öffentlich verfügbar sind, ist ungeklärt.
- **Offene Risiken:**
  - Verhalten sehr lange blockierender Tool-Calls in Claude Code ist nicht verifiziert.
  - Volle Interaktivität von iframes in tldraw Custom Shapes (Zoom, Events) muss getestet werden.
  - Qualität der semantischen Interpretation von Kritzeleien hängt stark vom Screenshot ab.
- **Alternative:** Claude Agent SDK statt Claude Code, wobei die Canvas-App die Agenten-Schleife selbst steuert. Mehr Kontrolle, mehr Eigenbau.
- **MVP-Reihenfolge:**
  1. tldraw-App plus MCP-Server mit nur `render_graph` und `ask`.
  2. Eine Grilling-Session komplett im Canvas durchspielen.
  3. Wayfinder-Graph mit Repo-Sync.
  4. `render_diagram`, `compare`, `render_prototype`.
