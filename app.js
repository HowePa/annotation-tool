/* ============================================================
 * Pairwise LLM Response Human Annotation Tool
 * 纯前端实现：FileReader 加载 / LocalStorage 自动保存 / Blob 导出
 * ============================================================ */

(function () {
  "use strict";

  /* ---------- 配置 ---------- */
  // 默认标签集，支持后续扩展（可在 DEFAULT_TAGS 增删）
  const STORAGE_KEY_PREFIX = "pairwise_annotation_progress_v2";
  const WINNER_VALUES = ["A", "B", "Tie", "None"];

  /* ---------- 全局状态 ---------- */
  let dataset = [];          // 当前加载的全部数据
  let currentIndex = 0;      // 当前查看的索引
  let fileName = "";         // 当前文件名
  let fileStorageScope = ""; // 当前文件的存储作用域
  // 标注结果：{ reflection_id: { winner, score_a, score_b, tags, note } }
  let annotations = {};

  /* ---------- DOM 引用 ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    fileInput: $("fileInput"),
    exportBtn: $("exportBtn"),
    fileName: $("fileName"),
    totalCount: $("totalCount"),
    progressText: $("progressText"),
    progressBar: $("progressBar"),
    progressPercent: $("progressPercent"),
    emptyHint: $("emptyHint"),
    mainArea: $("mainArea"),
    reflectionText: $("reflectionText"),
    metaRow: $("metaRow"),
    renderedA: $("renderedA"),
    renderedB: $("renderedB"),
    answerA: $("answerA"),
    answerB: $("answerB"),
    badgeA: $("badgeA"),
    badgeB: $("badgeB"),
    priorReflectionsToggle: $("priorReflectionsToggle"),
    priorReflectionsCount: $("priorReflectionsCount"),
    priorReflectionsList: $("priorReflectionsList"),
    sameLectureToggle: $("sameLectureToggle"),
    sameLectureCount: $("sameLectureCount"),
    sameLectureList: $("sameLectureList"),
    winnerGroup: $("winnerGroup"),
    noteInput: $("noteInput"),
    prevBtn: $("prevBtn"),
    nextBtn: $("nextBtn"),
    saveBtn: $("saveBtn"),
    jumpInput: $("jumpInput"),
    jumpBtn: $("jumpBtn"),
    navIndexText: $("navIndexText")
  };

  /* ============================================================
   * Markdown 渲染（支持：代码块、行内代码、粗体、斜体、换行、列表）
   * ============================================================ */
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderMarkdown(text) {
    if (text == null) return "";
    let src = String(text);

    // 先抽取代码块 ```...``` ，避免内部被其它规则破坏
    const codeBlocks = [];
    src = src.replace(/```([\s\S]*?)```/g, function (_, code) {
      codeBlocks.push(code);
      return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
    });

    // 转义 HTML
    let html = escapeHtml(src);

    // 处理字面量 \n（JSON 里常见）
    html = html
      .replace(/\\n\\n/g, "</p><p>")
      .replace(/\\n/g, "<br>")
      // 真实换行
      .replace(/\n\s*\n/g, "</p><p>")
      .replace(/\n/g, "<br>");

    // 行内代码 `code`
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // 粗体 / 斜体
    html = html
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>");

    // 简单列表：行首 - 或 * 开头
    html = html.replace(/(?:<br>|^)\s*[-*]\s+(.*?)(?=(?:<br>)|$)/g, function (m, line) {
      return "<br>• " + line;
    });

    // 还原代码块
    html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, function (_, i) {
      return "</p><pre><code>" + escapeHtml(codeBlocks[Number(i)]) + "</code></pre><p>";
    });

    return "<p>" + html + "</p>";
  }

  function escapeAndJoinList(items) {
    return items
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  }

  /* ============================================================
   * 字段自动识别
   * ============================================================ */
  // 自动识别 reflection_id / response_a / response_b 等字段，不依赖固定数量
  function pick(item, keys) {
    for (const k of keys) {
      if (item[k] != null && item[k] !== "") return item[k];
    }
    return "";
  }

  function getReflectionId(item) {
    return pick(item, ["reflection_id", "id", "rid"]);
  }
  function getReflection(item) {
    return pick(item, ["reflection", "question", "prompt", "student_reflection"]);
  }
  function getResponseA(item) {
    return pick(item, ["response_a", "resp_a", "answer_a", "a"]);
  }
  function getResponseB(item) {
    return pick(item, ["response_b", "resp_b", "answer_b", "b"]);
  }

  /* ============================================================
   * LocalStorage 自动保存
   * ============================================================ */
  function getStorageKey(scope) {
    return STORAGE_KEY_PREFIX + ":" + encodeURIComponent(scope || "default");
  }

  function buildStorageScope(file) {
    if (!file) return "default";
    const parts = [file.name || "unknown", file.size || 0, file.lastModified || 0];
    return parts.join("::");
  }

  function loadAnnotations(scope) {
    try {
      const raw = localStorage.getItem(getStorageKey(scope));
      annotations = raw ? JSON.parse(raw) : {};
    } catch (e) {
      annotations = {};
    }
  }

  function persistAnnotations() {
    if (!fileStorageScope) return;
    try {
      localStorage.setItem(getStorageKey(fileStorageScope), JSON.stringify(annotations));
    } catch (e) {
      console.warn("LocalStorage 保存失败：", e);
    }
  }

  // 保存当前条目的标注到 annotations 并写入 localStorage
  function saveCurrent() {
    if (!dataset.length) return;
    const item = dataset[currentIndex];
    const rid = getReflectionId(item) || ("idx_" + currentIndex);
    annotations[rid] = collectCurrentAnnotation();
    persistAnnotations();
    updateProgress();
  }

  /* ============================================================
   * 收集 / 填充当前条目的标注
   * ============================================================ */
  function collectCurrentAnnotation() {
    return {
      winner: getSelectedWinner(),
      note: el.noteInput.value
    };
  }

  function getSelectedWinner() {
    const checked = el.winnerGroup.querySelector("input[name='winner']:checked");
    return checked ? checked.value : "";
  }

  // 用指定标注数据回填 UI
  function applyAnnotation(ann) {
    // Winner
    el.winnerGroup.querySelectorAll("input[name='winner']").forEach((r) => {
      r.checked = (r.value === ann.winner);
    });
    updateWinnerVisual();

    // 备注
    el.noteInput.value = ann.note || "";

    // 卡片高亮
    updateChoiceBadge();
  }

  function resetAnnotationUI() {
    el.winnerGroup.querySelectorAll("input[name='winner']").forEach((r) => (r.checked = false));
    el.noteInput.value = "";
    updateWinnerVisual();
    updateChoiceBadge();
  }

  /* ============================================================
   * Winner 视觉效果
   * ============================================================ */
  function updateWinnerVisual() {
    const winner = getSelectedWinner();
    el.winnerGroup.querySelectorAll("label").forEach((label) => {
      const input = label.querySelector("input");
      label.classList.remove("checked-A", "checked-B", "checked-Tie", "checked-None");
      if (input.checked) {
        if (input.value === "A") label.classList.add("checked-A");
        else if (input.value === "B") label.classList.add("checked-B");
        else if (input.value === "Tie") label.classList.add("checked-Tie");
        else if (input.value === "None") label.classList.add("checked-None");
      }
    });
  }

  function updateChoiceBadge() {
    const winner = getSelectedWinner();
    el.badgeA.style.display = (winner === "A") ? "inline-block" : "none";
    el.badgeB.style.display = (winner === "B") ? "inline-block" : "none";
    el.answerA.classList.toggle("is-chosen", winner === "A");
    el.answerB.classList.toggle("is-chosen", winner === "B");
  }

  function renderReflectionLists(item) {
    const prior = Array.isArray(item.prior_student_reflections) ? item.prior_student_reflections : [];
    const sameLecture = Array.isArray(item.same_lecture_reflections) ? item.same_lecture_reflections : [];

    el.priorReflectionsCount.textContent = String(prior.length);
    el.sameLectureCount.textContent = String(sameLecture.length);

    el.priorReflectionsList.innerHTML = prior.length
      ? escapeAndJoinList(prior)
      : '<li class="empty-list-item">No prior_student_reflections</li>';

    el.sameLectureList.innerHTML = sameLecture.length
      ? escapeAndJoinList(sameLecture)
      : '<li class="empty-list-item">No same_lecture_reflections</li>';

    el.priorReflectionsToggle.open = prior.length > 0;
    el.sameLectureToggle.open = sameLecture.length > 0;
  }

  /* ============================================================
   * 渲染当前条目
   * ============================================================ */
  function renderCurrent() {
    if (!dataset.length) return;
    const item = dataset[currentIndex];

    // Reflection
    el.reflectionText.textContent = getReflection(item) || "(无 reflection 字段)";

    // 元信息（自动展示除大文本外的字段）
    const metaParts = [];
    const idVal = getReflectionId(item);
    if (idVal) metaParts.push("ID: " + idVal);
    ["student_id", "lecture_id"].forEach((k) => {
      if (item[k] != null && item[k] !== "") metaParts.push(k + ": " + item[k]);
    });
    el.metaRow.innerHTML = metaParts.map((m) => `<span>${escapeHtml(m)}</span>`).join("");

    // Response A / B（Markdown 渲染）
    el.renderedA.innerHTML = renderMarkdown(getResponseA(item));
    el.renderedB.innerHTML = renderMarkdown(getResponseB(item));

    // 相关反思列表
    renderReflectionLists(item);

    // 回填已有标注
    const rid = idVal || ("idx_" + currentIndex);
    if (annotations[rid]) {
      applyAnnotation(annotations[rid]);
    } else {
      resetAnnotationUI();
    }

    // 导航状态
    el.prevBtn.disabled = currentIndex <= 0;
    el.nextBtn.disabled = currentIndex >= dataset.length - 1;
    el.jumpInput.value = currentIndex + 1;
    el.jumpInput.max = dataset.length;
    el.navIndexText.textContent = "/ " + dataset.length;

    updateProgress();
  }

  function updateProgress() {
    const total = dataset.length;
    let done = 0;
    dataset.forEach((item, idx) => {
      const rid = getReflectionId(item) || ("idx_" + idx);
      const ann = annotations[rid];
      if (ann && ann.winner) done++; // 以 winner 是否填写视为已完成
    });
    el.progressText.textContent = done + " / " + total;
    const pct = total ? Math.round((done / total) * 100) : 0;
    el.progressBar.style.width = pct + "%";
    el.progressPercent.textContent = pct + "%";
  }

  /* ============================================================
   * 文件加载
   * ============================================================ */
  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) {
          alert("JSON 必须是数组格式（每条为一个对象）。");
          return;
        }
        dataset = data;
        fileName = file.name;
        fileStorageScope = buildStorageScope(file);
        currentIndex = 0;
        loadAnnotations(fileStorageScope); // 同文件复用，跨文件隔离

        el.fileName.textContent = fileName;
        el.totalCount.textContent = dataset.length;
        el.emptyHint.classList.add("hidden");
        el.mainArea.classList.remove("hidden");
        el.exportBtn.disabled = false;

        renderCurrent();
      } catch (err) {
        alert("解析 JSON 失败：" + err.message);
      }
    };
    reader.onerror = function () {
      alert("读取文件失败。");
    };
    reader.readAsText(file, "UTF-8");
  }

  /* ============================================================
   * 导出结果
   * ============================================================ */
  function exportResult() {
    if (!dataset.length) return;
    const result = [];
    dataset.forEach((item, idx) => {
      const rid = getReflectionId(item) || ("idx_" + idx);
      const ann = annotations[rid];
      if (!ann) return; // 未标注的不导出（也可改为导出空结构）
      result.push({
        reflection_id: rid,
        human_label: {
          winner: ann.winner || "",
          comment: ann.note || ""
        }
      });
    });

    const exportName = fileName
      ? fileName.replace(/\.json$/i, "") + "_result.json"
      : "annotation_result.json";

    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Exported " + exportName + " (" + result.length + " items)");
  }

  /* ============================================================
   * 导航
   * ============================================================ */
  function gotoPrev() {
    if (currentIndex > 0) {
      saveCurrent();
      currentIndex--;
      renderCurrent();
    }
  }
  function gotoNext() {
    if (currentIndex < dataset.length - 1) {
      saveCurrent();
      currentIndex++;
      renderCurrent();
    }
  }
  function gotoIndex(i) {
    if (!dataset.length) return;
    i = Math.max(0, Math.min(dataset.length - 1, i));
    saveCurrent();
    currentIndex = i;
    renderCurrent();
  }

  /* ============================================================
   * Toast 提示
   * ============================================================ */
  let toastTimer = null;
  function showToast(msg) {
    let t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
  }

  /* ============================================================
   * 快捷键
   * ============================================================ */
  function handleKeydown(e) {
    // 在输入框内不触发单键快捷键（除 Ctrl+S）
    const typing = e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT";
    if (typing) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrent();
        showToast("已保存");
      }
      return;
    }

    if (e.key === "ArrowLeft") { e.preventDefault(); gotoPrev(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); gotoNext(); }
    else if (e.key === "1") { selectWinner("A"); }
    else if (e.key === "2") { selectWinner("B"); }
    else if (e.key === "3") { selectWinner("Tie"); }
    else if (e.key === "4") { selectWinner("None"); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault(); saveCurrent(); showToast("已保存");
    }
  }

  function selectWinner(value) {
    const radio = el.winnerGroup.querySelector(`input[name='winner'][value="${value}"]`);
    if (radio) {
      radio.checked = true;
      updateWinnerVisual();
      updateChoiceBadge();
    }
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bindEvents() {
    el.fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      handleFile(file);
    });

    el.exportBtn.addEventListener("click", exportResult);

    // Winner 单选
    el.winnerGroup.querySelectorAll("input[name='winner']").forEach((r) => {
      r.addEventListener("change", () => {
        updateWinnerVisual();
        updateChoiceBadge();
      });
    });

    el.prevBtn.addEventListener("click", gotoPrev);
    el.nextBtn.addEventListener("click", gotoNext);
    el.saveBtn.addEventListener("click", () => {
      saveCurrent();
      showToast("已保存");
    });

    el.jumpBtn.addEventListener("click", () => {
      const i = parseInt(el.jumpInput.value, 10);
      if (!isNaN(i)) gotoIndex(i - 1);
    });
    el.jumpInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const i = parseInt(el.jumpInput.value, 10);
        if (!isNaN(i)) gotoIndex(i - 1);
      }
    });

    // 备注实时保存（防抖）
    let noteTimer = null;
    el.noteInput.addEventListener("input", () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(saveCurrent, 600);
    });

    document.addEventListener("keydown", handleKeydown);
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  function init() {
    annotations = {};
    bindEvents();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
