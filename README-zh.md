# Tacit — 语义连接

> 📖 [English README](./README.md)

> "我们所知道的，远超过我们所能言说的。" — 迈克尔·波兰尼

Tacit 是一个 Obsidian 插件，用来浮现你笔记库中那些**你自己也不知道存在的连接**。手动 `[[wikilinks]]` 只能记录你意识到的关系；而那些潜藏在边缘、半遗忘的关联，才是一个写了多年的笔记库里最有价值的部分。

Tacit 的设计哲学源自波兰尼的"隐性知识"理论：

- **被动浮现，而非主动查询**。相关笔记面板在你写作时安静地显示在侧边，连接从视觉边缘浮出，无需你先提出问题。
- **拥抱遗忘与偶然**。Serendipity 模式会刻意把那些你几乎忘掉的旧笔记带回来——这些恰恰是最有价值的隐性连接。
- **拖入即链接**。把结果拖进当前笔记，自动插入 `[[链接]]`，把隐性连接变为显性记录。

---

## 功能

- **相关笔记面板**（核心）：打开任意笔记，右侧自动显示语义最相关的笔记列表，无需任何操作
- **Serendipity（偶然性模式）**：降低相似性权重、提升旧笔记优先级，让遗忘的连接重新浮出
- **固定面板**：Pin 当前结果，在多个笔记间游走时保持参照不变
- **主动查找**：命令面板呼出搜索框，自然语言语义检索
- **重排序**（可选）：向量检索后调用专用 Reranker 对结果二次精排，显著提升相关性；支持 Jina Reranker 和 Cohere Rerank
- **AI 问答**：基于你自己的笔记内容回答问题，所有来源均来自你的库，不引入外部信息
- **Canvas 支持**：索引 `.canvas` 文件中的文字卡片，不遗漏任何内容
- **本地优先**：默认使用本机 Ollama，数据不离开你的设备；也支持 OpenAI、OpenRouter、Gemini、任意 OpenAI 兼容接口

---

## 安装

目前尚未上架 Obsidian 社区插件市场，请手动安装：

1. 前往 [Releases](https://github.com/nirodu/tacit/releases) 下载最新版本的 `main.js`、`manifest.json`、`styles.css`
2. 在你的 Vault 下创建目录：`.obsidian/plugins/tacit/`
3. 将三个文件放入该目录
4. 在 Obsidian → 设置 → 第三方插件中启用 **Tacit — Semantic Connections**

---

## 向量嵌入 Provider 配置

插件需要一个嵌入模型（Embedding Model）将笔记转换为向量。支持以下 Provider：

### Ollama（本地）

最简单的方式：数据完全留在本机，无需 API Key。

1. 安装 [Ollama](https://ollama.ai)
2. 拉取一个嵌入模型，推荐中英文均衡的 `bge-m3`：
   ```
   ollama pull bge-m3:latest
   ```
3. 插件设置中选择 Provider → Ollama，从下拉菜单选择模型，点击"测试连接"

> 笔记主要为中文时，推荐 `bge-m3:latest` 或 `shaw/dmeta-embedding-zh`。

### OpenAI

设置中填入 API Key，选择模型（如 `text-embedding-3-small`）。

### OpenRouter

填入 OpenRouter API Key，选择支持嵌入的模型。

### Gemini

填入 Google API Key，选择 `text-embedding-004` 等模型。

### 通用 OpenAI 兼容接口

填入 Base URL 和可选的 API Key，适用于 DeepSeek、硅基流动、通义千问等任意兼容 OpenAI 格式的嵌入接口。

---

## 重排序配置（可选）

重排序（Reranking）是向量检索的可选增强层：先用嵌入向量快速召回候选笔记，再调用专用 Reranker 模型对候选集做精确打分并重新排列，可显著提升最终结果的相关性。启用后每次查询会多一次 API 调用。

在插件设置 → **重排序（可选）** 中开启，并选择服务商：

### Jina Reranker

1. 前往 [jina.ai](https://jina.ai) 注册并获取 API Key
2. 插件设置中选择服务 → **Jina Reranker**，填入 API Key
3. 模型推荐：`jina-reranker-v2-base-multilingual`（中英双语效果佳）

### Cohere Rerank

1. 前往 [cohere.com](https://cohere.com) 注册并获取 API Key
2. 插件设置中选择服务 → **Cohere Rerank**，填入 API Key
3. 模型推荐：`rerank-v3.5`

> 重排序仅对相关笔记面板和主动查找的结果生效，不影响嵌入向量的生成与存储。

---

## AI 问答配置

AI 问答是可选功能，需要额外配置一个聊天模型（与嵌入 Provider 可以不同）。

支持：Ollama（本地聊天模型）、OpenAI、OpenRouter、Gemini、通用兼容接口。

> AI 问答只使用向量检索到的笔记片段作为上下文，不引入任何笔记以外的信息。所有来源笔记均显示在回答下方。

---

## 隐私说明

- 所有 API Key 以明文存储在 Obsidian 插件数据文件中（`.obsidian/plugins/tacit/data.json`），请勿将此文件同步到公开仓库
- 使用云端 Provider 时，笔记文本片段会发送至对应服务商的 API；使用 Ollama 时，数据完全留在本机
- 向量索引文件（`index.bin`、`index.meta.json`、`build-state.json`）默认保存在插件目录，**不会**随 Vault 同步

---

## 开发

```bash
git clone https://github.com/nirodu/tacit
cd tacit
npm install

# 开发模式（热重载）
npm run dev

# 生产构建
npm run build
```

将插件目录软链接或复制到 `<你的Vault>/.obsidian/plugins/tacit/`，配合 Obsidian 社区插件 [Hot-Reload](https://github.com/pjeby/hot-reload) 可实现保存即刷新。

构建产物输出至 `dist/`。

---

## 协议

本项目采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 协议：

- **署名**：使用或修改本项目，必须注明原作者（nirodu）及来源仓库
- **非商业**：不可用于商业目的
- **相同方式共享**：基于本项目的衍生作品必须使用相同协议发布

Copyright (c) 2024 nirodu &lt;nirodu1219@outlook.com&gt;
