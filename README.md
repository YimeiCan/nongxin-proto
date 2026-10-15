# 农信 · 可点击演示原型

三端：**农户 / 商家 / 后台**。地块手绘认领、虫情上报、农资下单。

## 公网打开（给 Fay）

https://cdn.jsdelivr.net/gh/YimeiCan/nongxin-proto@9dbab5ac3d312554a65814c2aceb478a1b1c1e9f/index.html

备用：https://raw.githack.com/YimeiCan/nongxin-proto/main/index.html

本页为 **浏览器 localStorage mock**（无需后端；数据存在本机浏览器）。

### 演示账号

| 账号 | 密码 | 角色 |
|------|------|------|
| farmer1 | 123456 | 农户 |
| farmer2 | 123456 | 农户（已有地块） |
| merchant1 | 123456 | 商家 |
| admin | 123456 | 后台 |

### 建议路径

farmer1 认领田块 → admin 审核通过 → farmer1 上报虫情并下单 → merchant1 看订单。

## 本地完整版（SQLite API）

在开发机：`/workspace/nongxin-proto`，`./start.sh` → http://127.0.0.1:8788/ ，`./stop.sh` 停止。
