/**
 * marknote 插件：任务管理全家桶（Tasks Suite）
 * ------------------------------------------------------------------
 * 用代码块围栏承载四种任务视图，数据以 JSON 存于块内（随文档保存/同步）：
 *
 *   ```tasks-kanban
 *   { "columns": { "todo": { "title": "待办", "items": [ {"id":"k1","text":"写周报"} ] }, ... } }
 *   ```
 *   ```tasks-matrix
 *   { "q1": [ {"id":"m1","text":"紧急且重要"} ], ... }   // 四象限
 *   ```
 *   ```tasks-pomodoro
 *   { "focus": 25, "rest": 5, "rounds": 4, "logs": [ {"date":"2026-08-04","n":3} ] }
 *   ```
 *   ```tasks-habit
 *   { "habits": [ {"id":"h1","name":"喝水","icon":"💧"} ], "records": { "2026-08-04": ["h1"] } }
 *   ```
 *
 * 交互：
 *   · 看板：点击「+」加卡片；拖拽/点击按钮跨列移动；点卡片编辑；点 ✕ 删除
 *   · 四象限：点击「+」加任务；点卡片编辑；点 ✕ 删除
 *   · 番茄钟：开始/暂停/重置；专注结束自动休息；累计次数按天记录
 *   · 习惯打卡：加习惯；点日期圆点打卡/取消；底部本月热力图
 *
 * 所有改动自动（防抖）写回对应代码块，随文档一起保存/同步。
 *
 * 非本插件围栏的代码块：原样以 <pre> 展示。
 *
 * 注意：插件在浏览器中按原样动态 import，不经 Vite 转译，故使用纯 JS（无 JSX）。
 */

let API = null;
const React = () => API.React;

/* ============================ 通用工具 ============================ */

function uid() {
  return "t" + Math.random().toString(36).slice(2, 9);
}

