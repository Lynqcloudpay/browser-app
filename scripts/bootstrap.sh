#!/bin/bash
# KindredStudio one-line installer. Safe to run again at any time (it updates and re-verifies).
#
#   curl -fsSL https://raw.githubusercontent.com/Lynqcloudpay/browser-app/main/scripts/bootstrap.sh | bash
#   ... | bash -s -- --start      # also start the app and open it in your browser when done
#
# Optional: KINDRED_DIR=/some/folder to install somewhere other than ~/browser-app.
#
# Everything is inside main() so bash reads the WHOLE script before running anything
# (otherwise commands like brew could swallow the rest of a piped script).

main() {
  set -e
  REPO_URL="https://github.com/Lynqcloudpay/browser-app.git"
  DIR="${KINDRED_DIR:-$HOME/browser-app}"
  START=0
  for arg in "$@"; do
    if [ "$arg" = "--start" ]; then START=1; fi
  done

  say() { printf '%s\n' "$*"; }
  die() { say ""; say "SETUP FAILED: $*"; exit 1; }

  say "KindredStudio installer"
  say "Install folder: $DIR"
  if [ "$(uname -s)" != "Darwin" ]; then
    say "WARNING: this is not macOS. The browser automation and daily scheduler are written for a Mac."
  fi

  # 1. git
  if ! command -v git >/dev/null 2>&1; then
    die "git is not installed. On a Mac run: xcode-select --install   (then paste the install line again)"
  fi

  # 2. Node.js 20 or newer
  node_ok() {
    command -v node >/dev/null 2>&1 || return 1
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
    [ "$major" -ge 20 ] 2>/dev/null
  }
  if ! node_ok; then
    if command -v brew >/dev/null 2>&1; then
      say "Node.js 20+ not found — installing it with Homebrew..."
      (brew install node || brew upgrade node) </dev/null || die "Homebrew could not install Node.js. Install Node 20+ from https://nodejs.org and paste the install line again."
      hash -r
    else
      die "Node.js 20 or newer is required. Install it from https://nodejs.org (or install Homebrew from https://brew.sh), then paste the install line again."
    fi
    node_ok || die "Node.js is still missing or older than 20. Install it from https://nodejs.org and paste the install line again."
  fi
  say "Node.js $(node -v) OK, git OK"

  # 3. Download (or update) the project
  if [ -d "$DIR/.git" ]; then
    say "Updating the existing copy..."
    git -C "$DIR" pull --ff-only </dev/null || say "(could not update — continuing with the code that is already there)"
  elif [ -e "$DIR" ]; then
    die "$DIR already exists but is not this project. Use another folder:  KINDRED_DIR=\$HOME/kindred-studio  (put that before 'bash')."
  else
    say "Downloading the project..."
    git clone "$REPO_URL" "$DIR" </dev/null || die "could not download $REPO_URL (check your internet connection)."
  fi

  # 4. Install + verify everything (prints SETUP OK / SETUP FAILED: <step>)
  cd "$DIR"
  node scripts/setup.mjs </dev/null

  say ""
  say "Installed in: $DIR"
  if [ "$START" = "1" ]; then
    say "Starting the app... (press Ctrl-C in this window to stop it)"
    if command -v open >/dev/null 2>&1; then
      (sleep 8; open "http://localhost:5173") &
    fi
    exec npm run dev
  else
    say "To start it:  cd \"$DIR\" && npm run dev     then open http://localhost:5173"
  fi
}

main "$@"
