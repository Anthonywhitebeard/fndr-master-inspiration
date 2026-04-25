const MODULE_ID = "inspiration-points";
const FLAG_SCOPE = MODULE_ID;
const STATE_FLAG = "state";
const TAB_NAME = "ipm-players";
const APPLICATION_ROLL_DELAY_MS = 950;

const runtime = {
  sidebarElement: null,
  seenEventIds: new Map()
};

Hooks.once("ready", () => {
  document.addEventListener("click", onDocumentClick);
  renderPlayersTab();
});

Hooks.on("renderSidebar", (_app, html) => {
  runtime.sidebarElement = normalizeElement(html);
  renderPlayersTab();
});

Hooks.on("renderApplicationV2", (app, element) => {
  const name = app?.constructor?.name;
  if (name === "Sidebar") {
    runtime.sidebarElement = normalizeElement(element);
    renderPlayersTab();
    return;
  }

  if (name === "ChatMessage5e" || name === "ChatMessage") {
    renderPlayersTab();
  }
});

Hooks.on("updateActor", (actor, changed) => {
  if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${STATE_FLAG}`)) {
    renderPlayersTab();
    maybePlayAnimation(actor, changed);
    return;
  }

  renderPlayersTab();
});

Hooks.on("createActor", () => renderPlayersTab());
Hooks.on("deleteActor", () => renderPlayersTab());
Hooks.on("updateUser", () => renderPlayersTab());
Hooks.on("renderChatLog", () => renderPlayersTab());
Hooks.on("createChatMessage", () => renderPlayersTab());
Hooks.on("deleteChatMessage", () => renderPlayersTab());

async function onDocumentClick(event) {
  const tabButton = event.target?.closest?.("[data-ipm-sidebar-tab]");
  if (tabButton) {
    event.preventDefault();
    event.stopPropagation();
    activatePlayersTab();
    return;
  }

  const button = event.target?.closest?.("[data-ipm-action]");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const action = button.dataset.ipmAction;
  const actorId = button.dataset.actorId;
  if (!action || !actorId) return;

  const actor = game.actors?.get(actorId);
  if (!actor) return;

  button.disabled = true;
  try {
    if (action === "give") {
      await grantInspiration(actor);
      return;
    }

    if (action === "spend") {
      await spendInspiration(actor, 1, "reroll");
      return;
    }

    if (action === "critical") {
      await spendInspiration(actor, 2, "critical");
    }
  } finally {
    button.disabled = false;
  }
}

function renderPlayersTab() {
  const sidebar = getSidebarElement();
  if (!sidebar) return;

  ensurePlayersTab(sidebar);

  const panel = sidebar.querySelector("[data-ipm-panel='players']");
  if (!panel) return;

  panel.innerHTML = buildPlayersTabMarkup();
  bindPanelInteractions(panel);
}

function ensurePlayersTab(sidebar) {
  const referenceTab = getReferenceSidebarTab(sidebar);
  const referenceTabItem = referenceTab?.closest?.("li");
  const referencePanel = getReferenceSidebarPanel(sidebar);
  const tabParent = referenceTabItem?.parentElement ?? referenceTab?.parentElement;
  const panelParent = referencePanel?.parentElement;
  if (!referenceTab || !referencePanel || !tabParent || !panelParent) return;

  cleanupDuplicateTabs(tabParent);
  cleanupDuplicatePanels(panelParent);

  if (!tabParent.querySelector("[data-ipm-sidebar-tab='players']")) {
    const button = buildSidebarTabElement(referenceTabItem ?? referenceTab);
    const icon = document.createElement("i");
    icon.className = "fas fa-users";
    const clickTarget = button.querySelector("[data-ipm-sidebar-tab]") ?? button;
    clickTarget.replaceChildren(icon);
    clickTarget.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activatePlayersTab();
    });
    const collapseItem = [...tabParent.children].find((element) =>
      element.querySelector?.("[data-action='collapse'], [data-action='toggleCollapse'], .fa-caret-left, .fa-chevron-left")
    );
    if (collapseItem) {
      tabParent.insertBefore(button, collapseItem);
    } else {
      tabParent.appendChild(button);
    }
  }

  if (!panelParent.querySelector("[data-ipm-panel='players']")) {
    const panel = referencePanel.cloneNode(false);
    panel.classList.add("ipm-sidebar-panel");
    panel.classList.remove("active");
    panel.dataset.tab = TAB_NAME;
    panel.dataset.group = referencePanel.dataset.group || "primary";
    panel.dataset.ipmPanel = "players";
    panel.innerHTML = "";
    panelParent.appendChild(panel);
  }
}

function activatePlayersTab() {
  const sidebar = getSidebarElement();
  if (!sidebar) return;

  const navItems = sidebar.querySelectorAll("[data-tab][data-group]");
  const panels = sidebar.querySelectorAll(".tab[data-tab][data-group]");

  for (const item of navItems) {
    item.classList.toggle("active", item.dataset.tab === TAB_NAME);
  }

  for (const panel of panels) {
    panel.classList.toggle("active", panel.dataset.tab === TAB_NAME);
  }
}

function bindPanelInteractions(panel) {
  for (const button of panel.querySelectorAll("[data-ipm-action]")) {
    button.addEventListener("click", onActionButtonClick);
  }

  for (const button of panel.querySelectorAll("[data-ipm-set-points]")) {
    button.addEventListener("click", onSetPointsClick);
  }
}

function buildPlayersTabMarkup() {
  const actors = getTrackedActors();
  const list = actors.map((actor) => renderActorRow(actor)).join("");

  return `
    <div class="ipm-players-root">
      <header class="ipm-players-header">
        <div>
          <div class="ipm-players-kicker">${escapeHtml(game.i18n.localize("IPM.Tab.Kicker"))}</div>
          <h2 class="ipm-players-title">${escapeHtml(game.i18n.localize("IPM.Tab.Title"))}</h2>
        </div>
        <div class="ipm-players-subtitle">${escapeHtml(game.i18n.localize("IPM.Tab.Subtitle"))}</div>
      </header>
      <div class="ipm-players-list">
        ${list || `<div class="ipm-empty">${escapeHtml(game.i18n.localize("IPM.Tab.Empty"))}</div>`}
      </div>
    </div>
  `;
}

function renderActorRow(actor) {
  const state = getActorState(actor);
  const canGive = game.user.isGM;
  const canSpend = canCurrentUserSpend(actor);
  const owners = getActorOwners(actor).map((user) => user.name).join(", ");
  const lastMessage = findLatestRollMessage(actor);
  const lastRollLabel = getLastRollLabel(lastMessage);
  const portrait = actor.img || "icons/svg/mystery-man.svg";

  return `
    <article class="ipm-player-card" data-ipm-actor-card="${escapeAttribute(actor.id)}">
      <div class="ipm-card-main">
        <div class="ipm-card-identity">
          <img class="ipm-card-portrait" src="${escapeAttribute(portrait)}" alt="${escapeAttribute(actor.name)}">
          <div class="ipm-card-copy">
            <div class="ipm-card-name">${escapeHtml(actor.name)}</div>
            <div class="ipm-card-meta">${escapeHtml(owners || game.i18n.localize("IPM.Actor.NoOwner"))}</div>
            <div class="ipm-card-roll">${escapeHtml(lastRollLabel)}</div>
          </div>
        </div>
        <div class="ipm-card-score">
          <div class="ipm-score-label">${escapeHtml(game.i18n.localize("IPM.Counter.Label"))}</div>
          <div class="ipm-score-value">
            <i class="fas fa-star ipm-score-icon"></i>
            <span>${state.points}</span>
          </div>
          ${canGive ? renderPointsEditor(actor.id, state.points) : ""}
        </div>
      </div>
      <div class="ipm-card-actions">
        ${canGive ? renderActionButton("give", actor.id, "is-give", "fa-gift", "IPM.Button.Give", false, "") : ""}
        ${canSpend ? renderActionButton("spend", actor.id, "is-spend", "fa-undo", "IPM.Button.Spend", state.points < 1, "IPM.Button.SpendHint") : ""}
        ${canSpend ? renderActionButton("critical", actor.id, "is-crit", "fa-hourglass-end", "IPM.Button.Critical", state.points < 2, "IPM.Button.CriticalHint") : ""}
      </div>
      <div class="ipm-fx-host" data-ipm-fx-host="true"></div>
    </article>
  `;
}

function renderActionButton(action, actorId, className, icon, labelKey, disabled, hintKey) {
  const title = hintKey ? game.i18n.localize(hintKey) : "";
  return `
    <button
      type="button"
      class="ipm-button ${className}"
      data-ipm-action="${escapeAttribute(action)}"
      data-actor-id="${escapeAttribute(actorId)}"
      ${disabled ? "disabled" : ""}
      title="${escapeAttribute(title)}"
    >
      <i class="fas ${icon}"></i>
      <span>${escapeHtml(game.i18n.localize(labelKey))}</span>
    </button>
  `;
}

function renderPointsEditor(actorId, points) {
  return `
    <div class="ipm-points-editor">
      <input
        type="number"
        class="ipm-points-input"
        data-ipm-points-input="${escapeAttribute(actorId)}"
        value="${points}"
        min="0"
        step="1"
      >
      <button
        type="button"
        class="ipm-button ipm-set-button"
        data-ipm-set-points="${escapeAttribute(actorId)}"
      >${escapeHtml(game.i18n.localize("IPM.Button.Set"))}</button>
    </div>
  `;
}

async function onActionButtonClick(event) {
  event.preventDefault();
  event.stopPropagation();

  const button = event.currentTarget;
  const action = button.dataset.ipmAction;
  const actorId = button.dataset.actorId;
  if (!action || !actorId) return;

  const actor = game.actors?.get(actorId);
  if (!actor) return;

  button.disabled = true;
  try {
    if (action === "give") {
      await grantInspiration(actor);
      return;
    }

    if (action === "spend") {
      await spendInspiration(actor, 1, "reroll");
      return;
    }

    if (action === "critical") {
      await spendInspiration(actor, 2, "critical");
    }
  } finally {
    button.disabled = false;
  }
}

async function onSetPointsClick(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!game.user.isGM) return;

  const button = event.currentTarget;
  const actorId = button.dataset.ipmSetPoints;
  if (!actorId) return;

  const actor = game.actors?.get(actorId);
  const panel = button.closest("[data-ipm-panel='players']") ?? document;
  const input = panel.querySelector(`[data-ipm-points-input="${cssEscape(actorId)}"]`);
  if (!actor || !(input instanceof HTMLInputElement)) return;

  const value = Math.max(0, Number.parseInt(input.value, 10) || 0);
  button.disabled = true;
  try {
    await setActorState(actor, value, makeEvent("gain", 0));
    ui.notifications.info(game.i18n.format("IPM.Notification.Set", { actor: actor.name, points: value }));
  } finally {
    button.disabled = false;
  }
}

async function grantInspiration(actor) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("IPM.Notification.NoPermission"));
    return;
  }

  const state = getActorState(actor);
  await setActorState(actor, state.points + 1, makeEvent("gain", 1));
  ui.notifications.info(game.i18n.format("IPM.Notification.Gained", { actor: actor.name }));
}

async function spendInspiration(actor, cost, mode) {
  if (!canCurrentUserSpend(actor)) {
    ui.notifications.warn(game.i18n.localize("IPM.Notification.NoPermission"));
    return;
  }

  const state = getActorState(actor);
  if (state.points < cost) {
    ui.notifications.warn(game.i18n.localize("IPM.Notification.NotEnough"));
    return;
  }

  const sourceMessage = findLatestRollMessage(actor);
  if (!sourceMessage) {
    ui.notifications.warn(game.i18n.format("IPM.Notification.NoRoll", { actor: actor.name }));
    return;
  }

  const baseRoll = getMessagePrimaryRoll(sourceMessage);
  if (!baseRoll) {
    ui.notifications.warn(game.i18n.format("IPM.Notification.NoRoll", { actor: actor.name }));
    return;
  }

  try {
    let rerolled = await baseRoll.reroll({ allowInteractive: false });

    if (mode === "critical") {
      const promoted = forceCriticalResult(rerolled);
      if (!promoted) {
        ui.notifications.warn(game.i18n.format("IPM.Notification.NoD20", { actor: actor.name }));
        return;
      }
      rerolled = promoted;
    }

    await setActorState(actor, state.points - cost, makeEvent(mode, cost));
    await wait(APPLICATION_ROLL_DELAY_MS);
    await ChatMessage.create(await buildRerollMessageData(actor, sourceMessage, rerolled, mode));

    const key = mode === "critical" ? "IPM.Notification.CriticalSpent" : "IPM.Notification.Spent";
    ui.notifications.info(game.i18n.format(key, { actor: actor.name }));
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to spend inspiration`, error);
    ui.notifications.error(game.i18n.localize("IPM.Notification.Failed"));
  }
}

