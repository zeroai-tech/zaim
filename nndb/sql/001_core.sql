-- NNDB — the cognitive layer behind Zaim.
--
-- Cloudflare D1 is SQLite, so there is no vector type and no array type.
-- Embeddings are stored as a raw float32 BLOB and compared in the process that
-- reads them. At this corpus size (low thousands of vectors, 384 dimensions,
-- about 1.5KB each) a full scan costs single-digit milliseconds, which is
-- cheaper and far simpler than standing up a second vector service.
--
-- Weights are not learned parameters. They are explicit, inspectable numbers:
-- confidence (how sure we are), recency (when it was last seen) and hits (how
-- often it has been used). Calling them neural would be flattering; they are a
-- ranking function, and being able to read why a rule fired matters more here
-- than pretending otherwise.

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────── cognitive layer ──
-- How Lottie decides, writes, and behaves. These constrain generation.

CREATE TABLE IF NOT EXISTS thought_patterns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  -- The trigger is matched against a drafting request; the rule is what to do.
  trigger       TEXT NOT NULL,
  rule          TEXT NOT NULL,
  evidence      TEXT,                    -- where this was observed, verbatim
  confidence    REAL NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  hits          INTEGER NOT NULL DEFAULT 0,
  last_seen_at  INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS writing_style (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'hard' rules are never violated (no em dashes). 'soft' are preferences.
  kind          TEXT NOT NULL CHECK (kind IN ('hard','soft')),
  scope         TEXT NOT NULL DEFAULT 'email',   -- email | social | any
  rule          TEXT NOT NULL,
  rationale     TEXT,
  example_good  TEXT,
  example_bad   TEXT,
  confidence    REAL NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  hits          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (scope, rule)
);

CREATE TABLE IF NOT EXISTS intent_models (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  goal          TEXT NOT NULL UNIQUE,
  horizon       TEXT CHECK (horizon IN ('now','quarter','year','always')),
  priority      INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  success_looks_like TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS behavioral_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario      TEXT NOT NULL,
  action        TEXT NOT NULL,
  -- A prohibition is enforced differently from a preference: it becomes a
  -- refusal in the prompt rather than guidance.
  prohibition   INTEGER NOT NULL DEFAULT 0,
  confidence    REAL NOT NULL DEFAULT 0.5,
  hits          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (scenario, action)
);

-- ─────────────────────────────────────────────────── knowledge layer ──

CREATE TABLE IF NOT EXISTS facts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subject       TEXT NOT NULL,
  claim         TEXT NOT NULL,
  -- Claims about traction and credentials have burned this company before, so
  -- every fact carries how safe it is to state publicly.
  sensitivity   TEXT NOT NULL DEFAULT 'public'
                CHECK (sensitivity IN ('public','private','never_claim')),
  source        TEXT,
  confidence    REAL NOT NULL DEFAULT 0.8,
  valid_from    INTEGER,
  valid_until   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (subject, claim)
);

CREATE TABLE IF NOT EXISTS entities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN ('person','org','project','tool','place')),
  name          TEXT NOT NULL,
  email         TEXT,
  handle        TEXT,
  notes         TEXT,
  first_seen_at INTEGER,
  last_seen_at  INTEGER,
  touches       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, name)
);
CREATE INDEX IF NOT EXISTS idx_entities_email ON entities(email);

CREATE TABLE IF NOT EXISTS relationships (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  src_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dst_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 1.0,
  last_seen_at  INTEGER,
  UNIQUE (src_id, dst_id, kind)
);

CREATE TABLE IF NOT EXISTS conversation_memory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel       TEXT NOT NULL CHECK (channel IN ('email','claude_code','social','note')),
  external_ref  TEXT,                    -- imap uid, transcript path, post id
  entity_id     INTEGER REFERENCES entities(id) ON DELETE SET NULL,
  occurred_at   INTEGER NOT NULL,
  -- Compressed, not the raw log: what happened and what it implies.
  summary       TEXT NOT NULL,
  outcome       TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (channel, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_convmem_time ON conversation_memory(occurred_at DESC);

-- ─────────────────────────────────────────────────────── asset layer ──

CREATE TABLE IF NOT EXISTS templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  purpose       TEXT NOT NULL,
  skeleton      TEXT NOT NULL,           -- the move-by-move shape, not prose
  derived_from  INTEGER,                 -- writing_samples.id it was learned from
  uses          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS artifacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,           -- proposal | pitch | post | card | doc
  title         TEXT NOT NULL,
  location      TEXT,                    -- path or URL, content is not copied here
  summary       TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────────────── embedding layer ──
-- One table for every embeddable thing, discriminated by source_kind, so
-- semantic search is a single scan rather than a union across tables.

CREATE TABLE IF NOT EXISTS writing_samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind   TEXT NOT NULL CHECK (source_kind IN ('sent_email','prompt','post','doc')),
  external_ref  TEXT,
  recipient     TEXT,
  subject       TEXT,
  body          TEXT NOT NULL,
  words         INTEGER NOT NULL DEFAULT 0,
  occurred_at   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (source_kind, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_samples_kind ON writing_samples(source_kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS embeddings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind   TEXT NOT NULL,           -- writing_sample | fact | pattern | memory
  source_id     INTEGER NOT NULL,
  model         TEXT NOT NULL,
  dims          INTEGER NOT NULL,
  -- float32 little-endian, dims * 4 bytes. Stored raw: D1 has no vector type,
  -- and JSON would roughly triple the size for no benefit.
  vector        BLOB NOT NULL,
  norm          REAL NOT NULL,           -- precomputed, so scoring is one dot product
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (source_kind, source_id, model)
);

-- ─────────────────────────────────────────────────────── graph layer ──
-- Nodes and edges over everything above, so recall can walk associations
-- rather than only ranking by cosine distance.

CREATE TABLE IF NOT EXISTS nodes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,           -- mirrors a table name
  ref_id        INTEGER NOT NULL,
  label         TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 1.0,
  UNIQUE (kind, ref_id)
);

CREATE TABLE IF NOT EXISTS edges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  src           INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst           INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 1.0,
  UNIQUE (src, dst, kind)
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);

-- ────────────────────────────────────────────────────── feedback loop ──
-- Corrections are the only way the weights move after ingestion. Recording the
-- before and after means a rule can be re-derived, not just overwritten.

CREATE TABLE IF NOT EXISTS corrections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  target_kind   TEXT NOT NULL,           -- writing_style | thought_pattern | fact
  target_id     INTEGER,
  drafted       TEXT,
  corrected     TEXT,
  note          TEXT,
  applied       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS cognition_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT NOT NULL,
  note          TEXT,
  rules_hash    TEXT,                    -- hash of the active rule set
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
