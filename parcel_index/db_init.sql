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

-- Current location of every district and parcel inscription (parcel_index/owners.py).
CREATE TABLE IF NOT EXISTS public.inscription_owners (
	inscription_id text NOT NULL,
	created_height int4 NOT NULL, -- reveal height of the inscription
	outpoint text NOT NULL, -- "txid:vout" holding the inscription now
	address text NULL, -- NULL when the output script has no address form
	output_value int8 NULL,
	updated_height int4 NOT NULL,
	CONSTRAINT inscription_owners_pk PRIMARY KEY (inscription_id)
);
CREATE INDEX IF NOT EXISTS inscription_owners_outpoint_idx ON public.inscription_owners USING btree (outpoint);
CREATE INDEX IF NOT EXISTS inscription_owners_address_idx ON public.inscription_owners USING btree (address);
CREATE INDEX IF NOT EXISTS inscription_owners_created_height_idx ON public.inscription_owners USING btree (created_height);

CREATE TABLE IF NOT EXISTS public.owner_block_hashes (
	block_height int4 NOT NULL,
	block_hash text NOT NULL,
	CONSTRAINT owner_block_hashes_pk PRIMARY KEY (block_height)
);

-- Land history for activity feeds: claims and transfers between addresses.
CREATE TABLE IF NOT EXISTS public.land_events (
	id bigserial NOT NULL,
	block_height int4 NOT NULL,
	block_time int8 NOT NULL, -- block header time, unix seconds
	kind text NOT NULL, -- district_claimed | parcel_claimed | transfer
	inscription_id text NOT NULL,
	bitmap_number int4 NOT NULL,
	tx_index int4 NULL, -- set for parcels
	from_address text NULL,
	to_address text NULL,
	CONSTRAINT land_events_pk PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS land_events_bitmap_number_idx ON public.land_events USING btree (bitmap_number, id);
CREATE INDEX IF NOT EXISTS land_events_block_height_idx ON public.land_events USING btree (block_height);

-- Per-transaction output totals (sats) of a block, cached by the API for Mondrian layouts.
CREATE TABLE IF NOT EXISTS public.block_tx_values (
	block_height int4 NOT NULL,
	block_hash text NOT NULL,
	tx_values int8[] NOT NULL,
	CONSTRAINT block_tx_values_pk PRIMARY KEY (block_height)
);

-- Zoning inputs, one row per block from height 0 (parcel_index/zones.py).
CREATE TABLE IF NOT EXISTS public.block_stats (
	block_height int4 NOT NULL,
	block_hash text NOT NULL,
	tx_count int4 NOT NULL, -- coinbase included
	total_fee int8 NOT NULL, -- sats
	total_out int8 NOT NULL, -- sats sent by non-coinbase transactions
	inscriptions int4 NOT NULL, -- inscriptions revealed in the block
	CONSTRAINT block_stats_pk PRIMARY KEY (block_height)
);

-- Per halving epoch (210000 blocks), the percentiles zones are cut at.
CREATE TABLE IF NOT EXISTS public.zone_thresholds (
	epoch int4 NOT NULL,
	fee_p90 int8 NULL,
	fee_p99 int8 NULL,
	txs_p25 int4 NULL,
	avg_out_p90 int8 NULL,
	block_count int4 NOT NULL,
	CONSTRAINT zone_thresholds_pk PRIMARY KEY (epoch)
);

-- Zone of each block with stats. The rules are documented in parcel_index/zones.py.
CREATE OR REPLACE VIEW public.block_zones AS
SELECT s.block_height,
	CASE
		WHEN s.block_height IN (0, 57043, 210000, 420000, 481824, 630000, 709632, 767430, 840000) THEN 'landmark'
		WHEN s.tx_count = 1 THEN 'mountain'
		WHEN s.total_fee > 0 AND s.total_fee >= t.fee_p99 THEN 'cbd'
		WHEN s.total_fee > 0 AND s.total_fee >= t.fee_p90 THEN 'commercial'
		WHEN s.inscriptions * 5 >= s.tx_count * 2 THEN 'data'
		WHEN s.tx_count <= t.txs_p25 AND s.total_out / (s.tx_count - 1) > t.avg_out_p90 THEN 'villa'
		ELSE 'residential'
	END AS zone,
	s.tx_count
FROM public.block_stats s
LEFT JOIN public.zone_thresholds t ON t.epoch = s.block_height / 210000;