async function buildRerollMessageData(actor, sourceMessage, roll, mode) {
  const source = sourceMessage.toObject();
  delete source._id;

  const flavorNote = mode === "critical"
    ? game.i18n.format("IPM.Chat.CriticalFlavor", { actor: actor.name })
    : game.i18n.format("IPM.Chat.RerollFlavor", { actor: actor.name });

  const renderedRoll = await roll.render();
  const cleanContent = stripInspirationNotes(source.content ?? "");
  const content = `
    ${cleanContent}
    <div class="ipm-chat-note">${escapeHtml(flavorNote)}</div>
    ${renderedRoll}
  `.trim();

  source.user = game.user.id;
  source.timestamp = Date.now();
  source.content = content;
  source.rolls = [roll];
  source.flavor = sourceMessage.flavor ?? "";
  source.flags = foundry.utils.mergeObject(source.flags ?? {}, {
    [MODULE_ID]: {
      spentMode: mode,
      sourceMessageId: sourceMessage.id,
      actorId: actor.id
    }
  }, { inplace: false });

  return source;
}

function maybePlayAnimation(actor, changed) {
  const event = foundry.utils.getProperty(changed, `flags.${MODULE_ID}.${STATE_FLAG}.lastEvent`);
  if (!event?.id) return;
  if (runtime.seenEventIds.get(actor.id) === event.id) return;
  runtime.seenEventIds.set(actor.id, event.id);

  for (const card of document.querySelectorAll(`[data-ipm-actor-card="${cssEscape(actor.id)}"]`)) {
    playCardAnimation(card, event.type);
  }

  playGlobalAnimation(event.type);
}

