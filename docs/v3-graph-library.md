# Dynamic graph library

The previous view placed up to 40 neighbours on fixed SVG rings. The replacement uses `react-force-graph-2d` for a force-directed Canvas layout. The graph must support direct manipulation: drag a node, pan the space, zoom, select a node, and fit the view. Selection must not restart the layout or replace the whole graph.

| Library | Fit for this app | Decision |
| --- | --- | --- |
| [react-force-graph-2d](https://github.com/vasturiano/react-force-graph) | React binding, 2D Canvas, force physics, zoom/pan, node dragging, and click/hover callbacks | Selected for the requested Obsidian-like interaction. |
| [Cytoscape.js](https://js.cytoscape.org/) | Broad graph analysis, multiple layouts, styles, gestures, and extensions | Useful alternative, but the requested interaction fits the smaller force-graph surface. |

The app owns filtering, scope, item selection, colours, and accessible controls. The library owns node layout and Canvas interaction. Simulation objects must be separate from saved vault records. Moving a node is a view operation and never moves content files or changes saved relationships.

The graph defaults to meaningful connected items. Tags and bulk files need explicit controls because they create large hubs. Both endpoints of each edge must pass the selected Work/Personal scope. Any display limit must show the actual drawn count and the total.

Reduced motion stops automatic movement. Keyboard users need a searchable list of the same visible items because Canvas nodes are not native links. Graph code should load only when the graph is opened.

## Implemented and checked

The graph now has overview and local modes, search, a selected-item panel, drag/pan/zoom, Fit, layout stop/run, scope filters, and explicit limits. Dense views use a screen-space label budget and collision checks. Node positions stay in browser memory and are never written into the vault.

The production bundle separates the graph into a roughly 198 KB chunk (66 KB gzip). A read-only real-vault check confirmed that Today does not request it. Today became actionable in 1.5 seconds in that run. Desktop-to-phone resizing keeps the selected graph inside the viewport.

Validation includes 228 unit/integration tests, 27 dashboard checks, 5 progressive-loading checks, and 16 graph interaction checks on a fixture with a 2,500-link hub. Very large graphs can still have slow frames during layout; the draw limit and Stop control stay available. Source vaults were not written.
