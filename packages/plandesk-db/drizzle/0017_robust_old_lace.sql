ALTER TABLE `tasks` ADD `lane` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `severity` text;--> statement-breakpoint
CREATE TABLE `task_field_migration_conflicts` (
	`task_id` text NOT NULL,
	`field` text NOT NULL,
	`tag_values` text NOT NULL,
	PRIMARY KEY(`task_id`, `field`)
);--> statement-breakpoint
INSERT INTO `task_field_migration_conflicts` (`task_id`, `field`, `tag_values`)
SELECT `task_tags`.`task_id`, 'lane', group_concat(DISTINCT substr(`tags`.`name`, 6))
FROM `task_tags`
INNER JOIN `tags` ON `tags`.`id` = `task_tags`.`tag_id`
WHERE `tags`.`name` IN ('lane:auto', 'lane:approve', 'lane:full')
GROUP BY `task_tags`.`task_id`
HAVING count(DISTINCT substr(`tags`.`name`, 6)) > 1;--> statement-breakpoint
INSERT INTO `task_field_migration_conflicts` (`task_id`, `field`, `tag_values`)
SELECT `task_tags`.`task_id`, 'severity', group_concat(DISTINCT CASE
	WHEN `tags`.`name` LIKE 'sev:%' THEN substr(`tags`.`name`, 5)
	ELSE substr(`tags`.`name`, 10)
END)
FROM `task_tags`
INNER JOIN `tags` ON `tags`.`id` = `task_tags`.`tag_id`
WHERE `tags`.`name` IN (
	'sev:low', 'sev:medium', 'sev:high',
	'severity:low', 'severity:medium', 'severity:high'
)
GROUP BY `task_tags`.`task_id`
HAVING count(DISTINCT CASE
	WHEN `tags`.`name` LIKE 'sev:%' THEN substr(`tags`.`name`, 5)
	ELSE substr(`tags`.`name`, 10)
END) > 1;--> statement-breakpoint
UPDATE `tasks`
SET `lane` = (
	SELECT MIN(substr(`tags`.`name`, 6))
	FROM `task_tags`
	INNER JOIN `tags` ON `tags`.`id` = `task_tags`.`tag_id`
	WHERE `task_tags`.`task_id` = `tasks`.`id`
	  AND `tags`.`name` IN ('lane:auto', 'lane:approve', 'lane:full')
)
WHERE `tasks`.`lane` IS NULL
  AND `tasks`.`id` IN (
	SELECT `task_tags`.`task_id`
	FROM `task_tags`
	INNER JOIN `tags` ON `tags`.`id` = `task_tags`.`tag_id`
	WHERE `tags`.`name` IN ('lane:auto', 'lane:approve', 'lane:full')
	GROUP BY `task_tags`.`task_id`
	HAVING count(DISTINCT substr(`tags`.`name`, 6)) = 1
);--> statement-breakpoint
UPDATE `tasks`
SET `severity` = (
	SELECT MIN(CASE
		WHEN `tags`.`name` LIKE 'sev:%' THEN substr(`tags`.`name`, 5)
		ELSE substr(`tags`.`name`, 10)
	END)
	FROM `task_tags`
	INNER JOIN `tags` ON `tags`.`id` = `task_tags`.`tag_id`
	WHERE `task_tags`.`task_id` = `tasks`.`id`
	  AND `tags`.`name` IN (
		'sev:low', 'sev:medium', 'sev:high',
		'severity:low', 'severity:medium', 'severity:high'
	  )
)
WHERE `tasks`.`severity` IS NULL
  AND `tasks`.`id` IN (
	SELECT `task_tags`.`task_id`
	FROM `task_tags`
	INNER JOIN `tags` ON `tags`.`id` = `task_tags`.`tag_id`
	WHERE `tags`.`name` IN (
		'sev:low', 'sev:medium', 'sev:high',
		'severity:low', 'severity:medium', 'severity:high'
	)
	GROUP BY `task_tags`.`task_id`
	HAVING count(DISTINCT CASE
		WHEN `tags`.`name` LIKE 'sev:%' THEN substr(`tags`.`name`, 5)
		ELSE substr(`tags`.`name`, 10)
	END) = 1
);
