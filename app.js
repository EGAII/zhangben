'use strict';

// ================= 基础工具 =================
const cfg = window.APP_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const appEl = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 日元没有小数
const money = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ymOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  return ymOf(new Date(y, m - 1 + delta, 1));
}
function monthRange(ym) {
  return [`${ym}-01`, `${shiftMonth(ym, 1)}-01`];
}
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}
function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const t = today();
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const ys = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`;
  const tag = dateStr === t ? '今天' : dateStr === ys ? '昨天' : WEEK[dt.getDay()];
  return `${m}月${d}日 ${tag}`;
}

let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
function errMsg(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return '邮箱或密码错误';
  if (/User already registered/i.test(m)) return '该邮箱已注册，请直接登录';
  if (/Password should be/i.test(m)) return '密码至少 6 位';
  if (/Email not confirmed/i.test(m)) return '邮箱未确认，请先去邮箱点确认链接';
  if (/Failed to fetch|NetworkError/i.test(m)) return '网络连接失败，请检查网络';
  return m;
}

const CATS = {
  expense: ['餐饮', '买菜', '日用', '交通', '住房', '水电燃气', '通讯', '医疗', '教育', '娱乐', '服饰', '人情', '其他'],
  income: ['存入', '工资', '奖金', '理财', '红包', '退款', '其他'],
};
const ICON = {
  餐饮: '🍜', 买菜: '🥬', 日用: '🧻', 交通: '🚌', 住房: '🏠', 水电燃气: '💡', 通讯: '📱', 医疗: '💊',
  教育: '📚', 娱乐: '🎮', 服饰: '👕', 人情: '🎁', 其他: '📝',
  存入: '🏦', 工资: '💼', 奖金: '🏆', 理财: '📈', 红包: '🧧', 退款: '↩️',
};
const PALETTE = ['#2f6f5e', '#d0473a', '#3b6fd6', '#d99a1e', '#8a4fc7', '#1f9aa8', '#c4507a', '#6b8e23', '#7a6a58', '#4a5568'];

// ================= 状态 =================
const state = {
  user: null,
  memberships: [],   // [{ledger_id, nickname, ledgers:{...}}]
  ledger: null,
  members: [],
  month: ymOf(new Date()),
  txs: [],
  totals: { income: 0, expense: 0 },
  tab: 'list',
  channel: null,
  live: false,
};

// ================= 启动 =================
if (!cfg.SUPABASE_URL || /你的/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) {
  appEl.innerHTML = `
    <div class="auth">
      <h1>还差一步</h1>
      <p class="sub">请先在 <b>config.js</b> 里填入 Supabase 项目的 URL 和 anon key，详见 README.md。</p>
    </div>`;
  throw new Error('APP_CONFIG 未配置');
}

const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

(async () => {
  const { data } = await sb.auth.getSession();
  await onSession(data.session);
  sb.auth.onAuthStateChange((_event, session) => {
    // 回调里不能直接 await supabase 请求，放到下一轮事件循环
    setTimeout(() => {
      const uid = session?.user?.id || null;
      if (uid !== (state.user?.id || null)) onSession(session);
    }, 0);
  });
})();

// iOS 切到后台会断开实时连接，回到前台时刷新一次
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.ledger) refreshData();
});

async function onSession(session) {
  state.user = session?.user || null;
  if (state.channel) { sb.removeChannel(state.channel); state.channel = null; }
  if (!state.user) { state.ledger = null; renderAuth(); return; }
  await loadMemberships();
  if (!state.memberships.length) { renderOnboard(); return; }
  const saved = localGet('ledgerId');
  const m = state.memberships.find((x) => x.ledger_id === saved) || state.memberships[0];
  await openLedger(m.ledger_id);
}

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } }

// ================= 数据读取 =================
async function loadMemberships() {
  const { data, error } = await sb
    .from('ledger_members')
    .select('ledger_id, nickname, ledgers(id, name, initial_balance, invite_code, owner_id)')
    .eq('user_id', state.user.id)
    .order('joined_at');
  if (error) { toast(errMsg(error)); state.memberships = []; return; }
  state.memberships = (data || []).filter((m) => m.ledgers);
}

async function openLedger(ledgerId) {
  const m = state.memberships.find((x) => x.ledger_id === ledgerId);
  if (!m) return;
  state.ledger = m.ledgers;
  localSet('ledgerId', ledgerId);
  appEl.innerHTML = '<div class="center-msg">加载中…</div>';
  await refreshData();
  subscribe();
}

async function refreshData() {
  if (!state.ledger) return;
  const id = state.ledger.id;
  const [start, end] = monthRange(state.month);
  const [txRes, totRes, memRes, ledRes] = await Promise.all([
    sb.from('transactions').select('*')
      .eq('ledger_id', id).gte('occurred_on', start).lt('occurred_on', end)
      .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }),
    sb.rpc('ledger_totals', { p_ledger: id }),
    sb.from('ledger_members').select('user_id, nickname').eq('ledger_id', id).order('joined_at'),
    sb.from('ledgers').select('id, name, initial_balance, invite_code, owner_id').eq('id', id).single(),
  ]);
  const err = txRes.error || totRes.error || memRes.error || ledRes.error;
  if (err) toast(errMsg(err));
  if (ledRes.data) state.ledger = ledRes.data;
  state.txs = txRes.data || [];
  const t = (totRes.data && totRes.data[0]) || { income: 0, expense: 0 };
  state.totals = { income: Number(t.income), expense: Number(t.expense) };
  state.members = memRes.data || [];
  renderMain();
}

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshData, 300);
}

function subscribe() {
  if (state.channel) sb.removeChannel(state.channel);
  const id = state.ledger.id;
  state.channel = sb.channel(`ledger-${id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions', filter: `ledger_id=eq.${id}` }, scheduleRefresh)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions', filter: `ledger_id=eq.${id}` }, scheduleRefresh)
    // 删除事件无法按账本过滤，收到就刷新
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transactions' }, scheduleRefresh)
    .subscribe((status) => {
      state.live = status === 'SUBSCRIBED';
      const dot = $('#live-dot');
      if (dot) dot.classList.toggle('on', state.live);
    });
}

