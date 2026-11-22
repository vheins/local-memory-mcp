/**
 * Domain-database DDL (ADR-012 / TASK-002) — the four attached domain schemas.
 *
 * GENERATED from the live `main` schema produced by `MIGRATIONS` v01..v40 and
 * pinned here as static DDL, mirroring `initDerivedSchema`. A future migration
 * that alters a moved table must also update the statement below: migrations
 * only ever run against `main`, which stops holding these tables once the
 * one-time move completes (see `domain-db.ts` §"Forward hazard").
 *
 * Every statement is `IF NOT EXISTS`, so a retried or partially completed run is
 * safe. Table names are schema-qualified; `REFERENCES` targets inside a table
 * body stay UNQUALIFIED so they resolve inside the same attached schema, since
 * SQLite rejects a cross-database foreign key.
 */

/** Attached domain schemas. The `core` group is `main` and has no entry here. */
export const DOMAIN_SCHEMAS = ["tasks", "standards", "kg", "observability"] as const;

export type DomainSchema = (typeof DOMAIN_SCHEMAS)[number];


/** Tables, indexes and FTS indexes of the `tasks` domain file. */
export const TASKS_SCHEMA_DDL = `
		CREATE TABLE IF NOT EXISTS tasks.tasks (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			owner TEXT NOT NULL DEFAULT '',
			task_code TEXT NOT NULL,
			phase TEXT,
			title TEXT NOT NULL,
			description TEXT,
			status TEXT NOT NULL DEFAULT 'backlog',
			priority INTEGER NOT NULL DEFAULT 3,
			agent TEXT NOT NULL DEFAULT 'unknown',
			role TEXT NOT NULL DEFAULT 'unknown',
			doc_path TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			finished_at TEXT,
			canceled_at TEXT,
			tags TEXT,
			metadata TEXT,
			parent_id TEXT,
			depends_on TEXT,
			est_tokens INTEGER NOT NULL DEFAULT 0,
			in_progress_at TEXT,
			commit_id TEXT,
			changed_files TEXT, suggested_skills TEXT,
			FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL,
			FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE SET NULL
		);

		CREATE TABLE IF NOT EXISTS tasks.task_comments (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			repo TEXT NOT NULL,
			owner TEXT NOT NULL DEFAULT '',
			comment TEXT NOT NULL,
			agent TEXT NOT NULL DEFAULT 'unknown',
			role TEXT NOT NULL DEFAULT 'unknown',
			model TEXT NOT NULL DEFAULT 'unknown',
			previous_status TEXT,
			next_status TEXT,
			created_at TEXT NOT NULL,
			FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS tasks.claims (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			owner TEXT NOT NULL DEFAULT '',
			task_id TEXT NOT NULL,
			agent TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'unknown',
			claimed_at TEXT NOT NULL,
			released_at TEXT,
			metadata TEXT NOT NULL DEFAULT '{}',
			FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS tasks.handoffs (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			owner TEXT NOT NULL DEFAULT '',
			from_agent TEXT NOT NULL,
			to_agent TEXT,
			task_id TEXT,
			summary TEXT NOT NULL,
			context TEXT NOT NULL DEFAULT '{}',
			status TEXT NOT NULL DEFAULT 'pending',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			expires_at TEXT,
			FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
		);

		CREATE INDEX IF NOT EXISTS tasks.idx_tasks_repo ON tasks(repo);

		CREATE INDEX IF NOT EXISTS tasks.idx_tasks_status ON tasks(status);

		CREATE INDEX IF NOT EXISTS tasks.idx_tasks_phase ON tasks(phase);

		CREATE INDEX IF NOT EXISTS tasks.idx_tasks_priority ON tasks(priority);

		CREATE INDEX IF NOT EXISTS tasks.idx_tasks_created_at ON tasks(created_at);

		CREATE INDEX IF NOT EXISTS tasks.idx_task_comments_task_id ON task_comments(task_id);

		CREATE INDEX IF NOT EXISTS tasks.idx_task_comments_repo ON task_comments(repo);

		CREATE INDEX IF NOT EXISTS tasks.idx_task_comments_created_at ON task_comments(created_at DESC);

		CREATE INDEX IF NOT EXISTS tasks.idx_handoffs_repo ON handoffs(repo);

		CREATE INDEX IF NOT EXISTS tasks.idx_handoffs_status ON handoffs(status);

		CREATE INDEX IF NOT EXISTS tasks.idx_handoffs_from_agent ON handoffs(from_agent);

		CREATE INDEX IF NOT EXISTS tasks.idx_handoffs_to_agent ON handoffs(to_agent);

		CREATE INDEX IF NOT EXISTS tasks.idx_handoffs_task_id ON handoffs(task_id);

		CREATE INDEX IF NOT EXISTS tasks.idx_handoffs_created_at ON handoffs(created_at);

		CREATE INDEX IF NOT EXISTS tasks.idx_claims_repo ON claims(repo);

		CREATE INDEX IF NOT EXISTS tasks.idx_claims_task_id ON claims(task_id);

		CREATE INDEX IF NOT EXISTS tasks.idx_claims_agent ON claims(agent);

		CREATE INDEX IF NOT EXISTS tasks.idx_claims_claimed_at ON claims(claimed_at);

		CREATE UNIQUE INDEX IF NOT EXISTS tasks.idx_tasks_code_owner_repo ON tasks(owner, repo, task_code);

		CREATE INDEX IF NOT EXISTS tasks.idx_tasks_owner_repo ON tasks(owner, repo);

		CREATE INDEX IF NOT EXISTS tasks.idx_tasks_owner_repo_status ON tasks(owner, repo, status);

		CREATE INDEX IF NOT EXISTS tasks.idx_handoffs_owner_repo ON handoffs(owner, repo);

		CREATE INDEX IF NOT EXISTS tasks.idx_claims_owner_repo ON claims(owner, repo);

		CREATE INDEX IF NOT EXISTS tasks.idx_task_comments_owner_repo ON task_comments(owner, repo);
`;


