#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1 && [[ -x "$HOME/.hermes/node/bin/node" ]]; then
  export PATH="$HOME/.hermes/node/bin:$PATH"
fi
if ! command -v pnpm >/dev/null 2>&1; then
  print '请先安装 pnpm，并在网页端目录运行 pnpm install。'
  read -r '?按回车关闭…'
  exit 1
fi
exec pnpm dev --open
