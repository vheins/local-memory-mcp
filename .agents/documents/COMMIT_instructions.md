# Commit Instructions

Run these commands in order from `/home/vheins/Projects/local-memory-mcp`:

```bash
# Stage all changes
git add .

# Commit
git commit -F - <<'EOF'
feat: all tool id parameters now accept code fallback

- All tool schemas: id/memory_id/task_id accept UUID or code string
- All tool handlers: non-UUID values resolve via getByCode()
- decision-log.ts: auto-supersedes on content conflict
- detail tools: memory-detail, standard-detail, task-detail
- DRY: UUID_REGEX extracted to src/mcp/utils/uuid.ts
- Tests: 379 passing
EOF

# Push
git push
```
