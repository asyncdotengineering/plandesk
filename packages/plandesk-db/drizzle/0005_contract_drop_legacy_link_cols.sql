-- Contract: drop task-only edge columns and documents.linked_task_id.
-- Typed endpoints become the sole, non-nullable shape of an edge.
-- Defensive: ensure every remaining linked_task_id still has a document→task edge
-- before the column is dropped (covers dual-write gaps).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
INSERT INTO `edges` (`id`, `project_id`, `from_task_id`, `to_task_id`, `from_type`, `from_id`, `to_type`, `to_id`, `label`, `arrow_direction`, `style`, `created_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
	`project_id`,
	NULL,
	NULL,
	'document',
	`id`,
	'task',
	`linked_task_id`,
	'documents',
	NULL,
	NULL,
	cast((julianday('now') - 2440587.5)*86400000 as integer)
FROM `documents` AS d
WHERE `linked_task_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM `edges` AS e
		WHERE e.`from_type` = 'document'
			AND e.`from_id` = d.`id`
			AND e.`to_type` = 'task'
			AND e.`to_id` = d.`linked_task_id`
	);--> statement-breakpoint
CREATE TABLE `__new_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`label` text,
	`arrow_direction` text,
	`style` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_edges`("id", "project_id", "from_type", "from_id", "to_type", "to_id", "label", "arrow_direction", "style", "created_at")
SELECT
	"id",
	"project_id",
	COALESCE("from_type", 'task'),
	COALESCE("from_id", "from_task_id"),
	COALESCE("to_type", 'task'),
	COALESCE("to_id", "to_task_id"),
	"label",
	"arrow_direction",
	"style",
	"created_at"
FROM `edges`
WHERE COALESCE("from_id", "from_task_id") IS NOT NULL
	AND COALESCE("to_id", "to_task_id") IS NOT NULL;--> statement-breakpoint
DROP TABLE `edges`;--> statement-breakpoint
ALTER TABLE `__new_edges` RENAME TO `edges`;--> statement-breakpoint
CREATE INDEX `edges_project_from_idx` ON `edges` (`project_id`,`from_type`,`from_id`);--> statement-breakpoint
CREATE INDEX `edges_project_to_idx` ON `edges` (`project_id`,`to_type`,`to_id`);--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status_line` text,
	`parent_id` text,
	`folder_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "project_id", "title", "body", "status_line", "parent_id", "folder_id", "created_at", "updated_at")
SELECT "id", "project_id", "title", "body", "status_line", "parent_id", "folder_id", "created_at", "updated_at" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
