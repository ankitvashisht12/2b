#!/bin/sh
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf "2b V3 needs Node.js 22 or later. Install it, then run this launcher again.\n"
  read -r answer
  exit 1
fi
if [ ! -x .tools/surrealdb-2.3.10/surreal ]; then
  node --experimental-strip-types --no-warnings src/v3/install-surreal.ts || exit 1
fi
./bin/2b start
if [ "$?" -ne 0 ]; then
  printf '\nPress Return to close.\n'
  read -r answer
fi
