ALTER TABLE `edges` ADD `from_type` text;--> statement-breakpoint
ALTER TABLE `edges` ADD `from_id` text;--> statement-breakpoint
ALTER TABLE `edges` ADD `to_type` text;--> statement-breakpoint
ALTER TABLE `edges` ADD `to_id` text;--> statement-breakpoint
UPDATE `edges` SET `from_type` = 'task', `from_id` = `from_task_id`, `to_type` = 'task', `to_id` = `to_task_id`;--> statement-breakpoint
INSERT INTO `edges` (`id`, `project_id`, `from_task_id`, `to_task_id`, `from_type`, `from_id`, `to_type`, `to_id`, `label`, `arrow_direction`, `style`, `created_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
	`project_id`,
	`linked_task_id`,
	`linked_task_id`,
	'document',
	`id`,
	'task',
	`linked_task_id`,
	'documents',
	NULL,
	NULL,
	cast((julianday('now') - 2440587.5)*86400000 as integer)
FROM `documents`
WHERE `linked_task_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `edges_project_from_idx` ON `edges` (`project_id`, `from_type`, `from_id`);--> statement-breakpoint
CREATE INDEX `edges_project_to_idx` ON `edges` (`project_id`, `to_type`, `to_id`);
