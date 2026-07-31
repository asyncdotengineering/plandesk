ALTER TABLE `tasks` ADD `priority` text;--> statement-breakpoint
-- Additive severity-tag backfill: map severity:* tags onto the new column where
-- priority is still null. Tags stay attached; re-running is a no-op because each
-- UPDATE only touches rows with priority IS NULL.
UPDATE `tasks` SET `priority` = 'high' WHERE `priority` IS NULL AND `id` IN (
	SELECT `task_tags`.`task_id` FROM `task_tags`
	INNER JOIN `tags` ON `tags`.`id` = `task_tags`.`tag_id`
	WHERE `tags`.`name` = 'severity:high'
);--> statement-breakpoint
UPDATE `tasks` SET `priority` = 'medium' WHERE `priority` IS NULL AND `id` IN (
	SELECT `task_tags`.`task_id` FROM `task_tags`
	INNER JOIN `tags` ON `tags`.`id` = `task_tags`.`tag_id`
	WHERE `tags`.`name` = 'severity:medium'
);--> statement-breakpoint
UPDATE `tasks` SET `priority` = 'low' WHERE `priority` IS NULL AND `id` IN (
	SELECT `task_tags`.`task_id` FROM `task_tags`
	INNER JOIN `tags` ON `tags`.`id` = `task_tags`.`tag_id`
	WHERE `tags`.`name` = 'severity:low'
);
