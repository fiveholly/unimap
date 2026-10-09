-- unimap social data. Reads the indexer tables (public schema), never writes them.

CREATE SCHEMA IF NOT EXISTS social;

CREATE TABLE IF NOT EXISTS social.login_nonces (
	nonce text NOT NULL,
	address text NOT NULL,
	message text NOT NULL, -- exact text the wallet signs
	expires_at timestamptz NOT NULL,
	used_at timestamptz NULL,
	CONSTRAINT login_nonces_pk PRIMARY KEY (nonce)
);

CREATE TABLE IF NOT EXISTS social.sessions (
	token_hash text NOT NULL, -- sha256 of the bearer token
	address text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	CONSTRAINT sessions_pk PRIMARY KEY (token_hash)
);

CREATE TABLE IF NOT EXISTS social.profiles (
	bitmap_number int4 NOT NULL,
	bio text NOT NULL DEFAULT '',
	cover text NULL, -- image URL
	visitor_comments_on bool NOT NULL DEFAULT true,
	pinned_post_id int8 NULL,
	updated_by text NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT profiles_pk PRIMARY KEY (bitmap_number)
);

-- Posts and replies. author_role and author_parcel record the author's standing
-- in the district when they posted; it is not updated when land changes hands.
CREATE TABLE IF NOT EXISTS social.posts (
	id bigserial NOT NULL,
	bitmap_number int4 NOT NULL,
	author_address text NOT NULL,
	author_role text NOT NULL, -- owner | resident | visitor
	author_parcel int4 NULL, -- tx_index of the parcel that made the author a resident
	author_bitmap int4 NULL, -- district the author chose to post as
	reply_to int8 NULL,
	body text NOT NULL,
	media jsonb NOT NULL DEFAULT '[]',
	signed_message text NOT NULL,
	signature text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	removed_at timestamptz NULL,
	removed_by text NULL,
	CONSTRAINT posts_pk PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS posts_bitmap_idx ON social.posts USING btree (bitmap_number, id) WHERE reply_to IS NULL;
CREATE INDEX IF NOT EXISTS posts_reply_to_idx ON social.posts USING btree (reply_to, id);
CREATE INDEX IF NOT EXISTS posts_author_idx ON social.posts USING btree (author_address, created_at);
CREATE INDEX IF NOT EXISTS posts_recent_idx ON social.posts USING btree (bitmap_number, created_at); -- prosperity
CREATE UNIQUE INDEX IF NOT EXISTS posts_signature_idx ON social.posts USING btree (signature);

CREATE TABLE IF NOT EXISTS social.likes (
	address text NOT NULL,
	post_id int8 NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT likes_pk PRIMARY KEY (post_id, address)
);

CREATE TABLE IF NOT EXISTS social.follows (
	address text NOT NULL,
	bitmap_number int4 NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT follows_pk PRIMARY KEY (address, bitmap_number)
);
CREATE INDEX IF NOT EXISTS follows_bitmap_idx ON social.follows USING btree (bitmap_number);

CREATE TABLE IF NOT EXISTS social.mutes (
	bitmap_number int4 NOT NULL,
	address text NOT NULL,
	by_address text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT mutes_pk PRIMARY KEY (bitmap_number, address)
);

-- Log of every moderation action.
CREATE TABLE IF NOT EXISTS social.moderation (
	id bigserial NOT NULL,
	bitmap_number int4 NOT NULL,
	action text NOT NULL, -- mute | unmute | remove_post | pin | unpin | profile
	target_address text NULL,
	post_id int8 NULL,
	by_address text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT moderation_pk PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS moderation_bitmap_idx ON social.moderation USING btree (bitmap_number, id);

-- One row per signed-in visitor per district per day (UTC); counts towards prosperity.
CREATE TABLE IF NOT EXISTS social.checkins (
	address text NOT NULL,
	bitmap_number int4 NOT NULL,
	day date NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT checkins_pk PRIMARY KEY (bitmap_number, day, address)
);

-- A district's look on the map (api/style.py): {"color": ..., "deco": [...]}.
ALTER TABLE social.profiles ADD COLUMN IF NOT EXISTS style jsonb NULL;

-- Recruiting residents (api/recruit.py). A notice counts only while created_by still owns
-- the district, so it lapses by itself when the district is sold.
CREATE TABLE IF NOT EXISTS social.recruitments (
	bitmap_number int4 NOT NULL,
	message text NOT NULL,
	parcels int4[] NOT NULL DEFAULT '{}', -- tx_index of the plots on offer
	created_by text NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT recruitments_pk PRIMARY KEY (bitmap_number)
);
CREATE TABLE IF NOT EXISTS social.applications (
	bitmap_number int4 NOT NULL,
	address text NOT NULL,
	note text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT applications_pk PRIMARY KEY (bitmap_number, address)
);

-- District polls (api/polls.py). The owner asks, the owner and residents vote.
CREATE TABLE IF NOT EXISTS social.polls (
	id bigserial NOT NULL,
	bitmap_number int4 NOT NULL,
	question text NOT NULL,
	options text[] NOT NULL,
	created_by text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	closes_at timestamptz NOT NULL,
	closed_at timestamptz NULL, -- closed early by the owner
	CONSTRAINT polls_pk PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS polls_bitmap_idx ON social.polls USING btree (bitmap_number, id);
CREATE TABLE IF NOT EXISTS social.poll_votes (
	poll_id int8 NOT NULL,
	address text NOT NULL,
	option int2 NOT NULL,
	role text NOT NULL, -- owner | resident, when they voted
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT poll_votes_pk PRIMARY KEY (poll_id, address)
);

-- Parks (api/parks.py): connected districts held by one address. A member
-- counts only while owner_address still holds it.
CREATE TABLE IF NOT EXISTS social.parks (
	id bigserial NOT NULL,
	name text NOT NULL,
	owner_address text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT parks_pk PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS social.park_members (
	bitmap_number int4 NOT NULL,
	park_id int8 NOT NULL,
	CONSTRAINT park_members_pk PRIMARY KEY (bitmap_number)
);
CREATE INDEX IF NOT EXISTS park_members_park_idx ON social.park_members USING btree (park_id);

-- Holdings on the map (api/holdings.py). What an owner picked to show on a district; a pick
-- counts only while updated_by still holds the district.
CREATE TABLE IF NOT EXISTS social.showcase (
	bitmap_number int4 NOT NULL,
	assets text[] NOT NULL,
	updated_by text NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT showcase_pk PRIMARY KEY (bitmap_number)
);
-- Cached balances from the holdings provider, refreshed every few hours.
CREATE TABLE IF NOT EXISTS social.holdings (
	address text NOT NULL,
	asset text NOT NULL,
	amount numeric NOT NULL,
	CONSTRAINT holdings_pk PRIMARY KEY (address, asset)
);
CREATE TABLE IF NOT EXISTS social.holdings_checked (
	address text NOT NULL,
	checked_at timestamptz NOT NULL,
	error text NULL, -- the provider's last failure; the cache above is then older
	CONSTRAINT holdings_checked_pk PRIMARY KEY (address)
);
