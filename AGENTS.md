# BesMapLab 工作约定

## 项目范围

- 定位：通过交互了解世界地图的开源项目。
- 当前支持 Robinson、Equal Earth、Mercator 三种投影和中文标注；计划功能必须明确标记为未实现。
- 本地优先，默认不添加联网请求、遥测、账户或后端依赖。
- 国界、国家/地区名称和面积数据的修改应说明来源；投影规则与地理数据分开维护。

## 源码与构建

- 修改 `src/`、`data/`、`scripts/` 后运行 `npm run build`，将更新后的 `index.html` 一起提交。
- 不直接手工修改生成的 `index.html`。
- 保留第三方文件的来源、版本、许可和 SHA-256；更新第三方库时同步 `data/sources.json`。
- 文本采用 UTF-8、纯 CRLF，遵循 `.gitattributes` 和 `.editorconfig`；不修改无关文件的换行。
- 对球面旋转、反子午线裁剪、共享边界简化等约束添加简短注释。

## 验证与提交

- 提交前运行 `npm run check`；修改地图交互时运行 `npm test`，并查看浏览器截图。
- 遵循 Conventional Commits。标题后空行，正文写 2–4 条主要行为及验证结果。
- AI 提交末尾追加 `Co-Authored-By: Codex <model-slug> <noreply@openai.com>`。
- 本机提交前执行 `powershell -NoProfile -File "$env:USERPROFILE\.codex\scripts\get-current-model.ps1"`，使用其唯一标准输出作为精确模型标识。脚本失败时先说明，不猜测。
