# BOM可搜索复合选择框

后续状态：2026-10-28已随[D-099](99-BOM知识与UI联合发布.md)发布，以下“未发布”为本阶段当时状态；当前版本、线上核验和回退以99为准。

日期：2026-10-28。决定：D-096。状态：本地完成，未发布线上。

用户指出生产计划的已发布BOM同时存在搜索框和下拉菜单，要求合为一个复合框。本批将MES Picker改为共享SearchSelect：一个输入框内搜索、显示选择、展开或清空；产品/组件等共用Picker同步复用。

- 保留可见标签、必填与可访问名称，采用combobox/listbox/option语义；方向键选择、Enter采用、Esc取消搜索，IME确认不提交表单。
- 搜索词为临时输入，只有候选ID或显式清空改变业务表单；空值或只输入文本不能绕过必填，已选值展开搜索时仍满足有效性。
- 搜索250ms防抖，候选每页20条，保留原企业、published/active/kind等筛选；加载更多追加去重，换搜索条件回首批。键盘抵达末项加载下一页，活动项滚动到可见范围。
- 加载、无结果、错误/重试分别反馈；取消搜索或读取失败保留原选值。下拉层按控件和视口定位，手机不横向溢出；公共样式保留键盘焦点。
- 无API、数据库、模型或生产配置变更；D-095等既有工作保留。其他普通select不在本批批量替换。

## 本地验证

真实工作区App＋内存fixture，拦截业务请求；45个候选，桌面1280×720、手机390×844及320×780。18项交互断言通过：单控件、搜索/无结果、键盘选择、Enter/Esc、清空/必填、只输入不能提交、失败与原选值、加载至45项、查询回首批、跨页活动项可见、未保存保护、窄屏边界及BOM产品/组件独立选值。[结果](../output/bom-combobox-20261028/interaction-checks.json)。

三端前端构建通过，包含最终TypeScript构建检查。[构建记录](../output/bom-combobox-20261028/build.log)。环境Node22.16.0/pnpm11.19.0；项目Node24 engine警告与现有web大块资源警告保留。未做真实读屏、原生手机键盘/触屏和生产接口验收，浏览器模拟不替代这些验证。

| 证据 | 说明 |
| --- | --- |
| [桌面搜索](../output/bom-combobox-20261028/04-combobox-desktop-final.png) | 同一控件输入搜索并显示匹配候选 |
| [390px](../output/bom-combobox-20261028/02-combobox-mobile.png) | 下拉层位于控件下方，无整页溢出 |
| [320px](../output/bom-combobox-20261028/03-combobox-320.png) | 窄屏仍可搜索选择，必填语义保留 |
| [共用选择器](../output/bom-combobox-20261028/05-bom-material-pickers.png) | BOM产品与组件独立选值 |

实现为`packages/frontend/src/SearchSelect.tsx`、`search-select.css`、公共导出/样式入口和`apps/web/src/mes/common.tsx`。公共规则同步UI02/UI05和MES04，UI公共版本1.15。修改前快照在`output/bom-combobox-20261028/before/`；[源码检查](../output/bom-combobox-20261028/source-check.json)记录差异与哈希。回退前先比较当前文件，避免覆盖后续改动。
