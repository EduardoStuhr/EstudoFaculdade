CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`note` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`key` text NOT NULL,
	FOREIGN KEY (`note`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_files_owner_note` ON `files` (`owner`,`note`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`subject` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`subject`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notes_owner_subject` ON `notes` (`owner`,`subject`);--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_subjects_owner` ON `subjects` (`owner`);