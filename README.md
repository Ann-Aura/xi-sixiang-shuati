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
- AI 解析：在“AI 配置”中填写 OpenAI 兼容接口地址、key 和模型后，可以为当前题目生成解析
- AI 解析支持常见 Markdown 渲染，如标题、列表、加粗、引用和代码块
- 章节刷题支持上一题/下一题切换，返回上一题时会保留选择和判题结果

AI 配置和解析缓存只保存在浏览器本地，不会写入仓库。默认接口地址是 `https://gcli.ggchan.dev`。

## 重新导入题库

如果 PDF 后续更新，可以运行：

```powershell
& 'C:\Users\XiaoAn\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'C:\Users\XiaoAn\Desktop\codex工作区\学习\习思想刷题软件\tools\import_questions.py'
```

导入结果会写入 `data/questions.js`。无法自动识别的片段会写入 `data/import_issues.json`，方便后续校对。
