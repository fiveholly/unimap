-- unimap parcel layer. Lives next to OPI's bitmap tables in the same database.

CREATE TABLE IF NOT EXISTS public.parcels (
	id bigserial NOT NULL,
	inscription_id text NOT NULL,
	inscription_number int4 NOT NULL,
	tx_index int4 NOT NULL,
	bitmap_number int4 NOT NULL,
	district_inscription_id text NOT NULL,
	block_height int4 NOT NULL, -- height where the parcel inscription was revealed
	CONSTRAINT parcels_pk PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS parcels_bitmap_tx_idx ON public.parcels USING btree (bitmap_number, tx_index);
CREATE INDEX IF NOT EXISTS parcels_block_height_idx ON public.parcels USING btree (block_height);
CREATE INDEX IF NOT EXISTS parcels_inscription_id_idx ON public.parcels USING btree (inscription_id);

CREATE TABLE IF NOT EXISTS public.parcel_block_hashes (
	id bigserial NOT NULL,
	block_height int4 NOT NULL,
	block_hash text NOT NULL,
	CONSTRAINT parcel_block_hashes_pk PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS parcel_block_hashes_block_height_idx ON public.parcel_block_hashes USING btree (block_height);

CREATE TABLE IF NOT EXISTS public.parcel_cumulative_event_hashes (
	id bigserial NOT NULL,
	block_height int4 NOT NULL,
	block_event_hash text NOT NULL,
	cumulative_event_hash text NOT NULL,
	CONSTRAINT parcel_cumulative_event_hashes_pk PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS parcel_cumulative_event_hashes_block_height_idx ON public.parcel_cumulative_event_hashes USING btree (block_height);

-- Immutable per-block facts, cached from bitcoind on first use.
CREATE TABLE IF NOT EXISTS public.block_meta (
	block_height int4 NOT NULL,
	block_hash text NOT NULL,
	tx_count int4 NOT NULL,
	CONSTRAINT block_meta_pk PRIMARY KEY (block_height)
);