const nickOf = (uid) => state.members.find((m) => m.user_id === uid)?.nickname || '已退出成员';
const myNick = () => nickOf(state.user.id);
const isOwner = () => state.ledger?.owner_id === state.user?.id;

// ================= 登录 / 注册 =================
function renderAuth(mode = 'login') {
  appEl.innerHTML = `
    <div class="auth">
      <h1>家庭账本</h1>
      <p class="sub">全家一起记账，实时同步</p>
      <div class="card">
        <div class="seg">
          <button data-mode="login" class="${mode === 'login' ? 'on' : ''}">登录</button>
          <button data-mode="signup" class="${mode === 'signup' ? 'on' : ''}">注册</button>
        </div>
        <form id="auth-form">
          <label class="field"><span>邮箱</span><input class="input" name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>密码${mode === 'signup' ? '（至少 6 位）' : ''}</span>
            <input class="input" name="password" type="password" minlength="6"
              autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required></label>
          <button class="btn" type="submit">${mode === 'signup' ? '注册' : '登录'}</button>
        </form>
      </div>
      <p class="muted small">提示：用 Safari 打开后，点底部「分享」→「添加到主屏幕」，就能像 App 一样使用。</p>
    </div>`;
  appEl.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => renderAuth(b.dataset.mode));
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const creds = { email: f.get('email').trim(), password: f.get('password') };
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp(creds);
        if (error) throw error;
        if (!data.session) {
          toast('注册成功，请去邮箱点确认链接后再登录', 4000);
          renderAuth('login');
        }
      } else {
        const { error } = await sb.auth.signInWithPassword(creds);
        if (error) throw error;
      }
    } catch (err) {
      toast(errMsg(err));
    } finally {
      btn.disabled = false;
    }
  };
}

// ================= 创建 / 加入账本 =================
function onboardHtml() {
  return `
    <div class="card" style="padding:20px;margin-bottom:16px">
      <h2 style="margin:0 0 14px;font-size:17px">新建账本</h2>
      <form id="create-form">
        <label class="field"><span>账本名称</span><input class="input" name="name" value="我家账本" required></label>
        <label class="field"><span>当前账户余额（初始金额）</span><input class="input" name="initial" inputmode="numeric" placeholder="¥0"></label>
        <label class="field"><span>你的昵称（家人看到的名字）</span><input class="input" name="nick" placeholder="如：爸爸" required></label>
        <button class="btn" type="submit">创建</button>
      </form>
    </div>
    <div class="card" style="padding:20px;margin-bottom:16px">
      <h2 style="margin:0 0 14px;font-size:17px">加入家人的账本</h2>
      <form id="join-form">
        <label class="field"><span>邀请码</span><input class="input" name="code" autocapitalize="characters" placeholder="8 位邀请码" required></label>
        <label class="field"><span>你的昵称</span><input class="input" name="nick" placeholder="如：妈妈" required></label>
        <button class="btn secondary" type="submit">加入</button>
      </form>
    </div>`;
}

