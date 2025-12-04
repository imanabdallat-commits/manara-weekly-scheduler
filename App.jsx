import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarDays,
  ListTodo,
  Wand2,
  Upload,
  Download,
  Trash2,
  Plus,
  Info,
  Pencil,
  X,
} from "lucide-react";

/**
 * Manara Boarding School Scheduler (single-file React app)
 *
 * Features:
 * - Sunday-first Week 1 / Week 2 alternating templates
 * - Tasks with due date, estimated minutes, priority
 * - Click task to edit (modal)
 * - Per-task auto-schedule: click wand, pick week + starting day,
 *   confirm before overwriting that task’s placements
 * - Drag scheduled items to other FREE blocks
 * - Click any non-free block to force FREE
 * - Click forced-free block again to UNDO (back to fixed)
 * - Week 1 / Week 2 forced-free overrides are SEPARATE
 * - Study Hall treated as FREE (green) but label preserved
 * - Click a FREE block to quick-add a task into that block
 * - Click blue scheduled task to delete placement
 * - Marking task done asks to remove from schedule too
 * - Done tasks show strikethrough on schedule
 * - Chunker generates editable chunks
 * - LocalStorage persistence + export/import
 */

// --------- DEFAULT TEMPLATES ---------
const DEFAULT_TEMPLATES = {
  weekStartsOn: "Sunday",
  templates: {
    week1: { grid: [], blocks: [], notes: [] },
    week2: { grid: [], blocks: [], notes: [] },
  },
};

const LS_KEY = "manara_scheduler_v1";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const BLOCK_TYPE = {
  FIXED: "fixed",
  FREE: "free",
};

// ---------- Helpers ----------
function inferBlockType(label) {
  if (!label) return BLOCK_TYPE.FREE;
  const s = String(label).toLowerCase();

  // Study Hall treated as FREE
  if (s.includes("study hall")) return BLOCK_TYPE.FREE;

  const fixedWords = [
    "breakfast",
    "lunch",
    "dinner",
    "meeting",
    "assembly",
    "check-in",
    "lights out",
    "religious",
    "athletics",
    "pe",
    "dorm",
    "advisory",
    "win",
  ];
  const freeWords = ["free", "open", "blank"];

  if (freeWords.some((w) => s.includes(w))) return BLOCK_TYPE.FREE;
  if (fixedWords.some((w) => s.includes(w))) return BLOCK_TYPE.FIXED;

  if (/^(block\s*)?[a-z]$/i.test(s)) return BLOCK_TYPE.FIXED;
  return BLOCK_TYPE.FIXED;
}

function toMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function parseRange(r) {
  if (!r) return null;
  const parts = r.split("-");
  if (parts.length !== 2) return null;
  const start = parts[0];
  const end = parts[1];
  if (!start || !end) return null;
  return { start, end, startMin: toMin(start), endMin: toMin(end) };
}
function durationMin(range) {
  return range.endMin - range.startMin;
}

// Build free slots from template, respecting per-week overrides
function buildSlots(template, weekOverrides = {}) {
  const rows = (template.grid || []).map((row) => ({
    range: parseRange(`${row.start}-${row.end}`),
    days: row.days || {},
  }));

  const slots = [];
  for (const row of rows) {
    if (!row.range) continue;
    for (const day of DAYS) {
      const label = row.days[day] ?? null;
      const key = `${day}_${row.range.start}_${row.range.end}`;
      const forcedFree = !!weekOverrides[key];
      const type = forcedFree ? BLOCK_TYPE.FREE : inferBlockType(label);
      if (type === BLOCK_TYPE.FREE) {
        slots.push({
          id: key,
          day,
          start: row.range.start,
          end: row.range.end,
          startMin: row.range.startMin,
          endMin: row.range.endMin,
          minutes: durationMin(row.range),
        });
      }
    }
  }

  return slots.sort(
    (a, b) =>
      DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startMin - b.startMin
  );
}

