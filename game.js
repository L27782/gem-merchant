/* ============================================================================
 * 《宝石商人》游戏引擎  game.js
 * ============================================================================ */
(function () {
  "use strict";

  const DATA = window.GAME_DATA;
  const STORY = window.STORY_DATA || [];

  /* 大关卡下标 → 通关后解锁的剧情段（story[0]=竹篮=前传，不占关卡） */
  const REWARD_SEGS = [[1], [2], [3], [4], [5, 6]];
  const LS = {
    coins: "gem-merchant.coins",
    done: "gem-merchant.done",
    prologue: "gem-merchant.prologueSeen",
    tier: "gem-merchant.tier",
    story: "gem-merchant.story",
  };

  /* ---------------- 工具 ---------------- */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const load = (k, fb) => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fb : JSON.parse(v);
    } catch (e) { return fb; }
  };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  /* ---------------- 状态 ---------------- */
  const state = {
    coins: load(LS.coins, 0),
    done: load(LS.done, {}),
    tier: load(LS.tier, 0),
    storyDone: load(LS.story, {}),
    prologueSeen: localStorage.getItem(LS.prologue) === "1",
    chapterId: null,
    subId: null,
    gems: [],          // [{ data, isCorrect, wrong }]
    inspecting: null,  // 正在查看的宝石下标
    wrong: 0,          // 本关累计错误次数
    hovered: null,
  };

  /* ---------------- 索引 ---------------- */
  const chapterById = {};
  const subByKey = {};
  DATA.chapters.forEach((c) => {
    chapterById[c.id] = c;
    c.subLevels.forEach((s) => {
      s.chapterId = c.id;
      subByKey[c.id + "/" + s.id] = s;
    });
  });

  const TOTAL = DATA.chapters.reduce((s, c) => s + c.subLevels.length, 0);
  function computeThresholds() {
    const base = Math.floor(TOTAL / 5);
    const rem = TOTAL % 5;
    if (base === 0) {
      // 临时退化：小关卡总数不足 5（题库尚未填全）时，每档 +1、封顶到总金币
      const t = [];
      let acc = 0;
      for (let i = 0; i < 5; i++) {
        acc = Math.min(TOTAL, acc + 1);
        t.push(acc);
      }
      return t;
    }
    const t = [];
    let acc = 0;
    for (let i = 0; i < 5; i++) {
      acc += (i === 4 ? base + rem : base);
      t.push(acc);
    }
    return t;
  }
  const THRESHOLDS = computeThresholds();

  function currentTier() {
    const maxIdx = DATA.lifeTiers.length - 1;
    return Math.min(Math.max(Number(state.tier) || 0, 0), maxIdx);
  }
  const passed = (c, s) => !!state.done[c + "/" + s];
  const key = (c, s) => c + "/" + s;

  function chapterPassedCount(ch) {
    return ch.subLevels.filter((s) => passed(ch.id, s.id)).length;
  }
  function isChapterDone(ch) {
    return ch.subLevels.length > 0 && chapterPassedCount(ch) === ch.subLevels.length;
  }
  function isChapterUnlocked(chIndex) {
    if (chIndex <= 0) return true;
    return isChapterDone(DATA.chapters[chIndex - 1]);
  }

  /* ---------------- 屏幕切换 ---------------- */
  function show(id) {
    $$(".screen").forEach((s) => s.classList.add("hidden"));
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  /* ---------------- 弹窗 & 提示 ---------------- */
  function openModal(title, message, buttons) {
    $("#modal-title").textContent = title;
    $("#modal-message").textContent = message;
    const box = $("#modal-buttons");
    box.innerHTML = "";
    buttons.forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "btn " + (b.cls || "primary");
      btn.textContent = b.label;
      btn.onclick = () => { closeModal(); if (b.onClick) b.onClick(); };
      box.appendChild(btn);
    });
    $("#modal").classList.remove("hidden");
  }
  function closeModal() { $("#modal").classList.add("hidden"); }

  function openHtmlModal(title, html, buttons) {
    $("#modal-title").textContent = title;
    $("#modal-message").innerHTML = html;
    const box = $("#modal-buttons");
    box.innerHTML = "";
    buttons.forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "btn " + (b.cls || "primary");
      btn.textContent = b.label;
      btn.onclick = () => { closeModal(); if (b.onClick) b.onClick(); };
      box.appendChild(btn);
    });
    $("#modal").classList.remove("hidden");
  }

  let toastTimer = null;
  function toast(msg, cls) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast " + (cls || "");
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 1700);
  }

  /* ---------------- 剧情阅读（前传 / 通关奖励共用） ---------------- */
  let storyReturn = null;

  function showStoryChapter(segIndex, onFinish) {
    const seg = STORY[segIndex];
    if (!seg) { if (onFinish) onFinish(); return; }
    storyReturn = onFinish || null;
    const el = $("#prologue-text");
    el.innerHTML =
      '<div class="p-speaker">' + seg.title + "</div>" +
      seg.paragraphs.map((p) => "<p>" + p + "</p>").join("");
    show("screen-prologue");
  }

  function finishStory() {
    const cb = storyReturn;
    storyReturn = null;
    if (cb) cb();
  }

  function playStories(segIdxs, onDone) {
    let k = 0;
    function next() {
      if (k >= segIdxs.length) { if (onDone) onDone(); return; }
      const segIdx = segIdxs[k++];
      state.storyDone[segIdx] = true;
      save(LS.story, state.storyDone);
      showStoryChapter(segIdx, next);
    }
    next();
  }

  /* ---------------- 主页 ---------------- */
  function renderHome() {
    const tier = DATA.lifeTiers[currentTier()];
    const bg = $("#home-bg");
    if (bg) bg.style.backgroundImage = 'url("' + tier.image + '")';
    // 左下角进度条：金币 / 下一档门槛
    const maxIdx = DATA.lifeTiers.length - 1;
    const next = currentTier() < maxIdx ? THRESHOLDS[currentTier()] : null;
    const fill = $("#home-progress-fill");
    const text = $("#home-progress-text");
    if (fill && text) {
      const pct = next ? Math.min(100, Math.round(state.coins / next * 100)) : 100;
      fill.style.width = pct + "%";
      text.textContent = next ? (state.coins + " / " + next) : (state.coins + " / 满");
    }
  }

  /* ---------------- 关卡选择 ---------------- */
  function renderChapters() {
    const list = $("#chapter-list");
    list.innerHTML = "";
    DATA.chapters.forEach((ch, idx) => {
      const total = ch.subLevels.length;
      const passedCount = chapterPassedCount(ch);
      const done = isChapterDone(ch);
      const unlocked = isChapterUnlocked(idx);
      const card = document.createElement("button");
      let progressText = done ? "✓ 已完成" : passedCount + " / " + total;
      if (!unlocked) progressText = "🔒 完成上一章解锁";
      card.className = "chapter-card" + (done ? " done" : "") + (unlocked ? "" : " locked");
      card.innerHTML =
        '<div class="chapter-icon">' + (unlocked ? ch.icon : "🔒") + '</div>' +
        '<div class="chapter-name">' + ch.name + '</div>' +
        '<div class="chapter-progress">' + progressText + '</div>';
      if (unlocked) card.addEventListener("click", () => showSubLevels(ch.id));
      list.appendChild(card);
    });
  }

  /* ---------------- 小关卡选择 ---------------- */
  function showSubLevels(chapterId) {
    state.chapterId = chapterId;
    const ch = chapterById[chapterId];
    $("#sublevel-chapter-name").textContent = ch.name;
    const list = $("#sublevel-list");
    list.innerHTML = "";
    ch.subLevels.forEach((sl) => {
      const isP = passed(ch.id, sl.id);
      const btn = document.createElement("button");
      btn.className = "sublevel-card" + (isP ? " passed" : "");
      btn.innerHTML =
        '<span class="sublevel-name">' + sl.name + '</span>' +
        '<span class="sublevel-badge">' + (isP ? "✓ 已通过" : "▶ 开始") + '</span>';
      btn.addEventListener("click", () => startSubLevel(ch.id, sl.id));
      list.appendChild(btn);
    });
    show("screen-sublevels");
  }

  /* ---------------- 开始小关卡 ---------------- */
  function startSubLevel(chapterId, subId) {
    state.chapterId = chapterId;
    state.subId = subId;
    state.wrong = 0;
    state.inspecting = null;
    state.hovered = null;
    const sl = subByKey[key(chapterId, subId)];
    $("#game-title").textContent = chapterById[chapterId].name + " · " + sl.name;
    updateHud();
    buildStall(sl);
    closeGemPopup();
    show("screen-game");
    layoutGems();
    toast("找出正确的知识点宝石！");
  }

  const SCENES = {
    overview: { landscape: "scene-overview-landscape.jpg", portrait: "scene-overview-portrait.jpg" },
    "producers-easy": { landscape: "scene-producers-easy-landscape.jpg", portrait: "scene-producers-easy-portrait.jpg" },
    "producers-hard": { landscape: "scene-producers-hard-landscape.jpg", portrait: "scene-producers-hard-portrait.jpg" },
    "broadcasters-easy": { landscape: "scene-broadcasters-easy-landscape.jpg", portrait: "scene-broadcasters-easy-portrait.jpg" },
    "broadcasters-hard": { landscape: "scene-broadcasters-hard-landscape.jpg", portrait: "scene-broadcasters-hard-portrait.jpg" },
    "performers-easy": { landscape: "scene-performers-easy-landscape.jpg", portrait: "scene-performers-easy-portrait.jpg" },
    "performers-hard": { landscape: "scene-performers-hard-landscape.jpg", portrait: "scene-performers-hard-portrait.jpg" },
    "publishers-easy": { landscape: "scene-publishers-easy-landscape.jpg", portrait: "scene-publishers-easy-portrait.jpg" },
    "publishers-hard": { landscape: "scene-publishers-hard-landscape.jpg", portrait: "scene-publishers-hard-portrait.jpg" },
  };
  const SCENE_SIZE = { landscape: { w: 2015, h: 1053 }, portrait: { w: 1030, h: 2136 } };
  const SCENE_SPOTS = {
    landscape: [
      { fx: 0.26, fy: 0.533 },
      { fx: 0.42, fy: 0.50 },
      { fx: 0.61, fy: 0.578 },
      { fx: 0.30, fy: 0.689 },
    ],
    portrait: [
      { fx: 0.24, fy: 0.539 },
      { fx: 0.44, fy: 0.518 },
      { fx: 0.63, fy: 0.55 },
      { fx: 0.31, fy: 0.636 },
    ],
  };

  let currentSceneKey = "overview";

  function isPortraitScreen() { return window.innerHeight > window.innerWidth; }

  function sceneKeyFor(sl) {
    const ch = chapterById[sl.chapterId];
    if (!ch || ch.scene === "overview") return "overview";
    return ch.scene + (sl.id === ch.easySub ? "-easy" : "-hard");
  }

  function buildStall(sl) {
    currentSceneKey = sceneKeyFor(sl);
    const gems = [];
    gems.push({ data: sl.correctGem, isCorrect: true, wrong: false });
    (sl.wrongGems || []).slice(0, 3).forEach((w) => gems.push({ data: w, isCorrect: false, wrong: false }));
    shuffle(gems);
    state.gems = gems;

    const container = $("#gems-container");
    container.innerHTML = "";
    gems.forEach((g, i) => {
      const el = document.createElement("div");
      el.className = "gem";
      el.dataset.index = i;
      el.addEventListener("mouseenter", () => setHover(i, true));
      el.addEventListener("mouseleave", () => setHover(i, false));
      el.addEventListener("click", () => onGemClick(i));
      container.appendChild(el);
    });
    layoutGems();
  }

  function layoutGems() {
    const scene = $("#stall-scene");
    if (!scene) return;
    const orient = isPortraitScreen() ? "portrait" : "landscape";
    const map = SCENES[currentSceneKey] || SCENES.overview;
    scene.style.backgroundImage = 'url("' + map[orient] + '")';
    const size = SCENE_SIZE[orient];
    const spots = SCENE_SPOTS[orient];
    const rect = scene.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (!W || !H) return;
    const scale = Math.max(W / size.w, H / size.h);
    const dispW = size.w * scale, dispH = size.h * scale;
    const offX = (W - dispW) / 2, offY = (H - dispH) / 2;
    $$("#gems-container .gem").forEach((el, i) => {
      const spot = spots[i % spots.length];
      el.style.left = (offX + spot.fx * dispW) + "px";
      el.style.top = (offY + spot.fy * dispH) + "px";
    });
  }

  function setHover(i, on) {
    const el = $$("#gems-container .gem")[i];
    if (!el || el.classList.contains("wrong")) return;
    el.classList.toggle("hovered", on);
    state.hovered = on ? i : null;
  }

  function onGemClick(i) {
    const el = $$("#gems-container .gem")[i];
    if (!el || el.classList.contains("wrong")) return;
    const g = state.gems[i];
    state.inspecting = i;
    $("#gem-popup-title").textContent = g.data.title;
    $("#gem-popup-content").textContent = g.data.content;
    $("#gem-popup").classList.remove("hidden");
  }

  function closeGemPopup() { $("#gem-popup").classList.add("hidden"); }

  function confirmGem() {
    if (state.inspecting == null) return;
    const i = state.inspecting;
    const g = state.gems[i];
    closeGemPopup();
    if (g.isCorrect) onCorrect(i);
    else onWrong(i);
  }

  function onCorrect(i) {
    markGem(i, "correct");
    const k = key(state.chapterId, state.subId);
    const firstTime = !state.done[k];
    if (firstTime) {
      state.done[k] = true;
      state.coins += 1;
      save(LS.done, state.done);
      save(LS.coins, state.coins);
    }
    updateHud();

    const ch = chapterById[state.chapterId];
    const idx = ch.subLevels.findIndex((s) => s.id === state.subId);
    const next = idx >= 0 && idx < ch.subLevels.length - 1 ? ch.subLevels[idx + 1] : null;
    const msg = firstTime ? "答对了！获得 1 枚金币 🪙" : "答对了！（本关金币已获得过）";

    const chapterIdx = DATA.chapters.indexOf(ch);
    if (isChapterDone(ch)) {
      const rewardIdxs = (REWARD_SEGS[chapterIdx] || []).filter((i2) => !state.storyDone[i2]);
      if (rewardIdxs.length > 0) {
        playStories(rewardIdxs, () => {
          const allDone = DATA.chapters.every((c) => isChapterDone(c));
          if (allDone) {
            openModal("🎉 全部完成", "所有大关卡完成，全部剧情已解锁！可在主页「剧情回顾」阅读整个故事。", [
              { label: "查看剧情", cls: "primary", onClick: () => showStoryReview() },
              { label: "返回主页", cls: "ghost", onClick: goHome },
            ]);
          } else {
            goHome();
          }
        });
        return;
      }
    }

    openModal("🎉 答对了", msg, next
      ? [{ label: "进入下一关", cls: "primary", onClick: () => startSubLevel(ch.id, next.id) }]
      : [{ label: "本章完成，返回关卡", cls: "primary", onClick: () => showSubLevels(ch.id) }]
    );
  }

  function onWrong(i) {
    state.wrong += 1;
    markGem(i, "wrong");
    updateHud();
    if (state.wrong >= 3) {
      openModal("😞 通关失败", "你已经选错 3 次了，本次关卡未通过。", [
        { label: "再来一次", cls: "primary", onClick: () => startSubLevel(state.chapterId, state.subId) },
        { label: "返回主页", cls: "ghost", onClick: goHome },
      ]);
    } else {
      toast("选错了！还可错 " + (3 - state.wrong) + " 次", "warn");
    }
  }

  function markGem(i, cls) {
    const el = $$("#gems-container .gem")[i];
    if (el) { el.classList.add(cls); el.classList.remove("hovered"); }
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    $("#hud-coins").textContent = state.coins;
    const left = 3 - state.wrong; // 还可错几次（>0 时显示）
    let hearts = "";
    for (let i = 0; i < 2; i++) hearts += i < Math.max(left, 0) ? "❤️" : "🤍";
    $("#hud-lives").textContent = hearts;
  }

  /* ---------------- 建设（生活状况 + 升级） ---------------- */
  function renderLife() {
    const tier = DATA.lifeTiers[currentTier()];
    $("#life-tier-name").textContent = tier.name;
    $("#life-desc").textContent = "当前服饰：" + tier.clothes + " · 当前住所：" + tier.house;
    const stageImg = $("#life-stage-img");
    if (stageImg) stageImg.style.backgroundImage = 'url("' + tier.image + '")';

    const maxIdx = DATA.lifeTiers.length - 1;
    const isMax = currentTier() >= maxIdx;
    const nextThreshold = isMax ? null : THRESHOLDS[currentTier()];
    const pct = nextThreshold ? Math.min(100, Math.round(state.coins / nextThreshold * 100)) : 100;
    $("#life-progress").style.setProperty("--w", pct + "%");
    $("#life-progress-text").textContent = isMax
      ? "已满级！累计金币 " + state.coins
      : "金币 " + state.coins + " / " + nextThreshold + "（再得 " + Math.max(nextThreshold - state.coins, 0) + " 枚可升级）";

    const list = $("#life-tiers-list");
    list.innerHTML = "";
    DATA.lifeTiers.forEach((t, i) => {
      const chip = document.createElement("div");
      chip.className = "tier-chip" + (i === currentTier() ? " current" : "") + (i <= currentTier() ? " reached" : "");
      chip.innerHTML = '<span class="tier-dot"></span>' + t.name;
      list.appendChild(chip);
    });

    const upBtn = $("#btn-upgrade");
    const canUp = !isMax && state.coins >= nextThreshold;
    upBtn.disabled = !canUp;
    if (isMax) upBtn.textContent = "已达顶富";
    else if (canUp) upBtn.textContent = "升级 → " + DATA.lifeTiers[currentTier() + 1].name;
    else upBtn.textContent = "还差 " + (nextThreshold - state.coins) + " 枚金币";
  }

  function tryUpgrade() {
    const maxIdx = DATA.lifeTiers.length - 1;
    if (currentTier() >= maxIdx) return;
    const need = THRESHOLDS[currentTier()];
    if (state.coins < need) { toast("金币不足：还差 " + (need - state.coins) + " 枚"); return; }
    state.tier = currentTier() + 1;
    save(LS.tier, state.tier);
    renderLife();
    renderHome();
    toast("升级成功！生活状况 → " + DATA.lifeTiers[state.tier].name);
  }

  /* ---------------- 导航 ---------------- */
  function goHome() { renderHome(); show("screen-home"); }
  function goStart() {
    if (!state.prologueSeen && STORY.length > 0) {
      showStoryChapter(0, () => {
        localStorage.setItem(LS.prologue, "1");
        state.prologueSeen = true;
        renderChapters();
        show("screen-levels");
      });
    } else {
      show("screen-levels");
    }
  }

  /* ---------------- 玩法说明 ---------------- */
  const HELP_TEXT =
    "1. 每个小关卡里，摊子上有许多宝石，其中只有一颗藏着「正确的知识点」。\n" +
    "2. 用放大镜（鼠标）指向宝石会放大，点击宝石可查看它显示的知识内容。\n" +
    "3. 认定后点击「确认选择」：选对得 1 枚金币并过关；选错则扣除一次机会。\n" +
    "4. 每关最多允许选错 2 次，第 3 次选错即通关失败，可再来一次或返回主页。\n" +
    "5. 在首页点「建设」查看生活状况，金币达到下一档门槛后点「升级」即可改善生活：一穷二白 → 贫困户 → 小康 → 中产 → 暴发户 → 顶富。";

  function showKnowledge() {
    let html = "";
    DATA.chapters.forEach((ch) => {
      html += '<div class="kn-chapter"><h3>' + ch.icon + " " + ch.name + "</h3>";
      ch.subLevels.forEach((sl) => {
        html += '<div class="kn-item"><div class="kn-title">' + sl.name + '</div><div class="kn-content">' + sl.correctGem.content + "</div></div>";
      });
      html += "</div>";
    });
    openHtmlModal("知识点说明", '<div class="kn-list">' + html + "</div>", [{ label: "关闭", cls: "primary" }]);
  }

  function isStoryUnlocked(i) {
    return !!state.storyDone[i];
  }

  function showStoryReview(focusIndex) {
    let html = '<div class="story-review">';
    STORY.forEach((seg, i) => {
      if (isStoryUnlocked(i)) {
        html += '<div class="story-seg"><h3>' + seg.title + '</h3>' +
          seg.paragraphs.map((p) => "<p>" + p + "</p>").join("") + "</div>";
      } else {
        html += '<div class="story-seg locked"><h3>🔒 ' + seg.title + '</h3>' +
          '<p class="story-lock-hint">完成对应的大关卡后解锁。</p></div>';
      }
    });
    html += "</div>";
    openHtmlModal("剧情回顾", html, [{ label: "关闭", cls: "primary" }]);
    if (typeof focusIndex === "number") {
      setTimeout(() => {
        const el = $$(".story-seg")[focusIndex];
        if (el) el.scrollIntoView({ block: "start" });
      }, 60);
    }
  }

  function showCredits() {
    const html =
      '<div class="credits">' +
      '<div class="credit-row"><span>制作人</span><b>刘晨鹏</b></div>' +
      '<div class="credit-row"><span>制作</span><b>deep seek</b></div>' +
      '<div class="credit-row"><span>画面</span><b>豆包</b></div>' +
      "</div>";
    openHtmlModal("制作构成", html, [{ label: "关闭", cls: "primary" }]);
  }

  /* ---------------- 放大镜跟随 ---------------- */
  function bindMagnifier() {
    const scene = $("#stall-scene");
    const mag = $("#magnifier");
    scene.addEventListener("mousemove", (e) => {
      mag.classList.remove("hidden");
      mag.style.left = e.clientX + "px";
      mag.style.top = e.clientY + "px";
    });
    scene.addEventListener("mouseleave", () => mag.classList.add("hidden"));
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $("#prologue-next").addEventListener("click", finishStory);
    $("#prologue-skip").addEventListener("click", finishStory);

    $("#btn-start").addEventListener("click", () => { renderChapters(); goStart(); });
    $("#btn-build").addEventListener("click", () => { renderLife(); show("screen-life"); });
    $("#btn-help").addEventListener("click", () => openModal("玩法说明", HELP_TEXT, [{ label: "我知道了", cls: "primary" }]));
    $("#btn-knowledge").addEventListener("click", showKnowledge);
    $("#btn-story").addEventListener("click", () => showStoryReview());
    $("#btn-credits").addEventListener("click", showCredits);
    $("#btn-upgrade").addEventListener("click", tryUpgrade);

    $("#btn-back-home").addEventListener("click", goHome);
    $("#btn-back-home-2").addEventListener("click", goHome);
    $("#btn-back-levels").addEventListener("click", () => { renderChapters(); show("screen-levels"); });

    $("#btn-confirm-gem").addEventListener("click", confirmGem);
    $("#btn-close-gem").addEventListener("click", closeGemPopup);

    $("#modal").addEventListener("click", (e) => { if (e.target === $("#modal")) closeModal(); });

    bindMagnifier();
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    bind();
    window.addEventListener("resize", layoutGems);
    // 前传（竹篮）从开始即解锁
    if (!state.storyDone[0]) {
      state.storyDone[0] = true;
      save(LS.story, state.storyDone);
    }
    renderHome();
    show("screen-home");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
