CREATE VIRTUAL TABLE `search_index` USING fts5(
	`kind` UNINDEXED,
	`item_id` UNINDEXED,
	`project_id` UNINDEXED,
	`title`,
	`body`,
	tokenize='trigram'
);
--> statement-breakpoint
-- One FTS table serves every tenant, and its kind/item_id columns are not
-- indexed: finding a row by them is a full scan. This map lets the triggers
-- address an index row by its rowid instead.
CREATE TABLE `search_index_rowids` (
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`fts_rowid` integer NOT NULL,
	PRIMARY KEY(`kind`, `item_id`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TRIGGER `documents_search_index_ai` AFTER INSERT ON `documents` BEGIN
	INSERT INTO `search_index`(`kind`, `item_id`, `project_id`, `title`, `body`)
	VALUES ('document', NEW.`id`, NEW.`project_id`, NEW.`title`, COALESCE(NEW.`body`, ''));
	INSERT INTO `search_index_rowids`(`kind`, `item_id`, `fts_rowid`)
	VALUES ('document', NEW.`id`, last_insert_rowid());
END;
--> statement-breakpoint
CREATE TRIGGER `documents_search_index_au` AFTER UPDATE OF `project_id`, `title`, `body` ON `documents` BEGIN
	DELETE FROM `search_index` WHERE rowid =
		(SELECT `fts_rowid` FROM `search_index_rowids` WHERE `kind` = 'document' AND `item_id` = OLD.`id`);
	DELETE FROM `search_index_rowids` WHERE `kind` = 'document' AND `item_id` = OLD.`id`;
	INSERT INTO `search_index`(`kind`, `item_id`, `project_id`, `title`, `body`)
	VALUES ('document', NEW.`id`, NEW.`project_id`, NEW.`title`, COALESCE(NEW.`body`, ''));
	INSERT INTO `search_index_rowids`(`kind`, `item_id`, `fts_rowid`)
	VALUES ('document', NEW.`id`, last_insert_rowid());
END;
--> statement-breakpoint
CREATE TRIGGER `documents_search_index_ad` AFTER DELETE ON `documents` BEGIN
	DELETE FROM `search_index` WHERE rowid =
		(SELECT `fts_rowid` FROM `search_index_rowids` WHERE `kind` = 'document' AND `item_id` = OLD.`id`);
	DELETE FROM `search_index_rowids` WHERE `kind` = 'document' AND `item_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `notes_search_index_ai` AFTER INSERT ON `notes` BEGIN
	INSERT INTO `search_index`(`kind`, `item_id`, `project_id`, `title`, `body`)
	VALUES ('note', NEW.`id`, NEW.`project_id`, NEW.`title`, COALESCE(NEW.`body`, ''));
	INSERT INTO `search_index_rowids`(`kind`, `item_id`, `fts_rowid`)
	VALUES ('note', NEW.`id`, last_insert_rowid());
END;
--> statement-breakpoint
CREATE TRIGGER `notes_search_index_au` AFTER UPDATE OF `project_id`, `title`, `body` ON `notes` BEGIN
	DELETE FROM `search_index` WHERE rowid =
		(SELECT `fts_rowid` FROM `search_index_rowids` WHERE `kind` = 'note' AND `item_id` = OLD.`id`);
	DELETE FROM `search_index_rowids` WHERE `kind` = 'note' AND `item_id` = OLD.`id`;
	INSERT INTO `search_index`(`kind`, `item_id`, `project_id`, `title`, `body`)
	VALUES ('note', NEW.`id`, NEW.`project_id`, NEW.`title`, COALESCE(NEW.`body`, ''));
	INSERT INTO `search_index_rowids`(`kind`, `item_id`, `fts_rowid`)
	VALUES ('note', NEW.`id`, last_insert_rowid());
END;
--> statement-breakpoint
CREATE TRIGGER `notes_search_index_ad` AFTER DELETE ON `notes` BEGIN
	DELETE FROM `search_index` WHERE rowid =
		(SELECT `fts_rowid` FROM `search_index_rowids` WHERE `kind` = 'note' AND `item_id` = OLD.`id`);
	DELETE FROM `search_index_rowids` WHERE `kind` = 'note' AND `item_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tasks_search_index_ai` AFTER INSERT ON `tasks` BEGIN
	INSERT INTO `search_index`(`kind`, `item_id`, `project_id`, `title`, `body`)
	VALUES ('task', NEW.`id`, NEW.`project_id`, NEW.`label`, COALESCE(NEW.`description`, ''));
	INSERT INTO `search_index_rowids`(`kind`, `item_id`, `fts_rowid`)
	VALUES ('task', NEW.`id`, last_insert_rowid());
END;
--> statement-breakpoint
CREATE TRIGGER `tasks_search_index_au` AFTER UPDATE OF `project_id`, `label`, `description` ON `tasks` BEGIN
	DELETE FROM `search_index` WHERE rowid =
		(SELECT `fts_rowid` FROM `search_index_rowids` WHERE `kind` = 'task' AND `item_id` = OLD.`id`);
	DELETE FROM `search_index_rowids` WHERE `kind` = 'task' AND `item_id` = OLD.`id`;
	INSERT INTO `search_index`(`kind`, `item_id`, `project_id`, `title`, `body`)
	VALUES ('task', NEW.`id`, NEW.`project_id`, NEW.`label`, COALESCE(NEW.`description`, ''));
	INSERT INTO `search_index_rowids`(`kind`, `item_id`, `fts_rowid`)
	VALUES ('task', NEW.`id`, last_insert_rowid());
END;
--> statement-breakpoint
CREATE TRIGGER `tasks_search_index_ad` AFTER DELETE ON `tasks` BEGIN
	DELETE FROM `search_index` WHERE rowid =
		(SELECT `fts_rowid` FROM `search_index_rowids` WHERE `kind` = 'task' AND `item_id` = OLD.`id`);
	DELETE FROM `search_index_rowids` WHERE `kind` = 'task' AND `item_id` = OLD.`id`;
END;
--> statement-breakpoint
INSERT INTO `search_index`(`kind`, `item_id`, `project_id`, `title`, `body`)
SELECT 'document', `id`, `project_id`, `title`, COALESCE(`body`, '') FROM `documents`;
--> statement-breakpoint
INSERT INTO `search_index`(`kind`, `item_id`, `project_id`, `title`, `body`)
SELECT 'note', `id`, `project_id`, `title`, COALESCE(`body`, '') FROM `notes`;
--> statement-breakpoint
INSERT INTO `search_index`(`kind`, `item_id`, `project_id`, `title`, `body`)
SELECT 'task', `id`, `project_id`, `label`, COALESCE(`description`, '') FROM `tasks`;
--> statement-breakpoint
INSERT INTO `search_index_rowids`(`kind`, `item_id`, `fts_rowid`)
SELECT `kind`, `item_id`, rowid FROM `search_index`;
