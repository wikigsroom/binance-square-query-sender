import { StrictMode, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Users,
  SlidersHorizontal,
  Images,
  FileText,
  ListChecks,
  Settings,
  LogOut,
  Pause,
  Play,
  Menu,
  X,
  ArrowUpRight,
  Clock3,
  Activity,
  Search,
  Sun,
  Moon,
  PlugZap,
  ChevronRight,
} from "lucide-react";
import { api, send, setCsrf, date, shortDate, Item } from "./api";
import {
  useData,
  ErrorBox,
  Loading,
  Button,
  PageHead,
  Badge,
  Empty,
  AsyncButton,
  Toasts,
  notify,
} from "./components";
import { AccountsPage } from "./pages/accounts";
import { PresetsPage } from "./pages/presets";
import { MediaPage, PostsPage, JobsPage } from "./pages/content";
import { SettingsPage } from "./pages/settings";
import "./style.css";
import "./workspace.css";

const pages = [
  { id: "overview", title: "运行总览", icon: LayoutDashboard },
  { id: "accounts", title: "账号与计划", icon: Users },
  { id: "presets", title: "内容预设", icon: SlidersHorizontal },
  { id: "media", title: "图库与生图", icon: Images },
  { id: "posts", title: "帖子中心", icon: FileText },
  { id: "jobs", title: "任务与日志", icon: ListChecks },
  { id: "settings", title: "系统设置", icon: Settings },
];
function App() {
  const [user, setUser] = useState<any>(undefined),
    [error, setError] = useState<any>(null),
    [page, setPage] = useState(location.pathname.split("/")[1] || "overview"),
    [menu, setMenu] = useState(false),
    [key, reload] = useState(0),
    [theme, setTheme] = useState(() =>
      localStorage.getItem("square-theme") === "dark" ? "dark" : "light",
    ),
    [search, setSearch] = useState("");
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("square-theme", theme);
  }, [theme]);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setCsrf("");
    };
    addEventListener("square:session-expired", expired);
    return () => removeEventListener("square:session-expired", expired);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const before = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    navigation.current?.querySelector<HTMLElement>("button, a")?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(false);
      }
      if (e.key === "Tab") {
        const items = Array.from(
          navigation.current?.querySelectorAll<HTMLElement>("a, button") || [],
        ).filter((e) => e.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const resized = () => {
      if (innerWidth > 850) setMenu(false);
    };
    addEventListener("keydown", keydown);
    addEventListener("resize", resized);
    return () => {
      document.body.style.overflow = "";
      removeEventListener("keydown", keydown);
      removeEventListener("resize", resized);
      before?.focus();
    };
  }, [menu]);
  useEffect(() => {
    api("/auth/me")
      .then((r) => {
        setUser(r.data);
        setCsrf(r.data.csrf);
      })
      .catch((e) => {
        if (["UNAUTHENTICATED", "SESSION_EXPIRED"].includes(e.code))
          setUser(null);
        else setError(e);
      });
  }, []);
  useEffect(() => {
    const fn = () => setPage(location.pathname.split("/")[1] || "overview");
    addEventListener("popstate", fn);
    return () => removeEventListener("popstate", fn);
  }, []);
  function go(next: string) {
    history.pushState({}, "", `/${next}`);
    setPage(next.split("?")[0]);
    reload((k) => k + 1);
    setMenu(false);
  }
  if (error)
    return (
      <div className="login-wrap">
        <ErrorBox error={error} />
        <Button onClick={() => location.reload()}>重新连接</Button>
      </div>
    );
  if (user === undefined) return <Loading />;
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          setCsrf(u.csrf);
        }}
      />
    );
  const content =
    page === "accounts" ? (
      <AccountsPage refreshKey={key} />
    ) : page === "presets" ? (
      <PresetsPage />
    ) : page === "media" ? (
      <MediaPage />
    ) : page === "posts" ? (
      <PostsPage key={location.search + key} />
    ) : page === "jobs" ? (
      <JobsPage />
    ) : page === "settings" ? (
      <SettingsPage
        key={location.search + key}
        onChange={() => reload((k) => k + 1)}
      />
    ) : (
      <Overview go={go} refreshKey={key} />
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside
        ref={navigation}
        id="workspace-navigation"
        className={`sidebar ${menu ? "open" : ""}`}
      >
        <button
          className="icon-button mobile-nav-close"
          aria-label="关闭导航"
          onClick={() => setMenu(false)}
        >
          <X size={20} />
        </button>
        <a
          className="brand"
          href="/overview"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
            <i />
          </span>
          <div>
            <strong>SQUARE DESK</strong>
            <span>币安广场 · 个人管理台</span>
          </div>
        </a>
        <p className="nav-caption">工作空间</p>
        <nav aria-label="主导航">
          {pages.map((p) => (
            <a
              key={p.id}
              href={`/${p.id}`}
              className={page === p.id ? "selected" : ""}
              aria-current={page === p.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(p.id);
              }}
            >
              <p.icon size={18} />
              {p.title}
              {p.id === page && <span className="nav-indicator" />}
            </a>
          ))}
        </nav>
        <a
          className="sidebar-ai"
          href="/settings?section=models"
          onClick={(e) => {
            e.preventDefault();
            go("settings?section=models");
          }}
        >
          <PlugZap size={19} />
          <div>
            <strong>AI 工作台</strong>
            <span>连接你的创作模型</span>
          </div>
          <ChevronRight size={15} />
        </a>
        <div className="sidebar-bottom">
          <div className="owner-avatar">
            {String(user.username).slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{user.username}</strong>
            <span>所有者管理员</span>
          </div>
          <button
            aria-label="退出登录"
            className="icon-button"
            onClick={() =>
              void send("/auth/logout").then(() => {
                setUser(null);
                setCsrf("");
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {menu && (
        <button
          className="nav-backdrop"
          aria-label="关闭导航遮罩"
          onClick={() => setMenu(false)}
          tabIndex={-1}
        />
      )}
      <div className="main-shell" inert={menu}>
        <header className="topbar">
          <button
            className="icon-button menu-toggle"
            aria-label={menu ? "关闭导航" : "打开导航"}
            aria-expanded={menu}
            aria-controls="workspace-navigation"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <div className="breadcrumb">
            工作空间 <span>/</span>{" "}
            {pages.find((p) => p.id === page)?.title || "运行总览"}
          </div>
          <div className="topbar-right">
            <form
              className="top-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                go(`posts?q=${encodeURIComponent(search)}`);
                setSearch("");
              }}
            >
              <Search size={16} />
              <input
                aria-label="搜索已发布内容"
                placeholder="搜索帖子…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            <button
              className="icon-button theme-toggle"
              aria-label={theme === "light" ? "切换深色模式" : "切换浅色模式"}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <RuntimeControl
              refreshKey={key}
              onChange={() => reload((k) => k + 1)}
            />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} key={page}>
          {content}
        </main>
        <footer>
          Square Desk <span>每一篇内容都有来源，每一次提交都有记录。</span>
        </footer>
      </div>
      <Toasts />
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const [username, setUsername] = useState("owner"),
    [password, setPassword] = useState(""),
    [error, setError] = useState<any>(null),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <div className="login-intro">
        <span className="eyebrow">SQUARE DESK</span>
        <h1>
          账号各有节奏。
          <br />
          内容有迹可循。
        </h1>
        <p>登录你的币安广场管理台。</p>
        <div className="login-lines">
          <i />
          <i />
          <i />
        </div>
      </div>
      <form
        className="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void send("/auth/login", { username, password })
            .then((r) => {
              setPassword("");
              onLogin(r.data);
            })
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <h2>所有者登录</h2>
        <label className="field">
          <span>用户名</span>
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>密码</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <ErrorBox error={error} />}
        <Button type="submit" kind="primary" disabled={busy}>
          {busy ? "正在登录…" : "登录管理台"}
          <ArrowUpRight size={16} />
        </Button>
        <small>账号由服务端初始化命令创建。</small>
      </form>
    </div>
  );
}
function RuntimeControl({
  refreshKey,
  onChange,
}: {
  refreshKey: any;
  onChange: () => void;
}) {
  const { data, error, reload } = useData("/runtime", refreshKey);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<any>(null);
  if (error) return <span className="status-text danger">后端失联</span>;
  if (!data) return <span className="muted">连接中</span>;
  return (
    <div className="runtime-control">
      {data.profile === "fixture" && (
        <span className="fixture-label">隔离开发样本</span>
      )}
      <span className={`status-text ${data.paused ? "paused" : "live"}`}>
        <i />
        {data.paused ? "全局已暂停" : "允许发布"}
      </span>
      <Button
        kind={data.paused ? "subtle" : "danger-outline"}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void send(
            "/runtime",
            { expectedVersion: data.version, paused: !data.paused },
            "PATCH",
          )
            .then(() => {
              setFailure(null);
              notify(data.paused ? "已恢复账号计划" : "已暂停新提交");
              reload();
              onChange();
            })
            .catch(setFailure)
            .finally(() => setBusy(false));
        }}
      >
        {data.paused ? <Play size={14} /> : <Pause size={14} />}{" "}
        {data.paused ? "恢复发布" : "暂停发布"}
      </Button>
      {failure && (
        <div className="floating-error">
          <ErrorBox error={failure} />
          <Button onClick={() => setFailure(null)}>关闭</Button>
        </div>
      )}
    </div>
  );
}
function Overview({
  go,
  refreshKey,
}: {
  go: (s: string) => void;
  refreshKey: any;
}) {
  const { data, error, loading } = useData("/overview", refreshKey);
  if (error) return <ErrorBox error={error} />;
  if (!data || loading) return <Loading />;
  const metrics = [
    ["管理账号", data.counts.accounts, `${data.counts.enabled} 个独立计划`],
    ["今日确认发布", data.counts.publishedToday, "按远端回执统计"],
    [
      "今日核验通过",
      data.counts.verifiedToday,
      `${data.counts.pendingVerification} 篇等待或无法完整核验`,
    ],
    [
      "需要处理",
      data.counts.attention,
      `${data.counts.unknown} 条提交结果不明`,
    ],
  ];
  return (
    <>
      <PageHead
        eyebrow="ACCOUNT RHYTHM"
        title="账号独立计划"
        description="各自抽样，各自执行。下一篇内容在任务创建时按预设权重决定。"
        actions={
          <Button onClick={() => go("accounts")}>
            管理账号 <ArrowUpRight size={15} />
          </Button>
        }
      />
      {data.runtime.paused && (
        <div className="notice">
          <Pause size={16} />
          <div>
            <strong>全局发送已暂停</strong>
            <span>
              计划保留供查看，恢复后各账号分别重新抽样。已提交的请求继续回收结果。
            </span>
          </div>
        </div>
      )}
      <div className="metrics-strip">
        {metrics.map(([title, value, note]) => (
          <div className="metric" key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="readiness-grid" aria-label="发布准备情况">
        {[
          {
            title: "AI 接入",
            note: data.setup.defaultText.available
              ? data.setup.defaultText.externalId
              : `${data.setup.textModels} 个可用模型 · 选择默认`,
            ready: data.setup.defaultText.available,
            icon: PlugZap,
            target: "settings?section=models",
          },
          {
            title: "内容预设",
            note: `${data.setup.publishedPresets} 个已发布预设`,
            ready: data.setup.publishedPresets > 0,
            icon: SlidersHorizontal,
            target: "presets",
          },
          {
            title: "受管图库",
            note: `${data.setup.assets} 张可用图片`,
            ready: data.setup.assets > 0,
            icon: Images,
            target: "media",
          },
          {
            title: "账号计划",
            note: `${data.counts.enabled} / ${data.counts.accounts} 个计划已启用`,
            ready: data.counts.enabled > 0,
            icon: Users,
            target: "accounts",
          },
        ].map((item) => (
          <button
            key={item.title}
            className={`readiness-item ${item.ready ? "ready" : ""}`}
            onClick={() => go(item.target)}
          >
            <item.icon size={20} />
            <div>
              <strong>{item.title}</strong>
              <small>{item.note}</small>
            </div>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel schedule-panel">
          <div className="panel-head">
            <div>
              <h2>下一次执行</h2>
              <p>已抽中的时间不会随页面刷新改变</p>
            </div>
            <span className="mono muted">UTC+8</span>
          </div>
          {data.upcoming.length ? (
            <ScheduleLanes rows={data.upcoming} />
          ) : (
            <Empty
              action={
                <Button onClick={() => go("accounts")}>配置账号计划</Button>
              }
            >
              还没有启用的账号计划。
            </Empty>
          )}
          <div className="panel-foot">
            <Clock3 size={14} /> 创建任务时按权重选择预设；排队等待另行记录。
          </div>
        </section>
        <aside className="panel worker-panel">
          <div className="panel-head">
            <h2>服务状态</h2>
            <Activity size={18} />
          </div>
          <div className={`worker-state ${data.worker ? "ok" : ""}`}>
            <i />
            {data.worker ? "Worker 心跳正常" : "没有有效 Worker 心跳"}
          </div>
          <dl className="info-list">
            <div>
              <dt>最近心跳</dt>
              <dd>{date(data.worker?.at)}</dd>
            </div>
            <div>
              <dt>发布并发</dt>
              <dd className="mono">{data.runtime.concurrency}</dd>
            </div>
            <div>
              <dt>文字 / 生图并发</dt>
              <dd className="mono">
                {data.runtime.textConcurrency} / {data.runtime.imageConcurrency}
              </dd>
            </div>
            <div>
              <dt>当前控制</dt>
              <dd>{data.runtime.paused ? "暂停新提交" : "允许新提交"}</dd>
            </div>
          </dl>
          <p className="help-text">
            页面打开不代表后台运行。这里展示服务端记录的心跳。
          </p>
          <Button onClick={() => go("jobs")}>
            查看任务日志 <ArrowUpRight size={14} />
          </Button>
        </aside>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>最近任务</h2>
            <p>生成、发布和公开核验分别记录</p>
          </div>
          <Button kind="text" onClick={() => go("jobs")}>
            全部任务 <ArrowUpRight size={15} />
          </Button>
        </div>
        {data.recentJobs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>触发</th>
                  <th>当前状态</th>
                  <th>创建时间</th>
                  <th>阻塞信息</th>
                </tr>
              </thead>
              <tbody>
                {data.recentJobs.map((j: Item) => (
                  <tr key={j.id}>
                    <td>
                      <button
                        className="link mono"
                        onClick={() => go(`jobs?job=${j.id}`)}
                      >
                        {j.id.slice(0, 18)}
                      </button>
                    </td>
                    <td>
                      <Badge value={j.kind} />
                    </td>
                    <td>
                      <Badge value={j.state} />
                    </td>
                    <td>{date(j.createdAt)}</td>
                    <td className="truncate">{j.error?.message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            任务尚未开始。先配置模型、预设和图库，再选择账号的计划。
          </Empty>
        )}
      </section>
    </>
  );
}
function ScheduleLanes({ rows }: { rows: Item[] }) {
  const start = Date.now(),
    times = rows.filter((r) => r.nextDueAt).map((r) => Date.parse(r.nextDueAt)),
    span = Math.max(3600_000, ...times.map((t) => t - start)) * 1.12;
  return (
    <div className="schedule-lanes">
      <div className="lane-axis">
        <span>现在</span>
        <span>{shortDate(new Date(start + span / 2).toISOString())}</span>
        <span>{shortDate(new Date(start + span).toISOString())}</span>
      </div>
      {rows.map((s, i) => (
        <div className="schedule-lane" key={s.id}>
          <div className="lane-account">
            <span
              className="account-dot"
              style={{
                background: ["#dba73b", "#3d8277", "#7186a4", "#b77869"][i % 4],
              }}
            />
            <div>
              <strong>{s.account?.name || s.accountId}</strong>
              <small>
                {Math.round(s.minIntervalSeconds / 60)}—
                {Math.round(s.maxIntervalSeconds / 60)} 分钟
              </small>
            </div>
          </div>
          <div className="lane-track">
            <div className="track-grid" />
            {s.nextDueAt ? (
              <div
                className="time-pin"
                style={{
                  left: `${Math.max(2, Math.min(90, ((Date.parse(s.nextDueAt) - start) / span) * 100))}%`,
                }}
              >
                <i />
                <span>{shortDate(s.nextDueAt)}</span>
              </div>
            ) : (
              <span className="lane-wait">
                {s.account?.blockReason ? "账号存在阻塞" : "等待当前任务结束"}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
