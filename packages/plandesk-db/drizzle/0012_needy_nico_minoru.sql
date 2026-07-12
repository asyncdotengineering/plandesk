CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`bytes` blob,
	`external_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