/** Tables, indexes and FTS indexes of the `standards` domain file. */
export const STANDARDS_SCHEMA_DDL = `
		CREATE TABLE IF NOT EXISTS standards.coding_standards (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			parent_id TEXT,
			context TEXT,
			version TEXT,
			language TEXT,
			stack TEXT,
			is_global INTEGER NOT NULL DEFAULT 0,
			repo TEXT,
			owner TEXT NOT NULL DEFAULT '',
			tags TEXT,
			metadata TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			hit_count INTEGER NOT NULL DEFAULT 0,
			last_used_at TEXT,
			agent TEXT NOT NULL DEFAULT 'unknown',
			model TEXT NOT NULL DEFAULT 'unknown', code TEXT,
			FOREIGN KEY (parent_id) REFERENCES coding_standards(id) ON DELETE SET NULL
		);

		CREATE VIRTUAL TABLE IF NOT EXISTS standards.coding_standards_fts USING fts5(
			title, content, context, stack, tags,
			content='coding_standards',
			content_rowid='rowid'
		);

		CREATE TABLE IF NOT EXISTS standards.standard_tags (
			standard_id TEXT NOT NULL,
			tag TEXT NOT NULL COLLATE NOCASE,
			PRIMARY KEY (standard_id, tag),
			FOREIGN KEY (standard_id) REFERENCES coding_standards(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS standards.standard_stack (
			standard_id TEXT NOT NULL,
			stack TEXT NOT NULL COLLATE NOCASE,
			PRIMARY KEY (standard_id, stack),
			FOREIGN KEY (standard_id) REFERENCES coding_standards(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS standards.idx_coding_standards_repo ON coding_standards(repo);

		CREATE INDEX IF NOT EXISTS standards.idx_coding_standards_is_global ON coding_standards(is_global);

		CREATE INDEX IF NOT EXISTS standards.idx_coding_standards_language ON coding_standards(language);

		CREATE INDEX IF NOT EXISTS standards.idx_coding_standards_hit_count ON coding_standards(hit_count);

		CREATE INDEX IF NOT EXISTS standards.idx_coding_standards_code ON coding_standards(code);

		CREATE INDEX IF NOT EXISTS standards.idx_coding_standards_repo_code ON coding_standards(repo, code);

		CREATE INDEX IF NOT EXISTS standards.idx_standard_tags_tag ON standard_tags(tag);

		CREATE INDEX IF NOT EXISTS standards.idx_standard_stack_stack ON standard_stack(stack);

		CREATE INDEX IF NOT EXISTS standards.idx_coding_standards_repo_created_at ON coding_standards(repo, created_at DESC);

		CREATE INDEX IF NOT EXISTS standards.idx_coding_standards_is_global_created_at ON coding_standards(is_global, created_at DESC);

		CREATE INDEX IF NOT EXISTS standards.idx_standards_owner_repo ON coding_standards(owner, repo);
`;

