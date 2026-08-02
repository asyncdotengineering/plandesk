ALTER TABLE `goals` ADD `name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `goals_project_id_name_unique` ON `goals` (`project_id`,`name`);