function bindOnboard(root) {
  $('#create-form', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const initial = parseAmount(f.get('initial')) ?? 0;
    await runLedgerRpc(e.target, 'create_ledger', { p_name: f.get('name'), p_initial: initial, p_nickname: f.get('nick') });
  };
  $('#join-form', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await runLedgerRpc(e.target, 'join_ledger', { p_code: f.get('code'), p_nickname: f.get('nick') });
  };
}

async function runLedgerRpc(form, fn, args) {
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    closeSheet();
    await loadMemberships();
    await openLedger(data);
    toast(fn === 'create_ledger' ? '账本已创建' : '已加入账本');
  } catch (err) {
    toast(errMsg(err));
  } finally {
    btn.disabled = false;
  }
}

function renderOnboard() {
  appEl.innerHTML = `
    <div class="auth">
      <h1>开始记账</h1>
      <p class="sub">新建一个账本，或输入家人给你的邀请码</p>
      ${onboardHtml()}
      <button class="btn danger" id="logout">退出登录</button>
    </div>`;
  bindOnboard(appEl);
  $('#logout').onclick = () => sb.auth.signOut();
}

// ================= 主界面 =================
function renderMain() {
  const balance = Number(state.ledger.initial_balance) + state.totals.income - state.totals.expense;
  let mIn = 0, mOut = 0;
  for (const t of state.txs) t.type === 'income' ? (mIn += Number(t.amount)) : (mOut += Number(t.amount));

  appEl.innerHTML = `
    <div class="main">
      <div class="topbar">
        <button class="title" id="switch-ledger">${esc(state.ledger.name)}${state.memberships.length > 1 ? ' ▾' : ''}
          <i id="live-dot" class="live-dot ${state.live ? 'on' : ''}" title="实时同步"></i></button>
        <span class="muted small">${esc(myNick())}</span>
      </div>
      <div class="balance">
        <div class="label">账户余额</div>
        <div class="amount">¥${money(balance)}</div>
        <div class="row">
          <div>本月存入<b>¥${money(mIn)}</b></div>
          <div>本月支出<b>¥${money(mOut)}</b></div>
        </div>
      </div>
      <div class="monthbar">
        <button id="prev-m" aria-label="上个月">‹</button>
        <span>${monthLabel(state.month)}</span>
        <button id="next-m" aria-label="下个月">›</button>
      </div>
      <div id="tab-body">${state.tab === 'list' ? listHtml() : state.tab === 'stats' ? statsHtml(mIn, mOut) : settingsHtml()}</div>
    </div>
    ${state.tab === 'list' ? '<button class="fab" id="add">＋ 记一笔</button>' : ''}
    <nav class="tabbar">
      ${[['list', '📒', '账单'], ['stats', '📊', '统计'], ['settings', '⚙️', '设置']].map(([k, ic, t]) =>
        `<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}"><span class="ic">${ic}</span>${t}</button>`).join('')}
    </nav>`;

  appEl.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; renderMain(); window.scrollTo(0, 0); });
  $('#prev-m').onclick = () => { state.month = shiftMonth(state.month, -1); refreshData(); };
  $('#next-m').onclick = () => { state.month = shiftMonth(state.month, 1); refreshData(); };
  $('#switch-ledger').onclick = openLedgerSwitcher;
  if ($('#add')) $('#add').onclick = () => openTxEditor();
  appEl.querySelectorAll('[data-tx]').forEach((b) => b.onclick = () => openTxDetail(b.dataset.tx));
  if (state.tab === 'settings') bindSettings();
}

function listHtml() {
  if (!state.txs.length) return '<div class="empty">这个月还没有记录<br>点右下角「记一笔」开始</div>';
  const groups = new Map();
  for (const t of state.txs) {
    if (!groups.has(t.occurred_on)) groups.set(t.occurred_on, []);
    groups.get(t.occurred_on).push(t);
  }
  let html = '';
  for (const [day, list] of groups) {
    let i = 0, o = 0;
    for (const t of list) t.type === 'income' ? (i += Number(t.amount)) : (o += Number(t.amount));
    html += `<div class="card day">
      <div class="day-head"><span>${dayLabel(day)}</span>
        <span>${o ? `支出 ${money(o)}` : ''}${i && o ? '　' : ''}${i ? `存入 ${money(i)}` : ''}</span></div>
      ${list.map(txRowHtml).join('')}
    </div>`;
  }
  return html;
}

function txRowHtml(t) {
  const sign = t.type === 'income' ? '+' : '-';
  return `<button class="tx" data-tx="${t.id}">
    <div class="icon">${ICON[t.category] || '📝'}</div>
    <div class="body">
      <div class="name">${esc(t.note || t.category)}</div>
      <div class="meta">${esc(t.category)} · ${esc(nickOf(t.user_id))}${t.receipt_path ? ' · 🧾小票' : ''}</div>
    </div>
    <div class="amt ${t.type}">${sign}${money(t.amount)}</div>
  </button>`;
}

function statsHtml(mIn, mOut) {
  const bars = (type, total) => {
    const sums = {};
    for (const t of state.txs) if (t.type === type) sums[t.category] = (sums[t.category] || 0) + Number(t.amount);
    const rows = Object.entries(sums).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '<div class="muted small">暂无数据</div>';
    return rows.map(([c, v], i) => `
      <div class="bar-row">
        <div class="top"><span>${ICON[c] || ''} ${esc(c)}</span><span>¥${money(v)}　<span class="muted">${(v / total * 100).toFixed(1)}%</span></span></div>
        <div class="bar"><i style="width:${(v / total * 100).toFixed(1)}%;background:${PALETTE[i % PALETTE.length]}"></i></div>
      </div>`).join('');
  };
  const byMember = {};
  for (const t of state.txs) {
    const k = t.user_id;
    byMember[k] ??= { income: 0, expense: 0 };
    byMember[k][t.type] += Number(t.amount);
  }
  const memberRows = Object.entries(byMember).map(([uid, v]) => `
    <div class="list-row"><span>${esc(nickOf(uid))}</span>
      <span class="small"><span class="expense">支出 ${money(v.expense)}</span>　<span class="income">存入 ${money(v.income)}</span></span></div>`).join('');
  return `
    <div class="card section"><h3>支出分类　<span class="expense">¥${money(mOut)}</span></h3>${bars('expense', mOut)}</div>
    <div class="card section"><h3>存入分类　<span class="income">¥${money(mIn)}</span></h3>${bars('income', mIn)}</div>
    <div class="card section"><h3>家庭成员</h3>${memberRows || '<div class="muted small">暂无数据</div>'}</div>`;
}

// ================= 设置 =================
function settingsHtml() {
  const l = state.ledger;
  return `
    <div class="card section">
      <h3>邀请家人</h3>
      <div class="list-row">
        <span class="code">${esc(l.invite_code)}</span>
        <button class="btn small secondary" id="share-code">分享</button>
      </div>
      <div class="muted small">家人打开本应用 → 注册 → 「加入家人的账本」→ 输入这个邀请码。</div>
    </div>
    <div class="card section">
      <h3>家庭成员（${state.members.length}）</h3>
      ${state.members.map((m) => `<div class="list-row"><span>${esc(m.nickname)}${m.user_id === state.user.id ? '（我）' : ''}</span>
        <span class="muted small">${m.user_id === l.owner_id ? '创建者' : ''}</span></div>`).join('')}
    </div>
    <div class="card section">
      <h3>账本</h3>
      <div class="list-row"><span>我的昵称</span><button class="btn small secondary" id="edit-nick">${esc(myNick())} ✎</button></div>
      ${isOwner() ? `
      <div class="list-row"><span>账本名称</span><button class="btn small secondary" id="edit-name">${esc(l.name)} ✎</button></div>
      <div class="list-row"><span>初始金额</span><button class="btn small secondary" id="edit-initial">¥${money(l.initial_balance)} ✎</button></div>` : ''}
      <div class="list-row"><span>切换 / 新建 / 加入账本</span><button class="btn small secondary" id="switch2">打开</button></div>
    </div>
    <div class="card section">
      <h3>安装到桌面</h3>
      <div class="muted small">在 iPhone 上用 Safari 打开本页 → 点底部「分享」按钮 → 「添加到主屏幕」。之后从桌面图标打开即可全屏使用。</div>
    </div>
    <button class="btn danger" id="logout">退出登录</button>
    ${!isOwner() ? '<button class="btn danger" id="leave">退出此账本</button>' : ''}
    <div class="muted small" style="text-align:center;margin-top:8px">${esc(state.user.email)}</div>`;
}

function bindSettings() {
  const l = state.ledger;
  $('#share-code').onclick = async () => {
    const text = `来和我一起用「家庭账本」记账吧！打开 ${location.origin}${location.pathname} 注册后，输入邀请码：${l.invite_code}`;
    try {
      if (navigator.share) await navigator.share({ title: '家庭账本邀请', text });
      else { await navigator.clipboard.writeText(text); toast('邀请信息已复制'); }
    } catch { /* 用户取消分享 */ }
  };
  $('#edit-nick').onclick = async () => {
    const v = await askSheet('修改昵称', [{ name: 'v', label: '昵称', value: myNick() }]);
    if (!v) return;
    const { error } = await sb.from('ledger_members').update({ nickname: v.v.trim() || myNick() })
      .eq('ledger_id', l.id).eq('user_id', state.user.id);
    if (error) return toast(errMsg(error));
    await loadMemberships(); await refreshData();
  };
  if ($('#edit-name')) $('#edit-name').onclick = async () => {
    const v = await askSheet('账本名称', [{ name: 'v', label: '名称', value: l.name }]);
    if (!v || !v.v.trim()) return;
    const { error } = await sb.from('ledgers').update({ name: v.v.trim() }).eq('id', l.id);
    if (error) return toast(errMsg(error));
    await loadMemberships(); await refreshData();
  };
  if ($('#edit-initial')) $('#edit-initial').onclick = async () => {
    const v = await askSheet('初始金额', [{ name: 'v', label: '开始记账时账户里已有的钱', value: String(Math.round(l.initial_balance)), inputmode: 'numeric' }]);
    if (!v) return;
    const n = parseAmount(v.v);
    if (n === null) return toast('请输入正确的金额');
    const { error } = await sb.from('ledgers').update({ initial_balance: n }).eq('id', l.id);
    if (error) return toast(errMsg(error));
    await refreshData();
  };
  $('#switch2').onclick = openLedgerSwitcher;
  $('#logout').onclick = () => sb.auth.signOut();
  if ($('#leave')) $('#leave').onclick = async () => {
    if (!confirm(`确定退出「${l.name}」吗？之后需要邀请码才能重新加入。`)) return;
    const { error } = await sb.from('ledger_members').delete().eq('ledger_id', l.id).eq('user_id', state.user.id);
    if (error) return toast(errMsg(error));
    localSet('ledgerId', '');
    onSession({ user: state.user });
  };
}

function openLedgerSwitcher() {
  const items = state.memberships.map((m) => `
    <button class="list-row" style="width:100%" data-ledger="${m.ledger_id}">
      <span>${esc(m.ledgers.name)}</span><span class="muted small">${m.ledger_id === state.ledger.id ? '当前' : ''}</span>
    </button>`).join('');
  const root = openSheet('我的账本', `<div class="card" style="padding:0 16px;margin-bottom:16px">${items}</div>${onboardHtml()}`);
  root.querySelectorAll('[data-ledger]').forEach((b) => b.onclick = async () => {
    closeSheet();
    if (b.dataset.ledger !== state.ledger.id) { state.month = ymOf(new Date()); await openLedger(b.dataset.ledger); }
  });
  bindOnboard(root);
}

// ================= 弹层 =================
let sheetOnClose = null;
function openSheet(title, html) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="close" id="sheet-close">关闭</button></div>
    <div id="sheet-body">${html}</div>`;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  $('#sheet-backdrop').hidden = false;
  $('#sheet-close').onclick = closeSheet;
  $('#sheet-backdrop').onclick = closeSheet;
  return $('#sheet-body');
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  $('#sheet').innerHTML = '';
  const fn = sheetOnClose; sheetOnClose = null;
  if (fn) fn();
}