/**
 * FTS + cache-maintenance triggers of the `standards` file.
 *
 * Trigger NAMES are schema-qualified; the `ON` table and the trigger body stay
 * UNQUALIFIED because SQLite forbids a qualified table on an INSERT/UPDATE/
 * DELETE inside a trigger. An unqualified body resolves inside the trigger's own
 * schema (`standards`), never `main`.
 */
export const STANDARDS_SCHEMA_TRIGGERS = `
		DROP TRIGGER IF EXISTS standards.coding_standards_ai;
		CREATE TRIGGER standards.coding_standards_ai AFTER INSERT ON coding_standards BEGIN
		INSERT INTO coding_standards_fts(rowid, title, content, context, stack, tags)
		VALUES (new.rowid, new.title, new.content, new.context, new.stack, new.tags);
		END;

		DROP TRIGGER IF EXISTS standards.coding_standards_ad;
		CREATE TRIGGER standards.coding_standards_ad AFTER DELETE ON coding_standards BEGIN
		INSERT INTO coding_standards_fts(coding_standards_fts, rowid, title, content, context, stack, tags)
		VALUES('delete', old.rowid, old.title, old.content, old.context, old.stack, old.tags);
		END;

		DROP TRIGGER IF EXISTS standards.coding_standards_au;
		CREATE TRIGGER standards.coding_standards_au AFTER UPDATE ON coding_standards BEGIN
		INSERT INTO coding_standards_fts(coding_standards_fts, rowid, title, content, context, stack, tags)
		VALUES('delete', old.rowid, old.title, old.content, old.context, old.stack, old.tags);
		INSERT INTO coding_standards_fts(rowid, title, content, context, stack, tags)
		VALUES (new.rowid, new.title, new.content, new.context, new.stack, new.tags);
		END;

		DROP TRIGGER IF EXISTS standards.standard_stack_ai;
		CREATE TRIGGER standards.standard_stack_ai AFTER INSERT ON coding_standards BEGIN
		INSERT OR IGNORE INTO standard_stack (standard_id, stack)
		SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.stack) THEN new.stack ELSE '[]' END) j
		WHERE j.value IS NOT NULL AND j.value <> '';
		END;

		DROP TRIGGER IF EXISTS standards.standard_stack_au;
		CREATE TRIGGER standards.standard_stack_au AFTER UPDATE ON coding_standards
		WHEN new.stack IS NOT old.stack BEGIN
		DELETE FROM standard_stack WHERE standard_id = new.id;
		INSERT OR IGNORE INTO standard_stack (standard_id, stack)
		SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.stack) THEN new.stack ELSE '[]' END) j
		WHERE j.value IS NOT NULL AND j.value <> '';
		END;

		DROP TRIGGER IF EXISTS standards.standard_tags_ai;
		CREATE TRIGGER standards.standard_tags_ai AFTER INSERT ON coding_standards BEGIN
		INSERT OR IGNORE INTO standard_tags (standard_id, tag)
		SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.tags) THEN new.tags ELSE '[]' END) j
		WHERE j.value IS NOT NULL AND j.value <> '';
		END;

		DROP TRIGGER IF EXISTS standards.standard_tags_au;
		CREATE TRIGGER standards.standard_tags_au AFTER UPDATE ON coding_standards
		WHEN new.tags IS NOT old.tags BEGIN
		DELETE FROM standard_tags WHERE standard_id = new.id;
		INSERT OR IGNORE INTO standard_tags (standard_id, tag)
		SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.tags) THEN new.tags ELSE '[]' END) j
		WHERE j.value IS NOT NULL AND j.value <> '';
		END;
`;


