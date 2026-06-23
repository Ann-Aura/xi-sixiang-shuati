const bank = window.QUESTION_BANK || { questions: [], chapters: [], total: 0 };
const questions = bank.questions || [];
const STORAGE_KEY = "xi-quiz-mistakes-v1";
const AI_CONFIG_KEY = "xi-quiz-ai-config-v1";
const AI_CACHE_KEY = "xi-quiz-ai-cache-v1";
const BACKUP_CONFIG_KEY = "xi-quiz-backup-config-v1";
const BACKUP_FILENAME = "xi-quiz-backup.json";
const PROGRESS_KEY = "xi-quiz-progress-v1";
const FAVORITES_KEY = "xi-quiz-favorites-v1";
const BRIEF_REVIEW_KEY = "xi-quiz-brief-reviews-v1";
const EXAM_EXCLUDED_CHAPTERS = new Set([
  "第十三章 维护和塑造国家安全",
  "第十四章 建设巩固国防和强大人民军队",
]);

const state = {
  view: "home",
  practice: null,
  exam: null,
  timer: null,
  aiStatus: {},
  aiExpanded: {},
  briefRevealed: {},
  reviewFilter: "all",
  configMessage: "",
  backupMessage: "",
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

function getFavorites() {
  const saved = readJson(FAVORITES_KEY, {});
  if (!saved || typeof saved !== "object") return {};
  return Object.fromEntries(Object.entries(saved).filter(([id]) => questionById(id)));
}

function saveFavorites(value) {
  const valid = Object.fromEntries(Object.entries(value || {}).filter(([id]) => questionById(id)));
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(valid));
}

function isFavorite(question) {
  return Boolean(getFavorites()[question.id]);
}

function toggleFavorite(question) {
  const favorites = getFavorites();
  if (favorites[question.id]) delete favorites[question.id];
  else favorites[question.id] = { savedAt: new Date().toISOString() };
  saveFavorites(favorites);
}

function getBriefReviews() {
  const saved = readJson(BRIEF_REVIEW_KEY, {});
  if (!saved || typeof saved !== "object") return {};
  return Object.fromEntries(
    Object.entries(saved).filter(
      ([id, value]) => questionById(id)?.type === "brief" && value && typeof value === "object"
    )
  );
}

function saveBriefReviews(value) {
  const valid = Object.fromEntries(
    Object.entries(value || {}).filter(
      ([id, entry]) => questionById(id)?.type === "brief" && entry && typeof entry === "object"
    )
  );
  localStorage.setItem(BRIEF_REVIEW_KEY, JSON.stringify(valid));
}

function briefReviewLabel(level) {
  if (level === "unknown") return "完全不会";
  if (level === "partial") return "有点了解";
  return "我很熟悉";
}

function briefReviewQueue() {
  const reviews = getBriefReviews();
  return Object.entries(reviews)
    .filter(([, review]) => review.level === "unknown" || review.level === "partial")
    .map(([id]) => questionById(id))
    .filter(Boolean);
}

function saveBriefReview(question, level) {
  const reviews = getBriefReviews();
  reviews[question.id] = { level, reviewedAt: new Date().toISOString() };
  saveBriefReviews(reviews);
  markQuestionCompleted(question, level === "familiar");
}

function favoriteButton(question) {
  const saved = isFavorite(question);
  return `<button class="button secondary ${saved ? "favorited" : ""}" data-action="toggle-favorite" data-question-id="${question.id}">${
    saved ? "取消收藏" : "收藏"
  }</button>`;
}

function sanitizePracticeSnapshot(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.questionIds)) return null;
  const questionIds = value.questionIds.filter((id) => typeof id === "string" && questionById(id));
  if (!questionIds.length) return null;

  const records = {};
  if (value.records && typeof value.records === "object") {
    questionIds.forEach((id) => {
      const record = value.records[id];
      if (!record || typeof record !== "object") return;
      records[id] = {
        selected: Array.isArray(record.selected)
          ? record.selected.filter((label) => typeof label === "string").sort()
          : [],
        checked: Boolean(record.checked),
        correct: Boolean(record.correct),
        skipped: Boolean(record.skipped),
      };
    });
  }

  return {
    title: typeof value.title === "string" && value.title ? value.title : "继续刷题",
    questionIds,
    index: Math.min(Math.max(Number(value.index) || 0, 0), questionIds.length - 1),
    records,
    removeOnCorrect: Boolean(value.removeOnCorrect),
    returnView: normalizeReturnView(value.returnView),
    kind: typeof value.kind === "string" ? value.kind : "chapter",
  };
}

function sanitizeProgress(value) {
  const source = value && typeof value === "object" ? value : {};
  const completed = {};
  if (source.completed && typeof source.completed === "object") {
    Object.entries(source.completed).forEach(([id, entry]) => {
      if (!questionById(id)) return;
      completed[id] = {
        completedAt: typeof entry?.completedAt === "string" ? entry.completedAt : "",
        correct: Boolean(entry?.correct),
      };
    });
  }
  return { completed, resume: sanitizePracticeSnapshot(source.resume) };
}

function getProgress() {
  return sanitizeProgress(readJson(PROGRESS_KEY, {}));
}

function saveProgress(value) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(sanitizeProgress(value)));
}

function completedCount(sourceQuestions) {
  const completed = getProgress().completed;
  return sourceQuestions.filter((question) => completed[question.id]).length;
}

function markQuestionCompleted(question, correct) {
  const progress = getProgress();
  progress.completed[question.id] = {
    completedAt: new Date().toISOString(),
    correct: Boolean(correct),
  };
  saveProgress(progress);
}