function askSheet(title, fields) {
  return new Promise((resolve) => {
    let done = false;
    const root = openSheet(title, `<form id="ask-form">
      ${fields.map((f) => `<label class="field"><span>${esc(f.label)}</span>
        <input class="input" name="${f.name}" value="${esc(f.value ?? '')}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}></label>`).join('')}
      <button class="btn" type="submit">保存</button></form>`);
    sheetOnClose = () => { if (!done) resolve(null); };
    $('#ask-form', root).onsubmit = (e) => {
      e.preventDefault();
      done = true;
      resolve(Object.fromEntries(new FormData(e.target)));
      closeSheet();
    };
  });
}

// ================= 记一笔 / 编辑 =================
function parseAmount(v) {
  const s = toHalfWidth(String(v ?? '')).replace(/[,¥円\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function openTxEditor(tx = null) {
  const f = {
    type: tx?.type || 'expense',
    amount: tx ? String(Number(tx.amount)) : '',
    category: tx?.category || '餐饮',
    note: tx?.note || '',
    date: tx?.occurred_on || today(),
    receiptPath: tx?.receipt_path || null,
    newBlob: null,
    removeReceipt: false,
    autoAmount: false,
  };

  const root = openSheet(tx ? '编辑' : '记一笔', `
    <div class="seg">
      <button type="button" data-type="expense">支出</button>
      <button type="button" data-type="income">存入</button>
    </div>
    <input class="amount-input" id="amt" inputmode="numeric" placeholder="¥0" value="${esc(f.amount)}">
    <div class="chips" id="cats"></div>
    <label class="field"><span>备注</span><input class="input" id="note" placeholder="买了什么 / 钱的来源" value="${esc(f.note)}"></label>
    <label class="field"><span>日期</span><input class="input" id="date" type="date" value="${f.date}"></label>
    <div class="field"><span class="muted small">小票照片（拍照后自动识别金额）</span></div>
    <div class="receipt-box">
      <img id="rc-preview" class="hidden" alt="小票">
      <button type="button" class="btn small secondary" id="rc-camera">📷 拍照</button>
      <button type="button" class="btn small secondary" id="rc-album">🖼 相册</button>
      <button type="button" class="btn small danger hidden" id="rc-remove">移除</button>
    </div>
    <input type="file" id="file-camera" accept="image/*" capture="environment" hidden>
    <input type="file" id="file-album" accept="image/*" hidden>
    <div class="ocr-status" id="ocr-status"></div>
    <button class="btn" id="save">保存</button>
    ${tx ? '<button class="btn danger" id="del" style="margin-top:6px">删除这笔</button>' : ''}`);

  const amt = $('#amt', root);
  const renderType = () => {
    root.querySelectorAll('[data-type]').forEach((b) => {
      const on = b.dataset.type === f.type;
      b.className = on ? `on ${f.type}-on` : '';
    });
    if (!CATS[f.type].includes(f.category)) f.category = CATS[f.type][0];
    $('#cats', root).innerHTML = CATS[f.type].map((c) =>
      `<button type="button" class="chip ${c === f.category ? 'on' : ''}" data-cat="${c}">${ICON[c] || ''} ${c}</button>`).join('');
    root.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { f.category = b.dataset.cat; renderType(); });
  };
  root.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => { f.type = b.dataset.type; renderType(); });
  renderType();
  amt.oninput = () => { f.autoAmount = false; };
  if (!tx) setTimeout(() => amt.focus(), 250);

  // ----- 小票 -----
  const preview = $('#rc-preview', root);
  const removeBtn = $('#rc-remove', root);
  const status = $('#ocr-status', root);
  const showPreview = (src) => {
    preview.src = src || '';
    preview.classList.toggle('hidden', !src);
    removeBtn.classList.toggle('hidden', !src);
  };
  if (f.receiptPath) signedUrl(f.receiptPath).then(showPreview);
  preview.onclick = () => { if (preview.src) window.open(preview.src, '_blank'); };

  $('#rc-camera', root).onclick = () => $('#file-camera', root).click();
  $('#rc-album', root).onclick = () => $('#file-album', root).click();
  removeBtn.onclick = () => {
    f.newBlob = null;
    f.removeReceipt = true;
    showPreview(null);
    status.textContent = '';
  };
  const onFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      status.textContent = '正在处理照片…';
      const blob = await compressImage(file);
      f.newBlob = blob;
      f.removeReceipt = false;
      showPreview(URL.createObjectURL(blob));
      status.textContent = '正在识别金额…（首次使用需下载识别模型，约十几秒）';
      const n = await recognizeAmount(blob, (p) => {
        if (document.body.contains(status)) status.textContent = p;
      });
      if (!document.body.contains(status)) return;
      if (n !== null) {
        if (!amt.value || f.autoAmount) { amt.value = String(n); f.autoAmount = true; }
        status.innerHTML = `识别到金额 <b>¥${money(n)}</b>，请核对后保存`;
      } else {
        status.textContent = '没有识别出金额，请手动填写';
      }
    } catch (err) {
      console.error(err);
      status.textContent = '识别失败，请手动填写金额（照片仍会保存）';
    }
  };
  $('#file-camera', root).onchange = onFile;
  $('#file-album', root).onchange = onFile;

  // ----- 保存 -----
  $('#save', root).onclick = async (e) => {
    const amount = parseAmount(amt.value);
    if (!amount) { toast('请输入金额'); amt.focus(); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      let receipt_path = f.receiptPath;
      if (f.newBlob) {
        const path = `${state.ledger.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from('receipts').upload(path, f.newBlob, { contentType: 'image/jpeg' });
        if (error) throw error;
        receipt_path = path;
      } else if (f.removeReceipt) {
        receipt_path = null;
      }
      const row = {
        type: f.type,
        amount,
        category: f.category,
        note: $('#note', root).value.trim(),
        occurred_on: $('#date', root).value || today(),
        receipt_path,
      };
      const { error } = tx
        ? await sb.from('transactions').update(row).eq('id', tx.id)
        : await sb.from('transactions').insert({ ...row, ledger_id: state.ledger.id, user_id: state.user.id });
      if (error) throw error;
      // 旧照片被替换或移除时，删掉存储里的旧文件
      if (tx?.receipt_path && tx.receipt_path !== receipt_path) {
        sb.storage.from('receipts').remove([tx.receipt_path]);
      }
      closeSheet();
      toast('已保存');
      const ym = row.occurred_on.slice(0, 7);
      if (ym !== state.month) state.month = ym;
      await refreshData();
    } catch (err) {
      toast(errMsg(err));
      btn.disabled = false;
      btn.textContent = '保存';
    }
  };

  if (tx) $('#del', root).onclick = () => deleteTx(tx);
}

async function deleteTx(tx) {
  if (!confirm(`确定删除这笔 ¥${money(tx.amount)} 的记录吗？`)) return;
  const { error } = await sb.from('transactions').delete().eq('id', tx.id);
  if (error) return toast(errMsg(error));
  if (tx.receipt_path) sb.storage.from('receipts').remove([tx.receipt_path]);
  closeSheet();
  toast('已删除');
  await refreshData();
}

function openTxDetail(id) {
  const t = state.txs.find((x) => x.id === id);
  if (!t) return;
  const root = openSheet('账单详情', `
    <div class="card section" style="text-align:center">
      <div style="font-size:30px">${ICON[t.category] || '📝'}</div>
      <div class="detail-amt ${t.type}">${t.type === 'income' ? '+' : '-'}${money(t.amount)}</div>
      <div class="muted">${t.type === 'income' ? '存入' : '支出'} · ${esc(t.category)}</div>
    </div>
    <div class="card section">
      <div class="kv"><span class="muted">备注</span><span>${esc(t.note || '无')}</span></div>
      <div class="kv"><span class="muted">日期</span><span>${t.occurred_on}</span></div>
      <div class="kv"><span class="muted">记账人</span><span>${esc(nickOf(t.user_id))}</span></div>
      <div class="kv"><span class="muted">记录时间</span><span>${new Date(t.created_at).toLocaleString('zh-CN', { hour12: false })}</span></div>
    </div>
    ${t.receipt_path ? '<div id="rc-wrap" class="muted small">小票加载中…</div>' : ''}
    <button class="btn" id="edit">编辑</button>
    <button class="btn danger" id="del" style="margin-top:6px">删除</button>`);
  if (t.receipt_path) {
    signedUrl(t.receipt_path).then((url) => {
      const w = $('#rc-wrap', root);
      if (!w) return;
      w.innerHTML = url ? `<a href="${esc(url)}" target="_blank"><img class="receipt-full" src="${esc(url)}" alt="小票"></a>` : '小票加载失败';
    });
  }
  $('#edit', root).onclick = () => openTxEditor(t);
  $('#del', root).onclick = () => deleteTx(t);
}

async function signedUrl(path) {
  const { data, error } = await sb.storage.from('receipts').createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}

// ================= 图片压缩 =================
async function compressImage(file, max = 1600, quality = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('无法读取图片'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ================= 小票识别（Tesseract.js，在手机本地运行） =================
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let ocrWorkerPromise = null;
let ocrProgress = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('识别组件下载失败'));
    document.head.appendChild(s);
  });
}

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      if (!window.Tesseract) await loadScript(TESSERACT_URL);
      return Tesseract.createWorker('jpn+eng', 1, {
        logger: (m) => {
          if (!ocrProgress) return;
          const pct = m.progress ? ` ${Math.round(m.progress * 100)}%` : '';
          if (m.status === 'recognizing text') ocrProgress(`正在识别金额…${pct}`);
          else if (/loading/.test(m.status)) ocrProgress(`正在下载识别模型…${pct}（仅首次）`);
        },
      });
    })().catch((e) => { ocrWorkerPromise = null; throw e; });
  }
  return ocrWorkerPromise;
}

