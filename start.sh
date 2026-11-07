#!/bin/sh
# Commander Table for Mac and Linux: starts the local server (server.py) and opens the game.
# Run it from a terminal:  sh start.sh      (Python 3.8 or newer is needed; macOS and most Linux have it)
# Check this computer first:  sh start.sh --check
cd "$(dirname "$0")" || exit 1
if [ ! -f server.py ] || [ ! -d public ]; then
  echo "Run this from the Commander Table folder (server.py and the public folder must be next to it)."
  exit 1
fi
for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1 && "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
    exec "$py" server.py "$@"
  fi
done
echo "Commander Table needs Python 3.8 or newer."
echo "  macOS:  run  xcode-select --install  (or get Python from python.org)"
echo "  Linux:  install the python3 package with your package manager"
exit 1
