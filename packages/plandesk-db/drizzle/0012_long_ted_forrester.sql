ALTER TABLE `projects` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `overview_document_id` text REFERENCES documents(id);