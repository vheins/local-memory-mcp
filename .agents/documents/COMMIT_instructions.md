# Commit Instructions

This document tracks the latest commit operations for the `@vheins/local-memory-mcp` repository.

## Latest Commit Pattern

```bash
# Stage all changes
git add .

# Commit with conventional message
git commit -F - <<'EOF'
<type>(<scope>): <description>

- <bullet point changes>
- <referenced issues>
EOF
```

## Conventional Commit Types

| Type       | Use Case                            |
| :--------- | :---------------------------------- |
| `feat`     | New feature                         |
| `fix`      | Bug fix                             |
| `docs`     | Documentation changes               |
| `test`     | Test changes                        |
| `refactor` | Code change without behavior change |
| `chore`    | Maintenance or dependency updates   |

## Commit Message Rules

- First line: `type(scope): description` (max 72 chars)
- Body: Bullet points with specific changes
- Footer: If referencing a GitHub issue, append `keyword #N` (e.g., `fix #1423`)

## Push

```bash
git push
```

**Note:** Never use `git push --force` or `--force-with-lease`. Use `git revert` for undoing changes.
