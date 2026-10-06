# Third-party notices

Liekan application source is distributed under the MIT license. The complete application copyright and license are retained in LICENSE. Dependency and data licenses remain in force independently.

| Component | License / attribution | Use |
| --- | --- | --- |
| Apache ECharts 5.5.0 | Apache-2.0; public/liekan/licenses/echarts-5.5.0-APACHE-2.0.txt | Prototype chart rendering |
| Inter | SIL Open Font License 1.1; public/liekan/licenses/Inter-OFL-1.1.txt | Locally served font |
| detect-browser | MIT; bundled dependency license | Browser recognition |
| GeoLite2 City | MaxMind GeoLite2 data terms; https://www.maxmind.com/en/geolite2/eula | Optional external geography database, inherited local data copy |
| pg-boss 12.36.0 | MIT, retained package LICENSE | Durable PostgreSQL queue and controlled queue bootstrap |
| node-postgres (pg) 8.23.1 | MIT, retained package LICENSE | Queue initialization and isolated integration verification |
| Node.js 22.23.3 | Node.js and bundled third-party licenses, LICENSE retained inside each collector archive | Linux collector runtime |
| Official crawler IP ranges | Public provider data, source URLs and retrieval dates in config/liekan/bot-ranges.json | Time-bounded identity verification |

The direct ua-parser-js dependency has been removed. Next.js may bundle a separate ua-parser-js 1.x implementation with its own MIT notice. The application MIT license does not change the licenses of Next.js, ECharts, fonts, geography data or other dependencies. A clean open-source release must retain their notices and exclude private configuration, database backups and non-distributable data.
实际安装依赖清单随镜像提供在 public/liekan/licenses/dependencies.json，各依赖的 LICENSE/COPYING 文件随 node_modules 保留。清单在镜像内按 Linux 依赖重新生成。Next.js 图片处理使用的 libvips 共享库采用 LGPL-3.0-or-later，其源码与许可链接由 @img/sharp-libvips 包提供；共享库位于独立 node_modules 路径。JSZip 采用可选择的 MIT 许可。
