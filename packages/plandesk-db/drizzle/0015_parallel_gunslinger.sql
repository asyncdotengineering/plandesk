CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_ref` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);