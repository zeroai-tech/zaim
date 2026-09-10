# nndb — the cognitive layer, vendored

Source of truth is `Code/nndb`. This copy ships inside the desktop app, which
is the only place the Claude subscription bridge can run: `claude -p` needs a
real shell, and Vercel has none.

Storage here is SQLite in the app's data directory, so an install needs no
credentials and the cognition never leaves the device. Set the Cloudflare D1
variables instead if the same cognition should follow you across machines.

Sync a change made upstream with:

    cp -R ../../nndb/src ../../nndb/sql .
