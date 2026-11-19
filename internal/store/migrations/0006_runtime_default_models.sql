-- Runtime default model for the runtime management page.
ALTER TABLE runtime_model_configs ADD COLUMN default_model TEXT NOT NULL DEFAULT '';
