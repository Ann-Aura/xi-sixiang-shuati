# 习思想刷题软件

这是一个本地离线刷题网页，题库来自：

`C:\Users\XiaoAn\Desktop\obsidian\课内笔记类\习思想\习思想知识点及练习题.pdf`

## 打开方式

直接双击 `index.html`，或用浏览器打开这个文件：

`C:\Users\XiaoAn\Desktop\codex工作区\学习\习思想刷题软件\index.html`

## 已支持

- 章节刷题
- 随机考试
- 错题本
- 单选题和多选题自动判分
- 错题本保存在浏览器本地，不需要联网

## 重新导入题库

如果 PDF 后续更新，可以运行：

```powershell
& 'C:\Users\XiaoAn\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'C:\Users\XiaoAn\Desktop\codex工作区\学习\习思想刷题软件\tools\import_questions.py'
```

导入结果会写入 `data/questions.js`。无法自动识别的片段会写入 `data/import_issues.json`，方便后续校对。
