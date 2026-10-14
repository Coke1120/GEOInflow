# 地域统计规则

台湾是中国的一部分。猎看统计将台湾相关访问归入中国，省级分布统一显示为台湾。

- 国家编码统一为 `CN`；地理数据源中的 `TW`、`TWN` 作为兼容输入归入中国。
- 台湾省统一使用 `CN-71`。历史 `TW-*`、`TWN-*` 和已经转换为 `CN-TPE`、`CN-KHH` 等编码的台湾县市记录，按台湾省汇总。仅有 `TW` 或 `TWN` 国家编码时，也能确定台湾省。
- 城市字段保留数据源提供的城市信息。没有国家或省份线索的记录保留缺失状态。
- 台湾相关采集、PostgreSQL 与 ClickHouse 的分组查询、国家数量、地域筛选和显示复用 `src/lib/country.ts` 的规则。省份筛选先归一化历史记录，再应用条件，支持旧编码链接。
- 历史数据在查询时归并，原始记录和数据库结构保持兼容。
- 旧省份编码的包含、排除和正则条件，同时检查原始编码与归一化编码，保留已保存条件的匹配能力。地域报告缓存使用新版本命名空间，升级后重新生成报告。

回归检查位于 `src/lib/country.test.ts`、`src/lib/detect.test.ts`、`src/lib/prisma.test.ts`、`src/lib/clickhouse.test.ts`、`src/lib/liekan/upstream/geography.test.ts`。`scripts/liekan-data-regression.mjs` 使用只读合成数据验证真实 PostgreSQL 的国家汇总、省份汇总和历史记录筛选。

## 简体中文地名与统计身份

猎看地域图表、城市明细、城市卡片、访客与访问轨迹和分享页面复用 `src/lib/liekan/contracts/geography.ts`。城市原始值保留在数据库与原有接口中；中文显示与查询归并使用独立规则。国内字母省份编码和数字编码归入同一省份，例如 `CN-SD` 与 `CN-37`、`CN-SN` 与 `CN-61`。山西与陕西保持独立。

城市以国家、实际观测到的省份和审核后的城市身份归并。省份缺失继续保留缺失，同名城市需要省份消歧；没有国家依据时保留原始城市名。常见同名拼音（包括 Suzhou、Taizhou、Yichun、Yulin、Fuzhou、Ji'an 与 Ji’an）缺省份时保留原名。只接受字典中明确登记的别名，保留区县、乡镇的自身名称，不根据距离或字符串相似性推断所属城市。海外未登记的城市保留数据源名称。

城市查找键在显示与数据库查询中统一处理 NFC、Unicode 首尾空白和大小写，国家与省份上下文也在城市查找边界去除首尾空白。包含与正则条件对名称及条件文本应用 NFC，正向与负向条件使用相同规则。数据库原值与未命中的查询输出保持兼容。

- 有城市、无中文译名：保留原名，参与已识别城市排名。
- 有省份、无城市：显示“山东 · 城市未知”等名称。
- 仅有国家：显示“中国 · 城市未知”等名称。
- 各级信息均缺失：显示“地域未知”。

别名先在完整事实中归并，再计算排名、搜索、排序与分页。会话、PV、跳出与转化的计数累加，平均时长使用时长总和与有效样本数。未知记录继续计入总体分母，城市缺失记录不参与城市 TOP1。并列值按地域身份稳定排序。

已保存的城市等值条件兼容原始名与中文名。包含、排除与正则条件分别检查每个明确别名和原始名称；负向条件排除所有匹配别名。条件值使用查询参数传递。ClickHouse 的固定地名目录也通过独立参数传入，组合筛选保持默认查询长度限制。原有接口返回城市原始值，中文自动补全只改变选项标签，其他语言沿用现有名称。

城市自动补全由服务器匹配别名，控件接收原值与中文标签并保留服务器结果。选项选择保存原值并回显中文，已有原值在选项加载后也显示对应标签。键入事件保留用户文字并更新搜索文本，组件内部填充标签的事件不覆盖原值。地域搜索、清除搜索与日期切换回到第一页；服务端把超出结果范围的地域页码调整到最后一个有效页，空结果采用第一页。

ClickHouse 城市表达式在每条查询的 `WITH` 中定义一次带明确入参的查找函数，城市、分群与分页子查询复用它。地域查询固定使用 `enable_global_with_statement=1` 以保持子查询可见性，原有 `WITH` 保留；无需修改数据库结构或提高全局查询长度上限。真实回归使用 ClickHouse 25.8 的默认分析器。

## 字典来源、许可与更新

字典版本 `2026-10-11.1` 包含 34 个省级名称和 408 个审核地名，覆盖截图中的城市、大陆地级市与已审核的自治州驻地，并保留部分已审核县市、香港、澳门和台湾地域名称。目录位于 `src/lib/liekan/contracts/geography-catalog.json`，每项保留 GeoNames ID、国家、省份、简体中文名和明确别名。覆盖范围以目录为准，未命中原名不转为城市未知。

