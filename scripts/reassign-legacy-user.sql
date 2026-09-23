-- Execute only after creating the destination account in `users`.
-- Replace both placeholders before running this against the remote D1 database.
-- Legacy rows stay invisible until this script assigns their `user_id`.

UPDATE subjects SET user_id = '<NEW_USER_UUID>' WHERE legacy_owner = '<LEGACY_CHATGPT_OWNER_ID>';
UPDATE notes SET user_id = '<NEW_USER_UUID>' WHERE legacy_owner = '<LEGACY_CHATGPT_OWNER_ID>';
UPDATE exams SET user_id = '<NEW_USER_UUID>' WHERE legacy_owner = '<LEGACY_CHATGPT_OWNER_ID>';
UPDATE attachments SET user_id = '<NEW_USER_UUID>' WHERE legacy_owner = '<LEGACY_CHATGPT_OWNER_ID>';
