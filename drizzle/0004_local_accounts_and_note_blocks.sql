CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
DROP INDEX `idx_subjects_owner`;
--> statement-breakpoint
ALTER TABLE `subjects` RENAME COLUMN `owner` TO `legacy_owner`;
--> statement-breakpoint
ALTER TABLE `subjects` RENAME COLUMN `created` TO `created_at`;
--> statement-breakpoint
ALTER TABLE `subjects` ADD COLUMN `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_subjects_user` ON `subjects` (`user_id`);
--> statement-breakpoint
DROP INDEX `idx_notes_owner_subject`;
--> statement-breakpoint
ALTER TABLE `notes` RENAME COLUMN `owner` TO `legacy_owner`;
--> statement-breakpoint
ALTER TABLE `notes` RENAME COLUMN `subject` TO `subject_id`;
--> statement-breakpoint
ALTER TABLE `notes` RENAME COLUMN `body` TO `plain_text`;
--> statement-breakpoint
ALTER TABLE `notes` RENAME COLUMN `blocks` TO `legacy_blocks`;
--> statement-breakpoint
ALTER TABLE `notes` RENAME COLUMN `updated` TO `created_at`;
--> statement-breakpoint
ALTER TABLE `notes` ADD COLUMN `updated_at` text;
--> statement-breakpoint
UPDATE `notes` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;
--> statement-breakpoint
ALTER TABLE `notes` ADD COLUMN `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_notes_user_subject` ON `notes` (`user_id`,`subject_id`);
--> statement-breakpoint
CREATE TABLE `note_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL REFERENCES `notes`(`id`) ON DELETE cascade,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_note_blocks_note_position` ON `note_blocks` (`note_id`,`position`);
--> statement-breakpoint
DROP INDEX `idx_files_owner_note`;
--> statement-breakpoint
ALTER TABLE `files` RENAME TO `attachments`;
--> statement-breakpoint
ALTER TABLE `attachments` RENAME COLUMN `owner` TO `legacy_owner`;
--> statement-breakpoint
ALTER TABLE `attachments` RENAME COLUMN `note` TO `note_id`;
--> statement-breakpoint
ALTER TABLE `attachments` RENAME COLUMN `name` TO `filename`;
--> statement-breakpoint
ALTER TABLE `attachments` RENAME COLUMN `key` TO `storage_key`;
--> statement-breakpoint
ALTER TABLE `attachments` ADD COLUMN `mime_type` text NOT NULL DEFAULT 'application/octet-stream';
--> statement-breakpoint
ALTER TABLE `attachments` ADD COLUMN `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_attachments_user_note` ON `attachments` (`user_id`,`note_id`);
--> statement-breakpoint
DROP INDEX `idx_exams_owner_date`;
--> statement-breakpoint
ALTER TABLE `exams` RENAME COLUMN `owner` TO `legacy_owner`;
--> statement-breakpoint
ALTER TABLE `exams` RENAME COLUMN `subject` TO `subject_id`;
--> statement-breakpoint
ALTER TABLE `exams` RENAME COLUMN `created` TO `created_at`;
--> statement-breakpoint
ALTER TABLE `exams` ADD COLUMN `updated_at` text;
--> statement-breakpoint
UPDATE `exams` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;
--> statement-breakpoint
ALTER TABLE `exams` ADD COLUMN `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_exams_user_date` ON `exams` (`user_id`,`date`);
