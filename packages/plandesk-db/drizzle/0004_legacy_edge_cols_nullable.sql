PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_task_id` text,
	`to_task_id` text,
	`from_type` text,
	`from_id` text,
	`to_type` text,
	`to_id` text,
	`label` text,
	`arrow_direction` text,
	`style` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_edges`("id", "project_id", "from_task_id", "to_task_id", "from_type", "from_id", "to_type", "to_id", "label", "arrow_direction", "style", "created_at") SELECT "id", "project_id", "from_task_id", "to_task_id", "from_type", "from_id", "to_type", "to_id", "label", "arrow_direction", "style", "created_at" FROM `edges`;--> statement-breakpoint
DROP TABLE `edges`;--> statement-breakpoint
ALTER TABLE `__new_edges` RENAME TO `edges`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `edges_project_from_idx` ON `edges` (`project_id`,`from_type`,`from_id`);--> statement-breakpoint
CREATE INDEX `edges_project_to_idx` ON `edges` (`project_id`,`to_type`,`to_id`);