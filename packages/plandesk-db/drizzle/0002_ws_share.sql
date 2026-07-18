PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_guest_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`project_id` text,
	`workspace_id` text,
	`name` text NOT NULL,
	`email` text,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_guest_sessions`("id", "share_id", "project_id", "workspace_id", "name", "email", "token_hash", "created_at", "revoked_at") SELECT "id", "share_id", "project_id", NULL AS "workspace_id", "name", "email", "token_hash", "created_at", "revoked_at" FROM `guest_sessions`;--> statement-breakpoint
DROP TABLE `guest_sessions`;--> statement-breakpoint
ALTER TABLE `__new_guest_sessions` RENAME TO `guest_sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `guest_sessions_token_hash_unique` ON `guest_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `__new_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`workspace_id` text,
	`audience_name` text NOT NULL,
	`mode` text DEFAULT 'invite' NOT NULL,
	`token_hash` text NOT NULL,
	`permissions` text NOT NULL,
	`policy` text NOT NULL,
	`invited_emails` text,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_shares`("id", "project_id", "workspace_id", "audience_name", "mode", "token_hash", "permissions", "policy", "invited_emails", "expires_at", "revoked_at", "created_at") SELECT "id", "project_id", NULL AS "workspace_id", "audience_name", "mode", "token_hash", "permissions", "policy", "invited_emails", "expires_at", "revoked_at", "created_at" FROM `shares`;--> statement-breakpoint
DROP TABLE `shares`;--> statement-breakpoint
ALTER TABLE `__new_shares` RENAME TO `shares`;--> statement-breakpoint
PRAGMA foreign_keys=ON;