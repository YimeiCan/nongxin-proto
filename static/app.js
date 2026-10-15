/* 农信 prototype SPA */
(() => {
  const MAP_CENTER = [36.862, 118.790]; // 寿光一带演示
  const MAP_ZOOM = 14;
  const ROLE_LABEL = { farmer: "农户", merchant: "商家", admin: "后台管理" };
  const STATUS_LABEL = {
    pending: "待审核",
    approved: "已通过",
    rejected: "已驳回",
    open: "待处理",
  };

  const state = {
    token: localStorage.getItem("nx_token") || "",
    user: JSON.parse(localStorage.getItem("nx_user") || "null"),
    tab: "",
    maps: {},
    drawPoints: [],
    drawLayer: null,
    pestPoint: null,
    pestMarker: null,
    demoAccounts: [],
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $("#app");
  const toastEl = $("#toast");

  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), ms);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (state.token) headers["Authorization"] = "Bearer " + state.token;
    if (opts.json) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.json);
    }
    const res = await fetch(path, { ...opts, headers });
    let data = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) data = await res.json();
    else data = await res.text();
    if (!res.ok) {
      const msg = (data && data.detail) || (typeof data === "string" ? data : "请求失败");
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  }

  function setAuth(token, user) {
    state.token = token || "";
    state.user = user || null;
    if (token) {
      localStorage.setItem("nx_token", token);
      localStorage.setItem("nx_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("nx_token");
      localStorage.removeItem("nx_user");
    }
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function badge(status) {
    const cls =
      status === "pending"
        ? "pending"
        : status === "approved"
        ? "approved"
        : status === "rejected"
        ? "rejected"
        : status === "open"
        ? "open"
        : "order";
    const label = STATUS_LABEL[status] || status;
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  function tileLayer() {
    // Prefer local cached tiles for demo area; fall back to OSM CDN
    const local = L.tileLayer("/static/tiles/{z}/{x}/{y}.png", {
      maxZoom: 16,
      minZoom: 14,
      errorTileUrl:
        "data:image/svg+xml," +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect fill="#dfece4" width="256" height="256"/><text x="50%" y="50%" text-anchor="middle" fill="#6b7c72" font-size="14">演示底图</text></svg>`
        ),
      attribution: "© OpenStreetMap",
    });
    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    });
    // Use OSM for zoom outside cache; local for 14-16 in demo area
    return L.layerGroup([osm, local]);
  }

  function makeMap(containerId, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el) return null;
    if (state.maps[containerId]) {
      try {
        state.maps[containerId].remove();
      } catch (_) {}
      delete state.maps[containerId];
    }
    const map = L.map(containerId, {
      zoomControl: true,
      attributionControl: true,
    }).setView(opts.center || MAP_CENTER, opts.zoom || MAP_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OSM · 演示底图，上线换高德",
    }).addTo(map);
    // Overlay local tiles when available (demo area)
    L.tileLayer("/static/tiles/{z}/{x}/{y}.png", {
      maxZoom: 16,
      minZoom: 14,
      opacity: 1,
      errorTileUrl:
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    }).addTo(map);
    state.maps[containerId] = map;
    setTimeout(() => map.invalidateSize(), 80);
    setTimeout(() => map.invalidateSize(), 300);
    return map;
  }

  function polygonStyle(status) {
    if (status === "approved")
      return { color: "#1b8a4a", weight: 2, fillColor: "#3ecf7a", fillOpacity: 0.35 };
    if (status === "rejected")
      return { color: "#c0392b", weight: 2, fillColor: "#e74c3c", fillOpacity: 0.25 };
    return { color: "#e67e22", weight: 2, fillColor: "#f5b041", fillOpacity: 0.3, dashArray: "6 4" };
  }

  function addParcelLayers(map, parcels, fit = true) {
    const group = L.featureGroup();
    parcels.forEach((p) => {
      try {
        const layer = L.geoJSON(p.geometry, { style: polygonStyle(p.status) });
        layer.bindPopup(
          `<b>${esc(p.name)}</b><br/>${esc(p.crop || "未填作物")} · ${esc(p.area_mu)} 亩<br/>${STATUS_LABEL[p.status] || p.status}${
            p.farmer_name ? "<br/>农户：" + esc(p.farmer_name) : ""
          }`
        );
        layer.addTo(group);
      } catch (_) {}
    });
    group.addTo(map);
    if (fit && parcels.length) {
      try {
        map.fitBounds(group.getBounds().pad(0.2));
      } catch (_) {}
    }
    return group;
  }

  // ---------- Login ----------
  async function renderLogin() {
    if (!state.demoAccounts.length) {
      try {
        const d = await api("/api/demo-accounts");
        state.demoAccounts = d.accounts;
      } catch (_) {
        state.demoAccounts = [
          { username: "farmer1", password: "123456", role: "farmer", label: "农户·张大叔" },
          { username: "merchant1", password: "123456", role: "merchant", label: "商家·绿田农资店" },
          { username: "admin", password: "123456", role: "admin", label: "后台·运维小王" },
        ];
      }
    }
    app.innerHTML = `
      <div class="login-page">
        <div class="card login-card stack">
          <div class="logo">农</div>
          <div>
            <h2 style="margin:0">农信 · 演示原型</h2>
            <div class="muted">地块认领 · 虫情上报 · 农资下单（演示底图，上线换高德）</div>
          </div>
          <label class="field">账号
            <input id="login-user" autocomplete="username" placeholder="farmer1 / merchant1 / admin" />
          </label>
          <label class="field">密码
            <input id="login-pass" type="password" autocomplete="current-password" value="123456" />
          </label>
          <button class="btn block" id="login-btn">登录</button>
          <div class="muted">一键演示账号</div>
          <div class="demo-grid" id="demo-grid"></div>
        </div>
      </div>`;
    const grid = $("#demo-grid");
    state.demoAccounts.forEach((a) => {
      const b = document.createElement("button");
      b.className = "demo-btn";
      b.innerHTML = `<strong>${esc(a.label)}</strong><span class="muted">${esc(a.username)} / ${esc(a.password)} · ${esc(
        ROLE_LABEL[a.role] || a.role
      )}</span>`;
      b.onclick = () => {
        $("#login-user").value = a.username;
        $("#login-pass").value = a.password;
        doLogin();
      };
      grid.appendChild(b);
    });
    $("#login-btn").onclick = doLogin;
    $("#login-pass").onkeydown = (e) => {
      if (e.key === "Enter") doLogin();
    };
  }

  async function doLogin() {
    const username = $("#login-user").value.trim();
    const password = $("#login-pass").value;
    try {
      const data = await api("/api/login", { method: "POST", json: { username, password } });
      setAuth(data.token, data.user);
      toast("欢迎，" + data.user.display_name);
      routeByRole();
    } catch (e) {
      toast(e.message);
    }
  }

  async function doLogout() {
    try {
      await api("/api/logout", { method: "POST" });
    } catch (_) {}
    Object.values(state.maps).forEach((m) => {
      try {
        m.remove();
      } catch (_) {}
    });
    state.maps = {};
    setAuth("", null);
    renderLogin();
  }

  function routeByRole() {
    const role = state.user?.role;
    const path = location.pathname;
    if (role === "farmer") {
      if (!path.startsWith("/farmer")) history.replaceState({}, "", "/farmer");
      state.tab = state.tab || "claim";
      renderShell();
    } else if (role === "merchant") {
      if (!path.startsWith("/merchant")) history.replaceState({}, "", "/merchant");
      state.tab = state.tab || "products";
      renderShell();
    } else if (role === "admin") {
      if (!path.startsWith("/admin")) history.replaceState({}, "", "/admin");
      state.tab = state.tab || "review";
      renderShell();
    } else {
      renderLogin();
    }
  }

  function renderShell() {
    const role = state.user.role;
    const tabs =
      role === "farmer"
        ? [
            ["claim", "认领田块"],
            ["parcels", "我的地块"],
            ["pest", "虫情上报"],
            ["shop", "农资商城"],
            ["orders", "我的订单"],
          ]
        : role === "merchant"
        ? [
            ["products", "商品管理"],
            ["morders", "订单列表"],
          ]
        : [
            ["review", "地块审核"],
            ["overview", "地块总览"],
            ["pests", "虫情列表"],
            ["aorders", "订单总览"],
          ];

    app.innerHTML = `
      <div class="topbar">
        <div>
          <div class="brand">农信</div>
          <div class="sub">${esc(ROLE_LABEL[role])}端 · 演示${(window.__NX_DATA_MODE__==="localStorage")?" · 浏览器缓存":" · 服务端"}</div>
        </div>
        <div class="spacer"></div>
        <div class="userchip">${esc(state.user.display_name)}</div>
        <button class="btn ghost sm" id="btn-logout">退出</button>
      </div>
      <div class="shell">
        <div class="nav-tabs" id="nav-tabs"></div>
        <div class="content" id="content"></div>
      </div>`;
    const nav = $("#nav-tabs");
    tabs.forEach(([id, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (state.tab === id) b.classList.add("active");
      b.onclick = () => {
        state.tab = id;
        renderShell();
      };
      nav.appendChild(b);
    });
    $("#btn-logout").onclick = doLogout;
    renderTab();
  }

  async function renderTab() {
    const c = $("#content");
    c.innerHTML = `<div class="empty">加载中…</div>`;
    try {
      if (state.user.role === "farmer") {
        if (state.tab === "claim") await viewFarmerClaim(c);
        else if (state.tab === "parcels") await viewFarmerParcels(c);
        else if (state.tab === "pest") await viewFarmerPest(c);
        else if (state.tab === "shop") await viewFarmerShop(c);
        else if (state.tab === "orders") await viewFarmerOrders(c);
      } else if (state.user.role === "merchant") {
        if (state.tab === "products") await viewMerchantProducts(c);
        else if (state.tab === "morders") await viewMerchantOrders(c);
      } else {
        if (state.tab === "review") await viewAdminReview(c);
        else if (state.tab === "overview") await viewAdminOverview(c);
        else if (state.tab === "pests") await viewAdminPests(c);
        else if (state.tab === "aorders") await viewAdminOrders(c);
      }
    } catch (e) {
      c.innerHTML = `<div class="card empty">${esc(e.message)}</div>`;
    }
  }

  // ---------- Farmer: claim ----------
  async function viewFarmerClaim(c) {
    const existing = await api("/api/parcels");
    c.innerHTML = `
      <div class="card">
        <h3>手绘认领田块</h3>
        <div class="muted">在地图上依次点击描点，至少 3 点后可闭合提交。橙色虚线=待审，绿色=已通过。</div>
        <div class="map-wrap tall" id="map-claim">
          <div class="map-banner">演示底图，上线换高德</div>
        </div>
        <div class="draw-tools">
          <button class="btn secondary sm" id="btn-undo">撤销一点</button>
          <button class="btn secondary sm" id="btn-clear">清空</button>
          <button class="btn secondary sm" id="btn-close">闭合预览</button>
        </div>
        <div class="stack" style="margin-top:8px">
          <label class="field">地块名称<input id="p-name" placeholder="例如：西河黄瓜棚" /></label>
          <label class="field">作物<input id="p-crop" placeholder="例如：黄瓜" /></label>
          <label class="field">面积（亩）<input id="p-area" type="number" step="0.1" min="0" placeholder="可选，约估" /></label>
          <button class="btn block" id="btn-submit-claim">提交认领（待后台审核）</button>
        </div>
      </div>`;
    const map = makeMap("map-claim");
    addParcelLayers(map, existing.items.filter((p) => p.status !== "rejected"), false);
    state.drawPoints = [];
    state.drawLayer = L.layerGroup().addTo(map);

    function redraw() {
      state.drawLayer.clearLayers();
      state.drawPoints.forEach((pt, i) => {
        L.circleMarker(pt, { radius: 6, color: "#1b8a4a", fillColor: "#fff", fillOpacity: 1, weight: 2 })
          .bindTooltip(String(i + 1), { permanent: true, direction: "top" })
          .addTo(state.drawLayer);
      });
      if (state.drawPoints.length >= 2) {
        L.polyline(state.drawPoints, { color: "#1b8a4a", weight: 2, dashArray: "4 4" }).addTo(state.drawLayer);
      }
    }

    map.on("click", (e) => {
      state.drawPoints.push([e.latlng.lat, e.latlng.lng]);
      redraw();
    });
    $("#btn-undo").onclick = () => {
      state.drawPoints.pop();
      redraw();
    };
    $("#btn-clear").onclick = () => {
      state.drawPoints = [];
      redraw();
    };
    $("#btn-close").onclick = () => {
      if (state.drawPoints.length < 3) return toast("至少画 3 个点");
      const ring = state.drawPoints.concat([state.drawPoints[0]]);
      state.drawLayer.clearLayers();
      L.polygon(ring, polygonStyle("pending")).addTo(state.drawLayer);
      state.drawPoints.forEach((pt) =>
        L.circleMarker(pt, { radius: 5, color: "#e67e22", fillOpacity: 1 }).addTo(state.drawLayer)
      );
      toast("已闭合预览，可提交");
    };
    $("#btn-submit-claim").onclick = async () => {
      if (state.drawPoints.length < 3) return toast("请先在地图画至少 3 个点");
      const name = $("#p-name").value.trim();
      if (!name) return toast("请填写地块名称");
      const ring = state.drawPoints.map(([lat, lng]) => [lng, lat]);
      ring.push(ring[0]);
      const geometry = { type: "Polygon", coordinates: [ring] };
      try {
        await api("/api/parcels", {
          method: "POST",
          json: {
            name,
            crop: $("#p-crop").value.trim(),
            area_mu: parseFloat($("#p-area").value) || 0,
            geometry,
          },
        });
        toast("已提交认领，等待后台审核");
        state.tab = "parcels";
        renderShell();
      } catch (e) {
        toast(e.message);
      }
    };
  }

  async function viewFarmerParcels(c) {
    const data = await api("/api/parcels");
    c.innerHTML = `
      <div class="card">
        <div class="row between"><h3>我的地块</h3><button class="btn sm" id="go-claim">去认领</button></div>
        <div class="map-wrap" id="map-my">
          <div class="map-banner">演示底图，上线换高德</div>
        </div>
      </div>
      <div class="card" id="parcel-list"></div>`;
    $("#go-claim").onclick = () => {
      state.tab = "claim";
      renderShell();
    };
    const map = makeMap("map-my");
    addParcelLayers(map, data.items);
    const list = $("#parcel-list");
    if (!data.items.length) {
      list.innerHTML = `<div class="empty">暂无地块，去地图认领一块吧</div>`;
      return;
    }
    list.innerHTML = data.items
      .map(
        (p) => `
      <div class="list-item">
        <div class="row between">
          <strong>${esc(p.name)}</strong>
          ${badge(p.status)}
        </div>
        <div class="muted">${esc(p.crop || "未填作物")} · ${esc(p.area_mu)} 亩 · ${esc(p.created_at)}</div>
        ${p.status === "rejected" && p.reject_reason ? `<div class="muted">驳回原因：${esc(p.reject_reason)}</div>` : ""}
      </div>`
      )
      .join("");
  }

  // ---------- Farmer: pest ----------
  async function viewFarmerPest(c) {
    const parcels = await api("/api/parcels");
    const pests = await api("/api/pests");
    const approved = parcels.items.filter((p) => p.status === "approved");
    c.innerHTML = `
      <div class="card stack">
        <h3>虫情 / 病害上报</h3>
        <div class="muted">点击地图标注发生位置，可附照片（可选）。</div>
        <div class="map-wrap" id="map-pest">
          <div class="map-banner">演示底图，上线换高德</div>
        </div>
        <label class="field">标题<input id="pest-title" placeholder="例如：黄瓜白粉病" /></label>
        <label class="field">严重程度
          <select id="pest-sev"><option>轻</option><option selected>中</option><option>重</option></select>
        </label>
        <label class="field">关联地块（可选）
          <select id="pest-parcel">
            <option value="">不关联</option>
            ${approved.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">描述<textarea id="pest-desc" placeholder="症状、范围、发现时间…"></textarea></label>
        <label class="field">照片（可选）<input id="pest-photo" type="file" accept="image/*" /></label>
        <img id="pest-preview" class="photo-preview hidden" alt="预览" />
        <button class="btn block" id="btn-pest">提交上报</button>
      </div>
      <div class="card"><h3>我的上报</h3><div id="pest-list"></div></div>`;
    const map = makeMap("map-pest");
    addParcelLayers(map, approved, true);
    state.pestPoint = null;
    state.pestMarker = null;
    map.on("click", (e) => {
      state.pestPoint = e.latlng;
      if (state.pestMarker) map.removeLayer(state.pestMarker);
      state.pestMarker = L.marker(e.latlng).addTo(map).bindPopup("虫情位置").openPopup();
    });
    $("#pest-photo").onchange = (ev) => {
      const f = ev.target.files?.[0];
      const img = $("#pest-preview");
      if (!f) {
        img.classList.add("hidden");
        return;
      }
      img.src = URL.createObjectURL(f);
      img.classList.remove("hidden");
    };
    $("#btn-pest").onclick = async () => {
      if (!state.pestPoint) return toast("请先在地图点选位置");
      const title = $("#pest-title").value.trim();
      if (!title) return toast("请填写标题");
      const fd = new FormData();
      fd.append("title", title);
      fd.append("description", $("#pest-desc").value);
      fd.append("severity", $("#pest-sev").value);
      fd.append("parcel_id", $("#pest-parcel").value);
      fd.append("lat", state.pestPoint.lat);
      fd.append("lng", state.pestPoint.lng);
      const file = $("#pest-photo").files?.[0];
      if (file) fd.append("photo", file);
      try {
        await api("/api/pests", { method: "POST", body: fd });
        toast("虫情已上报");
        viewFarmerPest(c);
      } catch (e) {
        toast(e.message);
      }
    };
    const list = $("#pest-list");
    if (!pests.items.length) list.innerHTML = `<div class="empty">暂无上报</div>`;
    else
      list.innerHTML = pests.items
        .map(
          (p) => `
        <div class="list-item">
          <div class="row between"><strong>${esc(p.title)}</strong>${badge(p.status)}</div>
          <div class="muted">严重：${esc(p.severity)} · ${esc(p.created_at)}</div>
          <div>${esc(p.description || "")}</div>
          ${p.photo_path ? `<img class="photo-preview" src="${esc(p.photo_path)}" alt="" />` : ""}
        </div>`
        )
        .join("");
  }

  // ---------- Farmer: shop / orders ----------
  async function viewFarmerShop(c) {
    const data = await api("/api/products");
    c.innerHTML = `<div class="card"><h3>农资商城</h3><div class="muted">演示下单，无真实支付</div></div><div id="shop-list"></div>`;
    const list = $("#shop-list");
    if (!data.items.length) {
      list.innerHTML = `<div class="card empty">暂无商品</div>`;
      return;
    }
    list.innerHTML = data.items
      .map(
        (p) => `
      <div class="card">
        <div class="row between">
          <div>
            <strong>${esc(p.name)}</strong>
            <div class="muted">${esc(p.category)} · ${esc(p.merchant_name || "")} · 库存 ${esc(p.stock)}${esc(p.unit)}</div>
          </div>
          <div class="price">¥${esc(p.price)} <small>/${esc(p.unit)}</small></div>
        </div>
        <div class="muted" style="margin:6px 0">${esc(p.description || "")}</div>
        <div class="row">
          <label class="field" style="flex:1;margin:0">数量
            <input type="number" min="1" value="1" id="qty-${esc(p.id)}" />
          </label>
          <button class="btn" data-buy="${esc(p.id)}" style="align-self:flex-end">下单</button>
        </div>
      </div>`
      )
      .join("");
    list.querySelectorAll("[data-buy]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-buy");
        const qty = parseInt($("#qty-" + id).value, 10) || 1;
        try {
          const r = await api("/api/orders", { method: "POST", json: { product_id: id, qty } });
          toast("已下单 · ¥" + r.total);
          state.tab = "orders";
          renderShell();
        } catch (e) {
          toast(e.message);
        }
      };
    });
  }

  async function viewFarmerOrders(c) {
    const data = await api("/api/orders");
    c.innerHTML = `<div class="card"><h3>我的订单</h3></div><div class="card" id="olist"></div>`;
    const list = $("#olist");
    if (!data.items.length) {
      list.innerHTML = `<div class="empty">还没有订单</div>`;
      return;
    }
    list.innerHTML = data.items
      .map(
        (o) => `
      <div class="list-item">
        <div class="row between"><strong>${esc(o.product_name)}</strong>${badge(o.status)}</div>
        <div class="muted">${esc(o.merchant_name)} · ${esc(o.qty)} 件 · ¥${esc(o.total)} · ${esc(o.created_at)}</div>
      </div>`
      )
      .join("");
  }

  // ---------- Merchant ----------
  async function viewMerchantProducts(c) {
    const data = await api("/api/products?mine=1");
    c.innerHTML = `
      <div class="card stack">
        <h3>添加 / 编辑商品</h3>
        <input type="hidden" id="edit-id" value="" />
        <label class="field">名称<input id="pr-name" placeholder="商品名" /></label>
        <div class="row">
          <label class="field" style="flex:1">分类<input id="pr-cat" value="农资" /></label>
          <label class="field" style="flex:1">单位<input id="pr-unit" value="袋" /></label>
        </div>
        <div class="row">
          <label class="field" style="flex:1">价格<input id="pr-price" type="number" step="0.01" /></label>
          <label class="field" style="flex:1">库存<input id="pr-stock" type="number" step="1" /></label>
        </div>
        <label class="field">描述<textarea id="pr-desc"></textarea></label>
        <button class="btn block" id="pr-save">保存商品</button>
      </div>
      <div class="card"><h3>本店商品</h3><div id="pr-list"></div></div>`;
    function fillForm(p) {
      $("#edit-id").value = p?.id || "";
      $("#pr-name").value = p?.name || "";
      $("#pr-cat").value = p?.category || "农资";
      $("#pr-unit").value = p?.unit || "袋";
      $("#pr-price").value = p?.price ?? "";
      $("#pr-stock").value = p?.stock ?? "";
      $("#pr-desc").value = p?.description || "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    $("#pr-save").onclick = async () => {
      const body = {
        name: $("#pr-name").value.trim(),
        category: $("#pr-cat").value.trim(),
        unit: $("#pr-unit").value.trim(),
        price: parseFloat($("#pr-price").value),
        stock: parseInt($("#pr-stock").value, 10) || 0,
        description: $("#pr-desc").value.trim(),
        active: true,
      };
      if (!body.name || isNaN(body.price)) return toast("请填写名称和价格");
      try {
        const id = $("#edit-id").value;
        if (id) await api("/api/products/" + id, { method: "PUT", json: body });
        else await api("/api/products", { method: "POST", json: body });
        toast("已保存");
        viewMerchantProducts(c);
      } catch (e) {
        toast(e.message);
      }
    };
    const list = $("#pr-list");
    if (!data.items.length) list.innerHTML = `<div class="empty">暂无商品，上方添加</div>`;
    else {
      list.innerHTML = data.items
        .map(
          (p) => `
        <div class="list-item">
          <div class="row between">
            <div>
              <strong>${esc(p.name)}</strong>
              <div class="muted">${esc(p.category)} · 库存 ${esc(p.stock)}${esc(p.unit)} · ${p.active ? "上架" : "下架"}</div>
            </div>
            <div class="price">¥${esc(p.price)}</div>
          </div>
          <div class="row" style="margin-top:8px">
            <button class="btn secondary sm" data-edit='${esc(JSON.stringify(p))}'>编辑</button>
            <button class="btn danger sm" data-off="${esc(p.id)}">下架</button>
          </div>
        </div>`
        )
        .join("");
      list.querySelectorAll("[data-edit]").forEach((b) => {
        b.onclick = () => fillForm(JSON.parse(b.getAttribute("data-edit")));
      });
      list.querySelectorAll("[data-off]").forEach((b) => {
        b.onclick = async () => {
          try {
            await api("/api/products/" + b.getAttribute("data-off"), { method: "DELETE" });
            toast("已下架");
            viewMerchantProducts(c);
          } catch (e) {
            toast(e.message);
          }
        };
      });
    }
  }

  async function viewMerchantOrders(c) {
    const data = await api("/api/orders");
    c.innerHTML = `<div class="card"><h3>店铺订单</h3></div><div class="card" id="molist"></div>`;
    renderOrderManage($("#molist"), data.items, true);
  }

  function renderOrderManage(el, items, canStatus) {
    if (!items.length) {
      el.innerHTML = `<div class="empty">暂无订单</div>`;
      return;
    }
    el.innerHTML = items
      .map(
        (o) => `
      <div class="list-item">
        <div class="row between"><strong>${esc(o.product_name)}</strong>${badge(o.status)}</div>
        <div class="muted">农户：${esc(o.farmer_name || "-")} · 商家：${esc(o.merchant_name || "-")}</div>
        <div class="muted">${esc(o.qty)} 件 · ¥${esc(o.total)} · ${esc(o.created_at)}</div>
        ${
          canStatus
            ? `<div class="row" style="margin-top:8px">
          <select class="btn secondary sm" data-st="${esc(o.id)}" style="box-shadow:none">
            ${["已下单", "备货中", "已发货", "已完成", "已取消"]
              .map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`)
              .join("")}
          </select>
          <button class="btn sm" data-apply="${esc(o.id)}">更新状态</button>
        </div>`
            : ""
        }
      </div>`
      )
      .join("");
    if (canStatus) {
      el.querySelectorAll("[data-apply]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-apply");
          const sel = el.querySelector(`select[data-st="${id}"]`);
          try {
            await api("/api/orders/" + id + "/status", { method: "PATCH", json: { status: sel.value } });
            toast("状态已更新");
            renderTab();
          } catch (e) {
            toast(e.message);
          }
        };
      });
    }
  }

  // ---------- Admin ----------
  async function viewAdminReview(c) {
    const [stats, parcels] = await Promise.all([api("/api/stats"), api("/api/parcels?scope=all")]);
    const pending = parcels.items.filter((p) => p.status === "pending");
    c.innerHTML = `
      <div class="card">
        <h3>运营概览</h3>
        <div class="stat-grid">
          <div class="stat"><div class="n">${stats.parcels_pending}</div><div class="l">待审地块</div></div>
          <div class="stat"><div class="n">${stats.parcels_approved}</div><div class="l">已通过地块</div></div>
          <div class="stat"><div class="n">${stats.pests_open}</div><div class="l">开放虫情</div></div>
          <div class="stat"><div class="n">${stats.orders_total}</div><div class="l">订单数</div></div>
        </div>
      </div>
      <div class="card">
        <h3>待审核认领</h3>
        <div class="map-wrap" id="map-review"><div class="map-banner">演示底图，上线换高德</div></div>
        <div id="review-list" style="margin-top:10px"></div>
      </div>`;
    const map = makeMap("map-review");
    addParcelLayers(map, pending.length ? pending : parcels.items.slice(0, 8));
    const list = $("#review-list");
    if (!pending.length) {
      list.innerHTML = `<div class="empty">暂无待审（可用农户账号画一块新地）</div>`;
      return;
    }
    list.innerHTML = pending
      .map(
        (p) => `
      <div class="list-item">
        <div class="row between"><strong>${esc(p.name)}</strong>${badge(p.status)}</div>
        <div class="muted">${esc(p.farmer_name)} · ${esc(p.crop || "未填作物")} · ${esc(p.area_mu)} 亩 · ${esc(p.created_at)}</div>
        <div class="row" style="margin-top:8px">
          <button class="btn sm" data-ok="${esc(p.id)}">通过</button>
          <button class="btn danger sm" data-no="${esc(p.id)}">驳回</button>
        </div>
      </div>`
      )
      .join("");
    list.querySelectorAll("[data-ok]").forEach((b) => {
      b.onclick = async () => {
        try {
          await api("/api/parcels/" + b.getAttribute("data-ok") + "/review", {
            method: "POST",
            json: { action: "approve" },
          });
          toast("已通过");
          viewAdminReview(c);
        } catch (e) {
          toast(e.message);
        }
      };
    });
    list.querySelectorAll("[data-no]").forEach((b) => {
      b.onclick = async () => {
        const reason = prompt("驳回原因（可选）", "边界不清，请重绘") || "";
        try {
          await api("/api/parcels/" + b.getAttribute("data-no") + "/review", {
            method: "POST",
            json: { action: "reject", reason },
          });
          toast("已驳回");
          viewAdminReview(c);
        } catch (e) {
          toast(e.message);
        }
      };
    });
  }

  async function viewAdminOverview(c) {
    const parcels = await api("/api/parcels?scope=all");
    c.innerHTML = `
      <div class="card">
        <h3>地块总览地图</h3>
        <div class="map-wrap tall" id="map-all"><div class="map-banner">演示底图，上线换高德</div></div>
      </div>
      <div class="card" id="all-list"></div>`;
    const map = makeMap("map-all");
    addParcelLayers(map, parcels.items);
    $("#all-list").innerHTML = parcels.items.length
      ? parcels.items
          .map(
            (p) => `
        <div class="list-item">
          <div class="row between"><strong>${esc(p.name)}</strong>${badge(p.status)}</div>
          <div class="muted">${esc(p.farmer_name)} · ${esc(p.crop || "-")} · ${esc(p.area_mu)} 亩</div>
        </div>`
          )
          .join("")
      : `<div class="empty">暂无地块</div>`;
  }

  async function viewAdminPests(c) {
    const data = await api("/api/pests");
    c.innerHTML = `
      <div class="card">
        <h3>虫情列表</h3>
        <div class="map-wrap" id="map-apests"><div class="map-banner">演示底图，上线换高德</div></div>
      </div>
      <div class="card" id="ap-list"></div>`;
    const map = makeMap("map-apests");
    const pts = [];
    data.items.forEach((p) => {
      if (p.lat != null && p.lng != null) {
        const m = L.marker([p.lat, p.lng]).addTo(map).bindPopup(`<b>${esc(p.title)}</b><br/>${esc(p.farmer_name)}`);
        pts.push(m);
      }
    });
    if (pts.length) {
      const g = L.featureGroup(pts);
      try {
        map.fitBounds(g.getBounds().pad(0.3));
      } catch (_) {}
    }
    $("#ap-list").innerHTML = data.items.length
      ? data.items
          .map(
            (p) => `
        <div class="list-item">
          <div class="row between"><strong>${esc(p.title)}</strong>${badge(p.status)}</div>
          <div class="muted">${esc(p.farmer_name)} · 严重 ${esc(p.severity)} · ${esc(p.created_at)}</div>
          <div>${esc(p.description || "")}</div>
          ${p.photo_path ? `<img class="photo-preview" src="${esc(p.photo_path)}" />` : ""}
        </div>`
          )
          .join("")
      : `<div class="empty">暂无虫情</div>`;
  }

  async function viewAdminOrders(c) {
    const data = await api("/api/orders");
    c.innerHTML = `<div class="card"><h3>订单总览</h3></div><div class="card" id="aolist"></div>`;
    renderOrderManage($("#aolist"), data.items, true);
  }

  // ---------- boot ----------
  async function boot() {
    // Fix leaflet default icon paths to local vendor
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });

    if (state.token) {
      try {
        const me = await api("/api/me");
        state.user = me;
        localStorage.setItem("nx_user", JSON.stringify(me));
        routeByRole();
        return;
      } catch (_) {
        setAuth("", null);
      }
    }
    renderLogin();
  }

  boot();
})();
