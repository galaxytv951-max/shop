(() => {
  "use strict";

  /* ============================================================
     Telegram
     ============================================================ */
  const tg = window.Telegram && window.Telegram.WebApp;
  const BG = "#07070b";

  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (_) {}
    try { tg.setHeaderColor && tg.setHeaderColor(BG); } catch (_) {}
    try { tg.setBackgroundColor && tg.setBackgroundColor(BG); } catch (_) {}
    try { tg.setBottomBarColor && tg.setBottomBarColor(BG); } catch (_) {}

    // Полноэкранный режим убирает верхнюю шапку (Bot API 8.0+). На десктопе не включаем.
    const mobile = ["android", "android_x", "ios"].includes(tg.platform);
    if (mobile && tg.isVersionAtLeast && tg.isVersionAtLeast("8.0") && tg.requestFullscreen && !tg.isFullscreen) {
      try { tg.requestFullscreen(); } catch (_) {}
    }
  }

  const haptic = (type = "light") => {
    try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(type); } catch (_) {}
  };
  const notify = (type = "success") => {
    try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(type); } catch (_) {}
  };

  /* ============================================================
     Данные и состояние
     ============================================================ */
  const { store, products, deliveries } = window.SHOP;
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const deliveryById = new Map(deliveries.map((d) => [d.id, d]));
  const ALL = "Все";
  const VIEWS = ["shop", "cart", "profile"];

  const fmt = (n) => Number(n).toLocaleString("ru-RU");
  const cur = store.currency;
  const money = (n) => `${fmt(n)}<small>${cur}</small>`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, a, b, c) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b;
    return c;
  };

  const load = (key, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (_) { return fallback; }
  };
  const persist = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} };

  let cart = load("shop_cart", {});
  for (const id of Object.keys(cart)) if (!byId.has(id)) delete cart[id];

  let profile = load("shop_profile", { name: "", phone: "", address: "" });
  let orders = load("shop_orders", []);
  let deliveryId = load("shop_delivery", deliveries[0].id);
  if (!deliveryById.has(deliveryId)) deliveryId = deliveries[0].id;

  const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  if (tgUser && !profile.name) {
    profile.name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
    persist("shop_profile", profile);
  }

  let category = ALL;
  let view = "shop";
  let sheetId = null;
  const scrollPos = { shop: 0, cart: 0, profile: 0 };
  const openOrders = new Set();

  const qtyOf = (id) => cart[String(id)] || 0;
  const totalCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
  const itemsSum = () => Object.entries(cart).reduce((s, [id, q]) => s + byId.get(id).price * q, 0);
  const deliveryPrice = (sum = itemsSum()) => {
    const d = deliveryById.get(deliveryId);
    if (store.freeDeliveryFrom && sum >= store.freeDeliveryFrom) return 0;
    return d.price;
  };

  /* ============================================================
     DOM
     ============================================================ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const grid = $("#grid"), chips = $("#chips"), chipsInd = $("#chips-ind");
  const cartList = $("#cart-list"), cartEmpty = $("#cart-empty"), checkoutBlock = $("#checkout-block");
  const deliveryBox = $("#delivery");
  const dock = $("#dock"), badge = $("#badge");
  const sheetWrap = $("#sheet-wrap"), sheet = $("#sheet"), sheetBody = $("#sheet-body");
  const toastEl = $("#toast");
  const ordersBox = $("#orders");

  $("#store-name").textContent = store.name;
  document.title = store.name;
  if (tgUser && tgUser.first_name) $("#hello").textContent = `Привет, ${tgUser.first_name}`;

  /* ---------- общие кирпичики ---------- */
  const pic = (p, i = 0, cls = "") => `
    <div class="pic ${cls}" style="--h:${Number(p.hue) || 260};--i:${i}">
      ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="emoji">${p.emoji || "📦"}</span>`}
    </div>`;

  const qtyControl = (id, size = "") => {
    const q = qtyOf(id);
    return `
      <div class="qty ${size} ${q ? "has" : ""}" data-qty="${id}">
        <button class="minus" data-action="dec" data-id="${id}" aria-label="Убрать">−</button>
        <span class="count">${q || ""}</span>
        <button class="plus" data-action="inc" data-id="${id}" aria-label="Добавить">+${size ? '<span class="label">Добавить</span>' : ""}</button>
      </div>`;
  };

  const moveInd = (ind, el) => {
    if (!el) return;
    ind.style.width = el.offsetWidth + "px";
    ind.style.transform = `translateX(${el.offsetLeft}px)`;
  };

  /* ============================================================
     Витрина
     ============================================================ */
  const categories = [ALL, ...new Set(products.map((p) => p.category).filter(Boolean))];

  function renderChips() {
    $$(".chip", chips).forEach((c) => c.remove());
    categories.forEach((c) => {
      const b = document.createElement("button");
      b.className = "chip" + (c === category ? " active" : "");
      b.textContent = c;
      b.dataset.action = "category";
      b.dataset.cat = c;
      chips.appendChild(b);
    });
    requestAnimationFrame(() => moveInd(chipsInd, $(".chip.active", chips)));
  }

  function renderGrid() {
    const list = category === ALL ? products : products.filter((p) => p.category === category);
    grid.innerHTML = list.map((p, i) => `
      <article class="card" data-action="open" data-id="${p.id}" style="--i:${i}">
        ${pic(p, i)}
        <div class="card-info">
          <div class="card-cat">${esc(p.category || "")}</div>
          <div class="card-name">${esc(p.name)}</div>
          <div class="card-foot">
            <span class="price">${money(p.price)}</span>
            ${qtyControl(p.id)}
          </div>
        </div>
      </article>`).join("");
  }

  /* ============================================================
     Корзина
     ============================================================ */
  function renderCart() {
    const ids = Object.keys(cart);
    cartList.innerHTML = ids.map((id, i) => {
      const p = byId.get(id), q = cart[id];
      return `
        <div class="row" data-row="${id}" style="--i:${i}">
          ${pic(p, i)}
          <div>
            <div class="row-name">${esc(p.name)}</div>
            <div class="row-price">${fmt(p.price)} ${cur}</div>
            <div class="row-sum" data-rowsum="${id}">${fmt(p.price * q)} ${cur}</div>
          </div>
          ${qtyControl(id)}
        </div>`;
    }).join("");
    syncCartMeta();
  }

  function renderDelivery() {
    deliveryBox.innerHTML = deliveries.map((d) => `
      <button class="dopt ${d.id === deliveryId ? "on" : ""}" data-action="delivery" data-id="${d.id}">
        <span class="dmark" style="--c:${d.color}">${esc(d.mark)}</span>
        <span><div class="dname">${esc(d.name)}</div><div class="dsub">${esc(d.sub)}</div></span>
        <span class="dprice" data-dprice="${d.id}"></span>
        <span class="radio"></span>
      </button>`).join("");
    syncDeliveryPrices();
  }

  function syncDeliveryPrices() {
    const free = store.freeDeliveryFrom && itemsSum() >= store.freeDeliveryFrom;
    deliveries.forEach((d) => {
      const el = $(`[data-dprice="${d.id}"]`);
      if (!el) return;
      el.textContent = free ? "Бесплатно" : `${fmt(d.price)} ${cur}`;
      el.classList.toggle("free", !!free);
    });
  }

  const bump = (el, html) => {
    if (el.dataset.v === html) return;
    el.dataset.v = html;
    el.innerHTML = `<span class="bump">${html}</span>`;
  };

  function syncCartMeta(delayVisibility = false) {
    const n = totalCount();
    const sum = itemsSum();
    const dp = deliveryPrice(sum);

    $("#cart-sub").textContent = n ? `${n} ${plural(n, "товар", "товара", "товаров")} в заказе` : "Ваш заказ";
    $("#sum-items-label").textContent = `Товары · ${n} шт.`;
    bump($("#sum-items"), `${fmt(sum)} ${cur}`);
    bump($("#sum-delivery"), dp === 0 ? "Бесплатно" : `${fmt(dp)} ${cur}`);
    bump($("#sum-total"), `${fmt(sum + dp)} ${cur}`);
    $("#checkout-btn").textContent = n ? `Оформить заказ · ${fmt(sum + dp)} ${cur}` : "Оформить заказ";

    // прогресс до бесплатной доставки
    const bar = $("#free-bar"), from = store.freeDeliveryFrom;
    if (from && n) {
      bar.hidden = false;
      const left = from - sum;
      $("#free-text").textContent = left > 0 ? `Ещё ${fmt(left)} ${cur} — и доставка бесплатно` : "Доставка бесплатная 🎉";
      $("#free-fill").style.width = Math.min(100, (sum / from) * 100) + "%";
    } else bar.hidden = true;

    syncDeliveryPrices();

    const apply = () => {
      const has = totalCount() > 0;
      cartEmpty.hidden = has;
      checkoutBlock.hidden = !has;
    };
    if (delayVisibility && n === 0) setTimeout(apply, 560); else apply();
  }

  /* ============================================================
     Количество
     ============================================================ */
  function setQty(id, q) {
    id = String(id);
    if (q <= 0) delete cart[id]; else cart[id] = Math.min(q, 99);
    persist("shop_cart", cart);
    syncUI(id);
  }

  function updateBadge() {
    const n = totalCount();
    const prev = badge.textContent;
    badge.textContent = n;
    badge.classList.toggle("show", n > 0);
    if (prev !== String(n)) { badge.classList.remove("pop"); void badge.offsetWidth; badge.classList.add("pop"); }
  }

  /* Обновляем «на месте» — анимации не обрываются */
  function syncUI(id) {
    const q = qtyOf(id);

    $$(`[data-qty="${id}"]`).forEach((el) => {
      if (el.closest(".row") && q === 0) return; // строка корзины уезжает — не трогаем вид
      el.classList.toggle("has", q > 0);
      const c = $(".count", el);
      const txt = q ? String(q) : "";
      if (c.textContent !== txt) {
        c.textContent = txt;
        c.classList.remove("pop"); void c.offsetWidth; c.classList.add("pop");
      }
    });

    const row = $(`[data-row="${id}"]`);
    if (row) {
      if (q === 0) {
        row.classList.add("removing");
        setTimeout(() => row.remove(), 560);
      } else {
        $(`[data-rowsum="${id}"]`).textContent = `${fmt(byId.get(id).price * q)} ${cur}`;
      }
    }

    updateBadge();
    syncCartMeta(true);
  }

  /* ============================================================
     Профиль и заказы
     ============================================================ */
  function renderMe() {
    const name = profile.name || (tgUser && tgUser.first_name) || "Покупатель";
    $("#me-name").textContent = name;
    $("#me-user").textContent = tgUser && tgUser.username ? "@" + tgUser.username : (profile.phone || "Данные ниже");
    const av = $("#avatar");
    if (tgUser && tgUser.photo_url) {
      av.innerHTML = `<img src="${esc(tgUser.photo_url)}" alt="">`;
      const img = $("img", av);
      img.onerror = () => { av.textContent = name.trim()[0] ? name.trim()[0].toUpperCase() : "?"; };
    } else {
      av.textContent = name.trim()[0] ? name.trim()[0].toUpperCase() : "?";
    }
  }

  /* Стадия заказа. Если бэкенд отдаёт order.stage (0–5) — берём его,
     иначе работает демо-режим по времени (store.demoStageSeconds). */
  const stageOf = (o) => {
    if (typeof o.stage === "number") return Math.min(5, Math.max(0, o.stage));
    const sec = store.demoStageSeconds;
    if (!sec) return 0;
    return Math.min(5, Math.floor((Date.now() - o.createdAt) / (sec * 1000)));
  };

  const stepsOf = (o) => [
    { t: "Заказ оформлен", s: "Продавец получил ваш заказ" },
    { t: "Собираем заказ", s: "Упаковываем товары" },
    { t: `Передан в ${o.deliveryName}`, s: "Посылка у службы доставки" },
    { t: "В пути", s: "Едет в ваш город" },
    o.type === "courier"
      ? { t: "Курьер выехал", s: "Скоро будет у вас" }
      : { t: "Готов к выдаче", s: o.type === "post" ? "Заберите в отделении" : "Заберите в пункте выдачи" },
    { t: "Получен", s: "Спасибо за покупку!" },
  ];
  const statusLabel = (o, st) => ["Оформлен", "Собирается", "Передан", "В пути", o.type === "courier" ? "Курьер едет" : "Ждёт вас", "Получен"][st];

  const dateFmt = (ts) => new Date(ts).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const dayFmt = (ts) => new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const addDays = (ts, d) => ts + d * 86400000;

  const lastStages = new Map();

  function orderHTML(o, i) {
    const st = stageOf(o);
    lastStages.set(o.id, st);
    const steps = stepsOf(o);
    const thumbs = o.items.slice(0, 3).map((it) => `
      <span class="thumb" style="--h:${Number(it.hue) || 260}">${it.image ? `<img src="${esc(it.image)}" alt="">` : (it.emoji || "📦")}</span>`).join("")
      + (o.items.length > 3 ? `<span class="thumb more">+${o.items.length - 3}</span>` : "");
    const eta = st >= 5 ? "Доставлен" : `Ожидаем ${dayFmt(addDays(o.createdAt, o.days[0]))} – ${dayFmt(addDays(o.createdAt, o.days[1]))}`;

    return `
      <article class="order ${openOrders.has(o.id) ? "open" : ""}" data-order="${o.id}" style="--i:${i}">
        <button class="order-head" data-action="toggle-order" data-id="${o.id}">
          <div class="order-top">
            <div>
              <div class="order-num">Заказ №${o.id}</div>
              <div class="order-date">${dateFmt(o.createdAt)}</div>
            </div>
            <span class="status s${st}">${statusLabel(o, st)}</span>
          </div>
          <div class="order-mid">
            <div class="thumbs">${thumbs}</div>
            <div class="order-total">${money(o.total)}</div>
          </div>
          <div class="progress"><i style="width:${(st / 5) * 100}%"></i></div>
          <div class="order-sub"><span>${eta}</span><span class="chev">⌄</span></div>
        </button>
        <div class="order-more"><div>
          <div class="order-body">
            <ul class="timeline">
              ${steps.map((s, k) => `
                <li class="step ${k < st ? "done" : ""} ${k === st && st < 5 ? "now" : ""} ${k === 5 ? "final" : ""} ${k === 5 && st === 5 ? "done" : ""}">
                  <span class="dot"></span>
                  <div><div class="st-title">${esc(s.t)}</div><div class="st-sub">${esc(s.s)}</div></div>
                </li>`).join("")}
            </ul>
            <div class="kv">
              <div class="kv-row"><span>Доставка</span><span>${esc(o.deliveryLabel)}</span></div>
              <div class="kv-row"><span>Трек-номер</span><span>${esc(o.track)}</span></div>
              <div class="kv-row"><span>Получатель</span><span>${esc(o.customer.name)}</span></div>
              <div class="kv-row"><span>Телефон</span><span>${esc(o.customer.phone)}</span></div>
              <div class="kv-row"><span>Адрес</span><span>${esc(o.customer.address)}</span></div>
            </div>
            <div class="items-mini">
              ${o.items.map((it) => `<div><span>${esc(it.name)} × ${it.qty}</span><span>${fmt(it.price * it.qty)} ${cur}</span></div>`).join("")}
              <div><span>Доставка</span><span>${o.deliveryPrice ? fmt(o.deliveryPrice) + " " + cur : "Бесплатно"}</span></div>
            </div>
            <button class="btn ghost copy" data-action="copy-track" data-track="${esc(o.track)}">Скопировать трек-номер</button>
          </div>
        </div></div>
      </article>`;
  }

  function renderOrders(animate = true) {
    ordersBox.classList.toggle("still", !animate);
    ordersBox.innerHTML = orders.map(orderHTML).join("");
    const n = orders.length;
    $("#orders-empty").hidden = n > 0;
    const cnt = $("#orders-count");
    cnt.hidden = n === 0;
    cnt.textContent = n;

    const active = orders.filter((o) => stageOf(o) < 5).length;
    $("#st-orders").textContent = n;
    $("#st-active").textContent = active;
    $("#st-sum").textContent = fmt(orders.reduce((s, o) => s + o.total, 0));
    $("#st-cur").textContent = `потрачено, ${cur}`;
  }

  function renderProfile(animate = true) {
    renderMe();
    renderOrders(animate);
  }

  /* Статусы живут своей жизнью — тихо обновляем, пока открыт профиль */
  setInterval(() => {
    if (view !== "profile" || !orders.length) return;
    const changed = orders.some((o) => lastStages.get(o.id) !== stageOf(o));
    if (changed) { renderOrders(false); notify("success"); }
  }, 2500);

  /* ============================================================
     Поля ввода (корзина + профиль синхронизированы)
     ============================================================ */
  function fillInputs() {
    $$("[data-bind]").forEach((inp) => { inp.value = profile[inp.dataset.bind] || ""; });
  }
  function syncAddressPlaceholder() {
    const t = deliveryById.get(deliveryId).type;
    $("#addr-cart").placeholder = {
      pickup: "Город и адрес пункта выдачи",
      courier: "Город, улица, дом, квартира",
      post: "Индекс, город, улица, дом, кв.",
    }[t];
  }
  document.addEventListener("input", (e) => {
    const inp = e.target.closest("[data-bind]");
    if (!inp) return;
    const key = inp.dataset.bind;
    profile[key] = inp.value;
    persist("shop_profile", profile);
    $$(`[data-bind="${key}"]`).forEach((o) => { if (o !== inp) o.value = inp.value; });
    if (key === "name") renderMe();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input")) e.target.blur();
  });

  /* ============================================================
     Переключение экранов — горизонтальный слайд
     ============================================================ */
  let switching = false;
  function showView(name) {
    if (name === view || switching || !VIEWS.includes(name)) return;
    switching = true;

    const dir = VIEWS.indexOf(name) > VIEWS.indexOf(view) ? 1 : -1;
    const from = $(`#view-${view}`), to = $(`#view-${name}`);
    const y = window.scrollY;
    scrollPos[view] = y;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    $$(".dock-btn", dock).forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    haptic("light");

    if (name === "cart") renderCart();
    if (name === "profile") renderProfile(true);

    // старый экран «замораживаем» на текущем месте и уводим в сторону
    from.classList.remove("intro");
    from.style.top = -y + "px";
    from.classList.add("leaving", dir > 0 ? "to-left" : "to-right");

    // новый — заезжает с противоположной
    to.hidden = false;
    to.classList.remove("intro");
    to.classList.add("entering", dir > 0 ? "from-right" : "from-left");
    window.scrollTo(0, scrollPos[name] || 0);

    view = name;
    setTimeout(() => {
      from.hidden = true;
      from.style.top = "";
      from.classList.remove("leaving", "to-left", "to-right");
      to.classList.remove("entering", "from-right", "from-left");
      switching = false;
    }, 760);
  }

  /* Свайп влево/вправо между экранами */
  (() => {
    let sx = 0, sy = 0, ok = false;
    document.addEventListener("touchstart", (e) => {
      ok = !sheetId && !e.target.closest(".chips, input, .sheet-wrap");
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (!ok) return;
      ok = false;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const next = VIEWS[VIEWS.indexOf(view) + (dx < 0 ? 1 : -1)];
      if (next) showView(next);
    }, { passive: true });
  })();

  /* ============================================================
     Шторка товара
     ============================================================ */
  function openSheet(id) {
    const p = byId.get(String(id));
    if (!p) return;
    sheetId = String(id);
    sheetBody.innerHTML = `
      <div class="s-in" style="--d:0">${pic(p, 0, "s-pic")}</div>
      <div class="s-cat s-in" style="--d:1">${esc(p.category || "")}</div>
      <h2 class="s-name s-in" style="--d:2">${esc(p.name)}</h2>
      <p class="s-desc s-in" style="--d:3">${esc(p.desc || "")}</p>
      <div class="s-foot s-in" style="--d:4">
        <span class="s-price">${money(p.price)}</span>
        ${qtyControl(p.id, "lg")}
      </div>`;
    sheet.scrollTop = 0;
    sheetWrap.classList.add("open");
    sheetWrap.setAttribute("aria-hidden", "false");
    document.body.classList.add("locked");
    haptic("light");
    if (tg && tg.BackButton) { try { tg.BackButton.show(); } catch (_) {} }
  }

  function closeSheet() {
    if (!sheetId) return;
    sheetId = null;
    sheetWrap.classList.remove("open");
    sheetWrap.setAttribute("aria-hidden", "true");
    document.body.classList.remove("locked");
    sheet.style.transform = "";
    if (tg && tg.BackButton) { try { tg.BackButton.hide(); } catch (_) {} }
  }
  if (tg && tg.BackButton) { try { tg.BackButton.onClick(closeSheet); } catch (_) {} }

  (() => {
    let startY = 0, dy = 0, active = false;
    sheet.addEventListener("touchstart", (e) => {
      if (sheet.scrollTop > 0) return;
      startY = e.touches[0].clientY; dy = 0; active = true;
    }, { passive: true });
    sheet.addEventListener("touchmove", (e) => {
      if (!active) return;
      dy = e.touches[0].clientY - startY;
      if (dy > 0) {
        sheet.classList.add("dragging");
        sheet.style.transform = `translateY(${dy * 0.9}px)`;
      } else sheet.style.transform = "";
    }, { passive: true });
    sheet.addEventListener("touchend", () => {
      if (!active) return;
      active = false;
      sheet.classList.remove("dragging");
      if (dy > 110) closeSheet(); else sheet.style.transform = "";
    });
  })();

  /* ============================================================
     Тост
     ============================================================ */
  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  /* ============================================================
     Оформление заказа
     ============================================================ */
  const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

  function validate() {
    const checks = [
      ["name", (v) => v.trim().length >= 2, "Укажите имя получателя"],
      ["phone", (v) => v.replace(/\D/g, "").length >= 10, "Укажите телефон"],
      ["address", (v) => v.trim().length >= 5, "Укажите адрес доставки"],
    ];
    for (const [key, ok, msg] of checks) {
      if (!ok(profile[key] || "")) {
        const inp = $(`#checkout-block [data-bind="${key}"]`);
        inp.scrollIntoView({ behavior: "smooth", block: "center" });
        inp.classList.remove("shake"); void inp.offsetWidth; inp.classList.add("shake");
        setTimeout(() => inp.focus({ preventScroll: true }), 350);
        toast(msg);
        notify("error");
        return false;
      }
    }
    return true;
  }

  function buildOrder() {
    const d = deliveryById.get(deliveryId);
    const sum = itemsSum(), dp = deliveryPrice(sum);
    const num = 1000 + (load("shop_order_seq", 0) + 1);
    persist("shop_order_seq", num - 1000);
    return {
      id: num,
      createdAt: Date.now(),
      items: Object.entries(cart).map(([id, qty]) => {
        const p = byId.get(id);
        return { id: p.id, name: p.name, price: p.price, qty, emoji: p.emoji, hue: p.hue, image: p.image };
      }),
      itemsSum: sum,
      deliveryId: d.id,
      deliveryName: d.name,
      deliveryLabel: `${d.name} · ${d.type === "pickup" ? "пункт выдачи" : d.type === "courier" ? "курьер" : "отделение"}`,
      type: d.type,
      days: d.days,
      deliveryPrice: dp,
      total: sum + dp,
      track: d.type === "post" ? "80" + digits(12) : "10" + digits(8),
      customer: { name: profile.name.trim(), phone: profile.phone.trim(), address: profile.address.trim() },
      // stage: 0   ← статус заказа; с бэкендом приходит оттуда (0–5), иначе считается демо-таймером
    };
  }

  /* Сюда подключается бэкенд: отправить заказ продавцу (fetch / Telegram-бот и т.д.) */
  async function submitOrder(order) {
    // await fetch("/api/orders", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(order) });
    return order;
  }

  async function checkout() {
    if (!totalCount() || !validate()) return;
    const btn = $("#checkout-btn");
    btn.classList.add("busy");
    haptic("medium");

    const order = buildOrder();
    try { await submitOrder(order); } catch (_) {
      btn.classList.remove("busy");
      toast("Не удалось оформить заказ, попробуйте ещё раз");
      return;
    }
    await new Promise((r) => setTimeout(r, 600));

    orders.unshift(order);
    persist("shop_orders", orders);
    cart = {};
    persist("shop_cart", cart);

    openOrders.clear();
    openOrders.add(order.id);

    renderGrid();
    updateBadge();
    btn.classList.remove("busy");
    notify("success");
    showView("profile");
    setTimeout(() => toast(`Заказ №${order.id} оформлен ✨`), 500);
  }

  /* ============================================================
     События
     ============================================================ */
  document.addEventListener("click", (e) => {
    const dockBtn = e.target.closest(".dock-btn");
    if (dockBtn) return showView(dockBtn.dataset.view);

    const el = e.target.closest("[data-action]");
    if (!el) return;
    const { action, id } = el.dataset;

    switch (action) {
      case "inc":
        e.stopPropagation();
        setQty(id, qtyOf(id) + 1);
        haptic("light");
        break;
      case "dec":
        e.stopPropagation();
        setQty(id, qtyOf(id) - 1);
        haptic("light");
        break;
      case "open": openSheet(id); break;
      case "close-sheet": closeSheet(); break;
      case "goto-shop": showView("shop"); break;
      case "checkout": checkout(); break;
      case "delivery":
        if (id === deliveryId) return;
        deliveryId = id;
        persist("shop_delivery", deliveryId);
        $$(".dopt", deliveryBox).forEach((b) => b.classList.toggle("on", b.dataset.id === id));
        syncAddressPlaceholder();
        syncCartMeta();
        haptic("light");
        break;
      case "toggle-order": {
        const oid = Number(id);
        const card = $(`[data-order="${oid}"]`);
        if (openOrders.has(oid)) openOrders.delete(oid); else openOrders.add(oid);
        card.classList.toggle("open", openOrders.has(oid));
        haptic("light");
        break;
      }
      case "copy-track": {
        const t = el.dataset.track;
        const done = () => { toast("Трек-номер скопирован"); notify("success"); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => toast(t));
        else toast(t);
        break;
      }
      case "category":
        if (el.dataset.cat === category) return;
        category = el.dataset.cat;
        $$(".chip", chips).forEach((c) => c.classList.toggle("active", c === el));
        moveInd(chipsInd, el);
        el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        haptic("light");
        renderGrid();
        break;
    }
  });

  window.addEventListener("resize", () => moveInd(chipsInd, $(".chip.active", chips)));

  /* ============================================================
     Старт
     ============================================================ */
  renderChips();
  renderGrid();
  renderDelivery();
  syncAddressPlaceholder();
  fillInputs();
  renderMe();
  syncCartMeta();
  updateBadge();
  $("#view-shop").addEventListener("animationend", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove("intro");
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveInd(chipsInd, $(".chip.active", chips)));
})();
