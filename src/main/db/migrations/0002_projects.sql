CREATE TABLE `project_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`filename` text NOT NULL,
	`content` text,
	`created_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_docs_project_idx` ON `project_docs` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`instructions` text,
	`docs_count` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer,
	`synced_at` integer
);
--> statement-breakpoint
CREATE INDEX `projects_provider_idx` ON `projects` (`provider`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `project_id` text;--> statement-breakpoint
CREATE INDEX `conversations_project_idx` ON `conversations` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `conversation_id_idx` ON `messages` (`conversation_id`);
