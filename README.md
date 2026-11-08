# 宇宙观实验室

在同一片**真实的星空**下，切换四种宇宙观 —— 地平说、巨球论（浑天）、地心说（托勒密）、日心说 —— 看它们各自怎么解释你抬头看到的东西。

整个站点是**一个 HTML 文件**（约 5 MB），不需要服务器，双击就能打开。

## 它做什么

- 真实数据：8 等以内的恒星、银河、深空天体、太阳/月亮/行星位置（天文历表）、地磁场（NOAA WMM）、卫星轨道力学、主要流星雨。
- 四种宇宙观各自的模型：从“掌心”一路缩放到地面，看每种说法的几何和机制；界面并排显示“模型预言 vs 现实”。
- 地面视角：时间加速、日月轨迹、四季日轨、极昼极夜、极光、流星、卫星、观测高度、摄影师模式（取景框、延时、星轨、截图）。
- 假说面板里的“日月对照”：四种体系对同一天太阳高度、太阳/月亮视直径的预言，和实际天象画在一起。

> 哪些是真的、哪些是示意：位置、地磁、日月预言、极夜极昼、卫星轨道、流星雨表都是真实数据或真实几何；极光的强度（Kp）是手调的、形状是统计示意；四种宇宙观里“模型预言”一栏是各模型自己的数学结果，不代表对错的裁决。

## 本地运行

需要 Node.js 22（版本固定在 `.node-version`；Node 20 已停止维护）。

```bash
npm ci
npm run build        # 生成 dist/index.html
npm test             # 可选：天文内核校验
```

然后直接双击 `dist/index.html` 即可（不用起服务器）。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/` | 源码（Three.js + 原生 JS；`src/models/` 是四种宇宙观，`src/fx/` 是极光/流星/卫星/日月轨迹，`src/ui/` 是界面） |
| `src/generated/` | 由 `tools/build_*.py`、`tools/build_*.mjs` 从原始数据生成的星表、银河图、地球贴图、地磁系数 |
| `data/`、`assets/` | 生成上述数据用的原始输入（d3-celestial 星表、NASA 贴图） |
| `tools/` | 构建脚本、天文校验、截图/界面/黑块检测脚本（测试脚本依赖本机的 Playwright + Chromium，仅开发用） |
| `PROGRESS.md` | 开发记录与设计决策 |
| `LICENSE`、`THIRD_PARTY_NOTICES.md` | 代码许可证，以及内嵌第三方库/数据/字体的版权与许可全文 |

## 线上地址

- GitHub Pages：https://ml-2020.github.io/cosmos-lab/
- Cloudflare Pages：https://cosmos-lab.pages.dev/

## 部署

- **Cloudflare Pages**：已连接本仓库，构建命令 `npm ci && npm run build`，输出目录 `dist`，Node 版本由 `.node-version` 指定；推送到 `main` 自动构建和部署。
- **GitHub Pages**：仓库 Settings → Pages → Source 选 “GitHub Actions”，推送到 `main` 后由 `.github/workflows/pages.yml` 自动发布。

## 数据与致谢

- 恒星/星座/深空天体：[d3-celestial](https://github.com/ofrohn/d3-celestial)（BSD-3-Clause）
- 天体位置：[astronomy-engine](https://github.com/cosinekitty/astronomy)（MIT）
- 地磁模型：NOAA/NCEI World Magnetic Model（公有领域）
- 地球贴图：NASA Blue Marble / Black Marble；海岸线：Natural Earth（公有领域，经 world-atlas）
- 三维渲染：[three.js](https://threejs.org)（MIT）
- 字体（已裁剪后内嵌）：Noto Serif CJK SC、Bricolage Grotesque（SIL OFL）

## 许可

- 本项目代码以 **MIT** 许可证发布，见 [`LICENSE`](LICENSE)。
- 内嵌的第三方库、星表/贴图数据与字体的版权和许可全文见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

数据与致谢见上一节。
