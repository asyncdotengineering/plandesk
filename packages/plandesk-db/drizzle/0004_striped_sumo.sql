CREATE TABLE `sync_remotes` (
	`project_id` text PRIMARY KEY NOT NULL,
	`server_url` text NOT NULL,
	`global_project_id` text NOT NULL,
	`sync_token` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
