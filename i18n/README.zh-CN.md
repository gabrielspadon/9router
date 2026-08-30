# 9Router

> 中文摘要已移至仓库根目录的 [README.zh-CN.md](../README.zh-CN.md)，本页仅作
> 指路，不再单独维护，以免两份中文说明各自漂移。
>
> 权威文档为英文版 [README.md](../README.md) 与
> [docs/README.md](../docs/README.md)。

9Router 是一个运行在本地的 AI 路由网关，并自带控制面板。它只对外暴露一个兼容
OpenAI 的接口 `/v1/*`，把每个请求翻译成所选上游要求的格式，并在多个模型与多个
账号之间自动切换。

## 安装

```bash
npm install -g 9router
9router
```

控制面板位于 `http://localhost:20128/dashboard`，兼容 OpenAI 的接口位于
`http://localhost:20128/v1`。首次登录使用 `INITIAL_PASSWORD`，默认值为
`123456`，请务必修改。

## 分支状态

本仓库是 [decolua/9router](https://github.com/decolua/9router) 的一个独立维护
的分支（fork）。它跟随上游，同时按照自己的节奏携带本地修复与集成。9Router 这一
名称、上游的提交历史、许可证以及作者署名均予以保留。上游仅作为只读参考，所有
开发都在本仓库进行；本分支未获得上游项目背书，也不代表上游项目发言。

## 继续阅读

- [README.zh-CN.md](../README.zh-CN.md)，完整的中文摘要。
- [README.md](../README.md)，英文首页。
- [docs/README.md](../docs/README.md)，文档索引。
