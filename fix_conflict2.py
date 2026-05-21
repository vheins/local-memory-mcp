import re

with open('src/mcp/tests/router.test.ts', 'r') as f:
    content = f.read()

conflict_pattern = re.compile(r'<<<<<<< HEAD\n.*?\n=======\n(.*?)\n>>>>>>> origin/main', re.DOTALL)
resolved_content = conflict_pattern.sub(r'\1', content)

with open('src/mcp/tests/router.test.ts', 'w') as f:
    f.write(resolved_content)
