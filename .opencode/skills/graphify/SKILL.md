---
name: graphify
description: graphify, /graphify, dependency graph, architecture graph, Mermaid graph. Use when the user asks to visualize codebase structure, dependencies, call flows, routes, components, or data relationships as graphs.
---

# Graphify

Use this skill to turn codebase structure into concise, useful graphs.

## Workflow

1. Identify the user's target scope. If none is given, inspect the project structure and choose the main application surface.
2. Search for routes, entry points, package manifests, service boundaries, components, models, and dependency declarations.
3. Produce one or more Mermaid diagrams that reveal the important relationships.
4. Keep diagrams readable. Split large systems into smaller graphs rather than creating one dense graph.
5. Include a short note explaining what each graph shows and any assumptions or omitted details.

## Graph Types

- Use `flowchart TD` for architecture, routes, component hierarchies, and data flow.
- Use `sequenceDiagram` for request lifecycles and user flows.
- Use `classDiagram` or `erDiagram` for domain models and data relationships.
- Use `graph LR` for dependency maps.

## Output Rules

- Prefer Mermaid fenced code blocks.
- Use stable names from the code, not invented abstractions, unless summarizing a large cluster.
- Add file references when the graph is based on specific code locations.
- If the codebase is too large, graph the most relevant area first and state what was not covered.