async function recognizeAmount(blob, onProgress) {
  ocrProgress = onProgress;
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(blob);
    return guessAmount(data.text || '');
  } finally {
    ocrProgress = null;
  }
}

// 全角数字/符号转半角
function toHalfWidth(s) {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[，､、]/g, ',').replace(/[．。]/g, '.').replace(/￥/g, '¥').replace(/：/g, ':');
}

// 从日本小票文字里猜总金额：
// 优先找「合計」等关键字所在行，其次「お支払」「小計」；
// 跳过「お預り」（付的现金）、「お釣り」（找零）、消费税等行；
// 都找不到时，取带 ¥ 或「円」标记的最大金额。
function guessAmount(text) {
  const lines = toHalfWidth(text).split('\n')
    .map((l) => l.replace(/\s+/g, '').replace(/[\\Y半羊](?=\d)/g, '¥')) // OCR 常把 ¥ 认成这些字符
    .filter(Boolean);

  const numsIn = (line) => {
    const clean = line
      .replace(/\d{2,4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?/g, ' ') // 日期
      .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')                // 时间
      .replace(/\d+(\.\d+)?%/g, ' ')                         // 税率
      .replace(/\d+点|点数\d+/g, ' ');                        // 件数
    const out = [];
    const re = /(¥)?(\d{1,3}(?:[,.]\d{3})+|\d{1,7})(円)?/g;
    let m;
    while ((m = re.exec(clean))) {
      const n = Number(m[2].replace(/[,.]/g, ''));
      if (n > 0 && n < 1e7) out.push({ n, marked: !!(m[1] || m[3]) });
    }
    return out;
  };
  const pick = (nums) => {
    const marked = nums.filter((x) => x.marked);
    const list = marked.length ? marked : nums;
    return list.length ? list[list.length - 1].n : null;
  };

  const KEYS = [
    /総合計|税込合計|御?合計|お買上|ご?請求|TOTAL/i,
    /お?支払(い)?金額|お支払|お会計|現計/,
    /小計/,
  ];
  const SKIP = /預[りか]|釣|消費税|内税|外税|税額|税等|対象|割引|値引|ポイント|TEL|電話|登録番号|現金/i;

  for (const key of KEYS) {
    for (let i = 0; i < lines.length; i++) {
      if (!key.test(lines[i]) || SKIP.test(lines[i])) continue;
      const here = pick(numsIn(lines[i]));
      if (here !== null) return here;
      const next = lines[i + 1] && !SKIP.test(lines[i + 1]) ? pick(numsIn(lines[i + 1])) : null;
      if (next !== null) return next;
    }
  }
  const marked = lines.filter((l) => !SKIP.test(l)).flatMap(numsIn).filter((x) => x.marked).map((x) => x.n);
  return marked.length ? Math.max(...marked) : null;
}
