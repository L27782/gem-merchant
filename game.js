/* ============================================================================
 * 《宝石商人》游戏引擎  game.js
 * ============================================================================ */
(function () {
  "use strict";

  const DATA = window.GAME_DATA;
  const LS = {
    coins: "gem-merchant.coins",
    done: "gem-merchant.done",
    prologue: "gem-merchant.prologueSeen",
    tier: "gem-merchant.tier",
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

  /* ---------------- 前传 ---------------- */
  let pg = 0;
  function renderPrologue() {
    const seg = DATA.prologue[pg];
    const bg = $("#prologue-bg");
    const textEl = $("#prologue-text");
    if (seg && seg.image) {
      bg.style.backgroundImage = 'url("' + seg.image + '")';
    } else {
      bg.style.backgroundImage = "none";
    }
    if (seg && seg.noText) {
      textEl.classList.add("hidden");
    } else {
      textEl.classList.remove("hidden");
      textEl.innerHTML = seg
        ? '<div class="p-speaker">' + seg.speaker + '</div><p>' + seg.text + "</p>"
        : "";
    }
    $("#prologue-next").textContent = pg >= DATA.prologue.length - 1 ? "开始游戏" : "下一步 ▶";
  }

  /* ---------------- 主页 ---------------- */
  function renderHome() {
    const tier = DATA.lifeTiers[currentTier()];
    const houseEl = $("#home-house");
    const charEl = $("#home-char");
    if (houseEl) houseEl.className = "life-house house-" + tier.houseStyle;
    if (charEl) charEl.className = "life-character clothes-" + tier.clothesStyle;
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
    DATA.chapters.forEach((ch) => {
      const total = ch.subLevels.length;
      const passedCount = ch.subLevels.filter((s) => passed(ch.id, s.id)).length;
      const ready = !ch.pending && total > 0;
      const card = document.createElement("button");
      card.className = "chapter-card" + (ready ? "" : " pending");
      card.innerHTML =
        '<div class="chapter-icon">' + ch.icon + '</div>' +
        '<div class="chapter-name">' + ch.name + '</div>' +
        '<div class="chapter-progress">' + (ready ? passedCount + " / " + total : "待上线") + '</div>';
      if (ready) card.addEventListener("click", () => showSubLevels(ch.id));
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
    toast("找出正确的知识点宝石！");
  }

  function buildStall(sl) {
    const gems = [];
    gems.push({ data: sl.correctGem, isCorrect: true, wrong: false });
    (sl.wrongGems || []).forEach((w) => gems.push({ data: w, isCorrect: false, wrong: false }));
    shuffle(gems);
    state.gems = gems;

    const container = $("#gems-container");
    container.innerHTML = "";
    gems.forEach((g, i) => {
      const el = document.createElement("div");
      el.className = "gem gem-" + (i % 7);
      el.dataset.index = i;
      el.innerHTML = '<span class="gem-facet"></span>';
      el.addEventListener("mouseenter", () => setHover(i, true));
      el.addEventListener("mouseleave", () => setHover(i, false));
      el.addEventListener("click", () => onGemClick(i));
      container.appendChild(el);
    });
    layoutGems();
  }

  function layoutGems() {
    const els = $$("#gems-container .gem");
    const n = els.length;
    els.forEach((el, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const left = 10 + col * 26 + (row % 2 ? 6 : 0);
      const top = 62 - row * 26;
      el.style.left = left + "%";
      el.style.top = top + "%";
      el.style.transform = "rotate(" + (((i * 47) % 24) - 12) + "deg)";
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
    $("#life-house").className = "life-house house-" + tier.houseStyle;
    $("#life-character").className = "life-character clothes-" + tier.clothesStyle;

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
    if (!state.prologueSeen && DATA.prologue.length > 0) {
      pg = 0;
      renderPrologue();
      show("screen-prologue");
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
    $("#prologue-next").addEventListener("click", () => {
      if (pg >= DATA.prologue.length - 1) {
        localStorage.setItem(LS.prologue, "1");
        state.prologueSeen = true;
        renderChapters();
        show("screen-levels");
      } else {
        pg += 1;
        renderPrologue();
      }
    });
    $("#prologue-skip").addEventListener("click", () => {
      localStorage.setItem(LS.prologue, "1");
      state.prologueSeen = true;
      renderChapters();
      show("screen-levels");
    });

    $("#btn-start").addEventListener("click", () => { renderChapters(); goStart(); });
    $("#btn-build").addEventListener("click", () => { renderLife(); show("screen-life"); });
    $("#btn-help").addEventListener("click", () => openModal("玩法说明", HELP_TEXT, [{ label: "我知道了", cls: "primary" }]));
    $("#btn-knowledge").addEventListener("click", showKnowledge);
    $("#btn-credits").addEventListener("click", showCredits);
    $("#btn-prologue").addEventListener("click", () => { pg = 0; renderPrologue(); show("screen-prologue"); });
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
    if (DATA.prologue.length === 0) state.prologueSeen = true;
    renderHome();
    show("screen-home");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