/** Tables, indexes and FTS indexes of the `kg` domain file. */
export const KG_SCHEMA_DDL = `
		CREATE TABLE IF NOT EXISTS kg.entities (
			name TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'unknown',
			description TEXT,
			repo TEXT NOT NULL DEFAULT '',
			owner TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (name, repo)
		);

		CREATE TABLE IF NOT EXISTS kg.relations (
			from_entity TEXT NOT NULL,
			to_entity TEXT NOT NULL,
			relation_type TEXT NOT NULL,
			repo TEXT NOT NULL DEFAULT '',
			owner TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			confidence REAL NOT NULL DEFAULT 1.0,
			PRIMARY KEY (from_entity, to_entity, relation_type, repo),
			FOREIGN KEY (from_entity, repo) REFERENCES "entities"(name, repo) ON DELETE CASCADE,
			FOREIGN KEY (to_entity, repo) REFERENCES "entities"(name, repo) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS kg.observations (
			id TEXT PRIMARY KEY,
			entity_name TEXT NOT NULL,
			observation TEXT NOT NULL,
			repo TEXT NOT NULL DEFAULT '',
			owner TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			FOREIGN KEY (entity_name, repo) REFERENCES "entities"(name, repo) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS kg.kg_degrees (
			repo TEXT NOT NULL,
			node TEXT NOT NULL,
			degree INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (repo, node)
		) WITHOUT ROWID;

		CREATE VIRTUAL TABLE IF NOT EXISTS kg.entity_names_fts USING fts5(name, repo UNINDEXED, tokenize='unicode61');

		CREATE INDEX IF NOT EXISTS kg.idx_entities_type ON entities(type);

		CREATE INDEX IF NOT EXISTS kg.idx_entities_repo ON entities(repo);

		CREATE INDEX IF NOT EXISTS kg.idx_relations_repo_from_to ON relations(repo, from_entity, to_entity);

		CREATE INDEX IF NOT EXISTS kg.idx_relations_repo_to ON relations(repo, to_entity);

		CREATE INDEX IF NOT EXISTS kg.idx_relations_created_at ON relations(created_at);

		CREATE INDEX IF NOT EXISTS kg.idx_observations_repo ON observations(repo);

		CREATE INDEX IF NOT EXISTS kg.idx_observations_created_at ON observations(created_at);

		CREATE INDEX IF NOT EXISTS kg.idx_observations_observation ON observations(observation);

		CREATE UNIQUE INDEX IF NOT EXISTS kg.idx_observations_dedup ON observations(entity_name, observation, repo);
`;

/**
 * FTS + cache-maintenance triggers of the `kg` file.
 *
 * Trigger NAMES are schema-qualified; the `ON` table and the trigger body stay
 * UNQUALIFIED because SQLite forbids a qualified table on an INSERT/UPDATE/
 * DELETE inside a trigger. An unqualified body resolves inside the trigger's own
 * schema (`kg`), never `main`.
 */
