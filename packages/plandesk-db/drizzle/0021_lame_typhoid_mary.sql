PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`goal_id` text,
	`label` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`kind` text DEFAULT 'build' NOT NULL,
	`priority` text,
	`lane` text,
	`severity` text,
	`description` text,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`assignee` text,
	`due_date` integer,
	`commit_refs` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "project_id", "goal_id", "label", "status", "kind", "priority", "lane", "severity", "description", "x", "y", "assignee", "due_date", "commit_refs", "created_at", "updated_at") SELECT "id", "project_id", "goal_id", "label", "status", "kind", "priority", "lane", "severity", "description", "x", "y", "assignee", "due_date", "commit_refs", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;