function playCardAnimation(card, type) {
  const host = card.querySelector("[data-ipm-fx-host='true']");
  if (!host) return;

  if (type !== "gain") {
    card.classList.remove("is-animating-gain", "is-animating-spend", "is-animating-crit");
    card.classList.add(type === "critical" ? "is-animating-crit" : "is-animating-spend");

    window.setTimeout(() => {
      card.classList.remove("is-animating-gain", "is-animating-spend", "is-animating-crit");
    }, 3100);
    return;
  }

  const layer = document.createElement("div");
  layer.className = "ipm-fx-burst";

  host.appendChild(layer);
  card.classList.remove("is-animating-gain", "is-animating-spend", "is-animating-crit");
  card.classList.add("is-animating-gain");

  window.setTimeout(() => {
    layer.remove();
    card.classList.remove("is-animating-gain", "is-animating-spend", "is-animating-crit");
  }, 1400);
}

function playGlobalAnimation(type) {
  const overlay = document.createElement("div");
  overlay.className = `ipm-screen-fx is-${type === "gain" ? "gain" : type === "critical" ? "crit" : "spend"}`;
  if (type !== "gain") overlay.appendChild(buildScreenTimeSweep(type));
  document.body.appendChild(overlay);
  window.setTimeout(() => overlay.remove(), type === "gain" ? 1100 : 3200);
}

