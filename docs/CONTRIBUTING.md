# Contributing Guidelines

Thank you for your interest in contributing to the MCP Local Memory Service!

## Reporting Issues
If you find a bug or have a feature idea:
1. Check if a similar issue has already been reported on [GitHub Issues](https://github.com/vheins/local-memory-mcp/issues).
2. If not, create a new issue with the label `bug` or `enhancement`.
3. Include details about your OS, Node.js version, and steps to reproduce the bug.

## Code Contribution Workflow
1. Fork this repository.
2. Create a new branch (`feat/feature-name` or `fix/bug-description`).
3. Ensure your code follows the project's TypeScript standards.
4. **Mandatory:** Add unit tests in `src/` or update `src/e2e.test.ts` if adding new features.
5. Run tests: `npm run test`.
6. Submit a Pull Request (PR) to the `main` branch.

## Quality Standards (Strict Rules)
- **Local-First:** Do not add cloud dependencies or external APIs without deep discussion.
- **SQLite Only:** All data persistence must use SQLite.
- **Strict Anti-Hallucination:** Do not lower the semantic search thresholds below the project's security standards.

## ⚠️ No Warranty & Liability
By contributing, you acknowledge that this project is provided **"AS IS"** without any warranty. You agree that the authors and maintainers are not liable for any damages arising from the use of this software.

## License
By contributing, you agree that your contributions will be licensed under the project's MIT License.
