#!/bin/bash
# Copy tree-sitter grammar WASM files into dist/grammars/
# This ensures they are bundled with the npm package and available
# when the package is installed via npx (where node_modules exists
# but grammar packages may not have their WASM files).
#
# Also copies the web-tree-sitter engine WASM.

set -e
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT_DIR/dist/grammars"
mkdir -p "$DEST_DIR"

# Source: node_modules/<pkg>/<wasm-file>
# Dest:   dist/grammars/<pkg>/<wasm-file>
copy_wasm() {
	local pkg="$1"
	local file="$2"
	local src="$ROOT_DIR/node_modules/$pkg/$file"
	local dest="$DEST_DIR/$pkg/$file"

	if [ -f "$src" ]; then
		mkdir -p "$(dirname "$dest")"
		cp "$src" "$dest"
		echo "  ✓ $pkg/$file"
	else
		echo "  ✗ $pkg/$file NOT FOUND"
	fi
}

echo "Copying grammar WASM files..."

# Grammar WASM files
copy_wasm "tree-sitter-javascript" "tree-sitter-javascript.wasm"
copy_wasm "tree-sitter-typescript" "tree-sitter-typescript.wasm"
copy_wasm "tree-sitter-typescript" "tree-sitter-tsx.wasm"
copy_wasm "tree-sitter-go"       "tree-sitter-go.wasm"
copy_wasm "tree-sitter-python"   "tree-sitter-python.wasm"
copy_wasm "tree-sitter-php"      "tree-sitter-php_only.wasm"
copy_wasm "tree-sitter-dart"     "tree-sitter-dart.wasm"
copy_wasm "tree-sitter-rust"     "tree-sitter-rust.wasm"
copy_wasm "tree-sitter-java"     "tree-sitter-java.wasm"
copy_wasm "tree-sitter-kotlin"   "tree-sitter-kotlin.wasm"
copy_wasm "tree-sitter-ruby"     "tree-sitter-ruby.wasm"
copy_wasm "tree-sitter-swift"    "tree-sitter-swift.wasm"
copy_wasm "tree-sitter-c"        "tree-sitter-c.wasm"
copy_wasm "tree-sitter-cpp"      "tree-sitter-cpp.wasm"

# Engine WASM (web-tree-sitter itself)
copy_wasm "web-tree-sitter"      "web-tree-sitter.wasm"

echo ""
echo "Done. Copied files:"
find "$DEST_DIR" -name "*.wasm" | sort
