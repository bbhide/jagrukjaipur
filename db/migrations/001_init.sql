-- Jagruk Jaipur — initial schema
-- Money is stored in paise-free NUMERIC(12,2) rupees to match how the legacy site reports it.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- ─── Catalogue ────────────────────────────────────────────────
CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  icon        TEXT NOT NULL DEFAULT '🎉',
  color       TEXT NOT NULL DEFAULT '#7C3AED',
  sort_order  INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,          -- "All Events" pseudo-category, not deletable
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE venues (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  area            TEXT,
  address         TEXT,
  maps_url        TEXT,
  google_place_id TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── People ───────────────────────────────────────────────────
CREATE TABLE users (
  id                 SERIAL PRIMARY KEY,
  whatsapp_number    TEXT NOT NULL UNIQUE,              -- E.164 without '+', e.g. 919876543210
  name               TEXT,
  email              CITEXT,
  gender             TEXT CHECK (gender IN ('Male','Female','Other','Prefer not to say')),
  dob                DATE,
  instagram_username TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admins (
  id            SERIAL PRIMARY KEY,
  username      CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                          -- scrypt$N$r$p$salt$hash
  display_name  TEXT NOT NULL DEFAULT 'Administrator',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,                         -- sha256 of the cookie token
  kind        TEXT NOT NULL CHECK (kind IN ('user','admin','pending')),
  subject_id  INT,                                      -- users.id / admins.id; NULL while pending OTP
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE otp_requests (
  id              BIGSERIAL PRIMARY KEY,
  whatsapp_number TEXT NOT NULL,
  otp_hash        TEXT NOT NULL,
  source_page     TEXT,
  source_button   TEXT,
  status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','verified','expired','failed')),
  attempts        INT NOT NULL DEFAULT 0,
  ip              INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  verified_at     TIMESTAMPTZ
);
CREATE INDEX otp_requests_number_idx ON otp_requests (whatsapp_number, created_at DESC);
CREATE INDEX otp_requests_created_idx ON otp_requests (created_at);

-- ─── Organisers & communities ─────────────────────────────────
CREATE TABLE organizers (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  contact          TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  is_community     BOOLEAN NOT NULL DEFAULT FALSE,
  logo_path        TEXT,
  about            TEXT,
  special          TEXT,                                -- "What makes us special?"
  features         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{icon,label}]
  social_instagram TEXT,
  social_facebook  TEXT,
  social_twitter   TEXT,
  social_whatsapp  TEXT,
  social_website   TEXT,
  -- ticketing account (set when a logged-in user registers as an organiser)
  user_id            INT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  email              CITEXT,
  gstin              TEXT,
  state              TEXT,
  bank_details       JSONB,
  commission_rate    NUMERIC(5,2) NOT NULL DEFAULT 15,
  absorption_mode    TEXT NOT NULL DEFAULT 'organiser' CHECK (absorption_mode IN ('organiser','customer','split')),
  ticketing_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status    TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizer_categories (
  organizer_id INT NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  category_id  INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  position     SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (organizer_id, category_id)
);

-- ─── Events ───────────────────────────────────────────────────
CREATE TABLE events (
  id                 SERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  short_description  TEXT,
  description        TEXT,                              -- sanitised HTML
  event_date         DATE NOT NULL,
  event_time         TIME,
  end_date           DATE,
  end_time           TIME,
  organizer_id       INT REFERENCES organizers(id) ON DELETE SET NULL,
  venue_id           INT REFERENCES venues(id) ON DELETE SET NULL,
  image_path         TEXT,
  thumb_path         TEXT,
  is_free            BOOLEAN NOT NULL DEFAULT FALSE,
  ticket_url         TEXT,
  button_text        TEXT NOT NULL DEFAULT 'Get Tickets',
  ticket_price       TEXT,                              -- free-text label, e.g. "499 onwards"
  is_featured        BOOLEAN NOT NULL DEFAULT FALSE,
  is_exclusive       BOOLEAN NOT NULL DEFAULT FALSE,
  is_recurring       BOOLEAN NOT NULL DEFAULT FALSE,
  recurrence_type    TEXT CHECK (recurrence_type IN ('weekly','monthly')),
  recurrence_days    SMALLINT[] NOT NULL DEFAULT '{}',
  recurrence_day_of_month SMALLINT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled','past')),
  views              INT NOT NULL DEFAULT 0,
  interests          INT NOT NULL DEFAULT 0,            -- public "Interests" counter
  -- organiser-submitted events (ticketing moderation queue)
  source             TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin','organizer')),
  has_ticketing      BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status    TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected')),
  listing_fee_status TEXT NOT NULL DEFAULT 'free' CHECK (listing_fee_status IN ('free','unpaid','paid','refunded')),
  listing_payment_ref TEXT,
  rejection_reason   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_listing_idx ON events (status, event_date);
CREATE INDEX events_end_idx ON events (end_date);
CREATE INDEX events_title_trgm ON events USING gin (title gin_trgm_ops);

CREATE TABLE event_categories (
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  position    SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, category_id)
);
CREATE INDEX event_categories_cat_idx ON event_categories (category_id);

CREATE TABLE event_daily_views (
  event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  views    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, day)
);

CREATE TABLE event_interests (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE submissions (
  id         SERIAL PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('event','community')),
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  payload    JSONB NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','added','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Ticketing ────────────────────────────────────────────────
CREATE TABLE ticket_tiers (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  price      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  capacity   INT CHECK (capacity IS NULL OR capacity >= 0),
  sold       INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX ticket_tiers_event_idx ON ticket_tiers (event_id);

CREATE TABLE event_questions (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE coupons (
  id             SERIAL PRIMARY KEY,
  event_id       INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code           CITEXT NOT NULL,
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
  max_uses       INT,
  uses           INT NOT NULL DEFAULT 0,
  valid_until    DATE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (event_id, code)
);

CREATE TABLE bookings (
  id                  SERIAL PRIMARY KEY,
  reference           TEXT NOT NULL UNIQUE,             -- public booking code
  event_id            INT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  user_id             INT REFERENCES users(id) ON DELETE SET NULL,
  tier_id             INT NOT NULL REFERENCES ticket_tiers(id) ON DELETE RESTRICT,
  quantity            INT NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  attendee_name       TEXT NOT NULL,
  attendee_email      CITEXT,
  attendee_phone      TEXT,
  answers             JSONB NOT NULL DEFAULT '[]'::jsonb,
  coupon_id           INT REFERENCES coupons(id) ON DELETE SET NULL,
  subtotal            NUMERIC(12,2) NOT NULL,           -- price × qty
  discount            NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission          NUMERIC(12,2) NOT NULL DEFAULT 0, -- platform fee on (subtotal − discount)
  gst                 NUMERIC(12,2) NOT NULL DEFAULT 0, -- 18 % on commission
  customer_fee        NUMERIC(12,2) NOT NULL DEFAULT 0, -- part of commission + gst charged to the buyer
  total               NUMERIC(12,2) NOT NULL,           -- amount the buyer pays
  organizer_payout    NUMERIC(12,2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed','cancelled','refunded')),
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at        TIMESTAMPTZ
);
CREATE INDEX bookings_event_idx ON bookings (event_id, status);
CREATE INDEX bookings_user_idx ON bookings (user_id);

CREATE TABLE tickets (
  id            SERIAL PRIMARY KEY,
  booking_id    INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  code          TEXT NOT NULL UNIQUE,                   -- encoded in the QR pass
  checked_in_at TIMESTAMPTZ
);

CREATE TABLE settlements (
  id           SERIAL PRIMARY KEY,
  organizer_id INT NOT NULL REFERENCES organizers(id) ON DELETE RESTRICT,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('UPI','Bank Transfer','NetBanking','Cash')),
  summary      TEXT NOT NULL,
  created_by   INT REFERENCES admins(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE listing_promos (
  id             SERIAL PRIMARY KEY,
  code           CITEXT NOT NULL UNIQUE,
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
  max_uses       INT,
  uses           INT NOT NULL DEFAULT 0,
  valid_until    DATE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Podcast ──────────────────────────────────────────────────
CREATE TABLE podcast_episodes (
  id             SERIAL PRIMARY KEY,
  episode_number INT NOT NULL,
  title          TEXT NOT NULL,
  youtube_id     TEXT NOT NULL,
  youtube_url    TEXT,
  guest_name     TEXT,
  guest_title    TEXT,
  category       TEXT,
  description    TEXT,
  release_date   DATE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE podcast_guests (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  designation TEXT,
  bio         TEXT,
  photo_path  TEXT,
  socials     JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE podcast_applications (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       CITEXT NOT NULL,
  designation TEXT,
  topic       TEXT NOT NULL,
  bio         TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','contacted','scheduled','rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Settings ─────────────────────────────────────────────────
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
