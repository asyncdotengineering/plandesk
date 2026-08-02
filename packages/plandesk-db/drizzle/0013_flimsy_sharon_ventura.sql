CREATE TABLE `prototypes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`viewport_width` real NOT NULL,
	`viewport_height` real NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `artifacts` ADD `prototype_id` text REFERENCES prototypes(id);--> statement-breakpoint
ALTER TABLE `artifacts` ADD `x` real;--> statement-breakpoint
ALTER TABLE `artifacts` ADD `y` real;