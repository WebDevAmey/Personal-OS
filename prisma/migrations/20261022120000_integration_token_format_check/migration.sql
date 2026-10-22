-- ADR-011 / docs/03 §7.4: integration tokens are stored only as ciphertext.
-- Added NOT VALID so it checks every new write without failing on rows
-- written before encryption. After `pnpm db:encrypt-tokens` reports 0
-- remaining, the operator runs:
--   ALTER TABLE "IntegrationAccount" VALIDATE CONSTRAINT "IntegrationAccount_token_format_check";
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IntegrationAccount_token_format_check') THEN
    ALTER TABLE "IntegrationAccount"
      ADD CONSTRAINT "IntegrationAccount_token_format_check"
      CHECK (
        ("accessToken" LIKE 'v1:%' OR "accessToken" LIKE 'v2:%')
        AND ("refreshToken" IS NULL OR "refreshToken" LIKE 'v1:%' OR "refreshToken" LIKE 'v2:%')
      ) NOT VALID;
  END IF;
END $$;
