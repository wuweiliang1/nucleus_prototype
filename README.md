# Nucleus — AI-Native Multi-Agent App Studio

> 从一句话想法到可运行、带真实 PostgreSQL 云端数据库的在线全栈应用。

- **在线体验**：`https://nucleus.soleusforce.cn`（支持一键访客免注册体验 & 邮箱注册登录）

---

## 核心能力与亮点

1. **Multi-Agent 虚拟研发团队协作（Shared Context + SSE 实时流）**
   - **Mike（Team Lead）**：意图识别与动态路由（区分从零新建、增量迭代、可视化局部修改、运行时错误修复）。
   - **Emma（Product Manager）**：输出结构化 PRD 文档，持久化到项目共享上下文。
   - **Bob（System Architect）**：设计系统架构与 Nucleus Cloud 数据模型 Schema。
   - **Alex（Full-Stack Engineer）**：基于共享上下文生成/增量更新多文件 Web 应用，支持 `@Emma` / `@Bob` / `@Alex` 定向协作。
2. **Race Mode（双方案并行赛马 PK）**
   - 一键开启后并行调度两条独立赛道（不同模型/审美方向）同时构建完整可交互应用，右侧左右分屏实时体验，点击「采纳此方案」即可合入主分支并生成版本快照。
3. **Visual Select-to-Edit（可视化点选修改）+ Runtime Auto-Fix（自愈闭环）**
   - 预览区开启「点选编辑」后，悬停高亮任意 DOM 元素并点击，自动提取 CSS Selector 与 HTML 片段发给 Alex 精准定向修改。
   - 沙箱自动捕获生成应用的运行时异常与未处理 Promise 拒绝，弹出「一键让 Alex 修复」横幅，将错误堆栈回传修复。
4. **Nucleus Cloud（内置应用级 PostgreSQL 持久化 + 一键发布）**
   - 自动向每个生成的应用注入 `window.NucleusDB` SDK（底层对接 PostgreSQL `app_data` 集合隔离 API）。生成出的看板、记账本、投票墙等应用本身即具备真实云端持久化。
   - 内置 **Nucleus Cloud DB Explorer** 实时查看生成应用写入数据库的数据行。
   - 一键发布至公开独立 URL `/p/<slug>`，支持社区 Showcase 展示与一键 **Remix**。
5. **工程工作流完备性**
   - 多文件源码浏览器与在线编辑保存、每次变更自动版本快照与一键回滚、一键导出完整项目 ZIP。

---

## 系统架构

```
Web Studio (React 19 + Vite + Tailwind)
   │  REST + SSE Streaming (/api/projects/:id/chat)
   ▼
Nucleus Server (Node 22 + TypeScript + Express)
   ├── Multi-Agent Orchestrator (Mike -> Emma -> Bob -> Alex / Race Mode)
   │      └── OpenAI-Compatible LLM Gateway
   ├── Runtime Bundler (/p/:slug & Preview Sandbox)
   │      └── Injects window.NucleusDB + Select-to-Edit Inspector + Error Catcher
   └── Cloud DB REST API (/api/runtime/:projectId/collections/:name)
          ▼
PostgreSQL (users, projects, messages, project_versions, app_data, race_sessions)
```

---

## 本地快速启动

```bash
# 1. 安装依赖
npm run install:all

# 2. 配置环境变量（复制 .env.example 到 server/.env 并填入 DATABASE_URL 与 LLM_API_KEY）
cp .env.example server/.env

# 3. 构建并启动
npm run build
npm run start
# 访问 http://localhost:8080
```