function getTrackedActors() {
  const actors = [];
  for (const actor of game.actors ?? []) {
    if (!shouldTrackActor(actor)) continue;
    actors.push(actor);
  }

  actors.sort((left, right) => left.name.localeCompare(right.name, game.i18n.lang));
  return actors;
}

function shouldTrackActor(actor) {
  if (!actor?.id) return false;
  return Boolean(actor.hasPlayerOwner || actor.type === "character");
}

function getActorOwners(actor) {
  return (game.users ?? []).filter(
    (user) =>
      !user.isGM &&
      actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
  );
}

function canCurrentUserSpend(actor) {
  if (!actor || game.user.isGM) return false;
  return actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
}

function getActorState(actor) {
  const stored = actor?.getFlag(FLAG_SCOPE, STATE_FLAG) ?? {};
  return {
    points: Math.max(0, Number(stored.points) || 0),
    lastEvent: stored.lastEvent ?? null
  };
}

async function setActorState(actor, points, lastEvent) {
  return actor.setFlag(FLAG_SCOPE, STATE_FLAG, {
    points: Math.max(0, Number(points) || 0),
    lastEvent
  });
}

function makeEvent(type, amount) {
  return {
    id: foundry.utils.randomID(),
    type,
    amount,
    at: Date.now(),
    userId: game.user.id
  };
}

