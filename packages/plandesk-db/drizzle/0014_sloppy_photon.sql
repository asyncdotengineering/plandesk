CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `orgs` (`id`, `name`, `created_at`, `updated_at`)
VALUES (
	'00000000-0000-4000-8000-0000000000a1',
	'Personal',
	(cast((julianday('now') - 2440587.5)*86400000 as integer)),
	(cast((julianday('now') - 2440587.5)*86400000 as integer))
);
--> statement-breakpoint
CREATE TABLE `org_members` (
	`org_id` text NOT NULL,
	`user_ref` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	PRIMARY KEY(`org_id`, `user_ref`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`canvas_layout` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_projects` (`id`, `org_id`, `name`, `description`, `canvas_layout`, `created_at`, `updated_at`)
SELECT `id`, '00000000-0000-4000-8000-0000000000a1', `name`, `description`, `canvas_layout`, `created_at`, `updated_at` FROM `projects`;
--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE TABLE `__new_mcp_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope` text DEFAULT 'full' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_mcp_tokens` (`id`, `org_id`, `name`, `token_hash`, `scope`, `created_at`, `revoked_at`)
SELECT `id`, '00000000-0000-4000-8000-0000000000a1', `name`, `token_hash`, 'full', `created_at`, `revoked_at` FROM `mcp_tokens`;
--> statement-breakpoint
DROP TABLE `mcp_tokens`;--> statement-breakpoint
ALTER TABLE `__new_mcp_tokens` RENAME TO `mcp_tokens`;--> statement-breakpoint
CREATE TABLE `__new_files` (
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`bytes` blob,
	`external_url` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_files`("id", "project_id", "filename", "mime", "size", "bytes", "external_url", "created_at") SELECT "id", "project_id", "filename", "mime", "size", "bytes", "external_url", "created_at" FROM `files`;--> statement-breakpoint
DROP TABLE `files`;--> statement-breakpoint
ALTER TABLE `__new_files` RENAME TO `files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
