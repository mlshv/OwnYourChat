DROP INDEX IF EXISTS `attachments_file_id_unique`;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `show_debug_panel` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `export_settings` text;