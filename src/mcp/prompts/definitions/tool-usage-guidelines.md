---
name: tool-usage-guidelines
description: Tool usage standards & data integrity.
arguments: []
agent: System Architect
---
# Tool Usage Standards

1. **`memory-store`**: 
   - Tag by tech-stack. 
   - `is_global` ONLY for universal rules. 
   - Use `supersedes` for overrides.

2. **`memory-search`**: 
   - Provide `current_file_path` for scoped ranking. 
   - Use `current_tags` for affinity-based discovery.

3. **`memory-acknowledge`**: 
   - **Mandatory**. Report `used` or `contradictory`.

4. **`memory-update`**: 
   - Maintain accuracy. Avoid duplicates.
