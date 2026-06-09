CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
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
