CREATE TABLE `pending_auth` (
	`auth_id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
