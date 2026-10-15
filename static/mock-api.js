/* LocalStorage mock backend for static / public deploy */
(function () {
  const KEY = "nongxin_mock_v1";
  const CST = () => {
    const d = new Date();
    const s = new Date(d.getTime() + 8 * 3600 * 1000);
    return s.toISOString().replace("T", " ").slice(0, 19);
  };
  function uid(p) {
    return p + Math.random().toString(16).slice(2, 12);
  }
  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  }
  function save(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
  }
  function seed() {
    const db = {
      users: [
        { id: "u_farmer1", username: "farmer1", password: "123456", display_name: "张大叔", role: "farmer", phone: "13800001111" },
        { id: "u_farmer2", username: "farmer2", password: "123456", display_name: "李婶", role: "farmer", phone: "13800002222" },
        { id: "u_merchant1", username: "merchant1", password: "123456", display_name: "绿田农资店", role: "merchant", phone: "13900003333" },
        { id: "u_admin", username: "admin", password: "123456", display_name: "运维小王", role: "admin", phone: "13700004444" },
      ],
      sessions: {},
      parcels: [
        {
          id: "p_demo1",
          farmer_id: "u_farmer2",
          name: "东坡番茄地",
          crop: "番茄",
          area_mu: 3.2,
          geometry: {
            type: "Polygon",
            coordinates: [[[118.785, 36.862], [118.792, 36.862], [118.792, 36.868], [118.785, 36.868], [118.785, 36.862]]],
          },
          status: "approved",
          reject_reason: "",
          created_at: CST(),
          reviewed_at: CST(),
          reviewed_by: "u_admin",
        },
      ],
      pests: [],
      products: [
        { id: "prod1", merchant_id: "u_merchant1", name: "复合肥 45kg", category: "肥料", price: 128, unit: "袋", stock: 200, description: "高氮磷钾复合肥，适合蔬菜", active: 1, created_at: CST() },
        { id: "prod2", merchant_id: "u_merchant1", name: "吡虫啉杀虫剂", category: "农药", price: 36.5, unit: "瓶", stock: 80, description: "蚜虫/粉虱常用", active: 1, created_at: CST() },
        { id: "prod3", merchant_id: "u_merchant1", name: "滴灌管 100m", category: "灌溉", price: 89, unit: "卷", stock: 50, description: "PE滴灌管", active: 1, created_at: CST() },
        { id: "prod4", merchant_id: "u_merchant1", name: "有机基质土", category: "基质", price: 45, unit: "袋", stock: 120, description: "育苗基质", active: 1, created_at: CST() },
      ],
      orders: [],
    };
    save(db);
    return db;
  }
  function db() {
    return load() || seed();
  }
  function userByToken(auth) {
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7).trim();
    const d = db();
    const uid_ = d.sessions[token];
    return d.users.find((u) => u.id === uid_) || null;
  }
  function publicUser(u) {
    return { id: u.id, username: u.username, display_name: u.display_name, role: u.role, phone: u.phone };
  }
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
  function err(detail, status = 400) {
    return json({ detail }, status);
  }

  async function handle(url, opts) {
    const u = new URL(url, location.origin);
    const path = u.pathname;
    const method = (opts.method || "GET").toUpperCase();
    const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || "";
    let body = null;
    if (opts.body && typeof opts.body === "string") {
      try {
        body = JSON.parse(opts.body);
      } catch {
        body = null;
      }
    }

    if (path === "/api/demo-accounts" && method === "GET") {
      return json({
        accounts: [
          { username: "farmer1", password: "123456", role: "farmer", label: "农户·张大叔" },
          { username: "farmer2", password: "123456", role: "farmer", label: "农户·李婶（已有地块）" },
          { username: "merchant1", password: "123456", role: "merchant", label: "商家·绿田农资店" },
          { username: "admin", password: "123456", role: "admin", label: "后台·运维小王" },
        ],
      });
    }
    if (path === "/api/login" && method === "POST") {
      const d = db();
      const user = d.users.find((x) => x.username === (body?.username || "").trim() && x.password === body?.password);
      if (!user) return err("账号或密码错误", 400);
      const token = uid("tok_");
      d.sessions[token] = user.id;
      save(d);
      return json({ token, user: publicUser(user) });
    }
    if (path === "/api/logout" && method === "POST") {
      const d = db();
      if (auth.startsWith("Bearer ")) delete d.sessions[auth.slice(7).trim()];
      save(d);
      return json({ ok: true });
    }
    if (path === "/api/me" && method === "GET") {
      const user = userByToken(auth);
      if (!user) return err("请先登录", 401);
      return json(publicUser(user));
    }
    if (path === "/api/parcels" && method === "GET") {
      const user = userByToken(auth);
      if (!user) return err("请先登录", 401);
      const d = db();
      let items = d.parcels.map((p) => ({
        ...p,
        farmer_name: d.users.find((x) => x.id === p.farmer_id)?.display_name || "",
      }));
      if (!(user.role === "admin" || u.searchParams.get("scope") === "all")) {
        items = items.filter((p) => p.farmer_id === user.id);
      } else if (user.role !== "admin" && u.searchParams.get("scope") === "all") {
        return err("无权限", 403);
      }
      items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return json({ items });
    }
    if (path === "/api/parcels" && method === "POST") {
      const user = userByToken(auth);
      if (!user || user.role !== "farmer") return err("仅农户可认领地块", 403);
      const d = db();
      const id = uid("p_");
      d.parcels.unshift({
        id,
        farmer_id: user.id,
        name: (body.name || "").trim(),
        crop: (body.crop || "").trim(),
        area_mu: Number(body.area_mu) || 0,
        geometry: body.geometry,
        status: "pending",
        reject_reason: "",
        created_at: CST(),
        reviewed_at: "",
        reviewed_by: "",
      });
      save(d);
      return json({ id, status: "pending" });
    }
    const review = path.match(/^\/api\/parcels\/([^/]+)\/review$/);
    if (review && method === "POST") {
      const user = userByToken(auth);
      if (!user || user.role !== "admin") return err("仅后台可审核", 403);
      const d = db();
      const p = d.parcels.find((x) => x.id === review[1]);
      if (!p) return err("地块不存在", 404);
      p.status = body.action === "approve" ? "approved" : "rejected";
      p.reject_reason = p.status === "rejected" ? body.reason || "" : "";
      p.reviewed_at = CST();
      p.reviewed_by = user.id;
      save(d);
      return json({ ok: true, status: p.status });
    }
    if (path === "/api/pests" && method === "GET") {
      const user = userByToken(auth);
      if (!user) return err("请先登录", 401);
      const d = db();
      let items = d.pests.map((p) => ({
        ...p,
        farmer_name: d.users.find((x) => x.id === p.farmer_id)?.display_name || "",
      }));
      if (user.role !== "admin") items = items.filter((p) => p.farmer_id === user.id);
      return json({ items });
    }
    if (path === "/api/pests" && method === "POST") {
      const user = userByToken(auth);
      if (!user || user.role !== "farmer") return err("仅农户可上报虫情", 403);
      // FormData
      let title = "", description = "", severity = "中", parcel_id = "", lat = 0, lng = 0, photo_path = "";
      if (opts.body instanceof FormData) {
        title = opts.body.get("title") || "";
        description = opts.body.get("description") || "";
        severity = opts.body.get("severity") || "中";
        parcel_id = opts.body.get("parcel_id") || "";
        lat = parseFloat(opts.body.get("lat"));
        lng = parseFloat(opts.body.get("lng"));
        const photo = opts.body.get("photo");
        if (photo && photo instanceof Blob && photo.size) {
          photo_path = await new Promise((res) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.readAsDataURL(photo);
          });
        }
      }
      const d = db();
      const id = uid("pest_");
      d.pests.unshift({
        id,
        farmer_id: user.id,
        parcel_id,
        title: String(title).trim(),
        description: String(description),
        severity,
        lat,
        lng,
        photo_path,
        status: "open",
        created_at: CST(),
      });
      save(d);
      return json({ id, photo_path });
    }
    if (path === "/api/products" && method === "GET") {
      const user = userByToken(auth);
      if (!user) return err("请先登录", 401);
      const d = db();
      let items = d.products.slice();
      if (u.searchParams.get("mine") === "1" && user.role === "merchant") {
        items = items.filter((p) => p.merchant_id === user.id);
      } else {
        items = items
          .filter((p) => p.active)
          .map((p) => ({
            ...p,
            merchant_name: d.users.find((x) => x.id === p.merchant_id)?.display_name || "",
          }));
      }
      return json({ items });
    }
    if (path === "/api/products" && method === "POST") {
      const user = userByToken(auth);
      if (!user || user.role !== "merchant") return err("仅商家可添加商品", 403);
      const d = db();
      const id = uid("prod_");
      d.products.unshift({
        id,
        merchant_id: user.id,
        name: body.name,
        category: body.category || "农资",
        price: Number(body.price),
        unit: body.unit || "袋",
        stock: Number(body.stock) || 0,
        description: body.description || "",
        active: 1,
        created_at: CST(),
      });
      save(d);
      return json({ id });
    }
    const prodPut = path.match(/^\/api\/products\/([^/]+)$/);
    if (prodPut && method === "PUT") {
      const user = userByToken(auth);
      if (!user || user.role !== "merchant") return err("仅商家可编辑", 403);
      const d = db();
      const p = d.products.find((x) => x.id === prodPut[1] && x.merchant_id === user.id);
      if (!p) return err("商品不存在", 404);
      Object.assign(p, {
        name: body.name,
        category: body.category || "农资",
        price: Number(body.price),
        unit: body.unit || "袋",
        stock: Number(body.stock) || 0,
        description: body.description || "",
        active: body.active === false ? 0 : 1,
      });
      save(d);
      return json({ ok: true });
    }
    if (prodPut && method === "DELETE") {
      const user = userByToken(auth);
      if (!user || user.role !== "merchant") return err("仅商家可下架", 403);
      const d = db();
      const p = d.products.find((x) => x.id === prodPut[1] && x.merchant_id === user.id);
      if (!p) return err("商品不存在", 404);
      p.active = 0;
      save(d);
      return json({ ok: true });
    }
    if (path === "/api/orders" && method === "GET") {
      const user = userByToken(auth);
      if (!user) return err("请先登录", 401);
      const d = db();
      let items = d.orders.map((o) => ({
        ...o,
        farmer_name: d.users.find((x) => x.id === o.farmer_id)?.display_name || "",
        merchant_name: d.users.find((x) => x.id === o.merchant_id)?.display_name || "",
      }));
      if (user.role === "farmer") items = items.filter((o) => o.farmer_id === user.id);
      else if (user.role === "merchant") items = items.filter((o) => o.merchant_id === user.id);
      return json({ items });
    }
    if (path === "/api/orders" && method === "POST") {
      const user = userByToken(auth);
      if (!user || user.role !== "farmer") return err("仅农户可下单", 403);
      const d = db();
      const prod = d.products.find((x) => x.id === body.product_id && x.active);
      if (!prod) return err("商品不存在或已下架", 404);
      const qty = Number(body.qty) || 1;
      if (prod.stock < qty) return err(`库存不足（剩 ${prod.stock}）`, 400);
      const id = uid("ord_");
      const total = Math.round(prod.price * qty * 100) / 100;
      d.orders.unshift({
        id,
        farmer_id: user.id,
        merchant_id: prod.merchant_id,
        product_id: prod.id,
        product_name: prod.name,
        unit_price: prod.price,
        qty,
        total,
        status: "已下单",
        note: body.note || "",
        created_at: CST(),
      });
      prod.stock -= qty;
      save(d);
      return json({ id, status: "已下单", total });
    }
    const ost = path.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (ost && method === "PATCH") {
      const user = userByToken(auth);
      if (!user || (user.role !== "merchant" && user.role !== "admin")) return err("无权限", 403);
      const d = db();
      const o = d.orders.find((x) => x.id === ost[1]);
      if (!o) return err("订单不存在", 404);
      if (user.role === "merchant" && o.merchant_id !== user.id) return err("非本店订单", 403);
      o.status = body.status;
      save(d);
      return json({ ok: true });
    }
    if (path === "/api/stats" && method === "GET") {
      const user = userByToken(auth);
      if (!user || user.role !== "admin") return err("仅后台", 403);
      const d = db();
      return json({
        parcels_pending: d.parcels.filter((p) => p.status === "pending").length,
        parcels_approved: d.parcels.filter((p) => p.status === "approved").length,
        pests_open: d.pests.filter((p) => p.status === "open").length,
        orders_total: d.orders.length,
        farmers: d.users.filter((x) => x.role === "farmer").length,
        merchants: d.users.filter((x) => x.role === "merchant").length,
      });
    }
    if (path === "/health") return json({ ok: true, time: CST(), mode: "localStorage" });
    return err("mock 未实现 " + method + " " + path, 404);
  }

  window.__NX_MOCK__ = { handle, seed, db, reset: () => { localStorage.removeItem(KEY); seed(); } };

  // Auto-enable when meta tag or query or backend missing
  window.__NX_INSTALL_MOCK__ = function () {
    if (window.__NX_MOCK_INSTALLED__) return;
    window.__NX_MOCK_INSTALLED__ = true;
    const orig = window.fetch.bind(window);
    window.fetch = async function (input, init = {}) {
      const url = typeof input === "string" ? input : input.url;
      if (String(url).includes("/api/") || String(url).endsWith("/health") || String(url).includes("/health?")) {
        try {
          return await handle(url, init || {});
        } catch (e) {
          return err(String(e), 500);
        }
      }
      return orig(input, init);
    };
    console.info("[农信] localStorage mock API 已启用");
  };
})();