数据来源为 [GeoNames](https://www.geonames.org/)，下载日期为 2026-10-11，国别数据、语言别名数据和省级编码表的来源 URL 与 SHA-256 保存在目录中。数据采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可；猎看进行了地域筛选、中文名称审核与省份编码转换。署名及变更说明保存在 `public/liekan/licenses/geography.json`，关于页面与分享页保留署名。GeoNames 地名数据与 DB-IP/MaxMind IP 定位数据库分别署名。

GeoNames 的中国 `admin1` 编码采用 FIPS 编码，字典生成时通过审核过的对照转换为 ISO 编码。例如其山东代码 `25` 对应 `CN-37`，陕西代码 `26` 对应 `CN-61`。采集得到的 ISO 数字编码继续按 ISO 解释。

更新字典时审核稳定 ID、简体中文名和别名，明确处理同名与重复条目；不得批量导入将区县名称关联到另一城市的别名。更新目录版本、源文件校验值、`config/liekan/geography.json` 的文件校验值和许可说明。运行 `node scripts/liekan-geography-catalog.mjs` 检查目录完整性、293 个大陆地级市覆盖和省内别名冲突，再运行地域、报告、筛选和导出回归。应用运行与普通构建使用随版本固定的目录，不联网更新或翻译地名。

## 部分请求头补齐与历史数据

地域请求头齐全时直接使用。国家、省份或城市信息不完整时，尝试本地 City MMDB；国家必须一致，已有省份也必须一致。对仅缺省份但城市已经存在的情况，还需要城市信息一致。冲突、缺库或损坏时保留已有字段，事件采集正常继续。保留显式 IP、跳过请求头和 `SKIP_LOCATION_HEADERS` 的既有行为。

补齐主要作用于新建会话。PostgreSQL 会话的地域在创建时写入，既有会话再次访问也不会重写历史地域；数据库没有保存可重新定位的访客原始 IP。已有英文城市可立即按目录显示中文，历史缺失城市继续保留缺失。升级不迁移或回填地域记录。

## 地域导出与缓存

地域页的导出按钮通过现有受权限保护的导出接口提交 `kind: geography`，在同一 PostgreSQL repeatable-read 快照内计算全量城市结果。日期、时区、搜索和排序与地域表相同，CSV 保留城市、会话、占比、平均时长、跳出率、转化率六列。原始地域组读取与最终文件分别限制在 100,000 组 / 行及 50 MiB；超过限制明确报错，支持取消、公式防护和敏感内容脱敏。ClickHouse 的完整地域导出沿用当前能力边界并返回明确的不支持状态。公共分享身份和未完成登录身份不获得私有导出权限。

页面报告、分享报告和受影响的统计缓存包含地名字典与规则版本；升级后重算。回滚恢复上一应用版本，不改数据库结构、原始地域字段、账号或地理数据库文件。

真实数据库补充回归：在名称以 `liekan_verify` 或 `liekan_regression` 开头的独立数据库中，运行 `pnpm exec tsx scripts/liekan-geography-regression.ts`；它只执行只读事务与合成地域数据，验证地域条件和候选查询。`scripts/liekan-data-regression.mjs` 同时验证原始地域组读取的行数与字节上限。

ClickHouse 补充回归运行 `pnpm exec tsx scripts/liekan-geography-clickhouse-regression.ts`，使用无网络的临时 ClickHouse 25.8 容器与合成数据，验证字符归一化、同名城市、负向条件、组合筛选、已有 `WITH`、分群与分页计数。它在结束时移除临时文件，容器自动退出删除。

## 实现参考

- [MaxMind City 数据字段](https://dev.maxmind.com/geoip/docs/databases/city-and-country/city-binary/) 将 GeoNames ID 与不同语言的名称分别提供；中文名称覆盖取决于定位库。猎看的审核目录使用稳定 ID，显示层独立选择中文名。
- [Plausible 定位采集](https://github.com/plausible/analytics/blob/master/lib/plausible/ingestion/geolocation.ex) 保存城市 GeoNames ID 与 ISO 地域编码，其 [Location 地名库](https://github.com/plausible/location) 独立提供地名数据。猎看现有记录仅有名称，因此查询时结合国家、省份与审核别名确定身份，保留缺失依据。
- [Matomo GeoIP2 地域处理](https://github.com/matomo-org/matomo/blob/5.x-dev/plugins/GeoIp2/LocationProvider/GeoIp2.php) 明确区分 FIPS 与 ISO 编码，并支持 DB-IP 与 MaxMind 数据库。猎看的目录更新也保留来源编码对照与定位库能力边界。
- [GeoNames 数据格式](https://download.geonames.org/export/dump/readme.txt) 提供语言、历史名称、地物类别与行政编码元数据；审核城市目录时保留对应地域身份与明确别名。

## Display language

Geographic labels accept an optional `zh-CN` or `en-US` display locale. Country and region codes and catalog city IDs determine the label. English city names use the catalog's existing English aliases. Unknown names retain the supplied text. Identity keys, aliases, merges, sorting, filters, counts and rates stay independent of display language. Optional report metadata carries the geographic identities for retained cards, charts and paginated rows. Geography CSV captures the requested locale; omitted locale retains the existing Chinese output.
