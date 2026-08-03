ALTER TABLE `projects` ADD `current_goal_id` text REFERENCES goals(id);--> statement-breakpoint
UPDATE `projects`
SET `current_goal_id` = (
  SELECT `g`.`id`
  FROM `goals` AS `g`
  WHERE `g`.`project_id` = `projects`.`id`
    AND `g`.`status` = 'active'
  ORDER BY `g`.`created_at` DESC, `g`.`id` DESC
  LIMIT 1
)
WHERE `current_goal_id` IS NULL;