function findLatestRollMessage(actor) {
  const messages = game.messages?.contents ?? [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message?.isRoll) continue;
    if (!message.visible) continue;

    const speakerActor = message.speakerActor;
    if (speakerActor?.id === actor.id) return message;
    if (message.speaker?.actor === actor.id) return message;
  }

  return null;
}

function getMessagePrimaryRoll(message) {
  if (!message?.isRoll) return null;
  const rolls = Array.isArray(message.rolls) ? message.rolls : [];
  return rolls[0] ?? null;
}

function getLastRollLabel(message) {
  if (!message) return game.i18n.localize("IPM.Roll.None");

  const label = [
    message.flavor,
    message.alias
  ].find((entry) => String(entry ?? "").trim());

  return label ? game.i18n.format("IPM.Roll.Last", { label }) : game.i18n.localize("IPM.Roll.Generic");
}

function forceCriticalResult(roll) {
  const d20 = (roll.dice ?? []).find((term) => Number(term.faces) === 20 && Array.isArray(term.results) && term.results.length);
  if (!d20) return null;

  const activeResult = d20.results.find((result) => result.active !== false) ?? d20.results[0];
  if (!activeResult) return null;

  const previous = Number(activeResult.result) || 0;
  activeResult.result = 20;
  activeResult.active = true;
  activeResult.hidden = false;

  const delta = 20 - previous;
  if (Number.isFinite(delta) && "_total" in roll) {
    roll._total = (Number(roll.total) || 0) + delta;
  }

  if (roll.options) roll.options.ipmForcedCritical = true;
  return roll;
}

