-- Backfill application_id when migrating the older schema.
-- On a fresh database, app_name will not exist, so no backfill is needed.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'application_secrets'
          AND column_name = 'app_name'
    ) THEN
        UPDATE application_secrets AS s
        SET application_id = a.id
        FROM applications AS a
        WHERE s.app_name = a.app_name
          AND s.application_id IS NULL;
    END IF;
END $$;

-- Ensure every secret belongs to an application.
ALTER TABLE application_secrets
    ALTER COLUMN application_id SET NOT NULL;

-- Recreate the foreign key consistently.
ALTER TABLE application_secrets
    DROP CONSTRAINT IF EXISTS fk_application_secrets_application;

ALTER TABLE application_secrets
    ADD CONSTRAINT fk_application_secrets_application
    FOREIGN KEY (application_id)
    REFERENCES applications(id);

-- Ensure secret names are unique within each application.
ALTER TABLE application_secrets
    DROP CONSTRAINT IF EXISTS uq_application_secret_name;

ALTER TABLE application_secrets
    ADD CONSTRAINT uq_application_secret_name
    UNIQUE (application_id, secret_name);

-- Remove the older constraint and redundant column.
ALTER TABLE application_secrets
    DROP CONSTRAINT IF EXISTS uq_app_secret_name;

ALTER TABLE application_secrets
    DROP COLUMN IF EXISTS app_name;