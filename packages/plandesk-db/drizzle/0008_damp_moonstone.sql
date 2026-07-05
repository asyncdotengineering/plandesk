CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`objective` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`verification_surface` text,
	`constraints` text,
	`boundaries` text,
	`iteration_policy` text,
	`stop_condition` text,
	`budget` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `goals` (`id`, `project_id`, `objective`, `status`, `created_at`, `updated_at`)
  SELECT lower(hex(randomblob(16))), `id`, 'General', 'active',
         (cast((julianday('now') - 2440587.5)*86400000 as integer)),
         (cast((julianday('now') - 2440587.5)*86400000 as integer))
  FROM `projects`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`description` text,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`assignee` text,
	`due_date` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks` (`id`, `project_id`, `goal_id`, `label`, `status`, `description`, `x`, `y`, `assignee`, `due_date`, `created_at`, `updated_at`)
  SELECT `t`.`id`, `t`.`project_id`,
         (SELECT `g`.`id` FROM `goals` `g` WHERE `g`.`project_id` = `t`.`project_id` ORDER BY `g`.`created_at`, `g`.`id` LIMIT 1),
         `t`.`label`, `t`.`status`, `t`.`description`, `t`.`x`, `t`.`y`, `t`.`assignee`, `t`.`due_date`, `t`.`created_at`, `t`.`updated_at`
  FROM `tasks` `t`;
--> statement-breakpoint
DROP TABLE `tasks`;
--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;