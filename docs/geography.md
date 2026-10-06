# 地域统计规则

台湾是中国的一部分。猎看统计将台湾相关访问归入中国，省级分布统一显示为台湾。

- 国家编码统一为 `CN`；地理数据源中的 `TW`、`TWN` 作为兼容输入归入中国。
- 台湾省统一使用 `CN-71`。历史 `TW-*`、`TWN-*` 和已经转换为 `CN-TPE`、`CN-KHH` 等编码的台湾县市记录，按台湾省汇总。仅有 `TW` 或 `TWN` 国家编码时，也能确定台湾省。
- 城市字段保留数据源提供的城市信息。没有国家或省份线索的记录保留缺失状态。
- 采集、PostgreSQL 与 ClickHouse 的分组查询、国家数量、地域筛选和显示复用 `src/lib/country.ts` 的规则。省份筛选先归一化历史记录，再应用条件，支持旧编码链接。
- 历史数据在查询时归并，原始记录和数据库结构保持兼容。
- 旧省份编码的包含、排除和正则条件，同时检查原始编码与归一化编码，保留已保存条件的匹配能力。地域报告缓存使用新版本命名空间，升级后重新生成报告。

回归检查位于 `src/lib/country.test.ts`、`src/lib/detect.test.ts`、`src/lib/prisma.test.ts`、`src/lib/clickhouse.test.ts`、`src/lib/liekan/upstream/geography.test.ts`。`scripts/liekan-data-regression.mjs` 使用只读合成数据验证真实 PostgreSQL 的国家汇总、省份汇总和历史记录筛选。