function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseJson(text) {
  try {
    const o = JSON.parse(String(text || ""));
    if (o && typeof o === "object") return o;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function serialize(lang, data) {
  return "```" + lang + "\n" + JSON.stringify(data, null, 2) + "\n```";
}

function isLang(raw, lang) {
  return new RegExp("^```" + lang + "\\b", "i").test(String(raw || "").trim());
}

/* ============================ 各功能 ============================ */

/* ---------- 看板 Kanban ---------- */

const KANBAN_DEFAULT = {
  columns: {
    todo: { title: "待办", color: "#6c8cff", items: [] },
    doing: { title: "进行中", color: "#f5a623", items: [] },
    waiting: { title: "等待", color: "#9b8cff", items: [] },
    done: { title: "已完成", color: "#4caf7d", items: [] },
  },
};

function KanbanBlock(props) {
  const R = React();
  const h = API.h;
  const [data, setData] = R.useState(() => {
    const d = parseJson(props.source) || JSON.parse(JSON.stringify(KANBAN_DEFAULT));
    return d;
  });
  const [editing, setEditing] = R.useState(null); // {col, id}
  const [draft, setDraft] = R.useState("");

  // 防抖写回
  const lastWritten = R.useRef("");
  R.useEffect(() => {
    const t = setTimeout(() => {
      const raw = serialize("tasks-kanban", data);
      if (raw !== lastWritten.current) {
        lastWritten.current = raw;
        props.updateSource(raw);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [data]);

  const addCard = (colKey) => {
    const text = draft.trim();
    if (!text) return;
    setData((d) => ({
      ...d,
      columns: {
        ...d.columns,
        [colKey]: {
          ...d.columns[colKey],
          items: [...(d.columns[colKey].items || []), { id: uid(), text }],
        },
      },
    }));
    setDraft("");
  };

  const moveCard = (colKey, itemId, targetKey) => {
    if (colKey === targetKey) return;
    setData((d) => {
      const from = d.columns[colKey];
      const item = (from.items || []).find((i) => i.id === itemId);
      if (!item) return d;
      return {
        ...d,
        columns: {
          ...d.columns,
          [colKey]: { ...from, items: (from.items || []).filter((i) => i.id !== itemId) },
          [targetKey]: {
            ...d.columns[targetKey],
            items: [...(d.columns[targetKey].items || []), item],
          },
        },
      };
    });
  };

  const deleteCard = (colKey, itemId) => {
    setData((d) => ({
      ...d,
      columns: {
        ...d.columns,
        [colKey]: {
          ...d.columns[colKey],
          items: (d.columns[colKey].items || []).filter((i) => i.id !== itemId),
        },
      },
    }));
  };

  const saveCard = (colKey, itemId) => {
    const text = draft.trim();
    if (!text) return;
    setData((d) => ({
      ...d,
      columns: {
        ...d.columns,
        [colKey]: {
          ...d.columns[colKey],
          items: (d.columns[colKey].items || []).map((i) =>
            i.id === itemId ? { ...i, text } : i,
          ),
        },
      },
    }));
    setEditing(null);
    setDraft("");
  };

  const cols = Object.entries(data.columns || {});

  return h(
    "div",
    { className: "mn-tasks mn-tasks-kanban", style: kanbanStyle.container },
    h(
      "div",
      { style: kanbanStyle.header },
      "📋 任务看板",
      h("span", { style: kanbanStyle.hint }, "点击＋添加 · 卡片可拖到其他列"),
    ),
    h(
      "div",
      { style: kanbanStyle.columns },
      cols.map(([key, col]) =>
        h(
          "div",
          { key, style: { ...kanbanStyle.column, borderTop: `3px solid ${col.color || "#6c8cff"}` } },
          h(
            "div",
            { style: kanbanStyle.colTitle },
            h("span", { style: { color: col.color || "#6c8cff" } }, col.title),
            h("span", { style: kanbanStyle.count }, (col.items || []).length),
          ),
          (col.items || []).map((item) =>
            h(
              "div",
              {
                key: item.id,
                style: kanbanStyle.card,
                draggable: true,
                onDragStart: (e) => {
                  e.dataTransfer.setData("text/plain", item.id);
                  e.dataTransfer.setData("text/tasks-col", key);
                },
                onDragOver: (e) => e.preventDefault(),
                onDrop: (e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  const from = e.dataTransfer.getData("text/tasks-col") || key;
                  moveCard(from, id, key);
                },
              },
              editing && editing.col === key && editing.id === item.id
                ? h("input", {
                    style: kanbanStyle.input,
                    value: draft,
                    autoFocus: true,
                    onChange: (e) => setDraft(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === "Enter") saveCard(key, item.id);
                      if (e.key === "Escape") {
                        setEditing(null);
                        setDraft("");
                      }
                    },
                    onBlur: () => {
                      if (draft.trim()) saveCard(key, item.id);
                      else {
                        setEditing(null);
                        setDraft("");
                      }
                    },
                  })
                : h(
                    "div",
                    {
                      style: kanbanStyle.cardText,
                      onDoubleClick: () => {
                        setEditing({ col: key, id: item.id });
                        setDraft(item.text);
                      },
                    },
                    item.text,
                  ),
              h(
                "button",
                {
                  style: kanbanStyle.delBtn,
                  title: "删除",
                  onClick: () => deleteCard(key, item.id),
                },
                "✕",
              ),
            ),
          ),
          h(
            "div",
            { style: kanbanStyle.addRow },
            h("input", {
              style: kanbanStyle.input,
              placeholder: "添加任务…",
              value: editing ? "" : draft,
              onChange: (e) => {
                if (!editing) setDraft(e.target.value);
              },
              onKeyDown: (e) => {
                if (e.key === "Enter") addCard(key);
              },
            }),
            h(
              "button",
              { style: kanbanStyle.addBtn, onClick: () => addCard(key) },
              "＋",
            ),
          ),
        ),
      ),
    ),
  );
}

const kanbanStyle = {
  container: { padding: "10px", borderRadius: "10px", background: "rgba(30,40,80,.35)", border: "1px solid rgba(120,160,255,.3)" },
  header: { fontSize: "15px", fontWeight: 700, marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px", color: "#dbe6ff" },
  hint: { fontSize: "12px", fontWeight: 400, color: "#7d8db8" },
  columns: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" },
  column: { background: "rgba(255,255,255,.06)", borderRadius: "8px", padding: "8px", minHeight: "120px" },
  colTitle: { display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: "13px", marginBottom: "6px", color: "#eef" },
  count: { background: "rgba(255,255,255,.15)", borderRadius: "10px", padding: "0 7px", fontSize: "12px", color: "#cfe" },
  card: { background: "rgba(255,255,255,.09)", borderRadius: "6px", padding: "6px 8px", marginBottom: "5px", fontSize: "13px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4px", position: "relative" },
  cardText: { flex: 1, color: "#eef" },
  delBtn: { background: "transparent", border: "none", color: "#8aa", cursor: "pointer", fontSize: "12px", padding: "0 2px", opacity: ".7" },
  input: { background: "rgba(255,255,255,.08)", border: "1px solid rgba(120,160,255,.4)", borderRadius: "5px", color: "#eef", padding: "4px 6px", fontSize: "13px", width: "100%", outline: "none" },
  addRow: { display: "flex", gap: "4px", marginTop: "6px" },
  addBtn: { background: "rgba(120,160,255,.25)", border: "1px solid rgba(120,160,255,.5)", color: "#fff", borderRadius: "5px", cursor: "pointer", fontSize: "14px", padding: "0 8px", flexShrink: 0 },
};

/* ---------- 四象限 Matrix ---------- */

const MATRIX_DEFAULT = { q1: [], q2: [], q3: [], q4: [] };

const MATRIX_META = {
  q1: { title: "紧急 · 重要", color: "#e8594c", hint: "立即做" },
  q2: { title: "不紧急 · 重要", color: "#f5a623", hint: "计划做" },
  q3: { title: "紧急 · 不重要", color: "#6c8cff", hint: "委托/快速" },
  q4: { title: "不紧急 · 不重要", color: "#4caf7d", hint: "少做/不做" },
};

function MatrixBlock(props) {
  const R = React();
  const h = API.h;
  const [data, setData] = R.useState(() => parseJson(props.source) || JSON.parse(JSON.stringify(MATRIX_DEFAULT)));
  const [editing, setEditing] = R.useState(null);
  const [draft, setDraft] = R.useState("");

  const lastWritten = R.useRef("");
  R.useEffect(() => {
    const t = setTimeout(() => {
      const raw = serialize("tasks-matrix", data);
      if (raw !== lastWritten.current) {
        lastWritten.current = raw;
        props.updateSource(raw);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [data]);

  const addTask = (q) => {
    const text = draft.trim();
    if (!text) return;
    setData((d) => ({ ...d, [q]: [...(d[q] || []), { id: uid(), text }] }));
    setDraft("");
  };

  const saveTask = (q, id) => {
    const text = draft.trim();
    if (!text) return;
    setData((d) => ({ ...d, [q]: (d[q] || []).map((i) => (i.id === id ? { ...i, text } : i)) }));
    setEditing(null);
    setDraft("");
  };

  const deleteTask = (q, id) => {
    setData((d) => ({ ...d, [q]: (d[q] || []).filter((i) => i.id !== id) }));
  };

  return h(
    "div",
    { className: "mn-tasks mn-tasks-matrix", style: matrixStyle.container },
    h(
      "div",
      { style: kanbanStyle.header },
      "🎯 四象限",
      h("span", { style: kanbanStyle.hint }, "按 紧急 × 重要 规划"),
    ),
    h(
      "div",
      { style: matrixStyle.grid },
      Object.entries(MATRIX_META).map(([q, meta]) =>
        h(
          "div",
          { key: q, style: { ...matrixStyle.quad, borderTop: `3px solid ${meta.color}` } },
          h("div", { style: matrixStyle.quadTitle },
            h("span", { style: { color: meta.color } }, `${meta.title} · ${meta.hint}`),
            h("span", { style: kanbanStyle.count }, (data[q] || []).length),
          ),
          (data[q] || []).map((item) =>
            h(
              "div",
              { key: item.id, style: matrixStyle.card },
              editing === item.id
                ? h("input", {
                    style: kanbanStyle.input,
                    value: draft,
                    autoFocus: true,
                    onChange: (e) => setDraft(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === "Enter") saveTask(q, item.id);
                      if (e.key === "Escape") { setEditing(null); setDraft(""); }
                    },
                    onBlur: () => { if (draft.trim()) saveTask(q, item.id); else { setEditing(null); setDraft(""); } },
                  })
                : h(
                    "div",
                    {
                      style: { flex: 1, cursor: "pointer" },
                      onDoubleClick: () => { setEditing(item.id); setDraft(item.text); },
                    },
                    item.text,
                  ),
              h("button", { style: kanbanStyle.delBtn, title: "删除", onClick: () => deleteTask(q, item.id) }, "✕"),
            ),
          ),
          h("div", { style: kanbanStyle.addRow },
            h("input", {
              style: kanbanStyle.input,
              placeholder: "添加任务…",
              value: editing ? "" : draft,
              onChange: (e) => { if (!editing) setDraft(e.target.value); },
              onKeyDown: (e) => { if (e.key === "Enter") addTask(q); },
            }),
            h("button", { style: kanbanStyle.addBtn, onClick: () => addTask(q) }, "＋"),
          ),
        ),
      ),
    ),
  );
}

const matrixStyle = {
  container: { padding: "10px", borderRadius: "10px", background: "rgba(30,40,80,.35)", border: "1px solid rgba(120,160,255,.3)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" },
  quad: { background: "rgba(255,255,255,.06)", borderRadius: "8px", padding: "8px", minHeight: "110px" },
  quadTitle: { display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: "13px", marginBottom: "6px", color: "#eef" },
  card: { background: "rgba(255,255,255,.09)", borderRadius: "6px", padding: "6px 8px", marginBottom: "5px", fontSize: "13px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4px", color: "#eef" },
};

/* ---------- 番茄钟 Pomodoro ---------- */

const POMO_DEFAULT = { focus: 25, rest: 5, rounds: 4, logs: {} };

function PomodoroBlock(props) {
  const R = React();
  const h = API.h;
  const [data, setData] = R.useState(() => {
    const d = parseJson(props.source) || JSON.parse(JSON.stringify(POMO_DEFAULT));
    return d;
  });
  const [running, setRunning] = R.useState(false);
  const [mode, setMode] = R.useState("focus"); // focus | rest
  const [left, setLeft] = R.useState((d) => (d?.focus || 25) * 60);
  const [round, setRound] = R.useState(1);

  const lastWritten = R.useRef("");
  R.useEffect(() => {
    const t = setTimeout(() => {
      const raw = serialize("tasks-pomodoro", data);
      if (raw !== lastWritten.current) {
        lastWritten.current = raw;
        props.updateSource(raw);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [data]);

  R.useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          // 一个阶段结束
          if (mode === "focus") {
            const today = todayStr();
            const logs = data.logs || {};
            const cur = logs[today] || 0;
            const nd = { ...data, logs: { ...logs, [today]: cur + 1 } };
            setData(nd);
            if (round >= (data.rounds || 4)) {
              // 完成一轮，回到专注
              setMode("focus");
              setLeft((data.focus || 25) * 60);
              setRound(1);
            } else {
              setMode("rest");
              setLeft((data.rest || 5) * 60);
              setRound((r) => r + 1);
            }
          } else {
            setMode("focus");
            setLeft((data.focus || 25) * 60);
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [running, mode, data]);

  const reset = () => {
    setRunning(false);
    setMode("focus");
    setLeft((data.focus || 25) * 60);
    setRound(1);
  };

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const total = (mode === "focus" ? data.focus : data.rest) * 60;
  const pct = total > 0 ? ((total - left) / total) * 100 : 0;
  const logs = data.logs || {};
  const today = todayStr();
  const todayCount = logs[today] || 0;

  return h(
    "div",
    { className: "mn-tasks mn-tasks-pomodoro", style: pomoStyle.container },
    h(
      "div",
      { style: kanbanStyle.header },
      "🍅 番茄钟",
      h("span", { style: kanbanStyle.hint }, `第 ${round}/${data.rounds || 4} 轮 · ${mode === "focus" ? "专注" : "休息"}`),
    ),
    h(
      "div",
      { style: pomoStyle.timerWrap },
      h(
        "div",
        {
          style: {
            ...pomoStyle.timer,
            borderColor: mode === "focus" ? "#f5a623" : "#4caf7d",
            background: `conic-gradient(${mode === "focus" ? "#f5a623" : "#4caf7d"} ${pct}%, rgba(255,255,255,.08) 0)`,
          },
        },
        h("span", { style: { ...pomoStyle.timerText, color: mode === "focus" ? "#f5c06a" : "#7fd8a8" } }, `${mm}:${ss}`),
      ),
    ),
    h(
      "div",
      { style: pomoStyle.controls },
      h("button", { style: pomoStyle.btn, onClick: () => setRunning(!running) },
        running ? "⏸ 暂停" : "▶ 开始"),
      h("button", { style: pomoStyle.btn, onClick: reset }, "↺ 重置"),
      h("span", { style: pomoStyle.today }, `今日已完成 ${todayCount} 个番茄`),
    ),
    h(
      "div",
      { style: pomoStyle.config },
      "专注",
      h("input", {
        type: "number", min: 1, max: 120,
        style: pomoStyle.numInput, value: data.focus || 25,
        onChange: (e) => {
          const v = Math.max(1, Number(e.target.value) || 25);
          setData((d) => ({ ...d, focus: v }));
          if (mode === "focus") setLeft(v * 60);
        },
      }),
      "min · 休息",
      h("input", {
        type: "number", min: 1, max: 60,
        style: pomoStyle.numInput, value: data.rest || 5,
        onChange: (e) => {
          const v = Math.max(1, Number(e.target.value) || 5);
          setData((d) => ({ ...d, rest: v }));
          if (mode === "rest") setLeft(v * 60);
        },
      }),
      "min · 每轮",
      h("input", {
        type: "number", min: 1, max: 12,
        style: pomoStyle.numInput, value: data.rounds || 4,
        onChange: (e) => {
          const v = Math.max(1, Number(e.target.value) || 4);
          setData((d) => ({ ...d, rounds: v }));
        },
      }),
      "个",
    ),
  );
}

const pomoStyle = {
  container: { padding: "10px", borderRadius: "10px", background: "rgba(30,40,80,.35)", border: "1px solid rgba(120,160,255,.3)" },
  timerWrap: { display: "flex", justifyContent: "center", padding: "10px 0" },
  timer: { width: "110px", height: "110px", borderRadius: "50%", border: "6px solid", display: "flex", alignItems: "center", justifyContent: "center", background: "conic-gradient(#f5a623 0%, rgba(255,255,255,.08) 0)" },
  timerText: { fontSize: "28px", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  controls: { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", flexWrap: "wrap" },
  btn: { background: "rgba(120,160,255,.25)", border: "1px solid rgba(120,160,255,.5)", color: "#fff", borderRadius: "6px", padding: "5px 14px", cursor: "pointer", fontSize: "14px" },
  today: { fontSize: "13px", color: "#8fd8aa", marginLeft: "4px" },
  config: { display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "12px", color: "#8da", marginTop: "8px", flexWrap: "wrap" },
  numInput: { background: "rgba(255,255,255,.08)", border: "1px solid rgba(120,160,255,.4)", borderRadius: "5px", color: "#eef", width: "46px", padding: "2px 4px", textAlign: "center" },
};

/* ---------- 习惯打卡 Habit ---------- */

const HABIT_DEFAULT = { habits: [], records: {} };

function HabitBlock(props) {
  const R = React();
  const h = API.h;
  const [data, setData] = R.useState(() => {
    const d = parseJson(props.source) || JSON.parse(JSON.stringify(HABIT_DEFAULT));
    return d;
  });
  const [newName, setNewName] = R.useState("");

  const lastWritten = R.useRef("");
  R.useEffect(() => {
    const t = setTimeout(() => {
      const raw = serialize("tasks-habit", data);
      if (raw !== lastWritten.current) {
        lastWritten.current = raw;
        props.updateSource(raw);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [data]);

  const addHabit = () => {
    const name = newName.trim();
    if (!name) return;
    setData((d) => ({ ...d, habits: [...(d.habits || []), { id: uid(), name, icon: "✅" }] }));
    setNewName("");
  };

  const delHabit = (id) => {
    setData((d) => {
      const habits = (d.habits || []).filter((x) => x.id !== id);
      const records = {};
      for (const [day, ids] of Object.entries(d.records || {})) {
        const n = ids.filter((x) => x !== id);
        if (n.length) records[day] = n;
      }
      return { ...d, habits, records };
    });
  };

  const toggle = (hid, day) => {
    setData((d) => {
      const rec = d.records || {};
      const dayArr = rec[day] || [];
      const has = dayArr.includes(hid);
      return {
        ...d,
        records: {
          ...rec,
          [day]: has ? dayArr.filter((x) => x !== hid) : [...dayArr, hid],
        },
      };
    });
  };

  const habits = data.habits || [];
  const records = data.records || {};
  // 最近 14 天热力
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(todayStr(-i));

  return h(
    "div",
    { className: "mn-tasks mn-tasks-habit", style: habitStyle.container },
    h(
      "div",
      { style: kanbanStyle.header },
      "🔥 习惯打卡",
      h("span", { style: kanbanStyle.hint }, "点圆点打卡 · 最近 14 天"),
    ),
    h(
      "div",
      { style: habitStyle.addRow },
      h("input", {
        style: kanbanStyle.input,
        placeholder: "新习惯，如：喝水、跑步…",
        value: newName,
        onChange: (e) => setNewName(e.target.value),
        onKeyDown: (e) => { if (e.key === "Enter") addHabit(); },
      }),
      h("button", { style: kanbanStyle.addBtn, onClick: addHabit }, "＋"),
    ),
    habits.length === 0
      ? h("div", { style: habitStyle.empty }, "还没有习惯，添加一个开始打卡吧 👆")
      : h(
          "div",
          { style: habitStyle.table },
          habits.map((hb) => (
            h(
              "div",
              { key: hb.id, style: habitStyle.row },
              h("span", { style: habitStyle.habitName }, `${hb.icon || "✅"} ${hb.name}`),
              h(
                "div",
                { style: habitStyle.days },
                days.map((day) => {
                  const on = (records[day] || []).includes(hb.id);
                  return h("button", {
                    key: day,
                    title: day + (on ? " ✅" : ""),
                    style: {
                      ...habitStyle.day,
                      background: on ? "#4caf7d" : "rgba(255,255,255,.12)",
                    },
                    onClick: () => toggle(hb.id, day),
                  });
                }),
              ),
              h(
                "button",
                { style: kanbanStyle.delBtn, title: "删除习惯", onClick: () => delHabit(hb.id) },
                "✕",
              ),
            )
          )),
        ),
  );
}

const habitStyle = {
  container: { padding: "10px", borderRadius: "10px", background: "rgba(30,40,80,.35)", border: "1px solid rgba(120,160,255,.3)" },
  addRow: { display: "flex", gap: "4px", marginBottom: "8px" },
  empty: { fontSize: "13px", color: "#8da", padding: "8px 0", textAlign: "center" },
  table: { display: "flex", flexDirection: "column", gap: "4px" },
  row: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 2px", borderBottom: "1px solid rgba(255,255,255,.06)" },
  habitName: { flex: "0 0 140px", fontSize: "13px", color: "#eef", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  days: { display: "flex", gap: "4px", flex: 1, flexWrap: "wrap" },
  day: { width: "18px", height: "18px", borderRadius: "50%", border: "none", cursor: "pointer", transition: "background .15s" },
};

/* ============================ 主渲染器 ============================ */

function TasksBlock(props) {
  const raw = String(props.raw || "").trim();
  if (isLang(raw, "tasks-kanban")) return KanbanBlock(props);
  if (isLang(raw, "tasks-matrix")) return MatrixBlock(props);
  if (isLang(raw, "tasks-pomodoro")) return PomodoroBlock(props);
  if (isLang(raw, "tasks-habit")) return HabitBlock(props);
  // 非任务围栏：回退为普通代码块
  return React().createElement("pre", { style: { margin: 0 } }, props.source);
}

/* --------------------- 激活 --------------------- */

export function activate(api) {
  API = api;
  api.log("任务管理全家桶插件已激活");
  api.registerBlockRenderer("code", TasksBlock, "tasks");
  return {
    deactivate() {
      api.log("任务管理全家桶插件已停用");
    },
  };
}

export default { activate };
