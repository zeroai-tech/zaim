-- Baseline facts, prohibitions and goals.
--
-- These cannot be derived from sent mail, because they are the things that
-- must NOT be said as much as the things that may. A fresh install with an
-- empty facts table drafts with no guard at all: nothing stops it repeating
-- the "IBM Partner Plus Member and STEM.org Certified" wording that appears
-- in the old campaign sends and had to be withdrawn.
--
-- INSERT OR IGNORE throughout, so this is safe to re-run and never overwrites
-- a correction made later.

-- What may be stated, and how far.
INSERT OR IGNORE INTO facts (subject, claim, sensitivity, source, confidence) VALUES
  ('ZeroAI', 'Zambian company, founded by Lottie Mukuka, a Zambian citizen; builds from India for classrooms in India and across Africa', 'public', 'baseline', 0.95),
  ('ZeroAI Studio', 'six applications: circuits, block coding, Python, 3D design, electronics, machine learning; runs in 512MB of RAM', 'public', 'baseline', 0.95),
  ('Offline edition', 'installs from a USB stick and runs with no internet connection at all', 'public', 'baseline', 0.95),
  ('Punjab deployment', 'signed two year contract; a complete AI and robotics laboratory designed, built and installed by Lottie; over six hundred students use it weekly', 'public', 'baseline', 0.95),
  ('Founder experience', 'twelve years in AI and automation, two years building for K-12 classrooms', 'public', 'baseline', 0.95),
  ('IBM relationship', 'ZeroAI Technologies is an IBM Business Partner', 'public', 'baseline', 0.95),
  ('Pilot pricing', 'ten thousand five hundred US dollars for ten schools, seventeen thousand five hundred for twenty', 'public', 'baseline', 0.95),
  ('Legal entity', 'PACRA business name in Zambia and a sole proprietorship in India; there is no incorporated company', 'private', 'baseline', 0.95);

-- What must never be said. These are the claims that have already had to be
-- retracted, and the drafting prompt states them as prohibitions rather than
-- as guidance.
INSERT OR IGNORE INTO facts (subject, claim, sensitivity, source, confidence) VALUES
  ('IBM Partner Plus certification', 'ZeroAI is NOT IBM Partner Plus certified and issues its own certificates', 'never_claim', 'baseline', 0.99),
  ('STEM.org certification', 'ZeroAI is NOT STEM.org certified', 'never_claim', 'baseline', 0.99),
  ('Student reach', 'the 10,000+ figure is Lottie''s personal teaching over twelve years and must never be presented as platform users; the platform reached 600+ users in its first four months', 'never_claim', 'baseline', 0.99);

INSERT OR IGNORE INTO behavioral_rules (scenario, action, prohibition, confidence) VALUES
  ('Describing the company nationality', 'ZeroAI is Zambian-founded and operates from India. Never describe it as an Indian company.', 1, 0.95),
  ('Describing the products', 'Never call them small apps or tools. They are applications, a platform, a suite.', 1, 0.95),
  ('Naming a client contract value', 'Never publish a client contract value. Use it as a proof point only.', 1, 0.95),
  ('Third party tools', 'Credit by name, never imply partnership or endorsement.', 1, 0.95);

INSERT OR IGNORE INTO intent_models (goal, horizon, priority, success_looks_like) VALUES
  ('Land pilots in 10 to 20 schools per ministry or network', 'quarter', 9, 'a signed pilot or a named focal person at a ministry'),
  ('Raise 500k across pilots, patrons and grants', 'year', 8, 'committed investment, framed as investment not debt'),
  ('Get ZeroAI Studio in front of investors', 'quarter', 8, 'a polished offline and legacy product with credible branding');

-- Writing rules that are asserted rather than measured.
--
-- The em dash rule cannot be derived: 28.7% of the sent corpus contains one,
-- so counting says Lottie uses them. It is a stated preference that postdates
-- most of that corpus, which is exactly the kind of rule measurement cannot
-- find. Recorded here as asserted, with the conflict noted, rather than
-- quietly forced into the derivation where it would look measured.
INSERT OR IGNORE INTO writing_style (kind, scope, rule, rationale, confidence) VALUES
  ('hard', 'email',
   'Never use an em dash. Use a comma, a full stop, or a colon.',
   'Operator-asserted, not measured: 28.7% of the existing sent corpus contains one, so this rule postdates that writing.',
   0.99),
  ('hard', 'email',
   'Never state a URL, download link, trial length, licence term or account requirement that is not given to you as a fact. Refer to the website only as zeroaitech.tech.',
   'A draft invented zeroaitech.tech/download and a thirty day no-account trial. The site answers every path with the same page, so the link looked live and led nowhere.',
   0.99),
  ('hard', 'email',
   'Never invent a named programme, policy, department, job title or date for the recipient. Use only researched facts about them.',
   'Recipient specifics are where a model is most confidently wrong, and the reader is the one organisation certain to notice.',
   0.99);
