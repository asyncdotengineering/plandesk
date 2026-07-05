CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`passage` text,
	`body` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `comments` (`id`, `project_id`, `target_type`, `target_id`, `passage`, `body`, `resolved`, `created_at`)
SELECT dc.`id`, d.`project_id`, 'document', dc.`document_id`, dc.`passage`, dc.`body`, dc.`resolved`, dc.`created_at`
FROM `document_comments` dc
JOIN `documents` d ON d.`id` = dc.`document_id`;
--> statement-breakpoint
DROP TABLE `document_comments`;