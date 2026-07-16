CREATE TABLE `guest_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guest_sessions_token_hash_unique` ON `guest_sessions` (`token_hash`);