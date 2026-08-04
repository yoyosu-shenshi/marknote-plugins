/**
 * marknote 插件：思维导图（Mind Map）
 * ------------------------------------------------------------------
 * 以「代码块 + 语言 mindmap」作为载体（与 markmap 的约定一致）：
 *   写一个 ```mindmap 代码块，块内放 JSON 即可渲染成交互式思维导图。
 *
 *   JSON 结构：
 *   {
 *     "v": 1,
 *     "root": {
 *       "id": "n1", "text": "中心主题",
 *       "collapsed": false,                // 可选：折叠子树
 *       "mx": 120, "my": 80,               // 可选：手动拖拽后的绝对坐标
 *       "children": [ { "id": "n2", "text": "分支", "children": [] } ]
 *     }
 *   }
 *
 * 交互：
 *   · 选中节点 → 顶部工具栏编辑文字 / 加子节点 / 加同级 / 删除 / 折叠展开
 *   · 拖拽节点可自由摆放（子树整体跟随）
 *   · 空白处拖拽平移，工具栏 ＋/－ 缩放
 *   · 所有改动自动（防抖）写回该代码块，随文档一起保存/同步
 *
 * 非 mindmap 代码块：原样以 <pre> 展示（双击仍可编辑源码），不影响正常使用。
 *
 * 注意：插件在浏览器中按原样动态 import，不经 Vite 转译，故使用纯 JS（无 JSX）。
 */

let API = null;
const React = () => API.React;

/* --------------------- 数据工具 --------------------- */

