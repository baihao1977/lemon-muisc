# Docker 部署

需要已安装 Docker。**不用克隆源码、不用 `--build`**，拉官方镜像即可。

镜像：`ghcr.io/jia070310/lemon-muisc:latest`  
端口：`7983`  
首次登录：`admin123` / `admin123`（登录后立刻改密）

飞牛应用中心装的是原生 FPK，**不要**再把 Docker 套进 FPK。下面面向自建 Linux / NAS Docker / 群晖 / **宝塔** 等。

| 场景 | 章节 |
|------|------|
| compose / `docker run` | 方式一、二 |
| 国内 GHCR 加速 | 方式三 |
| 宝塔面板 | [方式四：宝塔面板 Docker](#方式四宝塔面板-docker) |

---

## 方式一：docker-compose.yml（推荐）

把下面内容保存为 `docker-compose.yml`。群晖 / 飞牛 Docker / 其它面板：新建项目，直接粘贴这段 YAML。需要改目录时，把 `./data/...` 换成共享文件夹（如 `/volume1/music:/music`）。

```yaml
services:
  lemon-music: # 服务名，一般不用改
    image: ghcr.io/jia070310/lemon-muisc:latest # 镜像；国内可改 ghcr.1ms.run/jia070310/lemon-muisc:latest
    container_name: lemon-music # 容器名
    ports:
      - "7983:7983" # 宿主机端口:容器端口，改左边即可
    restart: unless-stopped # 异常退出后自动重启
    environment:
      PORT: "7983" # 容器内监听端口，需与上面 ports 右侧一致
      DOWNLOAD_PATH: /downloads # 容器内下载目录
      CONFIG_PATH: /config # 容器内配置与数据库目录
      # MUSIC_HOST_PATH: /volume1/music # 可选，界面展示用的宿主机音乐路径
      # DOWNLOADS_HOST_PATH: /volume1/downloads # 可选，界面展示用的宿主机下载路径
      # LEMON_PUBLIC_URL: http://192.168.1.8:7983 # 可选，DLNA 投屏拉流地址
    volumes:
      - ./data/music:/music # 音乐库：左边改成你的歌曲目录
      - ./data/downloads:/downloads # 下载保存目录
      - ./data/config:/config # 配置与数据库，更新镜像不要删
```

然后在该文件所在目录执行：

```bash
docker compose up -d
```

浏览器打开：`http://服务器IP:7983`

更新：

```bash
docker compose pull
docker compose up -d
```

---

## 方式二：docker pull + docker run

```bash
mkdir -p data/music data/downloads data/config

docker pull ghcr.io/jia070310/lemon-muisc:latest

docker run -d --name lemon-music --restart unless-stopped \
  -p 7983:7983 \
  -e PORT=7983 \
  -e DOWNLOAD_PATH=/downloads \
  -e CONFIG_PATH=/config \
  -v "$PWD/data/music:/music" \
  -v "$PWD/data/downloads:/downloads" \
  -v "$PWD/data/config:/config" \
  ghcr.io/jia070310/lemon-muisc:latest
```

更新：

```bash
docker pull ghcr.io/jia070310/lemon-muisc:latest
docker rm -f lemon-music
# 再执行上面同一条 docker run（数据在 data/ 里，不会丢）
```

---

## 方式三：国内源拉取（GHCR 慢或失败时）

官方地址是 `ghcr.io/jia070310/lemon-muisc`。国内访问 GitHub Container Registry 经常超时，可把 `ghcr.io` 换成加速域名，**镜像名和 tag 不变**。

下面以 `ghcr.1ms.run` 为例（第三方加速，非本项目运维；失效时换其它 GHCR 加速站即可，写法相同）。

### Compose：直接改 `image`

把 `docker-compose.yml` 里的 `image` 换成加速地址，保存后 `docker compose up -d`：

```yaml
services:
  lemon-music: # 服务名，一般不用改
    image: ghcr.1ms.run/jia070310/lemon-muisc:latest # 国内加速镜像；加速站失效可换其它 GHCR 镜像站
    container_name: lemon-music # 容器名
    ports:
      - "7983:7983" # 宿主机端口:容器端口，改左边即可
    restart: unless-stopped # 异常退出后自动重启
    environment:
      PORT: "7983" # 容器内监听端口，需与上面 ports 右侧一致
      DOWNLOAD_PATH: /downloads # 容器内下载目录
      CONFIG_PATH: /config # 容器内配置与数据库目录
    volumes:
      - ./data/music:/music # 音乐库：左边改成你的歌曲目录
      - ./data/downloads:/downloads # 下载保存目录
      - ./data/config:/config # 配置与数据库，更新镜像不要删
```

```bash
docker compose pull
docker compose up -d
```

指定版本把 `latest` 改成 `1.2.17.10`。

### 命令行：pull 后改名（compose 仍写官方地址时）

若 YAML 里还是 `ghcr.io/...`，先从国内源拉下来，打成官方名，再 `up`：

```bash
docker pull ghcr.1ms.run/jia070310/lemon-muisc:latest
docker tag ghcr.1ms.run/jia070310/lemon-muisc:latest ghcr.io/jia070310/lemon-muisc:latest
docker compose up -d
```

### docker run

```bash
docker pull ghcr.1ms.run/jia070310/lemon-muisc:latest

docker run -d --name lemon-music --restart unless-stopped \
  -p 7983:7983 \
  -e PORT=7983 \
  -e DOWNLOAD_PATH=/downloads \
  -e CONFIG_PATH=/config \
  -v "$PWD/data/music:/music" \
  -v "$PWD/data/downloads:/downloads" \
  -v "$PWD/data/config:/config" \
  ghcr.1ms.run/jia070310/lemon-muisc:latest
```

更新：再执行一次 `docker pull ghcr.1ms.run/jia070310/lemon-muisc:latest`，然后 `docker compose up -d` 或删掉旧容器后重新 `docker run`。

加速站挂了时，把 `ghcr.1ms.run` 换成你能用的其它 GHCR 镜像站，路径仍是 `/jia070310/lemon-muisc:latest`。

---

## 目录挂载

| 宿主机（示例） | 容器内 | 用途 |
|----------------|--------|------|
| `./data/music` | `/music` | 音乐库 |
| `./data/downloads` | `/downloads` | 下载保存 |
| `./data/config` | `/config` | 数据库与设置 |

可改成绝对路径，例如 `/mnt/music:/music`。把歌曲放到宿主机对应目录后，在网页里点「刷新库」。

### 常用环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `7983` | 监听端口 |
| `DOWNLOAD_PATH` | `/downloads` | 下载目录（容器内） |
| `CONFIG_PATH` | `/config` | 配置目录（容器内） |
| `MUSIC_HOST_PATH` | （空） | 可选，界面展示用的宿主机音乐路径 |
| `DOWNLOADS_HOST_PATH` | （空） | 可选，界面展示用的宿主机下载路径 |
| `HTTPS` | （自动） | `1` 强制开 HTTPS；`0` 强制 HTTP |
| `SSL_CERT` / `SSL_KEY` | （空） | 容器内证书路径 |
| `LEMON_PUBLIC_URL` | （空） | DLNA 拉流地址，如 `http://192.168.1.8:7983` |

DLNA 投屏依赖局域网组播。桥接网往往搜不到设备，可加 `network_mode: host`（并相应改端口），或设 `LEMON_PUBLIC_URL`。

---

## 方式四：宝塔面板 Docker

适合已安装「Docker 管理器」的宝塔 Linux。官方镜像在 **GitHub Container Registry（ghcr.io）**，不是 Docker Hub，因此：

- **推荐用「命令拉取」**（面板里「拉取镜像 → 命令拉取」），直接执行 `docker pull …`
- 「从仓库拉取 / 常规拉取」多半按 Docker Hub 仓库名解析，**填 `ghcr.io/...` 经常失败或找不到**；国内也建议用加速域名命令拉取

默认宿主机目录（可按需改成你的盘符路径，容器内右侧路径不要改）：

| 宿主机 | 容器内 | 用途 |
|--------|--------|------|
| `/www/wwwroot/lemon-music/config` | `/config` | 配置与数据库（更新镜像勿删） |
| `/www/wwwroot/lemon-music/music` | `/music` | 音乐库 |
| `/www/wwwroot/lemon-music/downloads` | `/downloads` | 下载保存（含「柠檬音乐更新」安装包） |

### 1. 准备目录

在宝塔「终端」或 SSH 执行：

```bash
mkdir -p /www/wwwroot/lemon-music/{config,music,downloads}
```

### 2. 拉取镜像（命令拉取）

**Docker 管理器 → 镜像 → 拉取镜像 → 命令拉取**，执行下面其一。

官方源：

```bash
docker pull ghcr.io/jia070310/lemon-muisc:latest
```

国内拉不动 `ghcr.io` 时（示例加速站，失效可换其它 GHCR 加速）：

```bash
docker pull ghcr.1ms.run/jia070310/lemon-muisc:latest
docker tag ghcr.1ms.run/jia070310/lemon-muisc:latest ghcr.io/jia070310/lemon-muisc:latest
```

指定版本把 `latest` 换成如 `1.2.17.19`。

### 3. 创建容器

**Docker 管理器 → 容器 → 添加容器**，或终端执行：

```bash
docker run -d --name lemon-music --restart unless-stopped \
  -p 7983:7983 \
  -e PORT=7983 \
  -e DOWNLOAD_PATH=/downloads \
  -e CONFIG_PATH=/config \
  -e MUSIC_HOST_PATH=/www/wwwroot/lemon-music/music \
  -e DOWNLOADS_HOST_PATH=/www/wwwroot/lemon-music/downloads \
  -v /www/wwwroot/lemon-music/config:/config \
  -v /www/wwwroot/lemon-music/music:/music \
  -v /www/wwwroot/lemon-music/downloads:/downloads \
  ghcr.io/jia070310/lemon-muisc:latest
```

若上一步只用了加速镜像且未 `docker tag`，把最后一行改成 `ghcr.1ms.run/jia070310/lemon-muisc:latest`。

面板里手动创建时对照：

- 镜像：刚拉下来的 `ghcr.io/jia070310/lemon-muisc:latest`（或加速名）
- 端口：`7983` → `7983`
- 环境变量：`PORT=7983`、`DOWNLOAD_PATH=/downloads`、`CONFIG_PATH=/config`
- 目录挂载：上表三行

### 4. 访问与更新

浏览器：`http://服务器IP:7983`  
首次登录：`admin123` / `admin123`（立刻改密）

更新镜像（数据在三个挂载目录里，不会丢）：

```bash
docker pull ghcr.io/jia070310/lemon-muisc:latest
# 国内可改为：docker pull ghcr.1ms.run/jia070310/lemon-muisc:latest && docker tag …
docker rm -f lemon-music
# 再执行上面同一条 docker run
```

### 5. 可选：宝塔网站反代

若要用域名 / HTTPS：新建网站 → 反向代理到 `http://127.0.0.1:7983`，并开启 WebSocket 支持（路径 `/ws`）。证书用宝塔申请即可，容器保持 HTTP。

防火墙 / 安全组放行 `7983`（仅直连端口时需要）。

---

## HTTPS（可选）

容器不会自动拿飞牛系统证书。要用 HTTPS：把 `fullchain.pem`、`privkey.pem` 放到 `certs/`，再叠加：

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d
```

访问：`https://服务器IP或域名:7983`。证书续期后覆盖文件并 `docker compose restart`。

前面用 Caddy / Nginx 反代时，容器继续 HTTP `:7983` 即可，不必开应用内 TLS。

---

## 从源码构建（可选）

日常部署不需要。改代码后要本机构镜像：

```bash
git clone https://github.com/jia070310/lemon-muisc.git
cd lemon-muisc
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

---

## 重置密码 / 对照

```bash
docker compose exec lemon-music node scripts/reset-password.js --list
docker compose exec lemon-music node scripts/reset-password.js 用户名 新密码
```

`docker run` 部署则把 `docker compose exec lemon-music` 换成 `docker exec lemon-music`。

| 项目 | 飞牛 FPK | Docker / 宝塔 |
|------|----------|----------------|
| 安装 | 应用中心 | 拉镜像 + compose / run；宝塔用「命令拉取」ghcr |
| 证书 | 自动读飞牛证书 | 自行挂载，或前面反代（宝塔可网站反代） |
| 配置目录 | `/volX/@appdata/lemon-music/config` | 映射的 `/config`（宝塔示例见方式四） |

- 应用监听容器内 `7983`（HTTP 或 HTTPS）
- WebSocket：`/ws`（同一端口）
- OpenAPI：`http(s)://主机:7983/api/docs`
