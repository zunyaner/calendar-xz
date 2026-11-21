# 日历 PWA 首屏性能方案（calendar-xz，同样用于 calendar-lm）

适用于 GitHub Pages 上的主题日历（战日历已落地；橹穆上线时直接按此做）。

## 问题

- 首页全年总览把 12 张 **1600×1200** 月卡 JPEG 立刻设成 CSS `background-image`，无法懒加载。iPhone 首屏会一次拉下约 **3.4 MB**（12 张月卡 + 首页大图 + 182 KB 数据）。慢速 4G 下首页大图约 4 秒出现，网络要约 18 秒才停。
- Service Worker 在 `install` 时用 `cache.addAll` **预缓存全部** hero / card / widget / 大图标（合计约 6 MB）。首次打开会和页面抢带宽，失败还会让整个 SW 安装失败。

## 做法（不改视觉与功能）

1. **出图**（用已裁好的 card/hero/widget，不要用 user-src 原图）
   - `hero-XX.webp`：最长边 1080，质量 85（首页大图）
   - `card-XX.webp`：1080×810，质量 86（本月大卡、月份详情）
   - `thumb-XX.webp`：640×480，质量 80（全年总览小卡）
   - `widget-XX.webp`：宽 1080，质量 82（锁屏预览，不进首屏预缓存）
   - 应用图标：`icon-192.webp` / `icon-512.webp` / `icon-512-maskable.webp`；iOS `apple-touch-icon.png` 保持 PNG
2. **数据**：`photos[].out` / `month_out` / `hero_out` 改为 `.webp`，并加 `thumb_out`
3. **加载**
   - 月卡改用 `<img class="photo-bg">`，不再把大图写进 CSS background（否则无法 lazy）
   - 首页大图：`fetchpriority="high"` + `<link rel="preload" as="image">`
   - 本月大卡：`loading="eager"` + `fetchpriority="high"`，用 `card-*.webp`
   - 全年总览小卡：`loading="lazy"`，用 `thumb-*.webp`
4. **Service Worker**
   - 只预缓存壳：`index.html`、CSS/JS、`calendar-data.json`、manifest、小图标、widget 壳（不要预缓存全部照片）
   - 页面在注册 SW 后 `postMessage({ type: "precache", urls })`，只追加**当月** hero + card + thumb
   - 其余图片运行时 cache-first；二次打开走缓存秒开
   - 每次发布升 CACHE 名（如 `cal2027-xz-v13` / `cal2027-lm-v1`）

## 生成命令

在主题仓库根目录，用 Pillow 从现有 `icons/hero-*.jpg` 与 `icons/card-*.jpg` 导出（或从 user-out 的已裁图）。参考 calendar-xz 本次优化用的尺寸与质量。不要把 `user-src/`、`user-out/` 提交进仓库。
