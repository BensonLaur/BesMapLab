# 第三方组件与数据

BesMapLab 的原创代码和文档使用根目录 MIT 许可。下面组件保留各自的许可，项目许可不覆盖其原有权利声明。

| 组件 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| D3 | 7.9.0 | ISC | 地理投影、几何与 SVG 操作 |
| d3-geo-projection | 4.0.0 | ISC；内含 MIT 许可部分 | Robinson 等投影 |
| topojson-client | 3.1.0 | ISC | 将拓扑恢复为地理要素 |
| topojson-server | 3.0.1 | ISC | 构建共享边界拓扑 |
| topojson-simplify | 3.0.3 | ISC | 简化动画使用的共享弧段 |

许可原文保存在 `LICENSES/`。各文件的下载来源和 SHA-256 见 [`data/sources.json`](data/sources.json)。第三方 JavaScript 仅统一了换行，代码内容未作修改。

## Natural Earth

国家/地区和湖泊轮廓来自 Natural Earth 1:50m 数据。当前快照来自早期地图原型，记录日期为 2026-09-27。来源路径与文件校验值见 `data/sources.json`。

- 项目：https://www.naturalearthdata.com/
- 数据仓库：https://github.com/nvkelso/natural-earth-vector
- 公有领域说明：https://www.naturalearthdata.com/about/terms-of-use/

Natural Earth 允许个人、教育和商业使用及修改。地图边界和分类沿用数据集自身的表达方式；国家/地区条目数不等于主权国家数。
