CREATE TABLE IF NOT EXISTS campaign_metrics
(
    account_id   String,
    campaign_id  String,
    date         Date,
    impressions  UInt64,
    clicks       UInt64,
    spend        Float64,
    sales        Float64,
    orders       UInt64,
    acos         Float64,
    roas         Float64,
    ctr          Float64,
    cpc          Float64
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (account_id, campaign_id, date);
