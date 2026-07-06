# Sprint 5: Soul Maintenance & Dashboard Graph

**Sprint Goal:** Implement biological-style memory decay (Soul Maintenance) with tag immunization, and render structured Knowledge Graph relations on the Svelte dashboard.

## Backlog Items
1. [UA-09] Implement Soul Maintenance: Apply importance decay algorithms over time. Add tag-based immunization logic to exclude specific memories from decay.
2. [UA-10] Design background/startup maintenance job to process decayed memories and archive them to legacy storage.
3. [UA-11] Extend Svelte 5 Dashboard: Visualize Knowledge Graph entities and relations using a network/graph library (e.g. Vis.js or D3-force).
4. [UA-12] Implement interactive UI elements on the dashboard to manually curate, connect, or delete entities/relations.

## Dependencies
Sprint 4 (Decay model benefits from NLP-extracted tags, and graph needs to render populated relations).
