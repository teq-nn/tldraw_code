#!/usr/bin/env bash
# One-step setup of the tldraw-canvas MCP server (ADR 0032): checks the
# prerequisites before changing anything, installs the dependencies, builds the
# board script, then hands over to scripts/setup-mcp.ts (register, Stop hook,
# verify). Run it as `pnpm setup:mcp`, or directly when pnpm is not set up yet.
#
#   scripts/install.sh [--no-smoke]
#   scripts/install.sh --uninstall
set -euo pipefail
cd "$(dirname "$0")/.."

uninstall=false
smoke=true
for arg in "$@"; do
	case "$arg" in
	--uninstall) uninstall=true ;;
	--no-smoke) smoke=false ;;
	*)
		echo "usage: pnpm setup:mcp [--no-smoke | --uninstall]" >&2
		exit 2
		;;
	esac
done

problems=()
port="${CANVAS_BRIDGE_PORT:-4477}"

if ! command -v node >/dev/null 2>&1; then
	problems+=("node not found: install Node.js 22 or newer (https://nodejs.org, or \`nvm install 22\`)")
elif [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
	problems+=("Node.js $(node -v) is too old: install Node.js 22 or newer (\`nvm install 22\`)")
fi

if ! command -v pnpm >/dev/null 2>&1; then
	problems+=("pnpm not found: run \`corepack enable\` (ships with Node.js), then rerun")
elif [ "$(pnpm -v | cut -d. -f1)" -lt 10 ]; then
	problems+=("pnpm $(pnpm -v) is too old: run \`corepack enable\` so the repo's pinned pnpm 10 is used")
fi

if ! command -v claude >/dev/null 2>&1; then
	problems+=("claude (Claude Code CLI) not found: install it (https://docs.claude.com/en/docs/claude-code), then rerun")
fi

if [ "$uninstall" = false ]; then
	if ! command -v curl >/dev/null 2>&1; then
		problems+=("curl not found: the Stop hook that ends the working indicator needs it; install it with your package manager")
	fi
	if [ "$smoke" = true ] && command -v node >/dev/null 2>&1 &&
		! node -e 'const s = require("node:net").createServer()
s.once("error", () => process.exit(1))
s.listen(Number(process.argv[1]), "127.0.0.1", () => s.close())' "$port"; then
		problems+=("port $port is in use (CANVAS_BRIDGE_PORT), so the smoke check cannot start the server: quit what holds it (see \`ss -ltnp | grep $port\`; usually another Claude Code session with tldraw-canvas, or \`pnpm mcp\`), set CANVAS_BRIDGE_PORT, or pass --no-smoke")
	fi
fi

if [ "${#problems[@]}" -gt 0 ]; then
	echo "[setup:mcp] nothing changed; fix these first:" >&2
	for problem in "${problems[@]}"; do echo "  - $problem" >&2; done
	exit 1
fi

if [ "$uninstall" = false ]; then
	pnpm install --frozen-lockfile
	pnpm build:board-script
elif [ ! -x node_modules/.bin/tsx ]; then
	pnpm install --frozen-lockfile
fi

exec node_modules/.bin/tsx scripts/setup-mcp.ts "$@"
