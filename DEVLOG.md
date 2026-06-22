# 习思想刷题 · 开发日志

## 项目简介

习近平思想课程的本地刷题网页，支持章节刷题、随机考试、错题本。  
纯前端离线运行，题库从 PDF 用脚本导入，数据存在浏览器 localStorage。

## 技术栈

- **前端**：原生 HTML + CSS + JavaScript（无框架）
- **题库**：`data/questions.js`（全局变量，由 Python 脚本从 PDF 提取）
- **存储**：`localStorage`（学习进度、错题等）
- **Python 脚本**：`tools/import_questions.py`（从 PDF 提取题目）
- **部署**：GitHub Pages

## 文件结构

```
习思想刷题软件/
├── index.html          ← 主页面
├── styles.css          ← 样式
├── app.js              ← 全部 JavaScript 逻辑
├── README.md           ← 使用说明
├── DEVLOG.md           ← 本文件
├── data/
│   ├── questions.js    ← 题库数据（JS 全局变量格式）
│   └── import_issues.json  ← 导入时未能自动识别的题目
├── tools/
│   ├── import_questions.py        ← 从 PDF 提取题库的脚本
│   └── __pycache__/               ← Python 缓存（不用管）
└── .git/
```

## GitHub 相关信息

- **仓库地址**：https://github.com/Ann-Aura/xi-sixiang-shuati
- **Pages 地址**：https://ann-aura.github.io/xi-sixiang-shuati/
- **Pages 设置**：从 `main` 分支的根目录部署
- **推送方式**：`git push` 即可自动更新 Pages（等几分钟生效）

## 本地 Git 提交方法

每次改完代码后，在终端执行：

```bash
cd "C:/Users/XiaoAn/Desktop/codex工作区/学习/习思想刷题软件"
git add -A
git commit -m "类型: 改了啥"
git push
```

或者直接跟 Claude 说"提交一下"，会帮你自动完成。

## 数据模型（localStorage）

键名 `sixiang_data`，JSON 结构：

```json
{
  "progress": {
    "题目ID": {
      "answered": true,         // 是否答过
      "correct": true,          // 上次答对没
      "wrongCount": 1,          // 累计错误次数
      "selected": [0, 2],       // 选择的选项索引（单选是单元素）
      "history": [...]          // 答题历史
    }
  },
  "mistakes": [1, 5, 23],       // 错题 ID 列表
  "stats": {
    "total": 50,                // 总答题数
    "correct": 35               // 答对数
  },
  "lastStudyDate": "2026-06-22" // 上次学习日期
}
```

## 最近修改记录

### 2026-06-22 · 部署到 GitHub

1. **Git 初始化** — 本地文件夹初始化为 git 仓库
2. **创建 GitHub 仓库** — 公开仓库 `Ann-Aura/xi-sixiang-shuati`
3. **推送代码** — 本地所有文件提交并推送到远程 main 分支
4. **开启 GitHub Pages** — 设置从 main 分支根目录部署
5. **Pages 地址** — https://ann-aura.github.io/xi-sixiang-shuati/

### 注意事项

1. **Git 安全目录** — 该文件夹的 owner 是 `CodexSandboxOffline`，已通过 `git config --global --add safe.directory` 添加例外
2. **凭证** — Git 凭证存储在 `~/.git-credentials`，首次推送后已将 URL 中的 token 移除，后续 push 使用缓存的凭证
3. **题库更新** — PDF 更新后运行 `tools/import_questions.py` 重新导入，然后提交 `data/questions.js` 的改动
4. **多端同步** — 当前使用 `localStorage`，换设备无法同步进度。如需多端同步，后续可接入 LeanCloud 等后端服务