function stripInspirationNotes(content) {
  return String(content ?? "").replace(/<div class="ipm-chat-note">[\s\S]*?<\/div>/g, "").trim();
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildTimeRing(kind) {
  const ring = document.createElement("div");
  ring.className = `ipm-fx-time-ring is-${kind}`;
  return ring;
}

function buildTimeGear(side) {
  const gear = document.createElement("div");
  gear.className = `ipm-fx-time-gear is-${side}`;
  gear.innerHTML = `<i class="fas fa-cog"></i>`;
  return gear;
}

function buildTimeTrail() {
  const trail = document.createElement("div");
  trail.className = "ipm-fx-time-trail";
  return trail;
}

function buildTimeGlyphs(kind) {
  const glyphs = document.createElement("div");
  glyphs.className = `ipm-fx-time-glyphs is-${kind}`;
  glyphs.innerHTML = `
    <span>XII</span>
    <span>IX</span>
    <span>VI</span>
    <span>III</span>
  `;
  return glyphs;
}

function buildTimeParticles(kind) {
  const particles = document.createElement("div");
  particles.className = `ipm-fx-time-particles is-${kind}`;
  for (let index = 0; index < 12; index += 1) {
    const particle = document.createElement("span");
    particle.style.setProperty("--ipm-particle-index", String(index));
    particles.appendChild(particle);
  }
  return particles;
}

function buildScreenTimeSweep(type) {
  const sweep = document.createElement("div");
  sweep.className = `ipm-screen-time-sweep is-${type === "critical" ? "crit" : "rewind"}`;
  if (type === "critical") {
    const mark = document.createElement("div");
    mark.className = "ipm-screen-crit-mark";
    mark.textContent = "CRIT";
    sweep.appendChild(mark);
    sweep.appendChild(buildScreenTimeGlyphs());
  } else {
    const clock = document.createElement("div");
    clock.className = "ipm-screen-clock";
    clock.innerHTML = `<i class="fas fa-hourglass-half"></i>`;
    sweep.appendChild(clock);
    sweep.appendChild(buildScreenTimeGears());
  }

  sweep.appendChild(buildScreenTimeRings(type));
  sweep.appendChild(buildScreenTimeParticles(type));
  return sweep;
}

function buildScreenTimeRings(type) {
  const wrapper = document.createElement("div");
  wrapper.className = `ipm-screen-time-rings is-${type === "critical" ? "crit" : "rewind"}`;
  wrapper.innerHTML = `
    <div class="ipm-screen-time-ring is-outer"></div>
    <div class="ipm-screen-time-ring is-middle"></div>
    <div class="ipm-screen-time-ring is-inner"></div>
  `;
  return wrapper;
}

function buildScreenTimeParticles(type) {
  const particles = document.createElement("div");
  particles.className = `ipm-screen-time-particles is-${type === "critical" ? "crit" : "rewind"}`;
  for (let index = 0; index < 18; index += 1) {
    const particle = document.createElement("span");
    particle.style.setProperty("--ipm-screen-particle-index", String(index));
    particles.appendChild(particle);
  }
  return particles;
}

function buildScreenTimeGlyphs() {
  const glyphs = document.createElement("div");
  glyphs.className = "ipm-screen-time-glyphs";
  glyphs.innerHTML = `
    <span>XII</span>
    <span>IX</span>
    <span>VI</span>
    <span>III</span>
  `;
  return glyphs;
}

function buildScreenTimeGears() {
  const gears = document.createElement("div");
  gears.className = "ipm-screen-time-gears";
  gears.innerHTML = `
    <div class="ipm-screen-time-gear is-left"><i class="fas fa-cog"></i></div>
    <div class="ipm-screen-time-gear is-right"><i class="fas fa-cog"></i></div>
  `;
  return gears;
}

function getSidebarElement() {
  if (runtime.sidebarElement?.isConnected) return runtime.sidebarElement;

  const candidates = [
    ui.sidebar?.element,
    document.querySelector("#sidebar"),
    document.querySelector(".sidebar")
  ];

  for (const candidate of candidates) {
    const element = normalizeElement(candidate);
    if (element?.isConnected) {
      runtime.sidebarElement = element;
      return element;
    }
  }

  return null;
}

function getReferenceSidebarTab(sidebar) {
  return (
    sidebar.querySelector("#sidebar-tabs > li") ??
    sidebar.querySelector("#sidebar-tabs [data-tab='chat']") ??
    sidebar.querySelector("[data-tab='chat'][data-group]") ??
    sidebar.querySelector("#sidebar-tabs [data-tab]") ??
    sidebar.querySelector("nav [data-tab]")
  );
}

function getReferenceSidebarPanel(sidebar) {
  return (
    sidebar.querySelector("#sidebar-content .tab[data-tab='chat']") ??
    sidebar.querySelector(".tab[data-tab='chat'][data-group]") ??
    sidebar.querySelector("#sidebar-content .tab[data-tab]") ??
    sidebar.querySelector(".tab[data-tab]")
  );
}

function normalizeElement(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  if (value?.element instanceof HTMLElement) return value.element;
  if (value?.element?.[0] instanceof HTMLElement) return value.element[0];
  return null;
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replaceAll('"', '\\"');
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function buildSidebarTabElement(referenceTab) {
  if (referenceTab.tagName === "LI") {
    const item = document.createElement("li");
    item.className = stripChatIconClasses(referenceTab.className);
    item.classList.add("ipm-sidebar-nav-item");
    item.classList.remove("active");
    item.removeAttribute("aria-pressed");
    item.removeAttribute("aria-label");
    item.removeAttribute("aria-controls");
    item.removeAttribute("data-tooltip");

    const inner = referenceTab.querySelector("[data-tab][data-group]")?.cloneNode(false) ?? document.createElement("a");
    inner.className = stripChatIconClasses(inner.className || "item");
    inner.dataset.tab = TAB_NAME;
    inner.dataset.group = inner.dataset.group || "primary";
    inner.dataset.ipmSidebarTab = TAB_NAME;
    inner.removeAttribute("data-action");
    inner.setAttribute("data-tooltip", game.i18n.localize("IPM.Tab.Title"));
    inner.setAttribute("aria-label", game.i18n.localize("IPM.Tab.Title"));
    inner.title = game.i18n.localize("IPM.Tab.Title");
    item.appendChild(inner);
    return item;
  }

  const button = document.createElement(referenceTab.tagName.toLowerCase());
  button.className = stripChatIconClasses(referenceTab.className);
  button.classList.add("ipm-sidebar-nav-item");
  button.classList.remove("active");
  button.dataset.tab = TAB_NAME;
  button.dataset.group = referenceTab.dataset.group || "primary";
  button.dataset.ipmSidebarTab = TAB_NAME;
  button.removeAttribute("data-action");
  button.setAttribute("data-tooltip", game.i18n.localize("IPM.Tab.Title"));
  button.setAttribute("aria-label", game.i18n.localize("IPM.Tab.Title"));
  button.title = game.i18n.localize("IPM.Tab.Title");
  return button;
}

function stripChatIconClasses(className) {
  return String(className ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((entry) => !["fa-comments", "fa-comment"].includes(entry))
    .join(" ");
}

function cleanupDuplicateTabs(tabParent) {
  const matches = [...tabParent.querySelectorAll("[data-ipm-sidebar-tab], [data-tab='players'], [data-tab='ipm-players']")];
  let kept = false;

  for (const element of matches) {
    const tabItem = element.closest("li") ?? element;
    if (!kept && element.dataset.ipmSidebarTab === "players") {
      kept = true;
      continue;
    }

    tabItem.remove();
  }
}

function cleanupDuplicatePanels(panelParent) {
  const matches = [...panelParent.querySelectorAll("[data-ipm-panel='players'], .tab[data-tab='players'], .tab[data-tab='ipm-players']")];
  let kept = false;

  for (const panel of matches) {
    if (!kept && panel.dataset.ipmPanel === "players") {
      kept = true;
      continue;
    }

    panel.remove();
  }
}