function isMindmap(raw) {
  return /^```(mindmap|markmap)\b/i.test(String(raw || "").trim());
}

function uid() {
  return "n" + Math.random().toString(36).slice(2, 9);
}

function defaultData() {
  return { v: 1, root: { id: uid(), text: "中心主题", children: [] } };
}

function parseData(source) {
  try {
    const o = JSON.parse(String(source || ""));
    if (o && o.root) return o;
  } catch (_) {
    /* 解析失败 */
  }
  return null;
}

function serialize(data) {
  return "```mindmap\n" + JSON.stringify(data, null, 2) + "\n```";
}

function estimateWidth(text) {
  const t = String(text || " ");
  const cjk = (t.match(/[一-鿿]/g) || []).length;
  const w = cjk * 15 + (t.length - cjk) * 8 + 30;
  return Math.max(64, Math.min(260, w));
}

function cloneTree(n) {
  return { ...n, children: (n.children || []).map(cloneTree) };
}

function findNode(root, id) {
  if (root.id === id) return root;
  for (const c of root.children || []) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

function findParent(root, id) {
  for (const c of root.children || []) {
    if (c.id === id) return root;
    const r = findParent(c, id);
    if (r) return r;
  }
  return null;
}

/* --------------------- 布局（左→右树，支持手动坐标） --------------------- */

const NODE_H = 38;
const V_GAP = 18;
const LEVEL_GAP = 190;
const PAD = 34;

function layout(data) {
  const root = data.root;
  let cursorY = PAD;

  function run(node, depth) {
    node._x = PAD + depth * LEVEL_GAP;
    node._w = estimateWidth(node.text);
    const kids = node.collapsed ? [] : node.children || [];
    if (kids.length === 0) {
      node._y = cursorY + NODE_H / 2;
      cursorY += NODE_H + V_GAP;
    } else {
      kids.forEach((k) => run(k, depth + 1));
      node._y = (kids[0]._y + kids[kids.length - 1]._y) / 2;
    }
  }

  function shiftTree(node, dx, dy) {
    node._x += dx;
    node._y += dy;
    (node.children || []).forEach((c) => shiftTree(c, dx, dy));
  }

  function applyManual(node) {
    if (node.mx != null && node.my != null) {
      const dx = node.mx - node._x;
      const dy = node.my - node._y;
      node._x = node.mx;
      node._y = node.my;
      (node.children || []).forEach((c) => {
        shiftTree(c, dx, dy);
        applyManual(c);
      });
    } else {
      (node.children || []).forEach(applyManual);
    }
  }

  run(root, 0);
  applyManual(root);

  let maxX = 0;
  let maxY = 0;
  (function bb(n) {
    maxX = Math.max(maxX, n._x + (n._w || estimateWidth(n.text)));
    maxY = Math.max(maxY, n._y + NODE_H / 2);
    (n.children || []).forEach(bb);
  })(root);

  return { w: maxX + PAD, h: maxY + PAD };
}

function edgePath(p, c) {
  const x1 = p._x + (p._w || estimateWidth(p.text));
  const y1 = p._y;
  const x2 = c._x;
  const y2 = c._y;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

/* --------------------- 组件 --------------------- */

function MindMapBlock(props) {
  const R = API.React;
  const h = API.h;
  const useState = R.useState;
  const useEffect = R.useEffect;
  const useRef = R.useRef;

  const [data, setData] = useState(() => parseData(props.source) || defaultData());
  const [selectedId, setSelectedId] = useState(() => data.root.id);
  const [zoom, setZoom] = useState(1);

  const dataRef = useRef(data);
  const lastWrittenRawRef = useRef(props.raw);
  const saveTimer = useRef(null);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);

  dataRef.current = data;

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const raw = serialize(dataRef.current);
      lastWrittenRawRef.current = raw;
      try {
        props.updateSource(raw);
      } catch (_) {
        /* 忽略写入异常 */
      }
    }, 450);
  }

  // 挂载 / 切换块：仅当本块确为思维导图（lang=mindmap|markmap）时，才解析/初始化并写回。
  // 关键修复：此前对「任意代码块」都会执行该副作用，若内容非合法 JSON 就回写成 ```mindmap，
  // 导致「新建/转成代码块」被强制变成思维导图。非思维导图代码块应保持原样（<pre> 兜底）。
  useEffect(() => {
    if (!isMindmap(props.raw)) return;
    const parsed = parseData(props.source);
    if (parsed) {
      setData(parsed);
      dataRef.current = parsed;
      lastWrittenRawRef.current = props.raw;
      setSelectedId(parsed.root.id);
    } else {
      const d = defaultData();
      setData(d);
      dataRef.current = d;
      const raw = serialize(d);
      lastWrittenRawRef.current = raw;
      setSelectedId(d.root.id);
      try {
        props.updateSource(raw);
      } catch (_) {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.blockId]);

  // 外部（其它客户端/重载）改动：仅在不是我们自己刚写回时同步
  useEffect(() => {
    if (props.raw === lastWrittenRawRef.current) return;
    const parsed = parseData(props.source);
    if (parsed) {
      setData(parsed);
      dataRef.current = parsed;
      lastWrittenRawRef.current = props.raw;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.raw]);

  // 变更助手：克隆树 → 执行 mutator → 更新状态并防抖写回
  function update(mutator) {
    const next = { v: data.v || 1, root: cloneTree(data.root) };
    mutator(next.root);
    setData(next);
    dataRef.current = next;
    scheduleSave();
    return next;
  }

  function addChild(id) {
    const nid = uid();
    update((root) => {
      const n = findNode(root, id);
      if (n) {
        n.children = n.children || [];
        n.children.push({ id: nid, text: "新节点", children: [] });
        n.collapsed = false;
      }
    });
    setSelectedId(nid);
  }

  function addSibling(id) {
    if (id === data.root.id) return; // 根无同级
    const nid = uid();
    update((root) => {
      const p = findParent(root, id);
      if (!p) return;
      const idx = (p.children || []).findIndex((c) => c.id === id);
      p.children.splice(idx + 1, 0, { id: nid, text: "新节点", children: [] });
    });
    setSelectedId(nid);
  }

  function deleteNode(id) {
    if (id === data.root.id) return; // 根不可删
    update((root) => {
      const p = findParent(root, id);
      if (p) p.children = (p.children || []).filter((c) => c.id !== id);
    });
    setSelectedId(data.root.id);
  }

  function setText(id, text) {
    update((root) => {
      const n = findNode(root, id);
      if (n) n.text = text;
    });
  }

  function toggleCollapse(id) {
    update((root) => {
      const n = findNode(root, id);
      if (n) n.collapsed = !n.collapsed;
    });
  }

  function setPos(id, mx, my) {
    update((root) => {
      const n = findNode(root, id);
      if (n) {
        n.mx = Math.round(mx);
        n.my = Math.round(my);
      }
    });
  }

  /* 拖拽节点 */
  function onNodeMouseDown(e, node) {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseX = node.mx != null ? node.mx : node._x;
    const baseY = node.my != null ? node.my : node._y;
    dragRef.current = { id: node.id, startX, startY, baseX, baseY, zoom };
    function move(ev) {
      const d = dragRef.current;
      if (!d) return;
      const z = d.zoom || 1;
      const mx = d.baseX + (ev.clientX - d.startX) / z;
      const my = d.baseY + (ev.clientY - d.startY) / z;
      setData((prev) => {
        const next = { v: prev.v || 1, root: cloneTree(prev.root) };
        const n = findNode(next.root, d.id);
        if (n) {
          n.mx = Math.round(mx);
          n.my = Math.round(my);
        }
        dataRef.current = next;
        return next;
      });
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      dragRef.current = null;
      scheduleSave();
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  /* 平移（空白拖拽） */
  function onBgMouseDown(e) {
    if (e.target.closest && e.target.closest(".mn-mm-node")) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const sl = wrap.scrollLeft;
    const st = wrap.scrollTop;
    panRef.current = true;
    function move(ev) {
      wrap.scrollLeft = sl - (ev.clientX - startX);
      wrap.scrollTop = st - (ev.clientY - startY);
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      panRef.current = false;
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function onZoom(delta) {
    setZoom((z) => Math.max(0.3, Math.min(2.5, z * delta)));
  }

  function resetView() {
    setZoom(1);
    const wrap = wrapRef.current;
    if (wrap) {
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;
    }
  }

  // 非 mindmap：原样预览（双击可编辑源码）
  if (!isMindmap(props.raw)) {
    return h(
      "pre",
      { className: "mn-mm-codefallback", "data-mm": "0" },
      props.source || "",
    );
  }

  const lo = layout(data);
  const svgW = Math.max(lo.w * zoom, 200);
  const svgH = Math.max(lo.h * zoom, 120);

  const edges = [];
  const nodes = [];
  (function collect(n) {
    const hasKids = (n.children || []).length > 0;
    if (!n.collapsed && hasKids) {
      (n.children || []).forEach((c) => {
        edges.push(
          h("path", {
            key: "e" + c.id,
            d: edgePath(n, c),
            fill: "none",
            stroke: "#94a3b8",
            strokeWidth: 2,
          }),
        );
        collect(c);
      });
    }
    const selected = n.id === selectedId;
    const w = n._w || estimateWidth(n.text);
    nodes.push(
      h(
        "g",
        {
          key: "n" + n.id,
          className: "mn-mm-node",
          transform: `translate(${n._x}, ${n._y - NODE_H / 2})`,
          onMouseDown: (e) => onNodeMouseDown(e, n),
          onClick: (e) => {
            e.stopPropagation();
            setSelectedId(n.id);
          },
          style: { cursor: "grab" },
        },
        h("rect", {
          x: 0,
          y: 0,
          width: w,
          height: NODE_H,
          rx: 9,
          ry: 9,
          fill: selected ? "#eef2ff" : "#ffffff",
          stroke: selected ? "#4f46e5" : "#cbd5e1",
          strokeWidth: selected ? 2.4 : 1.4,
        }),
        h(
          "text",
          {
            x: w / 2,
            y: NODE_H / 2,
            "text-anchor": "middle",
            "dominant-baseline": "central",
            fontSize: 14,
            fill: "#1f2937",
            style: { pointerEvents: "none", userSelect: "none" },
          },
          String(n.text || " "),
        ),
        // 折叠/展开开关
        hasKids
          ? h(
              "g",
              {
                key: "t" + n.id,
                transform: `translate(${w + 12}, ${NODE_H / 2})`,
                onClick: (e) => {
                  e.stopPropagation();
                  toggleCollapse(n.id);
                },
                style: { cursor: "pointer" },
              },
              h("circle", {
                cx: 0,
                cy: 0,
                r: 9,
                fill: "#4f46e5",
              }),
              h(
                "text",
                {
                  x: 0,
                  y: 1,
                  "text-anchor": "middle",
                  "dominant-baseline": "central",
                  fontSize: 13,
                  fill: "#fff",
                  style: { pointerEvents: "none", userSelect: "none" },
                },
                n.collapsed ? "+" : "−",
              ),
            )
          : null,
      ),
    );
  })(data.root);

  const sel = findNode(data.root, selectedId);
  const isRoot = selectedId === data.root.id;

  return h(
    "div",
    {
      className: "mn-mm",
      onMouseDown: (e) => {
        e.stopPropagation();
      },
      onClick: (e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) setSelectedId(data.root.id);
      },
    },
    // 工具栏
    h(
      "div",
      { className: "mn-mm-toolbar" },
      h("input", {
        className: "mn-mm-text",
        type: "text",
        placeholder: "选中节点后在此编辑文字",
        value: sel ? sel.text : "",
        disabled: !sel,
        onChange: (e) => sel && setText(sel.id, e.target.value),
        onMouseDown: (e) => e.stopPropagation(),
      }),
      h(
        "button",
        {
          className: "mn-mm-btn",
          title: "添加子节点",
          onClick: (e) => {
            e.stopPropagation();
            addChild(selectedId);
          },
        },
        "＋子",
      ),
      h(
        "button",
        {
          className: "mn-mm-btn",
          title: "添加同级节点",
          disabled: isRoot,
          onClick: (e) => {
            e.stopPropagation();
            addSibling(selectedId);
          },
        },
        "＋同级",
      ),
      h(
        "button",
        {
          className: "mn-mm-btn mn-mm-danger",
          title: "删除节点",
          disabled: isRoot,
          onClick: (e) => {
            e.stopPropagation();
            deleteNode(selectedId);
          },
        },
        "🗑",
      ),
      h(
        "button",
        {
          className: "mn-mm-btn",
          title: "放大",
          onClick: (e) => {
            e.stopPropagation();
            onZoom(1.15);
          },
        },
        "＋",
      ),
      h(
        "button",
        {
          className: "mn-mm-btn",
          title: "缩小",
          onClick: (e) => {
            e.stopPropagation();
            onZoom(0.87);
          },
        },
        "－",
      ),
      h(
        "button",
        {
          className: "mn-mm-btn",
          title: "适应",
          onClick: (e) => {
            e.stopPropagation();
            resetView();
          },
        },
        "⤢",
      ),
    ),
    // 画布
    h(
      "div",
      { className: "mn-mm-wrap", ref: wrapRef, onMouseDown: onBgMouseDown },
      h(
        "svg",
        { width: svgW, height: svgH, className: "mn-mm-svg" },
        h("g", { transform: `scale(${zoom})` }, edges.concat(nodes)),
      ),
    ),
    h(
      "div",
      { className: "mn-mm-hint" },
      "拖拽节点摆放 · 空白拖拽平移 · 选中节点后可增删/编辑 · 数据存于该 ```mindmap 代码块",
    ),
  );
}

/* --------------------- 激活 --------------------- */

export function activate(api) {
  API = api;
  api.log("思维导图插件已激活");
  // fence 路由：仅接管 ```mindmap 围栏的 code 块，与其他插件（如任务管理）共存
  api.registerBlockRenderer("code", MindMapBlock, "mindmap");
  return {
    deactivate() {
      api.log("思维导图插件已停用");
    },
  };
}

export default { activate };
