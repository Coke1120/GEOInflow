CREATE TABLE liekan_account_preferences (
  user_id uuid PRIMARY KEY REFERENCES "user"(user_id) ON DELETE CASCADE,
  country_code varchar(2),
  timezone varchar(80) NOT NULL,
  date_range varchar(100) NOT NULL,
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT liekan_account_preferences_country CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT liekan_account_preferences_timezone CHECK (length(timezone) > 0),
  CONSTRAINT liekan_account_preferences_range CHECK (length(date_range) > 0),
  CONSTRAINT liekan_account_preferences_confirmation CHECK (confirmed_at IS NULL OR country_code IS NOT NULL)
);
