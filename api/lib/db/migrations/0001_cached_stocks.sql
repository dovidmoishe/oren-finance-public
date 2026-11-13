CREATE TABLE "cached_stocks" (
	"asset_id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"logo" text,
	"price" numeric(24, 8),
	"price_change_24h" numeric(20, 8),
	"volume_24h" numeric(28, 8),
	"liquidity" numeric(28, 8),
	"sort_rank" integer NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cached_stocks_sort_rank_idx" ON "cached_stocks" USING btree ("sort_rank");
--> statement-breakpoint
CREATE INDEX "cached_stocks_ticker_idx" ON "cached_stocks" USING btree ("ticker");
--> statement-breakpoint
CREATE INDEX "cached_stocks_expires_at_idx" ON "cached_stocks" USING btree ("expires_at");
