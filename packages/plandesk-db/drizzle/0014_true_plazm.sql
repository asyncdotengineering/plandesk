CREATE TABLE `prototype_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_artifact_id` text NOT NULL,
	`to_artifact_id` text,
	`raw_target` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action
);
