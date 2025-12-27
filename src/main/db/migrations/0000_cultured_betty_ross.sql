CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`type` text NOT NULL,
	`file_id` text,
	`original_url` text,
	`local_path` text,
	`filename` text,
	`mime_type` text,
	`size` integer,
	`width` integer,
	`height` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_file_id_unique` ON `attachments` (`file_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	`synced_at` integer,
	`message_count` integer DEFAULT 0,
	`current_node_id` text,
	`sync_error` text,
	`sync_retry_count` integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `provider_idx` ON `conversations` (`provider`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	`order_index` integer NOT NULL,
	`parent_id` text,
	`sibling_ids` text,
	`sibling_index` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `provider_state` (
	`provider_name` text PRIMARY KEY NOT NULL,
	`is_connected` integer DEFAULT false NOT NULL,
	`last_sync_at` integer,
	`status` text NOT NULL,
	`error_message` text,
	`metadata` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`has_completed_onboarding` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
