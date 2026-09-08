-- B3 修正：手工上架可只记录渠道、商品和展示价格，外部链接不是必填项。
ALTER TABLE listings ALTER COLUMN external_url DROP NOT NULL;
