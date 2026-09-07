# AI 教研助手 P0 客户调研修复包

本包用于解决客户公开资料调研超时、失败时暴露技术错误、以及未核验师资简介进入正式课表的问题。

## 一、上传代码（GitHub 网页）

1. 打开仓库：`https://github.com/rakauskasandrew773-glitch/ai-workbench`。
2. 点击 **Add file** → **Upload files**。
3. 将本压缩包内除本说明外的文件和文件夹全部拖入上传区；保持目录层级不变。
4. 如 GitHub 询问是否替换已有的 `assistant.html`、`README.md`、`edge-functions/api/chat.js`，选择替换。
5. 提交说明填入：`fix: make customer research resilient and traceable`，点击 **Commit changes**。

本包中必须保留的目录层级：

```text
assistant.html
README.md
edge-functions/api/chat.js
edge-functions/lib/research/service.js
edge-functions/lib/research/providers/bocha.js
tests/*.test.mjs
```

`tests/` 仅供开发回归检查，不影响 EdgeOne 部署。

## 二、配置备用搜索（建议）

1. 在博查开放平台创建 API Key：`https://open.bochaai.com/`。
2. 打开 EdgeOne 项目的环境变量配置。
3. 新增变量名 `BOCHA_API_KEY`，粘贴该密钥并保存。
4. 不要把 API Key 发到聊天、GitHub 或代码文件中。

未配置该变量时，主链路仍会尝试 DeepSeek 调研；失败时会安全提示并继续生成课程方案，但不会启用备用检索。

## 三、部署后验证

1. 等待 EdgeOne 因 GitHub 提交完成自动部署。
2. 新建项目，填写客户名称“上海财经大学”。
3. 输入明确的培训对象、主题和天数并发送。
4. 预期：客户调研最长约 35 秒；失败时显示友好提示而非技术错误，课程方案仍继续生成。
5. 检查正式课表：未标为 `verified` 的师资简介必须为空。

## 四、回退

如需回退，在 GitHub 的提交历史中找到本次提交前一个版本，使用 **Revert** 生成回退提交即可。
