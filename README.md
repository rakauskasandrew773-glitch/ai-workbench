# AI工作台 V1.0（动态版）

本项目用于直接部署到 Tencent EdgeOne Makers / Pages。

## 功能
- AI工作台首页
- AI教研助手独立页面
- `/api/chat` Serverless API
- DeepSeek API Key 保存在服务端环境变量中，不暴露在前端
- 响应式页面，可电脑和手机访问

## 项目结构

```text
.
├── index.html
├── assistant.html
├── edge-functions/
│   └── api/
│       └── chat.js
├── .gitignore
└── README.md
```

## 必须配置的环境变量

在 EdgeOne Makers 项目中添加：

```text
DEEPSEEK_API_KEY=你的 DeepSeek API Key
```

不要把 API Key 写进代码，也不要提交到 GitHub。

## 本地说明

直接双击 `index.html` 可以预览工作台 UI，但真实 AI 调用依赖 EdgeOne 的 `/api/chat` Serverless Function，所以完整功能需要部署后测试。

## 部署

推荐：
1. GitHub 新建仓库 `ai-workbench`
2. 把本项目全部文件上传到仓库根目录
3. EdgeOne Makers 新建项目
4. 从 GitHub 导入仓库
5. 配置环境变量 `DEEPSEEK_API_KEY`
6. 部署
7. 打开 EdgeOne 提供的访问地址测试