// ---------- Chunk templates ----------
const CHUNK_TEMPLATES = {
  essay: [
    { title: "Choose topic + gather sources", pct: 0.2 },
    { title: "Outline", pct: 0.12 },
    { title: "Draft part 1", pct: 0.28 },
    { title: "Draft part 2", pct: 0.28 },
    { title: "Edit + citations", pct: 0.1 },
    { title: "Final proof", pct: 0.02 },
  ],
  exam: [
    { title: "Review notes (unit 1)", pct: 0.25 },
    { title: "Practice problems", pct: 0.35 },
    { title: "Timed past paper", pct: 0.2 },
    { title: "Error review", pct: 0.15 },
    { title: "Final recap", pct: 0.05 },
  ],
  lab: [
    { title: "Background reading", pct: 0.2 },
    { title: "Plan/Design", pct: 0.15 },
    { title: "Data collection", pct: 0.25 },
    { title: "Analysis", pct: 0.2 },
    { title: "Write-up", pct: 0.18 },
    { title: "Polish + submit", pct: 0.02 },
  ],
};

// ======================================================
// App
// ======================================================
export default function App() {
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [activeWeek, setActiveWeek] = useState("week1");
  const [tasks, setTasks] = useState([]);
  const [placements, setPlacements] = useState([]);
  const [freeOverrides, setFreeOverrides] = useState({ week1: {}, week2: {} });
  const [view, setView] = useState("schedule");
  const [week1StartSunday, setWeek1StartSunday] = useState("2026-01-04");
  const [autoPick, setAutoPick] = useState(null);

  // Load LS
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.templates) setTemplates(data.templates);
      if (data.activeWeek) setActiveWeek(data.activeWeek);
      if (data.tasks) setTasks(data.tasks);
      if (data.placements) setPlacements(data.placements);
      if (data.freeOverrides) {
        if (data.freeOverrides.week1 || data.freeOverrides.week2) {
          setFreeOverrides({
            week1: data.freeOverrides.week1 || {},
            week2: data.freeOverrides.week2 || {},
          });
        } else {
          setFreeOverrides({ week1: data.freeOverrides, week2: {} });
        }
      }
      if (data.week1StartSunday) setWeek1StartSunday(data.week1StartSunday);
    } catch {}
  }, []);

  // Persist LS
  useEffect(() => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        templates,
        activeWeek,
        tasks,
        placements,
        freeOverrides,
        week1StartSunday,
      })
    );
  }, [templates, activeWeek, tasks, placements, freeOverrides, week1StartSunday]);

  // Current week based on week1StartSunday
  const currentWeekKey = useMemo(() => {
    const start = new Date(week1StartSunday + "T00:00:00");
    const now = new Date();
    const diffWeeks = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000));
    return diffWeeks % 2 === 0 ? "week1" : "week2";
  }, [week1StartSunday]);

  const template =
    templates.templates?.[activeWeek] || DEFAULT_TEMPLATES.templates.week1;
  const activeWeekOverrides = freeOverrides[activeWeek] || {};

  // ----- Task ops -----
  function addTask(t) {
    const id = crypto.randomUUID();
    setTasks((prev) => [{ ...t, id, status: "todo" }, ...prev]);
    return id;
  }
  function updateTask(id, patch) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function removeTask(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setPlacements((prev) => prev.filter((p) => p.taskId !== id));
  }
  function removePlacement(placementId) {
    setPlacements((prev) => prev.filter((p) => p.id !== placementId));
  }

  function toggleDone(taskId) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const nextStatus = task.status === "done" ? "todo" : "done";

    if (nextStatus === "done") {
      const placed = placements.some((p) => p.taskId === taskId);
      if (placed) {
        const removeAlso = window.confirm(
          `Marking "${task.title}" done. Remove it from schedule too?`
        );
        if (removeAlso) {
          setPlacements((prev) => prev.filter((p) => p.taskId !== taskId));
        }
      }
    }

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus } : t))
    );
  }

  function autoScheduleTaskInternal(taskId, targetWeek, startDay) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === "done") return;

    const targetTemplate =
      templates.templates?.[targetWeek] || DEFAULT_TEMPLATES.templates.week1;
    const targetWeekOverrides = freeOverrides[targetWeek] || {};
    const allSlots = buildSlots(targetTemplate, targetWeekOverrides);

    const startIdx = DAYS.indexOf(startDay);
    const orderedDays =
      startIdx >= 0
        ? [...DAYS.slice(startIdx), ...DAYS.slice(0, startIdx)]
        : DAYS;

    const slots = [...allSlots].sort(
      (a, b) =>
        orderedDays.indexOf(a.day) - orderedDays.indexOf(b.day) ||
        a.startMin - b.startMin
    );

    let remaining = Number(task.estimatedMin) || 0;
    const newPlacements = [];

    for (let i = 0; i < slots.length && remaining > 0; i++) {
      const s = slots[i];
      const take = Math.min(remaining, s.minutes);
      if (take < 15) continue;

      const startMin = s.startMin;
      const endMin = startMin + take;

      newPlacements.push({
        id: crypto.randomUUID(),
        taskId,
        week: targetWeek,
        day: s.day,
        start: toHHMM(startMin),
        end: toHHMM(endMin),
      });

      remaining -= take;

      if (take === s.minutes) {
        slots.splice(i, 1);
        i--;
      } else {
        slots[i] = {
          ...s,
          startMin: endMin,
          start: toHHMM(endMin),
          minutes: s.endMin - endMin,
        };
      }
    }

    setPlacements((prev) => [...newPlacements, ...prev]);
    setView("schedule");
  }

  function requestAutoScheduleTask(taskId) {
    setAutoPick({ taskId, week: activeWeek, day: "Sunday" });
  }

  function handleTemplateUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data?.templates?.week1 && data?.templates?.week2) {
          setTemplates(data);
        } else if (data?.templates) {
          setTemplates({ ...DEFAULT_TEMPLATES, templates: data.templates });
        } else {
          alert("JSON not recognized.");
        }
      } catch {
        alert("Could not read this JSON.");
      }
    };
    reader.readAsText(file);
  }

  function exportData() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            templates,
            tasks,
            placements,
            freeOverrides,
            week1StartSunday,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "manara_scheduler_export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function quickAddToSlot(slot, taskDraft) {
    const occupied = placements.some(
      (p) =>
        (p.week || activeWeek) === activeWeek &&
        p.day === slot.day &&
        p.start === slot.start &&
        p.end === slot.end
    );

    if (occupied) {
      const ok = window.confirm(
        "This block already has tasks. Add another here anyway?"
      );
      if (!ok) return;
    }

    const taskId = addTask(taskDraft);
    setPlacements((prev) => [
      {
        id: crypto.randomUUID(),
        taskId,
        week: activeWeek,
        day: slot.day,
        start: slot.start,
        end: slot.end,
      },
      ...prev,
    ]);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        activeWeek={activeWeek}
        setActiveWeek={setActiveWeek}
        currentWeekKey={currentWeekKey}
        view={view}
        setView={setView}
        week1StartSunday={week1StartSunday}
        setWeek1StartSunday={setWeek1StartSunday}
        onUpload={handleTemplateUpload}
        onExport={exportData}
      />

      <main className="max-w-6xl mx-auto px-4 pb-16">
        <AnimatePresence mode="wait">
          {view === "schedule" && (
            <motion.div
              key="schedule"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ScheduleView
                template={template}
                activeWeek={activeWeek}
                placements={placements}
                tasks={tasks}
                weekOverrides={activeWeekOverrides}
                onToggleFreeBlock={(key) =>
                  setFreeOverrides((prev) => {
                    const next = {
                      week1: { ...(prev.week1 || {}) },
                      week2: { ...(prev.week2 || {}) },
                    };
                    const bag = { ...(next[activeWeek] || {}) };
                    if (bag[key]) delete bag[key];
                    else bag[key] = true;
                    next[activeWeek] = bag;
                    return next;
                  })
                }
                onMovePlacement={(placementId, target) => {
                  setPlacements((prev) =>
                    prev.map((p) =>
                      p.id === placementId
                        ? {
                            ...p,
                            week: target.week ?? p.week ?? activeWeek,
                            day: target.day,
                            start: target.start,
                            end: target.end,
                          }
                        : p
                    )
                  );
                }}
                onQuickAdd={quickAddToSlot}
                onDeletePlacement={removePlacement}
              />
            </motion.div>
          )}

          {view === "tasks" && (
            <motion.div
              key="tasks"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <TasksView
                tasks={tasks}
                addTask={addTask}
                updateTask={updateTask}
                removeTask={removeTask}
                toggleDone={toggleDone}
                onAutoScheduleTask={requestAutoScheduleTask}
              />
            </motion.div>
          )}

          {view === "chunker" && (
            <motion.div
              key="chunker"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ChunkerView
                onCreateTasks={(newTasks) =>
                  setTasks((prev) => [...newTasks, ...prev])
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <FloatingActions setView={setView} />

      {/* Auto-schedule picker modal */}
      <AnimatePresence>
        {autoPick && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
            onClick={() => setAutoPick(null)}
          >
            <motion.div
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-2xl p-4 border border-slate-200 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-lg">Auto-schedule task</div>
                <button
                  onClick={() => setAutoPick(null)}
                  className="p-1 rounded hover:bg-slate-100"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 grid gap-3">
                <div className="grid gap-1">
                  <label className="text-xs font-medium text-slate-600">
                    Week
                  </label>
                  <select
                    value={autoPick.week}
                    onChange={(e) =>
                      setAutoPick((p) => ({ ...p, week: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl border border-slate-200"
                  >
                    <option value="week1">Week 1</option>
                    <option value="week2">Week 2</option>
                  </select>
                </div>

                <div className="grid gap-1">
                  <label className="text-xs font-medium text-slate-600">
                    Starting day
                  </label>
                  <select
                    value={autoPick.day}
                    onChange={(e) =>
                      setAutoPick((p) => ({ ...p, day: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl border border-slate-200"
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setAutoPick(null)}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const existing = placements.filter(
                        (p) =>
                          p.taskId === autoPick.taskId &&
                          (p.week || activeWeek) === autoPick.week
                      );

                      if (existing.length > 0) {
                        const task = tasks.find(
                          (t) => t.id === autoPick.taskId
                        );
                        const ok = window.confirm(
                          `"${task?.title ?? "This task"}" already has scheduled time in ${
                            autoPick.week === "week1" ? "Week 1" : "Week 2"
                          }. Overwrite its placements?`
                        );
                        if (!ok) return;

                        setPlacements((prev) =>
                          prev.filter(
                            (p) =>
                              !(
                                p.taskId === autoPick.taskId &&
                                (p.week || activeWeek) === autoPick.week
                              )
                          )
                        );
                      }

                      autoScheduleTaskInternal(
                        autoPick.taskId,
                        autoPick.week,
                        autoPick.day
                      );
                      setAutoPick(null);
                    }}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 text-white"
                  >
                    Schedule
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------------------------------
   Header
-------------------------------------------------- */
function Header({
  activeWeek,
  setActiveWeek,
  currentWeekKey,
  view,
  setView,
  week1StartSunday,
  setWeek1StartSunday,
  onUpload,
  onExport,
}) {
  return (
    <div className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold">
            M
          </div>
          <div>
            <div className="font-semibold">Manara Weekly Scheduler</div>
            <div className="text-xs text-slate-600">
              Sunday-first • Alternating Week 1 / Week 2
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setActiveWeek("week1")}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                activeWeek === "week1" ? "bg-white shadow" : "text-slate-700"
              }`}
            >
              Week 1{" "}
              {currentWeekKey === "week1" && (
                <span className="text-xs text-emerald-600">(current)</span>
              )}
            </button>
            <button
              onClick={() => setActiveWeek("week2")}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                activeWeek === "week2" ? "bg-white shadow" : "text-slate-700"
              }`}
            >
              Week 2{" "}
              {currentWeekKey === "week2" && (
                <span className="text-xs text-emerald-600">(current)</span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setView("schedule")}
              className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 ${
                view === "schedule" ? "bg-white shadow" : "text-slate-700"
              }`}
            >
              <CalendarDays className="h-4 w-4" />
              Schedule
            </button>
            <button
              onClick={() => setView("tasks")}
              className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 ${
                view === "tasks" ? "bg-white shadow" : "text-slate-700"
              }`}
            >
              <ListTodo className="h-4 w-4" />
              Tasks
            </button>
            <button
              onClick={() => setView("chunker")}
              className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 ${
                view === "chunker" ? "bg-white shadow" : "text-slate-700"
              }`}
            >
              <Wand2 className="h-4 w-4" />
              Chunker
            </button>
          </div>

          <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-sm">
            <Upload className="h-4 w-4" /> Upload templates JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={onUpload}
            />
          </label>

          <button
            onClick={onExport}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-sm"
          >
            <Download className="h-4 w-4" /> Export data
          </button>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Week 1 starts:</span>
            <input
              type="date"
              value={week1StartSunday}
              onChange={(e) => setWeek1StartSunday(e.target.value)}
              className="px-2 py-1 rounded-lg border border-slate-200 bg-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------
   ScheduleView
-------------------------------------------------- */
function ScheduleView({
  template,
  activeWeek,
  placements,
  tasks,
  weekOverrides,
  onToggleFreeBlock,
  onMovePlacement,
  onQuickAdd,
  onDeletePlacement,
}) {
  const rows = template.grid || [];
  const taskById = useMemo(
    () => Object.fromEntries(tasks.map((t) => [t.id, t])),
    [tasks]
  );

  const placementsBySlot = useMemo(() => {
    const map = {};
    for (const p of placements) {
      const week = p.week || activeWeek;
      if (week !== activeWeek) continue;
      const key = `${p.day}_${p.start}_${p.end}`;
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    return map;
  }, [placements, activeWeek]);

  const [quickAdd, setQuickAdd] = useState(null);
  const slotKey = (day, start, end) => `${day}_${start}_${end}`;

  function isFree(day, start, end, label) {
    const key = slotKey(day, start, end);
    if (weekOverrides?.[key]) return true;
    return inferBlockType(label) === BLOCK_TYPE.FREE;
  }

  function onDragStart(e, placementId) {
    e.dataTransfer.setData("text/placementId", placementId);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDropToCell(e, day, start, end, label) {
    e.preventDefault();
    const placementId = e.dataTransfer.getData("text/placementId");
    if (!placementId) return;
    if (!isFree(day, start, end, label)) return;
    onMovePlacement(placementId, { week: activeWeek, day, start, end });
  }

  function openQuickAdd(slot) {
    setQuickAdd({
      slot,
      title: "",
      dueDate: "",
      estimatedMin: slot.minutes || 60,
      priority: "medium",
    });
  }

  return (
    <div className="mt-5 grid gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Weekly Schedule</h2>
          <div className="text-xs text-slate-600 flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-slate-200" />
              Fixed
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-emerald-100 border border-emerald-200" />
              Free (incl. Study Hall)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-indigo-100 border border-indigo-200" />
              Scheduled Task
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-8 sticky top-0 bg-white z-10">
              <div className="p-2 text-xs font-semibold text-slate-500">Time</div>
              {DAYS.map((d) => (
                <div key={d} className="p-2 text-xs font-semibold text-slate-700">
                  {d}
                </div>
              ))}
            </div>

            {rows.map((r, idx) => {
              const fixedRange = `${r.start}-${r.end}`;
              const rowRange = parseRange(fixedRange);

              return (
                <div key={idx} className="grid grid-cols-8 border-t border-slate-100">
                  <div className="p-2 text-xs text-slate-600 whitespace-nowrap">
                    {fixedRange}
                  </div>

                  {DAYS.map((day) => {
                    const label = r.days?.[day] ?? null;
                    const key = slotKey(day, r.start, r.end);

                    const forcedFree = !!weekOverrides?.[key];
                    const inferredType = inferBlockType(label);
                    const cellFree = forcedFree || inferredType === BLOCK_TYPE.FREE;

                    const ps = placementsBySlot[key] || [];
                    const slot = {
                      id: key,
                      day,
                      start: r.start,
                      end: r.end,
                      minutes: rowRange ? durationMin(rowRange) : 60,
                    };

                    return (
                      <div key={day} className="p-1.5">
                        <div
                          onClick={() => {
                            if (forcedFree) {
                              onToggleFreeBlock(key);
                              return;
                            }
                            if (cellFree) openQuickAdd(slot);
                            else onToggleFreeBlock(key);
                          }}
                          onDragOver={(e) => {
                            if (cellFree) e.preventDefault();
                          }}
                          onDrop={(e) => onDropToCell(e, day, r.start, r.end, label)}
                          title={
                            forcedFree
                              ? "Click to undo forced-free"
                              : cellFree
                              ? "Click to add a task here"
                              : "Click to mark as Free"
                          }
                          className={`min-h-[42px] rounded-lg px-2 py-1 text-xs border cursor-pointer transition ${
                            cellFree
                              ? "bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                              : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {label && (
                            <div className="font-medium whitespace-pre-wrap">{label}</div>
                          )}

                          {cellFree && !label && (
                            <div className="text-slate-400 italic">Free</div>
                          )}

                          {forcedFree && inferredType !== BLOCK_TYPE.FREE && (
                            <div className="text-[10px] text-emerald-700 mt-0.5">(forced free)</div>
                          )}

                          {ps.length > 0 && (
                            <div className="mt-1 grid gap-1">
                              {ps.map((p) => {
                                const t = taskById[p.taskId];
                                if (!t) return null;
                                const done = t.status === "done";
                                return (
                                  <div
                                    key={p.id}
                                    draggable
                                    onDragStart={(e) => onDragStart(e, p.id)}
                                    className={`bg-indigo-50 border border-indigo-200 rounded px-2 py-1 cursor-move group relative ${
                                      done ? "opacity-60" : ""
                                    }`}
                                    title="Drag me to another free block"
                                  >
                                    <div className={`font-semibold pr-6 ${done ? "line-through" : ""}`}>
                                      {t.title}
                                    </div>
                                    <div className={`text-[10px] text-slate-600 ${done ? "line-through" : ""}`}>
                                      {p.start}–{p.end} • due {t.dueDate}
                                    </div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onDeletePlacement(p.id);
                                      }}
                                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-indigo-100"
                                      title="Remove from schedule"
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-indigo-700" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {template.notes?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 font-semibold">
            <Info className="h-4 w-4" /> Tues & Sat timing notes
          </div>
          <div className="mt-2 text-sm text-slate-700 flex flex-wrap gap-2">
            {template.notes.map((n, i) => (
              <span key={i} className="px-2 py-1 rounded-lg bg-slate-100 text-xs">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {quickAdd && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
            onClick={() => setQuickAdd(null)}
          >
            <motion.div
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-2xl p-4 border border-slate-200 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="font-semibold text-lg">
                Add task to {quickAdd.slot.day} {quickAdd.slot.start}–{quickAdd.slot.end}
              </div>

              <div className="mt-3 grid gap-2">
                <label className="text-xs font-medium text-slate-600">Task title</label>
                <input
                  value={quickAdd.title}
                  onChange={(e) => setQuickAdd((q) => ({ ...q, title: e.target.value }))}
                  className="px-3 py-2 rounded-xl border border-slate-200"
                  placeholder="e.g., Chemistry homework"
                />

                <label className="text-xs font-medium text-slate-600 mt-1">Due date</label>
                <input
                  type="date"
                  value={quickAdd.dueDate || ""}
                  onChange={(e) => setQuickAdd((q) => ({ ...q, dueDate: e.target.value }))}
                  className="px-3 py-2 rounded-xl border border-slate-200"
                />

                <label className="text-xs font-medium text-slate-600 mt-1">Estimated minutes</label>
                <input
                  type="number"
                  min={10}
                  step={5}
                  value={quickAdd.estimatedMin}
                  onChange={(e) =>
                    setQuickAdd((q) => ({ ...q, estimatedMin: Number(e.target.value) }))
                  }
                  className="px-3 py-2 rounded-xl border border-slate-200"
                />

                <label className="text-xs font-medium text-slate-600 mt-1">Priority</label>
                <select
                  value={quickAdd.priority}
                  onChange={(e) => setQuickAdd((q) => ({ ...q, priority: e.target.value }))}
                  className="px-3 py-2 rounded-xl border border-slate-200"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setQuickAdd(null)}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!quickAdd.title.trim()) return;
                      onQuickAdd(quickAdd.slot, {
                        title: quickAdd.title.trim(),
                        dueDate: quickAdd.dueDate || new Date().toISOString().slice(0, 10),
                        estimatedMin: quickAdd.estimatedMin,
                        priority: quickAdd.priority,
                      });
                      setQuickAdd(null);
                    }}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 text-white"
                  >
                    Add to this block
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------------------------------
   TasksView
-------------------------------------------------- */
function TasksView({
  tasks,
  addTask,
  updateTask,
  removeTask,
  toggleDone,
  onAutoScheduleTask,
}) {
  const [form, setForm] = useState({
    title: "",
    dueDate: "",
    estimatedMin: 60,
    priority: "medium",
  });
  const [editing, setEditing] = useState(null);

  const upcoming = tasks.filter((t) => t.status !== "done").length;

  function openEdit(t) {
    setEditing({ ...t });
  }

  return (
    <div className="mt-5 grid md:grid-cols-3 gap-4">
      <div className="md:col-span-1 bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Plus className="h-5 w-5" /> Add Task
        </h2>

        <div className="mt-3 grid gap-2">
          <label className="text-xs font-medium text-slate-600">Task title</label>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="px-3 py-2 rounded-xl border border-slate-200"
            placeholder="e.g., Math homework"
          />

          <label className="text-xs font-medium text-slate-600 mt-2">Due date</label>
          <input
            type="date"
            value={form.dueDate || ""}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            className="px-3 py-2 rounded-xl border border-slate-200"
          />

          <label className="text-xs font-medium text-slate-600 mt-2">Estimated time (minutes)</label>
          <input
            type="number"
            min={10}
            step={5}
            value={form.estimatedMin}
            onChange={(e) =>
              setForm({ ...form, estimatedMin: Number(e.target.value) })
            }
            className="px-3 py-2 rounded-xl border border-slate-200"
          />

          <label className="text-xs font-medium text-slate-600 mt-2">Priority</label>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="px-3 py-2 rounded-xl border border-slate-200"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <button
            onClick={() => {
              if (!form.title || !form.dueDate || !form.estimatedMin) return;
              addTask(form);
              setForm({
                title: "",
                dueDate: "",
                estimatedMin: 60,
                priority: "medium",
              });
            }}
            className="mt-3 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white"
          >
            Add
          </button>

          <div className="text-xs text-slate-500 mt-2">
            {upcoming} upcoming task(s)
          </div>
        </div>
      </div>

      <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="font-semibold text-lg">Your Tasks (click to edit)</h2>

        {tasks.length === 0 ? (
          <div className="mt-6 text-sm text-slate-500">
            No tasks yet. Add one on the left.
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2"
              >
                <div className="flex items-start gap-3 flex-1">
                  <input
                    type="checkbox"
                    checked={t.status === "done"}
                    onChange={() => toggleDone(t.id)}
                    className="mt-1"
                  />

                  <button onClick={() => openEdit(t)} className="text-left flex-1">
                    <div
                      className={`font-medium ${
                        t.status === "done" ? "line-through text-slate-400" : ""
                      }`}
                    >
                      {t.title}
                    </div>
                    <div className="text-xs text-slate-600">
                      Due {t.dueDate} • {t.estimatedMin} min • {t.priority}
                    </div>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onAutoScheduleTask(t.id)}
                    className="p-2 rounded-lg hover:bg-indigo-50 text-indigo-700"
                    title="Auto-schedule this task"
                  >
                    <Wand2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => openEdit(t)}
                    className="p-2 rounded-lg hover:bg-slate-100"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => removeTask(t.id)}
                    className="p-2 rounded-lg hover:bg-slate-100"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
            onClick={() => setEditing(null)}
          >
            <motion.div
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-2xl p-4 border border-slate-200 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-lg">Edit Task</div>
                <button
                  onClick={() => setEditing(null)}
                  className="p-1 rounded hover:bg-slate-100"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 grid gap-2">
                <label className="text-xs font-medium text-slate-600">Task title</label>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing((q) => ({ ...q, title: e.target.value }))}
                  className="px-3 py-2 rounded-xl border border-slate-200"
                />

                <label className="text-xs font-medium text-slate-600 mt-1">Due date</label>
                <input
                  type="date"
                  value={editing.dueDate || ""}
                  onChange={(e) => setEditing((q) => ({ ...q, dueDate: e.target.value }))}
                  className="px-3 py-2 rounded-xl border border-slate-200"
                />

                <label className="text-xs font-medium text-slate-600 mt-1">Estimated minutes</label>
                <input
                  type="number"
                  min={10}
                  step={5}
                  value={editing.estimatedMin}
                  onChange={(e) =>
                    setEditing((q) => ({ ...q, estimatedMin: Number(e.target.value) }))
                  }
                  className="px-3 py-2 rounded-xl border border-slate-200"
                />

                <label className="text-xs font-medium text-slate-600 mt-1">Priority</label>
                <select
                  value={editing.priority}
                  onChange={(e) => setEditing((q) => ({ ...q, priority: e.target.value }))}
                  className="px-3 py-2 rounded-xl border border-slate-200"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setEditing(null)}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!editing.title.trim()) return;
                      updateTask(editing.id, {
                        title: editing.title.trim(),
                        dueDate: editing.dueDate,
                        estimatedMin: editing.estimatedMin,
                        priority: editing.priority,
                      });
                      setEditing(null);
                    }}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 text-white"
                  >
                    Save
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------------------------------
   ChunkerView
-------------------------------------------------- */
function ChunkerView({ onCreateTasks }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [totalHours, setTotalHours] = useState(4);
  const [type, setType] = useState("essay");
  const [chunks, setChunks] = useState([]);

  function generate() {
    const tpl = CHUNK_TEMPLATES[type];
    const totalMin = Math.round(totalHours * 60);
    const newChunks = tpl.map((c) => ({
      title: `${title}: ${c.title}`,
      estimatedMin: Math.max(15, Math.round(totalMin * c.pct)),
      dueDate,
      priority: "medium",
      status: "todo",
      id: crypto.randomUUID(),
    }));
    setChunks(newChunks);
  }

  function updateChunk(id, patch) {
    setChunks((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  return (
    <div className="mt-5 grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="font-semibold text-lg">Project Chunker</h2>
        <div className="mt-3 grid gap-2">
          <label className="text-xs font-medium text-slate-600">Project title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200"
            placeholder="e.g., History essay"
          />

          <label className="text-xs font-medium text-slate-600 mt-2">Due date</label>
          <input
            type="date"
            value={dueDate || ""}
            onChange={(e) => setDueDate(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200"
          />

          <label className="text-xs font-medium text-slate-600 mt-2">Total estimated time (hours)</label>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={totalHours}
            onChange={(e) => setTotalHours(Number(e.target.value))}
            className="px-3 py-2 rounded-xl border border-slate-200"
          />

          <label className="text-xs font-medium text-slate-600 mt-2">Project type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200"
          >
            <option value="essay">Essay / Writing</option>
            <option value="exam">Studying for Exam</option>
            <option value="lab">Lab / Research / Presentation</option>
          </select>

          <button
            onClick={generate}
            className="mt-3 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white"
          >
            Generate chunks
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="font-semibold text-lg">Chunks (editable)</h2>
        {chunks.length === 0 ? (
          <div className="mt-6 text-sm text-slate-500">Generate chunks to see them here.</div>
        ) : (
          <div className="mt-3 grid gap-2">
            {chunks.map((c, i) => (
              <div key={c.id} className="rounded-xl border border-slate-200 px-3 py-2 grid gap-2">
                <div className="text-xs text-slate-500">Chunk {i + 1}</div>
                <input
                  value={c.title}
                  onChange={(e) => updateChunk(c.id, { title: e.target.value })}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-sm"
                />
                <div className="flex gap-2 items-center">
                  <label className="text-xs text-slate-600">Minutes</label>
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={c.estimatedMin}
                    onChange={(e) => updateChunk(c.id, { estimatedMin: Number(e.target.value) })}
                    className="w-24 px-2 py-1 rounded-lg border border-slate-200 text-sm"
                  />
                  <label className="text-xs text-slate-600">Due</label>
                  <input
                    type="date"
                    value={c.dueDate || ""}
                    onChange={(e) => updateChunk(c.id, { dueDate: e.target.value })}
                    className="px-2 py-1 rounded-lg border border-slate-200 text-sm"
                  />
                </div>
              </div>
            ))}
            <button
              onClick={() => {
                onCreateTasks(chunks);
                setChunks([]);
              }}
              className="mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 text-white"
            >
              Add chunks to Tasks
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------
   FloatingActions
-------------------------------------------------- */
function FloatingActions({ setView }) {
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl px-2 py-2 flex items-center gap-2">
        <button
          onClick={() => setView("tasks")}
          className="px-3 py-2 rounded-xl hover:bg-slate-100 text-sm inline-flex items-center gap-2"
        >
          <ListTodo className="h-4 w-4" />
          Tasks
        </button>
        <button
          onClick={() => setView("schedule")}
          className="px-3 py-2 rounded-xl hover:bg-slate-100 text-sm inline-flex items-center gap-2"
        >
          <CalendarDays className="h-4 w-4" />
          Schedule
        </button>
        <button
          onClick={() => setView("chunker")}
          className="px-3 py-2 rounded-xl hover:bg-slate-100 text-sm inline-flex items-center gap-2"
        >
          <Wand2 className="h-4 w-4" />
          Chunker
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------
   Tiny dev tests (optional)
-------------------------------------------------- */
function assert(cond, msg) {
  if (!cond) throw new Error("Test failed: " + msg);
}
if (typeof window !== "undefined" && window.__MANARA_TESTS__) {
  const r = parseRange("08:00-09:00");
  assert(r.startMin === 480, "toMin/parseRange startMin");
  assert(durationMin(r) === 60, "durationMin");
  assert(inferBlockType("Study Hall") === "free", "study hall free");
}