export const KG_SCHEMA_TRIGGERS = `
		DROP TRIGGER IF EXISTS kg.entity_names_fts_ai;
		CREATE TRIGGER kg.entity_names_fts_ai AFTER INSERT ON entities BEGIN
		INSERT INTO entity_names_fts(rowid, name, repo) VALUES (new.rowid, new.name, new.repo);
		END;

		DROP TRIGGER IF EXISTS kg.entity_names_fts_au;
		CREATE TRIGGER kg.entity_names_fts_au AFTER UPDATE ON entities BEGIN
		DELETE FROM entity_names_fts WHERE rowid = old.rowid;
		INSERT INTO entity_names_fts(rowid, name, repo) VALUES (new.rowid, new.name, new.repo);
		END;

		DROP TRIGGER IF EXISTS kg.entity_names_fts_ad;
		CREATE TRIGGER kg.entity_names_fts_ad AFTER DELETE ON entities BEGIN
		DELETE FROM entity_names_fts WHERE rowid = old.rowid;
		END;

		DROP TRIGGER IF EXISTS kg.trg_kg_degrees_ai;
		CREATE TRIGGER kg.trg_kg_degrees_ai AFTER INSERT ON relations BEGIN
		INSERT INTO kg_degrees (repo, node, degree) VALUES (NEW.repo, NEW.from_entity, 1)
		ON CONFLICT(repo, node) DO UPDATE SET degree = kg_degrees.degree + 1;
		INSERT INTO kg_degrees (repo, node, degree) VALUES (NEW.repo, NEW.to_entity, 1)
		ON CONFLICT(repo, node) DO UPDATE SET degree = kg_degrees.degree + 1;
		END;

		DROP TRIGGER IF EXISTS kg.trg_kg_degrees_ad;
		CREATE TRIGGER kg.trg_kg_degrees_ad AFTER DELETE ON relations BEGIN
		UPDATE kg_degrees SET degree = degree - 1 WHERE repo = OLD.repo AND node = OLD.from_entity AND degree > 0;
		UPDATE kg_degrees SET degree = degree - 1 WHERE repo = OLD.repo AND node = OLD.to_entity AND degree > 0;
		DELETE FROM kg_degrees WHERE repo = OLD.repo AND (node = OLD.from_entity OR node = OLD.to_entity) AND degree = 0;
		END;
`;


/** Tables, indexes and FTS indexes of the `observability` domain file. */
export const OBSERVABILITY_SCHEMA_DDL = `
		CREATE TABLE IF NOT EXISTS observability.exploration_observations (
			id TEXT PRIMARY KEY,
			owner TEXT NOT NULL,
			repo TEXT NOT NULL,
			subject TEXT NOT NULL,
			fact TEXT NOT NULL,
			confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
			task_id TEXT,
			agent TEXT,
			identity_hash TEXT NOT NULL,
			freshness TEXT NOT NULL DEFAULT 'valid' CHECK (freshness IN ('valid', 'stale', 'unverifiable')),
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL, stale_reason TEXT, last_verified_at TEXT, superseded_by TEXT REFERENCES exploration_observations(id),
			UNIQUE (owner, repo, identity_hash)
		);

		CREATE TABLE IF NOT EXISTS observability.exploration_evidence (
			id TEXT PRIMARY KEY,
			observation_id TEXT NOT NULL REFERENCES exploration_observations(id) ON DELETE CASCADE,
			file_path TEXT NOT NULL,
			symbol_id TEXT,
			start_line INTEGER,
			end_line INTEGER,
			created_at TEXT NOT NULL, file_checksum TEXT, symbol_fingerprint TEXT, indexed_at TEXT, commit_sha TEXT,
			UNIQUE (observation_id, file_path, symbol_id, start_line, end_line)
		);

		CREATE INDEX IF NOT EXISTS observability.idx_exploration_obs_scope_subject ON exploration_observations(owner, repo, subject);

		CREATE INDEX IF NOT EXISTS observability.idx_exploration_obs_scope_task ON exploration_observations(owner, repo, task_id);

		CREATE INDEX IF NOT EXISTS observability.idx_exploration_obs_scope_confidence ON exploration_observations(owner, repo, confidence DESC);

		CREATE INDEX IF NOT EXISTS observability.idx_exploration_evidence_file ON exploration_evidence(file_path, observation_id);

		CREATE INDEX IF NOT EXISTS observability.idx_exploration_evidence_symbol ON exploration_evidence(symbol_id, observation_id);

		CREATE INDEX IF NOT EXISTS observability.idx_exploration_obs_scope_freshness ON exploration_observations(owner, repo, freshness, confidence DESC);
`;

