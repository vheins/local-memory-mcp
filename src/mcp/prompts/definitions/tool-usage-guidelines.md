---
name: tool-usage-guidelines
description: Tool usage standards & data integrity.
arguments: []
agent: System Architect
category: workflows
version: "1.0.0"
tags: [workflow, tooling, memory, policy, mcp]
---

## Memory Flow

Entry=S0 → S1 → S2 → S3 → S4 → S5 Exit=maintained
Guard: S(N) req S(N-1)✅

S0 | navigate: agent-context(one-call session context) OR memory-recap (overview) / memory-search (targeted) | — | pointer rows | —
S1 | hydrate: memory-detail (id or code) before relying on content | S0✅ | full entry | —
S2 | store: memory-store(type+title+content+importance+agent+model+scope, durable only, tech tags, human title, aux in metadata) or decision-log(structured decisions) | — | stored | —
S3 | maintain: memory-update / supersedes for changes; avoid duplicates | — | updated | —
S4 | acknowledge: memory-acknowledge (used|irrelevant|contradictory) after code gen | code generated? | feedback | —
S5 | verify: confirm acknowledge called after code gen, no duplicate memories created | S4✅ | verified | —

## Knowledge Graph Tools

- `create-entity(key, name, entity_type, observations)`, `delete-entity(key)`
- `create-relation(source_key, target_key, relation_type)`, `delete-relation(source_key, target_key, relation_type)`
- `delete-observation(key, observation)`
- Specialized for structured data workflows only (entity-relationship modeling). Not part of standard memory/task flow.

## Standards Flow

Entry=S0 → S1 → S2 → S3 Exit=done
Guard: S(N) req S(N-1)✅

S0 | search: standard-search mandatory before code edit/test/refactor/migrate (query, lang, stack, repo) | — | applicable | —
S1 | apply precisely as implementation rules | S0✅ | compliant code | —
S2 | store: standard-store (1 rule/entry, name, content, context, version, lang, stack, tags, scope) | — | new entry | —
S3 | verify: confirm standard-search was called, scope and tags correct | S2✅ | verified | —

## Handoff & Claim Flow

Entry=S0 → S1 → S2 → S3 → S4 Exit=resolved
Guard: S(N) req S(N-1)✅

S0 | check: handoff-list (status, from/to agent) + claim-list | — | active state | —
S1 | ensure: NO handoff for completion summaries — use task-update or memory | — | valid | —
S2 | create: handoff-create (unfinished work only, summary + structured context) / task-claim (ownership) | S0✅ | pending | claimed | —
S3 | close: handoff-update (accepted|rejected|expired) / claim-release (stale ownership) | consumed | stale | resolved | —
S4 | verify: confirm no stale handoffs remain, claims reflect actual ownership | S3✅ | verified | —
