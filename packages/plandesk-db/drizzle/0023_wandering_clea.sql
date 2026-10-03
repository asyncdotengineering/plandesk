ALTER TABLE `documents` ADD `source_path` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `verified_at` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `verified_ref` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `verified_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `verified_ref` text;