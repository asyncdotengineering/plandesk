CREATE TABLE `share_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`hosted_share_id` text NOT NULL,
	`participant_name` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`severity` text,
	`task_ref` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`linked_task_id` text,
	`created_at` integer NOT NULL,
	`pulled_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`project_id` text PRIMARY KEY NOT NULL,
	`pull_cursor` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
