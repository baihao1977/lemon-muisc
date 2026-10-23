# 柠檬音乐 v1.2.17.16

## 更新内容

- **飞牛 / FPK**：修复升级到 1.2.17.15 后无法启用（`ERR_MODULE_NOT_FOUND`）——新增 MusicFree 依赖 `axios` / `cheerio` 后未触发 npm 补装；启用时检测并补齐
- **飞牛 / FPK**：修复补装后仍提示缺少 axios/cheerio——npm 装到实体 `node_modules` 后被错误丢弃、链回旧持久目录；改为用新安装结果覆盖持久依赖

## 安装 / 更新

- x86：`lemon-music-1.2.17.16-x86.fpk`
- ARM：`lemon-music-1.2.17.16-arm.fpk`
