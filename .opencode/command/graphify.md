---
description: Visualize codebase structure as Mermaid graphs. Usage /graphify [scope]
agent: build
---

Run the graphify skill workflow. Target scope: $ARGUMENTS

1. If no scope given, inspect project structure, choose main application surface.
2. Search routes, entry points, manifests, service boundaries, components, models, dependency declarations.
3. Produce Mermaid diagrams revealing important relationships:
   - flowchart TD for architecture, routes, component hierarchies, data flow
   - sequenceDiagram for request lifecycles, user flows
   - classDiagram / erDiagram for domain models and data relationships
   - graph LR for dependency maps
4. Split large systems into smaller readable graphs.
5. Use stable names from the code; add file references for code-based graphs.
6. Note assumptions and omitted details.
