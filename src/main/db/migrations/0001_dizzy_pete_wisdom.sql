CREATE TABLE `hindsight_index` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`memory_value_confidence` integer,
	`primary_topic` text,
	`latest_message_id` text,
	`analyzed_at` integer,
	`retained_at` integer,
	`retain_success` integer,
	`retain_error` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`latest_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
DROP INDEX `attachments_file_id_unique`;