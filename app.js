const bank = window.QUESTION_BANK || { questions: [], chapters: [], total: 0 };
const questions = bank.questions || [];
const STORAGE_KEY = "xi-quiz-mistakes-v1";
const AI_CONFIG_KEY = "xi-quiz-ai-config-v1";
const AI_CACHE_KEY = "xi-quiz-ai-cache-v1";

const state = {
  view: "home",
  practice: null,
  exam: null,
  timer: null,
  aiStatus: {},
  configMessage: "",
};

const $ = (selector) => document.querySelector(selector);

function getMistakes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveMistakes(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  updateSidebarStats();
}

function addMistake(question) {
  const mistakes = getMistakes();
  const current = mistakes[question.id] || { wrongCount: 0, lastWrongAt: "" };
  mistakes[question.id] = {
    wrongCount: current.wrongCount + 1,
    lastWrongAt: new Date().toISOString(),
  };
  saveMistakes(mistakes);
}

function removeMistake(question) {
  const mistakes = getMistakes();
  delete mistakes[question.id];
  saveMistakes(mistakes);
}

function formatType(type) {
  return type === "single" ? "单选" : "多选";
}

function selectedAnswer(selected) {
  return [...selected].sort().join("");
}

function isCorrect(question, selected) {
  return selectedAnswer(selected) === question.answer;
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function chapterQuestions(chapterName) {
  if (!chapterName || chapterName === "全部章节") return questions;
  return questions.filter((question) => question.chapter === chapterName);
}

function questionById(id) {
  return questions.find((question) => question.id === id);
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function getAiConfig() {
  const saved = readJson(AI_CONFIG_KEY, {});
  const config = {
    apiBase: "https://gcli.ggchan.dev",
    apiKey: "",
    model: "",
    models: [],
    ...(saved && typeof saved === "object" ? saved : {}),
  };
  return {
    apiBase: typeof config.apiBase === "string" ? config.apiBase : "https://gcli.ggchan.dev",
    apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
    model: typeof config.model === "string" ? config.model : "",
    models: Array.isArray(config.models) ? config.models.filter((model) => typeof model === "string") : [],
  };
}

function saveAiConfig(config) {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
}

function getAiCache() {
  return readJson(AI_CACHE_KEY, {});
}

function saveAiCache(cache) {
  localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
}

function normalizeApiBase(value) {
  const trimmed = (value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function buildApiUrl(apiBase, path) {
  return `${normalizeApiBase(apiBase)}/v1/${path.replace(/^\/+/, "")}`;
}

function aiCacheKey(question, model) {
  return `${model}:${question.id}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function updateSidebarStats() {
  $("#statTotal").textContent = String(questions.length);
  $("#statMistakes").textContent = String(Object.keys(getMistakes()).length);
  $("#bankMeta").textContent = `${questions.length} 题 · ${bank.chapters.length} 个章节`;
}

function showView(name) {
  state.view = name;
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  const target = name === "chapter" ? "chapterView" : `${name}View`;
  const view = document.getElementById(target);
  if (view) view.classList.add("active-view");

  if (name === "home") renderHome();
  if (name === "chapter") renderChapterPicker();
  if (name === "exam") renderExamSetup();
  if (name === "mistakes") renderMistakes();
  if (name === "config") safeRenderConfig();
}

function renderHome() {
  const single = questions.filter((question) => question.type === "single").length;
  const multiple = questions.length - single;
  $("#homeView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>今天刷哪一块？</h2>
        <p>离线题库已经准备好：章节练习适合补短板，随机考试适合模拟检测。</p>
      </div>
    </div>
    <div class="grid mode-grid">
      <article class="card mode-card">
        <h3>章节刷题</h3>
        <p>按导论和各章选择题目，答完立即反馈，适合一章一章稳扎稳打。</p>
        <div class="chapter-meta">
          <span class="pill">${bank.chapters.length} 个章节</span>
          <span class="pill">${questions.length} 题</span>
        </div>
        <button class="button" data-action="go-chapter">开始章节刷题</button>
      </article>
      <article class="card mode-card">
        <h3>随机考试</h3>
        <p>从全题库随机抽题，计时交卷，最后统一看成绩和错题。</p>
        <div class="chapter-meta">
          <span class="pill">单选 ${single}</span>
          <span class="pill">多选 ${multiple}</span>
        </div>
        <button class="button" data-action="go-exam">进入考试</button>
      </article>
      <article class="card mode-card">
        <h3>错题本</h3>
        <p>错题会自动收进来，按章节回炉，答对后可以自动移出。</p>
        <div class="chapter-meta">
          <span class="pill">${Object.keys(getMistakes()).length} 道错题</span>
        </div>
        <button class="button" data-action="go-mistakes">查看错题</button>
      </article>
      <article class="card mode-card">
        <h3>AI 解析</h3>
        <p>配置接口和模型后，可以让 AI 解释当前题目和正确答案。</p>
        <div class="chapter-meta">
          <span class="pill">${getAiConfig().model || "未选择模型"}</span>
        </div>
        <button class="button" data-action="go-config">配置 AI</button>
      </article>
    </div>
  `;
}

function renderChapterPicker() {
  const allSingle = questions.filter((question) => question.type === "single").length;
  const allMultiple = questions.length - allSingle;
  const cards = [
    { name: "全部章节", count: questions.length, single: allSingle, multiple: allMultiple },
    ...bank.chapters,
  ];

  $("#chapterView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>章节刷题</h2>
        <p>选择一个章节，题目会按 PDF 顺序出现；做错会自动进入错题本。</p>
      </div>
    </div>
    <div class="grid chapter-grid">
      ${cards
        .map(
          (chapter) => `
        <article class="card chapter-card">
          <h3>${chapter.name}</h3>
          <p>${chapter.count} 道题</p>
          <div class="chapter-meta">
            <span class="pill">单选 ${chapter.single}</span>
            <span class="pill">多选 ${chapter.multiple}</span>
          </div>
          <button class="button" data-action="start-chapter" data-chapter="${chapter.name}">开始</button>
        </article>
      `
        )
        .join("")}
    </div>
  `;
}

function startPractice(title, sourceQuestions, options = {}) {
  state.practice = {
    title,
    questions: sourceQuestions,
    index: 0,
    selected: new Set(),
    checked: false,
    correct: 0,
    answered: 0,
    removeOnCorrect: Boolean(options.removeOnCorrect),
  };
  showPractice();
}

function showPractice() {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  $("#practiceView").classList.add("active-view");
  renderPractice();
}

function renderPractice() {
  const practice = state.practice;
  if (!practice || practice.questions.length === 0) {
    $("#practiceView").innerHTML = `<div class="empty">这里暂时没有题目。</div>`;
    return;
  }

  const question = practice.questions[practice.index];
  const progress = Math.round(((practice.index + 1) / practice.questions.length) * 100);
  $("#practiceView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>${practice.title}</h2>
        <p>第 ${practice.index + 1} / ${practice.questions.length} 题 · ${formatType(question.type)} · PDF 第 ${question.sourcePage} 页</p>
      </div>
      <button class="button secondary" data-action="back-chapter">返回选择</button>
    </div>
    <div class="panel question-shell">
      <div class="progress-bar"><span style="width:${progress}%"></span></div>
      ${renderQuestion(question, practice.selected, practice.checked)}
      <div id="practiceFeedback" class="feedback ${practice.checked ? "show" : ""} ${
        practice.checked && isCorrect(question, practice.selected) ? "ok" : "bad"
      }">
        ${practice.checked ? feedbackText(question, practice.selected) : ""}
      </div>
      <div class="answer-actions">
        <button class="button" data-action="check-practice" ${practice.checked ? "disabled" : ""}>提交本题</button>
        <button class="button secondary" data-action="ai-explain" data-question-id="${question.id}">AI 解析</button>
        <button class="button secondary" data-action="next-practice">${practice.index + 1 === practice.questions.length ? "完成" : "下一题"}</button>
      </div>
      ${renderAiPanel(question, practice.selected)}
    </div>
  `;
}

function renderQuestion(question, selected, checked = false) {
  const inputType = question.type === "single" ? "radio" : "checkbox";
  return `
    <div class="question-top">
      <span>${question.chapter}</span>
      <span>答案${question.type === "single" ? "选 1 项" : "可多选"}</span>
    </div>
    <h3 class="question-title">${question.stem}</h3>
    <div class="options">
      ${Object.entries(question.options)
        .map(([label, text]) => {
          const isSelected = selected.has(label);
          const isAnswer = question.answer.includes(label);
          const isWrong = checked && isSelected && !isAnswer;
          const classes = ["option"];
          if (isSelected) classes.push("selected");
          if (checked && isAnswer) classes.push("correct");
          if (isWrong) classes.push("wrong");
          return `
            <label class="${classes.join(" ")}">
              <input type="${inputType}" name="answer-${question.id}" value="${label}" ${isSelected ? "checked" : ""} ${checked ? "disabled" : ""}>
              <span><strong>${label}.</strong> ${text}</span>
            </label>
          `;
        })
        .join("")}
    </div>
  `;
}

function feedbackText(question, selected) {
  const chosen = selectedAnswer(selected) || "未作答";
  if (isCorrect(question, selected)) {
    return `答对了。你的答案：${chosen}`;
  }
  return `答错了。你的答案：${chosen}，正确答案：${question.answer}`;
}

function handlePracticeAnswer(input) {
  const practice = state.practice;
  if (!practice || practice.checked) return;
  const value = input.value;
  if (input.type === "radio") {
    practice.selected = new Set([value]);
  } else if (practice.selected.has(value)) {
    practice.selected.delete(value);
  } else {
    practice.selected.add(value);
  }
  renderPractice();
}

function checkPractice() {
  const practice = state.practice;
  if (!practice || practice.checked) return;
  const question = practice.questions[practice.index];
  practice.checked = true;
  practice.answered += 1;
  if (isCorrect(question, practice.selected)) {
    practice.correct += 1;
    if (practice.removeOnCorrect) removeMistake(question);
  } else {
    addMistake(question);
  }
  renderPractice();
}

function nextPractice() {
  const practice = state.practice;
  if (!practice) return;
  if (!practice.checked) {
    checkPractice();
    return;
  }
  if (practice.index + 1 >= practice.questions.length) {
    renderPracticeResult();
    return;
  }
  practice.index += 1;
  practice.selected = new Set();
  practice.checked = false;
  renderPractice();
}

function renderPracticeResult() {
  const practice = state.practice;
  const rate = practice.answered ? Math.round((practice.correct / practice.answered) * 100) : 0;
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  $("#resultView").classList.add("active-view");
  $("#resultView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>练习完成</h2>
        <p>${practice.title}</p>
      </div>
    </div>
    <div class="card result-card">
      <h3>${practice.correct} / ${practice.answered}</h3>
      <p>正确率 ${rate}%</p>
      <div class="answer-actions" style="margin-top:16px">
        <button class="button" data-action="go-chapter">继续章节刷题</button>
        <button class="button secondary" data-action="go-mistakes">查看错题本</button>
      </div>
    </div>
  `;
}

function renderExamSetup() {
  const max = questions.length;
  $("#examView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>随机考试</h2>
        <p>从全部选择题中随机抽题，交卷后统一判分。</p>
      </div>
    </div>
    <div class="panel">
      <div class="setup-grid">
        <div class="field">
          <label for="examCount">题目数量</label>
          <select id="examCount">
            <option value="10">10 题</option>
            <option value="20" selected>20 题</option>
            <option value="50">50 题</option>
            <option value="${max}">全部 ${max} 题</option>
          </select>
        </div>
        <div class="field">
          <label for="examMinutes">考试时间</label>
          <input id="examMinutes" type="number" min="1" max="180" value="20">
        </div>
        <div class="field">
          <label for="examChapter">范围</label>
          <select id="examChapter">
            <option value="全部章节">全部章节</option>
            ${bank.chapters.map((chapter) => `<option value="${chapter.name}">${chapter.name}</option>`).join("")}
          </select>
        </div>
      </div>
      <button class="button" data-action="start-exam">开始考试</button>
    </div>
  `;
}

function startExam() {
  const count = Number($("#examCount").value);
  const minutes = Number($("#examMinutes").value);
  const chapter = $("#examChapter").value;
  const pool = shuffle(chapterQuestions(chapter));
  const examQuestions = pool.slice(0, Math.min(count, pool.length));
  state.exam = {
    questions: examQuestions,
    index: 0,
    answers: {},
    endsAt: Date.now() + minutes * 60 * 1000,
    submitted: false,
  };
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(tickExam, 1000);
  renderExam();
}

function tickExam() {
  if (!state.exam) return;
  if (Date.now() >= state.exam.endsAt) {
    submitExam();
    return;
  }
  const timer = $("#examTimer");
  if (timer) timer.textContent = formatRemaining(state.exam.endsAt - Date.now());
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function renderExam() {
  const exam = state.exam;
  if (!exam || exam.questions.length === 0) {
    $("#examView").innerHTML = `<div class="empty">没有可用于考试的题目。</div>`;
    return;
  }
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  $("#examView").classList.add("active-view");
  const question = exam.questions[exam.index];
  const selected = new Set(exam.answers[question.id] || []);
  const answeredCount = Object.keys(exam.answers).filter((id) => exam.answers[id].length).length;
  $("#examView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>随机考试</h2>
        <p>已答 ${answeredCount} / ${exam.questions.length}</p>
      </div>
      <strong id="examTimer">${formatRemaining(exam.endsAt - Date.now())}</strong>
    </div>
    <div class="exam-layout">
      <div class="panel question-shell">
        ${renderQuestion(question, selected, false)}
        <div class="exam-actions">
          <button class="button secondary" data-action="prev-exam" ${exam.index === 0 ? "disabled" : ""}>上一题</button>
          <button class="button secondary" data-action="next-exam" ${exam.index + 1 === exam.questions.length ? "disabled" : ""}>下一题</button>
          <button class="button secondary" data-action="ai-explain" data-question-id="${question.id}">AI 解析</button>
          <button class="button" data-action="submit-exam">交卷</button>
        </div>
        ${renderAiPanel(question, selected)}
      </div>
      <aside class="panel">
        <h3>答题卡</h3>
        <div class="answer-sheet">
          ${exam.questions
            .map(
              (item, index) => `
            <button class="sheet-button ${exam.answers[item.id]?.length ? "answered" : ""} ${
                index === exam.index ? "current" : ""
              }" data-action="jump-exam" data-index="${index}">${index + 1}</button>
          `
            )
            .join("")}
        </div>
      </aside>
    </div>
  `;
}

function handleExamAnswer(input) {
  const exam = state.exam;
  if (!exam) return;
  const question = exam.questions[exam.index];
  const current = new Set(exam.answers[question.id] || []);
  if (input.type === "radio") {
    exam.answers[question.id] = [input.value];
  } else {
    if (current.has(input.value)) current.delete(input.value);
    else current.add(input.value);
    exam.answers[question.id] = [...current].sort();
  }
  renderExam();
}

function submitExam() {
  const exam = state.exam;
  if (!exam || exam.submitted) return;
  exam.submitted = true;
  if (state.timer) clearInterval(state.timer);

  let correct = 0;
  const rows = exam.questions.map((question, index) => {
    const selected = new Set(exam.answers[question.id] || []);
    const ok = isCorrect(question, selected);
    if (ok) correct += 1;
    else addMistake(question);
    return { question, index, selected: selectedAnswer(selected) || "未作答", ok };
  });

  const rate = Math.round((correct / exam.questions.length) * 100);
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  $("#resultView").classList.add("active-view");
  $("#resultView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>考试结果</h2>
        <p>得分 ${correct} / ${exam.questions.length}，正确率 ${rate}%</p>
      </div>
      <button class="button" data-action="go-exam">再考一次</button>
    </div>
    <div class="result-list">
      ${rows
        .filter((row) => !row.ok)
        .map(
          (row) => `
        <div class="result-row">
          <div>
            <strong>第 ${row.index + 1} 题 · ${formatType(row.question.type)}</strong>
            <p class="muted">${row.question.stem}</p>
            <p>你的答案：${row.selected} · 正确答案：${row.question.answer}</p>
          </div>
          <span class="pill">${row.question.chapter}</span>
        </div>
      `
        )
        .join("") || `<div class="empty">这次没有错题。</div>`}
    </div>
  `;
}

function renderMistakes() {
  const mistakes = getMistakes();
  const mistakeQuestions = Object.keys(mistakes).map(questionById).filter(Boolean);
  const chapterNames = ["全部章节", ...bank.chapters.map((chapter) => chapter.name)];
  $("#mistakesView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>错题本</h2>
        <p>共 ${mistakeQuestions.length} 道错题，答对后会自动移出。</p>
      </div>
      <button class="button secondary" data-action="clear-mistakes" ${mistakeQuestions.length ? "" : "disabled"}>清空错题</button>
    </div>
    ${
      mistakeQuestions.length
        ? `
      <div class="toolbar" style="margin-bottom:14px">
        <div class="field">
          <label for="mistakeChapter">章节筛选</label>
          <select id="mistakeChapter">
            ${chapterNames.map((name) => `<option value="${name}">${name}</option>`).join("")}
          </select>
        </div>
        <button class="button" data-action="start-mistakes">重做错题</button>
      </div>
      <div class="result-list">
        ${mistakeQuestions
          .map(
            (question) => `
          <div class="result-row">
            <div>
              <strong>${formatType(question.type)} · 错 ${mistakes[question.id].wrongCount} 次</strong>
              <p class="muted">${question.stem}</p>
            </div>
            <span class="pill">${question.chapter}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `
        : `<div class="empty">暂时没有错题。做题时答错会自动收进这里。</div>`
    }
  `;
}

function startMistakePractice() {
  const chapter = $("#mistakeChapter")?.value || "全部章节";
  const ids = Object.keys(getMistakes());
  let pool = ids.map(questionById).filter(Boolean);
  if (chapter !== "全部章节") pool = pool.filter((question) => question.chapter === chapter);
  startPractice(`错题重练 · ${chapter}`, pool, { removeOnCorrect: true });
}

function renderConfig() {
  const config = getAiConfig();
  const cacheCount = Object.keys(getAiCache()).length;
  $("#configView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>AI 配置</h2>
        <p>API key 只保存在当前浏览器本地，不会写进题库文件或 GitHub 仓库。</p>
      </div>
    </div>
    <div class="panel config-panel">
      <div class="setup-grid">
        <div class="field">
          <label for="aiApiBase">API 地址</label>
          <input id="aiApiBase" type="url" value="${escapeHtml(config.apiBase || "https://gcli.ggchan.dev")}" placeholder="https://gcli.ggchan.dev">
        </div>
        <div class="field">
          <label for="aiApiKey">API key</label>
          <input id="aiApiKey" type="password" value="${escapeHtml(config.apiKey || "")}" placeholder="sk-...">
        </div>
        <div class="field">
          <label for="aiModel">模型</label>
          <select id="aiModel">
            <option value="">先拉取模型</option>
            ${(config.models || [])
              .map((model) => `<option value="${escapeHtml(model)}" ${model === config.model ? "selected" : ""}>${escapeHtml(model)}</option>`)
              .join("")}
          </select>
        </div>
      </div>
      <div class="answer-actions">
        <button class="button" data-action="fetch-models">拉取模型</button>
        <button class="button secondary" data-action="save-ai-config">保存配置</button>
        <button class="button secondary" data-action="clear-ai-cache">清除解析缓存（${cacheCount}）</button>
        <button class="button ghost" data-action="clear-ai-config">清除配置</button>
      </div>
      <div class="notice ${state.configMessage ? "show" : ""}" id="configMessage">${escapeHtml(state.configMessage)}</div>
    </div>
  `;
}

function safeRenderConfig() {
  try {
    renderConfig();
  } catch (error) {
    console.error(error);
    $("#configView").innerHTML = `
      <div class="page-head">
        <div>
          <h2>AI 配置</h2>
          <p>配置页加载时遇到本地缓存异常，已提供恢复操作。</p>
        </div>
      </div>
      <div class="panel config-panel">
        <div class="notice show">配置缓存格式异常：${escapeHtml(error?.message || String(error))}</div>
        <button class="button" data-action="reset-ai-config-hard">重置 AI 配置</button>
      </div>
    `;
  }
}

function readConfigForm() {
  const current = getAiConfig();
  return {
    apiBase: normalizeApiBase($("#aiApiBase")?.value || current.apiBase),
    apiKey: $("#aiApiKey")?.value || "",
    model: $("#aiModel")?.value || current.model || "",
    models: current.models || [],
  };
}

async function fetchModels() {
  const config = readConfigForm();
  state.configMessage = "";
  if (!config.apiBase || !config.apiKey) {
    state.configMessage = "请先填写 API 地址和 key。";
    safeRenderConfig();
    return;
  }

  state.configMessage = "正在拉取模型...";
  saveAiConfig(config);
  safeRenderConfig();
  try {
    const response = await fetch(buildApiUrl(config.apiBase, "models"), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!response.ok) throw new Error(`模型拉取失败：HTTP ${response.status}`);
    const payload = await response.json();
    const models = (payload.data || []).map((item) => item.id).filter(Boolean);
    if (!models.length) throw new Error("没有在返回结果中找到模型 id。");
    const next = {
      ...config,
      models,
      model: models.includes(config.model) ? config.model : models[0],
    };
    saveAiConfig(next);
    state.configMessage = `已拉取 ${models.length} 个模型，并保存配置。`;
  } catch (error) {
    state.configMessage = explainNetworkError(error);
  }
  safeRenderConfig();
}

function saveConfigFromForm() {
  const config = readConfigForm();
  saveAiConfig(config);
  state.configMessage = "配置已保存。";
  safeRenderConfig();
}

function renderAiPanel(question, selected) {
  const config = getAiConfig();
  const cache = getAiCache();
  const status = state.aiStatus[question.id] || {};
  const cached = config.model ? cache[aiCacheKey(question, config.model)] : "";
  const content = status.content || cached || "";
  const chosen = selectedAnswer(selected) || "未作答";
  const body = status.loading
    ? "正在请求 AI 解析..."
    : status.error
      ? status.error
      : content || "点击“AI 解析”，把当前题目、选项、正确答案和你的选择发给 AI。";
  const classes = ["ai-panel"];
  if (status.error) classes.push("error");
  if (content && !status.error) classes.push("ready");

  return `
    <section class="${classes.join(" ")}">
      <div class="ai-panel-head">
        <strong>AI 解析</strong>
        <span>你的答案：${chosen}</span>
      </div>
      <div class="ai-content">${formatAiContent(body)}</div>
    </section>
  `;
}

function formatAiContent(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function buildPrompt(question, selected) {
  const options = Object.entries(question.options)
    .map(([label, text]) => `${label}. ${text}`)
    .join("\n");
  const userAnswer = selectedAnswer(selected) || "未作答";
  return `题型：${formatType(question.type)}
章节：${question.chapter}
题目：${question.stem}
选项：
${options}
正确答案：${question.answer}
用户答案：${userAnswer}

请先说明正确答案；再逐项解释为什么选或不选；最后给出一个适合考前复习的记忆提示。`;
}

function explainNetworkError(error) {
  const message = error?.message || String(error);
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "请求失败：浏览器可能被 CORS 拦截，或 API 地址不可访问。若是 CORS，需要增加后端代理。";
  }
  return message;
}

function renderActiveQuestion() {
  if ($("#practiceView").classList.contains("active-view")) renderPractice();
  if ($("#examView").classList.contains("active-view")) renderExam();
}

async function explainQuestion(questionId) {
  const question = questionById(questionId);
  if (!question) return;

  const config = getAiConfig();
  const selected =
    state.exam && $("#examView").classList.contains("active-view")
      ? new Set(state.exam.answers[question.id] || [])
      : state.practice?.questions[state.practice.index]?.id === question.id
        ? state.practice.selected
        : new Set();

  if (!config.apiBase || !config.apiKey || !config.model) {
    state.aiStatus[question.id] = { error: "请先到“AI 配置”填写 API 地址、key，并选择模型。" };
    renderActiveQuestion();
    return;
  }

  const cache = getAiCache();
  const cacheKey = aiCacheKey(question, config.model);
  if (cache[cacheKey]) {
    state.aiStatus[question.id] = { content: cache[cacheKey] };
    renderActiveQuestion();
    return;
  }

  state.aiStatus[question.id] = { loading: true };
  renderActiveQuestion();
  try {
    const response = await fetch(buildApiUrl(config.apiBase, "chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "你是严谨的大学政治理论课助教。请基于题干和给定答案解析，不要改判题库答案；若需要提醒不确定性，请简短说明。",
          },
          { role: "user", content: buildPrompt(question, selected) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI 解析失败：HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("AI 返回为空。");
    cache[cacheKey] = content;
    saveAiCache(cache);
    state.aiStatus[question.id] = { content };
  } catch (error) {
    state.aiStatus[question.id] = { error: explainNetworkError(error) };
  }
  renderActiveQuestion();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "go-chapter") showView("chapter");
  if (action === "go-exam") showView("exam");
  if (action === "go-mistakes") showView("mistakes");
  if (action === "go-config") showView("config");
  if (action === "start-chapter") {
    const chapter = target.dataset.chapter;
    startPractice(`章节刷题 · ${chapter}`, chapterQuestions(chapter));
  }
  if (action === "back-chapter") showView("chapter");
  if (action === "check-practice") checkPractice();
  if (action === "next-practice") nextPractice();
  if (action === "start-exam") startExam();
  if (action === "prev-exam" && state.exam) {
    state.exam.index -= 1;
    renderExam();
  }
  if (action === "next-exam" && state.exam) {
    state.exam.index += 1;
    renderExam();
  }
  if (action === "jump-exam" && state.exam) {
    state.exam.index = Number(target.dataset.index);
    renderExam();
  }
  if (action === "submit-exam") submitExam();
  if (action === "start-mistakes") startMistakePractice();
  if (action === "ai-explain") explainQuestion(target.dataset.questionId);
  if (action === "fetch-models") fetchModels();
  if (action === "save-ai-config") saveConfigFromForm();
  if (action === "clear-ai-cache") {
    saveAiCache({});
    state.configMessage = "解析缓存已清除。";
    safeRenderConfig();
  }
  if (action === "clear-ai-config") {
    localStorage.removeItem(AI_CONFIG_KEY);
    state.configMessage = "AI 配置已清除。";
    safeRenderConfig();
  }
  if (action === "reset-ai-config-hard") {
    localStorage.removeItem(AI_CONFIG_KEY);
    localStorage.removeItem(AI_CACHE_KEY);
    state.configMessage = "AI 配置和解析缓存已重置。";
    safeRenderConfig();
  }
  if (action === "clear-mistakes") {
    saveMistakes({});
    renderMistakes();
  }
});

document.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.name?.startsWith("answer-")) {
    if (state.exam && $("#examView").classList.contains("active-view")) handleExamAnswer(input);
    else handlePracticeAnswer(input);
  }
});

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

updateSidebarStats();
renderHome();