function saveCurrentPractice() {
  const practice = state.practice;
  if (!practice?.questions?.length) return;
  const progress = getProgress();
  progress.resume = {
    title: practice.title,
    questionIds: practice.questions.map((question) => question.id),
    index: practice.index,
    records: practice.records || {},
    removeOnCorrect: practice.removeOnCorrect,
    returnView: practice.returnView,
    kind: practice.kind,
  };
  saveProgress(progress);
}

function clearPracticeResume() {
  const progress = getProgress();
  progress.resume = null;
  saveProgress(progress);
}

function restoreLastPractice() {
  const snapshot = getProgress().resume;
  if (!snapshot) return false;
  const restoredQuestions = snapshot.questionIds.map(questionById).filter(Boolean);
  if (!restoredQuestions.length) {
    clearPracticeResume();
    return false;
  }
  state.practice = {
    title: snapshot.title,
    questions: restoredQuestions,
    index: Math.min(snapshot.index, restoredQuestions.length - 1),
    records: snapshot.records,
    correct: 0,
    answered: 0,
    removeOnCorrect: snapshot.removeOnCorrect,
    returnView: snapshot.returnView,
    kind: snapshot.kind,
  };
  Object.assign(state.practice, getPracticeStats(state.practice));
  showPractice();
  return true;
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
  if (type === "single") return "单选";
  if (type === "multiple") return "多选";
  return "简答";
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

function chapterQuestions(chapterName, type = "") {
  const pool = !chapterName || chapterName === "全部章节" ? questions : questions.filter((question) => question.chapter === chapterName);
  return type ? pool.filter((question) => question.type === type) : pool;
}

function examQuestions(chapterName) {
  return chapterQuestions(chapterName, "single").filter((question) => !EXAM_EXCLUDED_CHAPTERS.has(question.chapter));
}

function examChapters() {
  return bank.chapters.filter((chapter) => !EXAM_EXCLUDED_CHAPTERS.has(chapter.name));
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

function getBackupConfig() {
  const saved = readJson(BACKUP_CONFIG_KEY, {});
  const config = saved && typeof saved === "object" ? saved : {};
  return {
    token: typeof config.token === "string" ? config.token : "",
    gistId: typeof config.gistId === "string" ? config.gistId : "",
    filename: typeof config.filename === "string" && config.filename ? config.filename : BACKUP_FILENAME,
  };
}

function saveBackupConfig(config) {
  localStorage.setItem(BACKUP_CONFIG_KEY, JSON.stringify(config));
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
  if (name === "favorites") renderFavorites();
  if (name === "backup") renderBackup();
  if (name === "config") safeRenderConfig();
}

function renderHome() {
  const single = questions.filter((question) => question.type === "single").length;
  const resume = getProgress().resume;
  $("#homeView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>今天刷哪一块？</h2>
        <p>离线题库已经准备好：章节练习适合补短板，随机考试适合模拟检测。</p>
      </div>
    </div>
    ${
      resume
        ? `<section class="panel continue-panel">
            <div>
              <h3>继续上次刷题</h3>
              <p>${escapeHtml(resume.title)} · 第 ${resume.index + 1} / ${resume.questionIds.length} 题</p>
            </div>
            <button class="button" data-action="resume-practice">继续</button>
          </section>`
        : ""
    }
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
        <p>从单选题库随机抽题，计时交卷，最后统一看成绩和错题。</p>
        <div class="chapter-meta">
          <span class="pill">单选 ${single}</span>
          <span class="pill">仅考单选</span>
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
        <h3>收藏题库</h3>
        <p>把值得反复看的题收进这里，按章节查找或集中重练。</p>
        <div class="chapter-meta">
          <span class="pill">${Object.keys(getFavorites()).length} 道收藏</span>
        </div>
        <button class="button" data-action="go-favorites">查看收藏</button>
      </article>
      <article class="card mode-card">
        <h3>AI 解析</h3>
        <p>配置接口和模型后，可以让 AI 解释当前题目和正确答案。</p>
        <div class="chapter-meta">
          <span class="pill">${getAiConfig().model || "未选择模型"}</span>
        </div>
        <button class="button" data-action="go-config">配置 AI</button>
      </article>
      <article class="card mode-card">
        <h3>数据备份</h3>
        <p>导出 JSON 文件，或备份到 GitHub Gist，在另一台设备上一键导入。</p>
        <div class="chapter-meta">
          <span class="pill">错题 ${Object.keys(getMistakes()).length}</span>
          <span class="pill">可同步</span>
        </div>
        <button class="button" data-action="go-backup">管理备份</button>
      </article>
    </div>
  `;
}

function renderChapterPicker() {
  const cards = [
    { name: "全部章节" },
    ...bank.chapters,
  ].map((chapter) => {
    const sourceQuestions = chapterQuestions(chapter.name);
    const single = sourceQuestions.filter((question) => question.type === "single").length;
    const multiple = sourceQuestions.filter((question) => question.type === "multiple").length;
    const brief = sourceQuestions.filter((question) => question.type === "brief").length;
    return {
      ...chapter,
      count: sourceQuestions.length,
      single,
      multiple,
      brief,
      completed: completedCount(sourceQuestions),
    };
  });

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
          <p>已刷 ${chapter.completed} / ${chapter.count} 题</p>
          <div class="chapter-meta">
            <span class="pill">单选 ${chapter.single}</span>
            <span class="pill">多选 ${chapter.multiple}</span>
            <span class="pill">简答 ${chapter.brief}</span>
          </div>
          <div class="chapter-actions">
            <button class="button" data-action="start-chapter" data-chapter="${escapeHtml(chapter.name)}">全部题目</button>
            <button class="button secondary" data-action="start-chapter" data-chapter="${escapeHtml(chapter.name)}" data-type="single">刷单选</button>
            <button class="button secondary" data-action="start-chapter" data-chapter="${escapeHtml(chapter.name)}" data-type="multiple">刷多选</button>
            <button class="button secondary" data-action="start-chapter" data-chapter="${escapeHtml(chapter.name)}" data-type="brief" ${chapter.brief ? "" : "disabled"}>刷简答</button>
          </div>
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
    questions: [...sourceQuestions],
    index: 0,
    records: {},
    correct: 0,
    answered: 0,
    removeOnCorrect: Boolean(options.removeOnCorrect),
    returnView: normalizeReturnView(options.returnView),
    kind: options.kind || "chapter",
  };
  if (state.practice.questions.length) saveCurrentPractice();
  else clearPracticeResume();
  showPractice();
}

function normalizeReturnView(value) {
  return value === "mistakes" || value === "favorites" ? value : "chapter";
}

function practiceReturnLabel(returnView) {
  if (returnView === "mistakes") return "错题本";
  if (returnView === "favorites") return "收藏题库";
  return "选择";
}

function practiceReturnAction(returnView) {
  if (returnView === "mistakes") return "go-mistakes";
  if (returnView === "favorites") return "go-favorites";
  return "go-chapter";
}

function getPracticeRecord(practice, question) {
  if (!practice.records) practice.records = {};
  if (!practice.records[question.id]) {
    practice.records[question.id] = { selected: [], checked: false, correct: false, skipped: false };
  }
  return practice.records[question.id];
}

function getPracticeStats(practice) {
  const records = Object.values(practice.records || {});
  const answered = records.filter((record) => record.checked).length;
  const correct = records.filter((record) => record.checked && record.correct).length;
  const skipped = records.filter((record) => !record.checked && record.skipped).length;
  return { answered, correct, skipped };
}

function firstUnfinishedPracticeIndex(practice) {
  return practice.questions.findIndex((question) => !practice.records?.[question.id]?.checked);
}

function showPractice() {
  state.view = "practice";
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("active"));
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
  const record = getPracticeRecord(practice, question);
  const selected = new Set(record.selected);
  const isBrief = question.type === "brief";
  const progress = Math.round(((practice.index + 1) / practice.questions.length) * 100);
  $("#practiceView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>${practice.title}</h2>
        <p>第 ${practice.index + 1} / ${practice.questions.length} 题 · ${formatType(question.type)} · PDF 第 ${question.sourcePage} 页</p>
      </div>
      <button class="button secondary" data-action="back-practice">返回${practiceReturnLabel(practice.returnView)}</button>
    </div>
    <div class="panel question-shell">
      <div class="progress-bar"><span style="width:${progress}%"></span></div>
      ${renderQuestion(question, selected, record.checked)}
      <div id="practiceFeedback" class="feedback ${!isBrief && record.checked ? "show" : ""} ${
        record.checked && isCorrect(question, selected) ? "ok" : "bad"
      }">
        ${!isBrief && record.checked ? feedbackText(question, selected) : ""}
      </div>
      <div class="answer-actions">
        <button class="button secondary" data-action="prev-practice" ${practice.index === 0 ? "disabled" : ""}>上一题</button>
        ${isBrief ? "" : `<button class="button" data-action="check-practice" ${record.checked ? "disabled" : ""}>提交本题</button>`}
        <button class="button secondary" data-action="skip-practice" ${record.checked ? "disabled" : ""}>跳过</button>
        ${favoriteButton(question)}
        <button class="button secondary" data-action="ai-explain" data-question-id="${question.id}">${aiActionLabel(question)}</button>
        <button class="button secondary" data-action="next-practice">${practice.index + 1 === practice.questions.length ? "完成" : "下一题"}</button>
      </div>
      ${renderAiPanel(question, selected)}
    </div>
  `;
}

function renderQuestion(question, selected, checked = false) {
  if (question.type === "brief") return renderBriefQuestion(question);
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

function renderBriefQuestion(question) {
  const revealed = Boolean(state.briefRevealed[question.id]);
  const review = getBriefReviews()[question.id];
  return `
    <div class="question-top">
      <span>${question.chapter}</span>
      <span>简答题</span>
    </div>
    <h3 class="question-title">${question.stem}</h3>
    <section class="brief-answer ${revealed ? "revealed" : ""}">
      <button class="button secondary" data-action="toggle-brief-answer" data-question-id="${question.id}">${
        revealed ? "收起参考答案" : "查看参考答案"
      }</button>
      ${
        revealed
          ? `<div class="brief-answer-content">${formatAiContent(question.referenceAnswer)}</div>
             <div class="review-actions" aria-label="掌握程度">
               ${["unknown", "partial", "familiar"]
                 .map(
                   (level) =>
                     `<button class="review-button ${review?.level === level ? "active" : ""}" data-action="review-brief" data-level="${level}">${briefReviewLabel(
                       level
                     )}</button>`
                 )
                 .join("")}
             </div>`
          : ""
      }
    </section>
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
  if (!practice) return;
  const question = practice.questions[practice.index];
  const record = getPracticeRecord(practice, question);
  if (record.checked) return;
  const value = input.value;
  const selected = new Set(record.selected);
  if (input.type === "radio") {
    record.selected = [value];
  } else if (selected.has(value)) {
    selected.delete(value);
    record.selected = [...selected].sort();
  } else {
    selected.add(value);
    record.selected = [...selected].sort();
  }
  record.skipped = false;
  saveCurrentPractice();
  renderPractice();
}

function checkPractice() {
  const practice = state.practice;
  if (!practice) return;
  const question = practice.questions[practice.index];
  if (question.type === "brief") return;
  const record = getPracticeRecord(practice, question);
  if (record.checked) return;
  const selected = new Set(record.selected);
  record.checked = true;
  record.correct = isCorrect(question, selected);
  record.skipped = false;
  markQuestionCompleted(question, record.correct);
  if (record.correct) {
    if (practice.removeOnCorrect) removeMistake(question);
  } else {
    addMistake(question);
  }
  Object.assign(practice, getPracticeStats(practice));
  saveCurrentPractice();
  renderPractice();
}

function toggleBriefAnswer(questionId) {
  state.briefRevealed[questionId] = !state.briefRevealed[questionId];
  renderPractice();
}

function reviewBriefQuestion(level) {
  const practice = state.practice;
  if (!practice) return;
  const question = practice.questions[practice.index];
  if (question.type !== "brief") return;
  const record = getPracticeRecord(practice, question);
  saveBriefReview(question, level);
  record.checked = true;
  record.correct = level === "familiar";
  record.skipped = false;
  Object.assign(practice, getPracticeStats(practice));
  saveCurrentPractice();
  renderPractice();
}

function prevPractice() {
  const practice = state.practice;
  if (!practice || practice.index === 0) return;
  practice.index -= 1;
  saveCurrentPractice();
  renderPractice();
}

function nextPractice() {
  const practice = state.practice;
  if (!practice) return;
  const question = practice.questions[practice.index];
  const record = getPracticeRecord(practice, question);
  if (!record.checked) {
    if (question.type === "brief") {
      skipPractice();
      return;
    }
    if (record.skipped) {
      skipPractice();
      return;
    }
    checkPractice();
    return;
  }
  if (practice.index + 1 >= practice.questions.length) {
    renderPracticeResult();
    return;
  }
  practice.index += 1;
  saveCurrentPractice();
  renderPractice();
}

function skipPractice() {
  const practice = state.practice;
  if (!practice) return;
  const question = practice.questions[practice.index];
  const record = getPracticeRecord(practice, question);
  if (record.checked) return;

  record.skipped = true;
  if (practice.index + 1 >= practice.questions.length) {
    const unfinishedIndex = firstUnfinishedPracticeIndex(practice);
    if (unfinishedIndex >= 0) practice.index = unfinishedIndex;
    saveCurrentPractice();
    renderPracticeResult();
    return;
  }
  practice.index += 1;
  saveCurrentPractice();
  renderPractice();
}

function continueUnfinishedPractice() {
  const practice = state.practice;
  if (!practice) return;
  const unfinishedIndex = firstUnfinishedPracticeIndex(practice);
  if (unfinishedIndex < 0) {
    renderPracticeResult();
    return;
  }
  practice.index = unfinishedIndex;
  saveCurrentPractice();
  showPractice();
}

function renderPracticeResult() {
  const practice = state.practice;
  const stats = getPracticeStats(practice);
  const unfinishedIndex = firstUnfinishedPracticeIndex(practice);
  const hasUnfinished = unfinishedIndex >= 0;
  if (hasUnfinished) {
    practice.index = unfinishedIndex;
    saveCurrentPractice();
  } else {
    clearPracticeResume();
  }
  const choiceQuestions = practice.questions.filter((question) => question.type !== "brief");
  const briefQuestions = practice.questions.filter((question) => question.type === "brief");
  const choiceAnswered = choiceQuestions.filter((question) => practice.records?.[question.id]?.checked).length;
  const choiceCorrect = choiceQuestions.filter((question) => practice.records?.[question.id]?.correct).length;
  const briefReviewed = briefQuestions.filter((question) => practice.records?.[question.id]?.checked).length;
  const rate = choiceAnswered ? Math.round((choiceCorrect / choiceAnswered) * 100) : 0;
  const returnAction = practiceReturnAction(practice.returnView);
  const returnLabel = practiceReturnLabel(practice.returnView);
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
      <h3>${choiceQuestions.length ? `${choiceCorrect} / ${choiceAnswered}` : `${briefReviewed} 道已复习`}</h3>
      <p>${choiceQuestions.length ? `选择题正确率 ${rate}% · ` : ""}简答已复习 ${briefReviewed} / ${briefQuestions.length} · 跳过 ${stats.skipped} 题</p>
      <div class="answer-actions" style="margin-top:16px">
        ${
          hasUnfinished
            ? `<button class="button" data-action="continue-unfinished">继续未做题</button>
              <button class="button secondary" data-action="${returnAction}">返回${returnLabel}</button>`
            : `<button class="button" data-action="${returnAction}">${
                practice.returnView === "chapter" ? "继续章节刷题" : `返回${returnLabel}`
              }</button>
              <button class="button secondary" data-action="${practice.returnView === "chapter" ? "go-mistakes" : "go-chapter"}">${
                practice.returnView === "chapter" ? "查看错题本" : "章节刷题"
              }</button>`
        }
      </div>
    </div>
  `;
}

function renderExamSetup() {
  const max = examQuestions("全部章节").length;
  $("#examView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>随机考试</h2>
        <p>从单选题中随机抽题，交卷后统一判分。</p>
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
            ${examChapters().map((chapter) => `<option value="${chapter.name}">${chapter.name}</option>`).join("")}
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
  const pool = shuffle(examQuestions(chapter));
  const examItems = pool.slice(0, Math.min(count, pool.length));
  state.exam = {
    questions: examItems,
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
          ${favoriteButton(question)}
          <button class="button secondary" data-action="ai-explain" data-question-id="${question.id}">${aiActionLabel(question)}</button>
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
    markQuestionCompleted(question, ok);
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
  const briefQuestions = briefReviewQueue();
  const reviews = getBriefReviews();
  const visibleQuestions =
    state.reviewFilter === "choices"
      ? mistakeQuestions
      : state.reviewFilter === "brief"
        ? briefQuestions
        : [...mistakeQuestions, ...briefQuestions];
  const chapterNames = ["全部章节", ...bank.chapters.map((chapter) => chapter.name)];
  $("#mistakesView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>错题与待复习</h2>
        <p>选择错题 ${mistakeQuestions.length} 道，简答待复习 ${briefQuestions.length} 道。</p>
      </div>
      <button class="button secondary" data-action="clear-mistakes" ${mistakeQuestions.length ? "" : "disabled"}>清空错题</button>
    </div>
    <div class="review-filter" role="group" aria-label="复习类型">
      <button class="filter-button ${state.reviewFilter === "all" ? "active" : ""}" data-action="set-review-filter" data-filter="all">全部待复习</button>
      <button class="filter-button ${state.reviewFilter === "choices" ? "active" : ""}" data-action="set-review-filter" data-filter="choices">选择错题</button>
      <button class="filter-button ${state.reviewFilter === "brief" ? "active" : ""}" data-action="set-review-filter" data-filter="brief">简答待复习</button>
    </div>
    ${
      visibleQuestions.length
        ? `
      <div class="toolbar" style="margin-bottom:14px">
        <div class="field">
          <label for="mistakeChapter">章节筛选</label>
          <select id="mistakeChapter">
            ${chapterNames.map((name) => `<option value="${name}">${name}</option>`).join("")}
          </select>
        </div>
        <button class="button" data-action="start-mistakes">开始重练</button>
      </div>
      <div class="result-list">
        ${visibleQuestions
          .map(
            (question) => {
              const isBrief = question.type === "brief";
              return `
          <div class="result-row">
            <div>
              <strong>${
                isBrief ? `简答 · ${briefReviewLabel(reviews[question.id]?.level)}` : `${formatType(question.type)} · 错 ${mistakes[question.id].wrongCount} 次`
              }</strong>
              <p class="muted">${question.stem}</p>
            </div>
            <div class="mistake-row-actions">
              <span class="pill">${question.chapter}</span>
              <button class="button secondary" data-action="start-single-review" data-question-id="${question.id}">做这题</button>
            </div>
          </div>
        `;
            }
          )
          .join("")}
      </div>
    `
        : `<div class="empty">暂时没有待复习题。选择题答错或简答题标记“完全不会 / 有点了解”后会出现在这里。</div>`
    }
  `;
}

function startMistakePractice() {
  const chapter = $("#mistakeChapter")?.value || "全部章节";
  const choicePool = Object.keys(getMistakes()).map(questionById).filter(Boolean);
  const briefPool = briefReviewQueue();
  let pool =
    state.reviewFilter === "choices"
      ? choicePool
      : state.reviewFilter === "brief"
        ? briefPool
        : [...choicePool, ...briefPool];
  if (chapter !== "全部章节") pool = pool.filter((question) => question.chapter === chapter);
  startPractice(`待复习重练 · ${chapter}`, pool, { removeOnCorrect: true, returnView: "mistakes", kind: "review" });
}

function startSingleMistakePractice(questionId) {
  const question = questionById(questionId);
  if (!question) return;
  startPractice(`错题重练 · 单题`, [question], {
    removeOnCorrect: true,
    returnView: "mistakes",
    kind: "mistake-single",
  });
}

function startSingleReviewPractice(questionId) {
  const question = questionById(questionId);
  if (!question) return;
  startPractice(`${question.type === "brief" ? "简答待复习" : "错题重练"} · 单题`, [question], {
    removeOnCorrect: question.type !== "brief",
    returnView: "mistakes",
    kind: question.type === "brief" ? "brief-review-single" : "mistake-single",
  });
}

function renderFavorites() {
  const favorites = getFavorites();
  const favoriteQuestions = Object.keys(favorites).map(questionById).filter(Boolean);
  const chapterNames = ["全部章节", ...bank.chapters.map((chapter) => chapter.name)];
  $("#favoritesView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>收藏题库</h2>
        <p>共 ${favoriteQuestions.length} 道收藏题，随时回来看重点和易错点。</p>
      </div>
      <button class="button secondary" data-action="clear-favorites" ${favoriteQuestions.length ? "" : "disabled"}>清空收藏</button>
    </div>
    ${
      favoriteQuestions.length
        ? `
      <div class="toolbar" style="margin-bottom:14px">
        <div class="field">
          <label for="favoriteChapter">章节筛选</label>
          <select id="favoriteChapter">
            ${chapterNames.map((name) => `<option value="${name}">${name}</option>`).join("")}
          </select>
        </div>
        <button class="button" data-action="start-favorites">重做收藏</button>
      </div>
      <div class="result-list">
        ${favoriteQuestions
          .map(
            (question) => `
          <div class="result-row">
            <div>
              <strong>${formatType(question.type)}</strong>
              <p class="muted">${question.stem}</p>
            </div>
            <div class="mistake-row-actions">
              <span class="pill">${question.chapter}</span>
              <button class="button secondary" data-action="start-single-favorite" data-question-id="${question.id}">做这题</button>
              <button class="button ghost" data-action="toggle-favorite" data-question-id="${question.id}">取消收藏</button>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `
        : `<div class="empty">暂时没有收藏题。做题时点击“收藏”，题目就会出现在这里。</div>`
    }
  `;
}

function startFavoritePractice() {
  const chapter = $("#favoriteChapter")?.value || "全部章节";
  const ids = Object.keys(getFavorites());
  let pool = ids.map(questionById).filter(Boolean);
  if (chapter !== "全部章节") pool = pool.filter((question) => question.chapter === chapter);
  startPractice(`收藏重练 · ${chapter}`, pool, { returnView: "favorites", kind: "favorites" });
}

function startSingleFavoritePractice(questionId) {
  const question = questionById(questionId);
  if (!question) return;
  startPractice(`收藏重练 · 单题`, [question], { returnView: "favorites", kind: "favorite-single" });
}

function renderBackup() {
  const config = getBackupConfig();
  const mistakes = getMistakes();
  const favorites = getFavorites();
  const briefReviews = getBriefReviews();
  const aiCache = getAiCache();
  const progress = getProgress();
  $("#backupView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>数据备份</h2>
        <p>导出/导入刷题进度、错题、简答复习、收藏、AI 配置和解析缓存；AI key 不会进入备份文件。</p>
      </div>
    </div>
    <div class="grid backup-grid">
      <section class="panel config-panel">
        <h3>本地文件</h3>
        <p class="muted">适合手动迁移，下载 JSON 后在另一台设备导入。</p>
        <div class="answer-actions">
          <button class="button" data-action="export-backup">导出备份文件</button>
          <label class="button secondary file-button" for="backupFile">导入备份文件</label>
          <input class="hidden-file" id="backupFile" type="file" accept="application/json,.json">
        </div>
      </section>
      <section class="panel config-panel">
        <h3>GitHub Gist 同步</h3>
        <p class="muted">需要 GitHub token 具备 gist 权限。token 只保存在当前浏览器本地，不写进备份。</p>
        <div class="setup-grid">
          <div class="field">
            <label for="backupToken">GitHub token</label>
            <input id="backupToken" type="password" value="${escapeHtml(config.token)}" placeholder="ghp_...">
          </div>
          <div class="field">
            <label for="backupGistId">Gist ID</label>
            <input id="backupGistId" value="${escapeHtml(config.gistId)}" placeholder="首次备份后自动生成">
          </div>
          <div class="field">
            <label for="backupFilename">文件名</label>
            <input id="backupFilename" value="${escapeHtml(config.filename)}">
          </div>
        </div>
        <div class="answer-actions">
          <button class="button secondary" data-action="save-backup-config">保存 GitHub 配置</button>
          <button class="button" data-action="backup-to-github">备份到 GitHub</button>
          <button class="button secondary" data-action="restore-from-github">从 GitHub 导入</button>
        </div>
      </section>
    </div>
    <div class="panel backup-summary">
      <strong>当前本地数据</strong>
      <div class="chapter-meta">
        <span class="pill">已刷 ${Object.keys(progress.completed).length}</span>
        <span class="pill">错题 ${Object.keys(mistakes).length}</span>
        <span class="pill">简答复习 ${Object.keys(briefReviews).length}</span>
        <span class="pill">收藏 ${Object.keys(favorites).length}</span>
        <span class="pill">AI 解析缓存 ${Object.keys(aiCache).length}</span>
        <span class="pill">模型 ${getAiConfig().model || "未配置"}</span>
      </div>
      <div class="notice ${state.backupMessage ? "show" : ""}">${escapeHtml(state.backupMessage)}</div>
    </div>
  `;
}

function readBackupForm() {
  const current = getBackupConfig();
  return {
    token: $("#backupToken")?.value || current.token,
    gistId: ($("#backupGistId")?.value || current.gistId).trim(),
    filename: ($("#backupFilename")?.value || current.filename || BACKUP_FILENAME).trim(),
  };
}

function buildBackupPayload() {
  const aiConfig = getAiConfig();
  return {
    app: "xi-sixiang-shuati",
    version: 4,
    exportedAt: new Date().toISOString(),
    questionBank: {
      total: questions.length,
      chapters: bank.chapters.length,
    },
    data: {
      mistakes: getMistakes(),
      favorites: getFavorites(),
      briefReviews: getBriefReviews(),
      progress: getProgress(),
      aiConfig: {
        apiBase: aiConfig.apiBase,
        model: aiConfig.model,
        models: aiConfig.models,
      },
      aiCache: getAiCache(),
    },
  };
}

function applyBackupPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("备份文件格式不正确。");
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  const mistakes = data.mistakes && typeof data.mistakes === "object" ? data.mistakes : {};
  const favorites = data.favorites && typeof data.favorites === "object" ? data.favorites : getFavorites();
  const briefReviews = data.briefReviews && typeof data.briefReviews === "object" ? data.briefReviews : getBriefReviews();
  const progress = data.progress && typeof data.progress === "object" ? data.progress : getProgress();
  const aiCache = data.aiCache && typeof data.aiCache === "object" ? data.aiCache : {};
  const importedAiConfig = data.aiConfig && typeof data.aiConfig === "object" ? data.aiConfig : {};
  const currentAiConfig = getAiConfig();

  saveMistakes(mistakes);
  saveFavorites(favorites);
  saveBriefReviews(briefReviews);
  saveProgress(progress);
  saveAiCache(aiCache);
  saveAiConfig({
    ...currentAiConfig,
    apiBase: typeof importedAiConfig.apiBase === "string" ? importedAiConfig.apiBase : currentAiConfig.apiBase,
    model: typeof importedAiConfig.model === "string" ? importedAiConfig.model : currentAiConfig.model,
    models: Array.isArray(importedAiConfig.models)
      ? importedAiConfig.models.filter((model) => typeof model === "string")
      : currentAiConfig.models,
    apiKey: currentAiConfig.apiKey,
  });
  state.aiStatus = {};
  state.aiExpanded = {};
  updateSidebarStats();
  state.backupMessage = `已导入备份：已刷 ${Object.keys(getProgress().completed).length} 题，错题 ${Object.keys(mistakes).length} 道，简答复习 ${Object.keys(getBriefReviews()).length} 题，收藏 ${Object.keys(getFavorites()).length} 题，AI 解析缓存 ${Object.keys(aiCache).length} 条。`;
}

function exportBackupFile() {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `xi-quiz-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  state.backupMessage = "备份文件已导出。";
  renderBackup();
}

function confirmBackupImport() {
  return window.confirm("导入会覆盖当前的刷题进度、错题和 AI 解析缓存，确定继续吗？");
}

async function importBackupFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!confirmBackupImport()) {
    input.value = "";
    state.backupMessage = "已取消导入，当前数据未变化。";
    renderBackup();
    return;
  }
  try {
    const text = await file.text();
    applyBackupPayload(JSON.parse(text));
  } catch (error) {
    state.backupMessage = `导入失败：${error?.message || String(error)}`;
  }
  input.value = "";
  renderBackup();
}

function saveBackupConfigFromForm() {
  saveBackupConfig(readBackupForm());
  state.backupMessage = "GitHub 备份配置已保存。";
  renderBackup();
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

async function githubErrorMessage(response, actionName) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload.message ? `（${payload.message}）` : "";
  } catch {
    detail = "";
  }

  if (response.status === 401) {
    return `${actionName}失败：GitHub token 无效、过期、复制不完整，或已经被撤销。请重新生成 token，并确保具备 Gist 写权限。${detail}`;
  }
  if (response.status === 403) {
    return `${actionName}失败：token 权限不足。Fine-grained token 需要 User permissions 里的 Gists: Read and write；Classic token 需要 gist scope。${detail}`;
  }
  if (response.status === 404) {
    return `${actionName}失败：没有找到这个 Gist，或当前 token 无权访问它。${detail}`;
  }
  return `${actionName}失败：HTTP ${response.status}${detail}`;
}

async function backupToGithub() {
  const config = readBackupForm();
  if (!config.token) {
    state.backupMessage = "请先填写 GitHub token。";
    renderBackup();
    return;
  }
  const filename = config.filename || BACKUP_FILENAME;
  const payload = buildBackupPayload();
  const body = {
    description: "习思想刷题软件数据备份",
    public: false,
    files: {
      [filename]: {
        content: JSON.stringify(payload, null, 2),
      },
    },
  };

  state.backupMessage = "正在备份到 GitHub...";
  renderBackup();
  try {
    const url = config.gistId ? `https://api.github.com/gists/${config.gistId}` : "https://api.github.com/gists";
    const response = await fetch(url, {
      method: config.gistId ? "PATCH" : "POST",
      headers: githubHeaders(config.token),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub 备份"));
    const gist = await response.json();
    saveBackupConfig({ ...config, gistId: gist.id, filename });
    state.backupMessage = `已备份到 GitHub Gist：${gist.id}`;
  } catch (error) {
    state.backupMessage = explainNetworkError(error);
  }
  renderBackup();
}

async function restoreFromGithub() {
  const config = readBackupForm();
  if (!config.token || !config.gistId) {
    state.backupMessage = "请填写 GitHub token 和 Gist ID。";
    renderBackup();
    return;
  }
  if (!confirmBackupImport()) {
    state.backupMessage = "已取消导入，当前数据未变化。";
    renderBackup();
    return;
  }

  state.backupMessage = "正在从 GitHub 导入...";
  renderBackup();
  try {
    const response = await fetch(`https://api.github.com/gists/${config.gistId}`, {
      headers: githubHeaders(config.token),
    });
    if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub 导入"));
    const gist = await response.json();
    const files = Object.values(gist.files || {});
    const file = files.find((item) => item.filename === config.filename) || files[0];
    if (!file?.content) throw new Error("Gist 中没有找到备份内容。");
    applyBackupPayload(JSON.parse(file.content));
    saveBackupConfig({ ...config, filename: file.filename || config.filename });
  } catch (error) {
    state.backupMessage = explainNetworkError(error);
  }
  renderBackup();
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

function aiStatusKey(question, model) {
  return model ? aiCacheKey(question, model) : `unconfigured:${question.id}`;
}

function aiActionLabel(question) {
  const config = getAiConfig();
  const key = aiStatusKey(question, config.model);
  const status = state.aiStatus[key] || {};
  const cached = config.model ? getAiCache()[aiCacheKey(question, config.model)] : "";
  if (status.loading) return "解析中...";
  if (status.error) return "重新解析";
  if (status.content || cached) return state.aiExpanded[key] ? "收起解析" : "展开解析";
  return "AI 解析";
}

function renderAiPanel(question, selected) {
  const config = getAiConfig();
  const key = aiStatusKey(question, config.model);
  const cache = getAiCache();
  const status = state.aiStatus[key] || {};
  const cached = config.model ? cache[aiCacheKey(question, config.model)] : "";
  const content = status.content || cached || "";
  const expanded = Boolean(state.aiExpanded[key]);
  if (!status.loading && !status.error && (!content || !expanded)) return "";

  const chosen =
    question.type === "brief"
      ? getBriefReviews()[question.id]?.level
        ? briefReviewLabel(getBriefReviews()[question.id].level)
        : "未标记掌握程度"
      : selectedAnswer(selected) || "未作答";
  const body = status.loading ? "正在请求 AI 解析..." : status.error || content;
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
  return renderMarkdown(value);
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>");
}

function renderMarkdown(value) {
  const lines = String(value).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType = "";
  let inCode = false;
  let codeLines = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = "";
    }
  };
  const openList = (type) => {
    if (listType !== type) {
      closeList();
      listType = type;
      html.push(`<${type}>`);
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(6, heading[1].length + 2);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      openList("ul");
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)、]\s+(.+)$/);
    if (ordered) {
      openList("ol");
      html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }

  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  closeList();
  return html.join("");
}

function buildPrompt(question, selected) {
  if (question.type === "brief") {
    const review = getBriefReviews()[question.id];
    return `题型：简答题
章节：${question.chapter}
题目：${question.stem}
参考答案：${question.referenceAnswer}
用户掌握状态：${review ? briefReviewLabel(review.level) : "未标记"}

请先提炼参考答案的核心要点；再按要点分层说明如何记忆；最后给出简短的复习提示。`;
  }
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
        ? new Set(getPracticeRecord(state.practice, question).selected)
        : new Set();

  const cache = getAiCache();
  const cacheKey = aiCacheKey(question, config.model);
  const statusKey = aiStatusKey(question, config.model);
  const currentStatus = state.aiStatus[statusKey] || {};
  if (currentStatus.loading) return;

  if (cache[cacheKey] || currentStatus.content) {
    state.aiExpanded[statusKey] = !state.aiExpanded[statusKey];
    renderActiveQuestion();
    return;
  }

  if (!config.apiBase || !config.apiKey || !config.model) {
    state.aiStatus[statusKey] = { error: "请先到“AI 配置”填写 API 地址、key，并选择模型。" };
    renderActiveQuestion();
    return;
  }

  state.aiExpanded[statusKey] = true;
  state.aiStatus[statusKey] = { loading: true };
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
    state.aiStatus[statusKey] = { content };
  } catch (error) {
    state.aiStatus[statusKey] = { error: explainNetworkError(error) };
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
  if (action === "go-favorites") showView("favorites");
  if (action === "go-config") showView("config");
  if (action === "go-backup") showView("backup");
  if (action === "resume-practice") restoreLastPractice();
  if (action === "export-backup") exportBackupFile();
  if (action === "save-backup-config") saveBackupConfigFromForm();
  if (action === "backup-to-github") backupToGithub();
  if (action === "restore-from-github") restoreFromGithub();
  if (action === "start-chapter") {
    const chapter = target.dataset.chapter;
    const type = target.dataset.type || "";
    const typeTitle = type === "single" ? " · 单选" : type === "multiple" ? " · 多选" : type === "brief" ? " · 简答" : "";
    startPractice(`章节刷题 · ${chapter}${typeTitle}`, chapterQuestions(chapter, type), { kind: "chapter" });
  }
  if (action === "back-practice") showView(state.practice?.returnView || "chapter");
  if (action === "check-practice") checkPractice();
  if (action === "prev-practice") prevPractice();
  if (action === "next-practice") nextPractice();
  if (action === "skip-practice") skipPractice();
  if (action === "continue-unfinished") continueUnfinishedPractice();
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
  if (action === "start-single-mistake") startSingleMistakePractice(target.dataset.questionId);
  if (action === "start-single-review") startSingleReviewPractice(target.dataset.questionId);
  if (action === "set-review-filter") {
    state.reviewFilter = ["all", "choices", "brief"].includes(target.dataset.filter) ? target.dataset.filter : "all";
    renderMistakes();
  }
  if (action === "start-favorites") startFavoritePractice();
  if (action === "start-single-favorite") startSingleFavoritePractice(target.dataset.questionId);
  if (action === "toggle-favorite") {
    const question = questionById(target.dataset.questionId);
    if (question) toggleFavorite(question);
    if ($("#favoritesView").classList.contains("active-view")) renderFavorites();
    else renderActiveQuestion();
  }
  if (action === "ai-explain") explainQuestion(target.dataset.questionId);
  if (action === "toggle-brief-answer") toggleBriefAnswer(target.dataset.questionId);
  if (action === "review-brief") reviewBriefQuestion(target.dataset.level);
  if (action === "fetch-models") fetchModels();
  if (action === "save-ai-config") saveConfigFromForm();
  if (action === "clear-ai-cache") {
    saveAiCache({});
    state.aiStatus = {};
    state.aiExpanded = {};
    state.configMessage = "解析缓存已清除。";
    safeRenderConfig();
  }
  if (action === "clear-ai-config") {
    localStorage.removeItem(AI_CONFIG_KEY);
    state.aiStatus = {};
    state.aiExpanded = {};
    state.configMessage = "AI 配置已清除。";
    safeRenderConfig();
  }
  if (action === "reset-ai-config-hard") {
    localStorage.removeItem(AI_CONFIG_KEY);
    localStorage.removeItem(AI_CACHE_KEY);
    state.aiStatus = {};
    state.aiExpanded = {};
    state.configMessage = "AI 配置和解析缓存已重置。";
    safeRenderConfig();
  }
  if (action === "clear-mistakes") {
    saveMistakes({});
    renderMistakes();
  }
  if (action === "clear-favorites") {
    saveFavorites({});
    renderFavorites();
  }
});

document.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.id === "backupFile") {
    importBackupFile(input);
    return;
  }
  if (input.name?.startsWith("answer-")) {
    if (state.exam && $("#examView").classList.contains("active-view")) handleExamAnswer(input);
    else handlePracticeAnswer(input);
  }
});

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

updateSidebarStats();
if (!restoreLastPractice()) renderHome();
