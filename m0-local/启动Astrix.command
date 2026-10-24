#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1 && [[ -x "$HOME/.hermes/node/bin/node" ]]; then
  export PATH="$HOME/.hermes/node/bin:$PATH"
fi
if [[ ! -f node_modules/electron/path.txt ]]; then
  print '请先在此目录运行 npm install，然后再次启动。'
  read -r '?按回车关闭…'
  exit 1
fi
exec npm run desktop
