/* ==========================================================================
   DouK Web UI — application logic
   Vanilla JS, no external dependencies.
   ========================================================================== */
'use strict';

/* ------------------------------------------------------------------ state */

const PLATFORM_LABEL = { douyin: '抖音', tiktok: 'TikTok' };

const VIEW_TITLES = {
  parse: '作品解析',
  account: '账号作品',
  mix: '合集作品',
  live: '直播解析',
  comment: '评论采集',
  search: '搜索发现',
  tasks: '服务端任务',
  settings: '全局配置',
};

const SEARCH_HINTS = {
  general: '综合结果会混合返回视频、用户、直播等数据',
  video: '按关键词搜索视频，可按排序、发布时间、时长与范围筛选',
  user: '按关键词搜索用户，可筛选粉丝数量与认证类型',
  live: '按关键词搜索正在直播的房间',
};

const state = {
  platform: 'douyin',
  token: '',
  view: 'parse',
  searchType: 'general',
  settings: null,
  history: [],
  config: { api_base: 'http://127.0.0.1:5555', docs: '/docs', redoc: '/redoc' },
  apiOnline: false,
  tokenValid: false,
};

const rawStore = new Map();
let rawSeq = 0;

/* ------------------------------------------------------------- dom helpers */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/* ---------------------------------------------------------------- utilities */

const ESC_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESC_MAP[char]);
}

function safeUrl(url) {
  const text = String(url ?? '').trim();
  return /^https?:\/\//i.test(text) ? esc(text) : '';
}

function stripUrl(url) {
  return String(url ?? '').trim();
}

function fmtNum(value) {
  if (value === undefined || value === null || value === '' || Number(value) < 0) {
    return '—';
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (number >= 1e8) return `${trimZero((number / 1e8).toFixed(2))}亿`;
  if (number >= 1e4) return `${trimZero((number / 1e4).toFixed(1))}万`;
  return number.toLocaleString('zh-CN');
}

function trimZero(value) {
  return String(value).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}

function initial(value) {
  const text = String(value || '?').trim();
  return text ? [...text][0].toUpperCase() : '?';
}

function shortText(value, length = 48) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function sanitizeName(value) {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function stamp() {
  const now = new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function relativeTime(timestamp) {
  const diff = Date.now() - Number(timestamp);
  if (!Number.isFinite(diff) || diff < 0) return '';
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const date = new Date(Number(timestamp));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const AVATAR_PALETTES = [
  ['#ff2f5f', '#7c5cff'],
  ['#2fe4d4', '#5b8bff'],
  ['#ff9a3c', '#ff2f5f'],
  ['#7c5cff', '#2fe4d4'],
  ['#4dd0e1', '#7c5cff'],
  ['#ff5c8a', '#ffc857'],
  ['#3ddc97', '#2fe4d4'],
  ['#7c5cff', '#ff5c8a'],
];

function avatarStyle(name) {
  const text = String(name || '?');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const [a, b] = AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
  return `--av-a:${a};--av-b:${b};`;
}

function platformOfShareUrl(url) {
  if (/tiktok\.com/i.test(url || '')) return 'TikTok';
  if (/douyin\.com/i.test(url || '')) return '抖音';
  return '';
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* -------------------------------------------------------------------- toast */

function toast(message, type = 'info', duration = 3200) {
  const host = $('#toasts');
  if (!host) return;
  const icon = type === 'success' ? 'i-check' : type === 'error' ? 'i-alert' : 'i-info';
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `<svg viewBox="0 0 24 24"><use href="#${icon}"/></svg><span>${esc(message)}</span>`;
  host.appendChild(element);
  window.setTimeout(() => {
    element.classList.add('leaving');
    window.setTimeout(() => element.remove(), 220);
  }, duration);
}

/* --------------------------------------------------------------- clipboard */

function copyText(value) {
  const text = String(value ?? '');
  if (!text) {
    toast('没有可复制的内容', 'error');
    return;
  }

  const fallback = () => {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast('已复制到剪贴板', 'success');
    } catch {
      toast('复制失败，请手动复制', 'error');
    }
    area.remove();
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(
      () => toast('已复制到剪贴板', 'success'),
      fallback,
    );
  } else {
    fallback();
  }
}

/* ---------------------------------------------------------------- downloads */

function fileName(item, kind = 0) {
  const base =
    sanitizeName([item?.nickname, item?.desc, item?.id].filter(Boolean).join('_')) ||
    'media';
  if (typeof kind === 'number') {
    return downloadList(item).length > 1
      ? `${base.slice(0, 84)}_${kind + 1}`
      : base.slice(0, 96);
  }
  const suffix = kind === 'music' ? '_音乐' : kind === 'cover' ? '_封面' : '';
  return `${base.slice(0, 96)}${suffix}`;
}

function downloadMedia(url, name) {
  if (!/^https?:\/\//i.test(String(url || ''))) {
    toast('下载链接不可用', 'error');
    return;
  }
  const link = document.createElement('a');
  link.href = `/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name || 'media')}`;
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast('已开始浏览器下载', 'success');
}

function serverDownloadTarget(item) {
  const share = String(item?.share_url || '').trim();
  if (/^https?:\/\//i.test(share)) return share;
  const id = String(item?.id || '').trim();
  if (!/^\d{19}$/.test(id)) return '';
  if (state.platform === 'tiktok') {
    const user = String(item?.unique_id || '').trim().replace(/^@/, '');
    return user ? `https://www.tiktok.com/@${user}/video/${id}` : '';
  }
  return `https://www.douyin.com/video/${id}`;
}

function accountServerFolder(items, tab) {
  const first = (items || []).find((item) => item && item.uid && item.nickname);
  if (!first) return '';
  const suffix =
    tab === 'favorite' ? '喜欢作品' : tab === 'collection' ? '收藏作品' : '发布作品';
  return `UID${String(first.uid).trim()}_${sanitizeName(first.nickname)}_${suffix}`;
}

async function requestServerDownload(payload, button, label = '服务端下载') {
  if (button) setButtonBusy(button, true, '提交中…');
  try {
    const response = await fetch('/server-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.detail || `HTTP ${response.status}`);
    }
    const folder = data.folder ? ` / ${data.folder}` : '';
    toast(
      `已提交${label}${data.count > 1 ? `（${data.count} 个作品）` : ''}${
        data.root ? `，保存到 ${data.root}${folder}` : ''
      }`,
      'success',
      7000,
    );
    pollServerDownload(data.job_id, data.log);
    loadServerJobs({ silent: true });
  } catch (error) {
    toast(`${label}提交失败：${error?.message || error}`, 'error', 7000);
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

function submitServerDownload(item, button = null) {
  const url = serverDownloadTarget(item);
  if (!url) {
    toast('缺少作品链接，无法提交服务端下载', 'error');
    return;
  }
  return requestServerDownload({ url }, button);
}

function submitServerBatchDownload(urls, folder, button = null) {
  const valid = [
    ...new Set(
      (urls || []).filter((url) => /^https?:\/\//i.test(String(url || ''))),
    ),
  ];
  if (!valid.length) {
    toast('没有可提交服务端下载的作品', 'error');
    return;
  }
  return requestServerDownload(
    { urls: valid, folder: folder || '' },
    button,
    '服务端批量下载',
  );
}

/* ----------------------------------------------------------- server tasks */

let tasksTimer = null;

function formatJobDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (value < 60) return `${value} 秒`;
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  if (minutes < 60) return `${minutes} 分 ${rest} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function formatJobTime(seconds) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function jobStateLabel(state) {
  if (state === 'running') return '运行中';
  if (state === 'done') return '已完成';
  if (state === 'failed') return '失败';
  return state || '未知';
}

function updateTasksBadge(running) {
  const badge = $('#tasks-badge');
  if (!badge) return;
  const count = Number(running) || 0;
  badge.hidden = count <= 0;
  badge.textContent = count > 99 ? '99+' : String(count);
}

function renderServerJob(job) {
  const state = job.state || 'unknown';
  const folder = String(job.folder || '');
  const root = String(job.root || '');
  const count = Number(job.count) || 0;
  const title = folder || (count > 1 ? '批量作品' : '单个作品');
  const location = root ? `${root}${folder ? ` / ${folder}` : ''}` : '—';
  const firstUrl = String(job.first_url || '');
  return `<article class="task-row ${esc(state)}">
    <span class="task-state ${esc(state)}"><span class="task-dot"></span>${esc(
      jobStateLabel(state),
    )}</span>
    <div class="task-main">
      <div class="task-title">
        <strong title="${esc(title)}">${esc(title)}</strong>
        <span class="badge">${esc(count)} 个作品</span>
      </div>
      <div class="task-meta">
        <span title="${esc(location)}"><svg viewBox="0 0 24 24"><use href="#i-folder"/></svg>${esc(location)}</span>
        <span title="${esc(formatJobTime(job.started))}"><svg viewBox="0 0 24 24"><use href="#i-clock"/></svg>${esc(
          formatJobTime(job.started),
        )} · ${state === 'running' ? '已运行' : '耗时'} ${esc(
          formatJobDuration(job.elapsed),
        )}</span>
        ${
          firstUrl
            ? `<span class="task-url" title="${esc(firstUrl)}"><svg viewBox="0 0 24 24"><use href="#i-link"/></svg>${esc(
                shortText(firstUrl, 60),
              )}</span>`
            : ''
        }
        ${
          job.code !== null && job.code !== undefined
            ? `<span>退出码 ${esc(job.code)}</span>`
            : ''
        }
      </div>
    </div>
    <div class="task-actions">
      <button type="button" class="btn btn-ghost btn-xs" data-task-log="${esc(
        job.job_id,
      )}">
        <svg viewBox="0 0 24 24"><use href="#i-doc"/></svg>日志
      </button>
    </div>
  </article>`;
}

function renderServerJobs(payload) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  updateTasksBadge(payload?.running);
  const summary = $('#tasks-summary');
  if (summary) {
    summary.textContent = `运行中 ${payload?.running || 0} · 已完成 ${
      payload?.done || 0
    } · 失败 ${payload?.failed || 0}`;
  }
  const list = $('#tasks-list');
  if (!list) return;
  if (!jobs.length) {
    list.innerHTML = emptyState(
      '还没有服务端下载任务',
      '在作品详情或批量下载弹窗中点击「服务端下载」，任务会显示在这里。',
      'i-bolt',
    );
    return;
  }
  list.innerHTML = `<div class="task-list">${jobs.map(renderServerJob).join('')}</div>`;
  list.querySelectorAll('[data-task-log]').forEach((button) => {
    button.addEventListener('click', () => showServerJobLog(button.dataset.taskLog));
  });
}

async function loadServerJobs({ silent = false } = {}) {
  const list = $('#tasks-list');
  if (!silent && list && state.view === 'tasks') {
    list.innerHTML = `<div class="settings-skeleton">
      <div class="skeleton"></div>
      <div class="skeleton"></div>
      <div class="skeleton"></div>
    </div>`;
  }
  try {
    const response = await fetch('/server-download/jobs', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('任务接口不可用，请重启 Web UI 服务（server.py）');
      }
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.detail || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    renderServerJobs(payload);
    return payload;
  } catch (error) {
    updateTasksBadge(0);
    if (!silent && list && state.view === 'tasks') {
      list.innerHTML = renderError(error);
    }
    return null;
  }
}

function startTasksPolling() {
  stopTasksPolling();
  loadServerJobs();
  tasksTimer = window.setInterval(() => {
    if (state.view === 'tasks') loadServerJobs({ silent: true });
  }, 4000);
}

function stopTasksPolling() {
  if (tasksTimer) {
    window.clearInterval(tasksTimer);
    tasksTimer = null;
  }
}

async function loadServerJobLog(jobId) {
  const body = $('#modal-body');
  if (!body || $('#modal')?.hidden) return;
  body.innerHTML = `<div class="task-log-loading"><span class="spinner"></span>加载日志…</div>`;
  try {
    const response = await fetch(
      `/server-download/log?job_id=${encodeURIComponent(jobId)}`,
      { headers: { Accept: 'application/json' } },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.detail || `HTTP ${response.status}`);
    }
    if ($('#modal')?.hidden) return;
    const pathNode = $('#task-log-path');
    if (pathNode) pathNode.textContent = payload.log || '';
    body.innerHTML = `<pre class="task-log">${esc(payload.text || '（日志为空）')}</pre>`;
    if (payload.truncated) {
      body.insertAdjacentHTML(
        'beforeend',
        '<p class="hint">日志过长，仅显示最后 64 KB。</p>',
      );
    }
  } catch (error) {
    if ($('#modal')?.hidden) return;
    body.innerHTML = renderError(error);
  }
}

function showServerJobLog(jobId) {
  openModal({
    title: '任务日志',
    wide: true,
    body: `<div class="task-log-loading"><span class="spinner"></span>加载日志…</div>`,
    footer: `<span class="hint task-log-path" id="task-log-path"></span>
      <div class="spacer"></div>
      <button type="button" class="btn btn-ghost" data-close>关闭</button>
      <button type="button" class="btn" id="task-log-refresh">
        <svg viewBox="0 0 24 24"><use href="#i-refresh"/></svg>刷新
      </button>`,
  });
  $('#task-log-refresh')?.addEventListener('click', () => loadServerJobLog(jobId));
  loadServerJobLog(jobId);
}

function pollServerDownload(jobId, logPath) {
  if (!jobId) return;
  const deadline = Date.now() + 30 * 60 * 1000;
  const tick = () => {
    if (Date.now() > deadline) return;
    fetch(`/server-download/status?job_id=${encodeURIComponent(jobId)}`, {
      headers: { Accept: 'application/json' },
    })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) return;
        if (payload.state === 'done') {
          toast('服务端下载任务已完成', 'success', 5000);
          loadServerJobs({ silent: true });
          return;
        }
        if (payload.state === 'failed') {
          toast(
            `服务端下载失败${payload.log ? `，日志：${payload.log}` : logPath ? `，日志：${logPath}` : ''}`,
            'error',
            10000,
          );
          loadServerJobs({ silent: true });
          return;
        }
        window.setTimeout(tick, 3000);
      })
      .catch(() => window.setTimeout(tick, 3000));
  };
  window.setTimeout(tick, 3000);
}

function mediaProxyUrl(url) {
  const text = stripUrl(url);
  if (!/^https?:\/\//i.test(text)) return '';
  return `/media?url=${encodeURIComponent(text)}`;
}

/* ---------------------------------------------------------- batch download */

function mediaFilesOf(items) {
  const files = [];
  items.forEach((item) => {
    downloadList(item).forEach((url, index) => {
      files.push({
        url,
        name: fileName(item, index),
        label: item.desc || item.id || '',
      });
    });
  });
  return files;
}

function triggerBatchDownloads(files) {
  const valid = files.filter(
    (file) => file && /^https?:\/\//i.test(String(file.url || '')),
  );
  if (!valid.length) {
    toast('没有可下载的文件', 'error');
    return;
  }

  toast(
    `已开始发起 ${valid.length} 个文件的浏览器下载；若浏览器询问“允许下载多个文件”，请选择允许。`,
    'info',
    6800,
  );

  // A hidden iframe keeps the current page state and avoids popup blockers.
  valid.forEach((file, index) => {
    window.setTimeout(() => {
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.setAttribute('aria-hidden', 'true');
      frame.src = `/download?url=${encodeURIComponent(file.url)}&name=${encodeURIComponent(
        file.name || 'media',
      )}`;
      document.body.appendChild(frame);
      window.setTimeout(() => frame.remove(), 300_000);
    }, index * 450);
  });
}

function openBatchModal(items, options = {}) {
  const serverFolder = options.serverFolder || '';
  const downloadable = items.filter((item) => downloadList(item).length);
  if (!downloadable.length) {
    toast('当前结果没有可下载的媒体文件', 'error');
    return;
  }

  const totalFiles = downloadable.reduce(
    (sum, item) => sum + downloadList(item).length,
    0,
  );

  const rows = downloadable
    .map((item, index) => {
      const files = downloadList(item);
      const cover = coverOf(item);
      const type =
        item.type || (mediaKind(item) === 'gallery' ? '图集' : '视频');
      return `<label class="batch-row">
        <input type="checkbox" data-batch-index="${index}" checked>
        ${
          cover
            ? `<img class="batch-thumb" src="${esc(mediaProxyUrl(cover))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
            : `<span class="batch-thumb batch-thumb-empty"><svg viewBox="0 0 24 24"><use href="#i-image"/></svg></span>`
        }
        <span class="batch-meta">
          <strong title="${esc(item.desc || '')}">${esc(item.desc || item.id || '未命名作品')}</strong>
          <span>${esc(item.nickname || '')} · ${esc(type)} · ${files.length} 个文件</span>
        </span>
        <span class="badge">${files.length}</span>
      </label>`;
    })
    .join('');

  openModal({
    title: '批量下载',
    wide: true,
    body: `<div class="stack">
      <div class="batch-toolbar">
        <button type="button" class="btn btn-ghost btn-xs" id="batch-select-all">全选</button>
        <button type="button" class="btn btn-ghost btn-xs" id="batch-select-none">全不选</button>
        <span class="hint" id="batch-count">已选择 ${downloadable.length} 个作品，共 ${totalFiles} 个文件</span>
      </div>
      <div class="batch-list" id="batch-list">${rows}</div>
      <div class="alert info compact">
        <svg viewBox="0 0 24 24"><use href="#i-info"/></svg>
        <span>浏览器下载会逐个保存到浏览器默认目录；服务端下载会由本机 TikTokDownloader 保存到全局配置的 root${
          serverFolder
            ? `，并使用专属文件夹 <strong>${esc(serverFolder)}</strong>`
            : ''
        }。首次浏览器批量下载时，请允许本站下载多个文件。</span>
      </div>
    </div>`,
    footer: `<span class="batch-count" id="batch-foot-count">共 ${totalFiles} 个文件</span>
      <div class="spacer"></div>
      <button type="button" class="btn btn-ghost" data-close>取消</button>
      <button type="button" class="btn" id="batch-start">
        <svg viewBox="0 0 24 24"><use href="#i-download"/></svg>浏览器下载所选
      </button>
      <button type="button" class="btn btn-primary" id="batch-server">
        <svg viewBox="0 0 24 24"><use href="#i-folder"/></svg>服务端下载所选
      </button>`,
  });

  const boxes = $$('#batch-list [data-batch-index]');
  const refresh = () => {
    const selected = boxes.filter((box) => box.checked);
    const files = selected.reduce(
      (sum, box) =>
        sum + downloadList(downloadable[Number(box.dataset.batchIndex)]).length,
      0,
    );
    $('#batch-count').textContent = `已选择 ${selected.length} 个作品，共 ${files} 个文件`;
    $('#batch-foot-count').textContent = `共 ${files} 个文件`;
    $('#batch-start').disabled = selected.length === 0;
    $('#batch-server').disabled = selected.length === 0;
  };

  boxes.forEach((box) => box.addEventListener('change', refresh));
  $('#batch-select-all').addEventListener('click', () => {
    boxes.forEach((box) => {
      box.checked = true;
    });
    refresh();
  });
  $('#batch-select-none').addEventListener('click', () => {
    boxes.forEach((box) => {
      box.checked = false;
    });
    refresh();
  });

  $('#batch-start').addEventListener('click', () => {
    const selected = boxes
      .filter((box) => box.checked)
      .map((box) => downloadable[Number(box.dataset.batchIndex)]);
    const files = mediaFilesOf(selected);
    closeModal();
    triggerBatchDownloads(files);
  });

  $('#batch-server').addEventListener('click', (event) => {
    const selected = boxes
      .filter((box) => box.checked)
      .map((box) => downloadable[Number(box.dataset.batchIndex)]);
    const urls = selected
      .map((item) => serverDownloadTarget(item))
      .filter(Boolean);
    if (!urls.length) {
      toast('所选作品没有可提交服务端下载的链接', 'error');
      return;
    }
    submitServerBatchDownload(urls, serverFolder, event.currentTarget);
  });

  refresh();
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `DouK_${stamp()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ------------------------------------------------------------- json renderer */

function syntaxJson(value) {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  const pattern =
    /("(?:\\u[\da-fA-F]{4}|\\.|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
  let output = '';
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(json)) !== null) {
    output += esc(json.slice(lastIndex, match.index));
    const token = match[0];
    let className = 'j-num';
    if (token.startsWith('"')) {
      className = match[2] ? 'j-key' : 'j-str';
    } else if (token === 'true' || token === 'false') {
      className = 'j-bool';
    } else if (token === 'null') {
      className = 'j-null';
    }
    output += `<span class="${className}">${esc(token)}</span>`;
    lastIndex = pattern.lastIndex;
  }
  output += esc(json.slice(lastIndex));
  return output;
}

function renderRaw(title, payload, subtitle = '') {
  const id = `raw-${(rawSeq += 1)}`;
  rawStore.set(id, payload);
  return `<div class="panel raw-panel">
    <div class="raw-head">
      <div>
        <span class="eyebrow small">RAW RESPONSE</span>
        <h3>${esc(title)}</h3>
        ${subtitle ? `<p class="hint">${esc(subtitle)}</p>` : ''}
      </div>
      <div class="raw-actions">
        <button type="button" class="btn btn-ghost btn-xs" data-raw-copy="${id}">
          <svg viewBox="0 0 24 24"><use href="#i-copy"/></svg>复制
        </button>
        <button type="button" class="btn btn-ghost btn-xs" data-raw-export="${id}">
          <svg viewBox="0 0 24 24"><use href="#i-download"/></svg>导出
        </button>
      </div>
    </div>
    <div class="json-view">${syntaxJson(payload)}</div>
  </div>`;
}

/* ---------------------------------------------------------------------- api */

class ApiError extends Error {
  constructor(status, payload) {
    super(`HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload || {};
  }
}

async function api(path, body, options = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = hasOwn(options, 'token') ? options.token : state.token;
  if (token) headers.token = token;

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, {
      detail: '无法连接本地 Web UI 服务，请确认 server.py 正在运行。',
    });
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { detail: text };
    }
  }

  if (!response.ok) throw new ApiError(response.status, payload || {});
  return payload;
}

function errorText(error) {
  if (!error) return '未知错误';
  if (error instanceof ApiError) {
    const detail = error.payload?.detail;
    if (error.status === 403) {
      return '令牌验证失败，请点击右上角「令牌」填写正确的 token。';
    }
    if (error.status === 422 && Array.isArray(detail)) {
      const parts = detail.map((item) => {
        const location = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : '';
        return `${location ? `${location}: ` : ''}${item.msg || '参数错误'}`;
      });
      return `参数校验失败：${parts.join('；')}`;
    }
    if (typeof detail === 'string' && detail) return detail;
    if (detail) return JSON.stringify(detail);
    if (error.payload && Object.keys(error.payload).length) {
      return JSON.stringify(error.payload);
    }
    if (error.status === 0) return error.message;
    return `请求失败（HTTP ${error.status}）`;
  }
  return error.message || String(error);
}

/* ---------------------------------------------------------------- renderers */

function mediaPlaceholder(label = '无预览图') {
  return `<div class="media-placeholder">
    <svg viewBox="0 0 24 24"><use href="#i-image"/></svg>
    <span>${esc(label)}</span>
  </div>`;
}

function downloadList(item) {
  const raw = item?.downloads;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
}

function isGallery(item) {
  return /图集|实况/.test(String(item?.type || ''));
}

function isImageUrl(url) {
  const text = String(url || '');
  return (
    /\.(jpe?g|png|webp|gif|avif|bmp)(\?|$)/i.test(text) ||
    /douyinpic\.com|aweme-images|image-cut-tos/i.test(text)
  );
}

function isLivePhoto(item) {
  return /实况/.test(String(item?.type || ''));
}

function mediaKind(item) {
  if (isGallery(item)) return 'gallery';
  if (/视频/.test(String(item?.type || ''))) return 'video';
  const url = downloadList(item)[0] || '';
  return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url) ? 'image' : 'video';
}

function coverOf(item) {
  const direct = stripUrl(item?.static_cover) || stripUrl(item?.dynamic_cover);
  if (direct) return direct;
  const kind = mediaKind(item);
  if (kind !== 'gallery' && kind !== 'image') return '';
  const downloads = downloadList(item);
  if (isLivePhoto(item)) {
    return downloads.find(isImageUrl) || '';
  }
  return downloads[0] || '';
}

function isItemLike(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ('downloads' in value || 'type' in value) &&
    ('id' in value || 'desc' in value || 'nickname' in value)
  );
}

function unwrapItems(response) {
  const data = response?.data;
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === 'object' && Array.isArray(data.data)) return data.data;
  return [data];
}

function renderSummary({ eyebrow, title, message = '', platform = '', extraActions = '' }) {
  return `<div class="result-summary">
    <div class="summary-main">
      <span class="eyebrow small">${esc(eyebrow)}</span>
      <strong>${title}</strong>
      ${message ? `<span class="result-message">${esc(message)}</span>` : ''}
    </div>
    <div class="summary-actions">
      ${platform ? `<span class="pill">${esc(platform)}</span>` : ''}
      <button type="button" class="btn btn-ghost btn-xs" data-export-result>
        <svg viewBox="0 0 24 24"><use href="#i-save"/></svg>导出 JSON
      </button>
      ${extraActions}
    </div>
  </div>`;
}

function bindExportResult(root, payload, filename) {
  const button = root.querySelector('[data-export-result]');
  if (button) {
    button.addEventListener('click', () => downloadJson(payload, filename));
  }
}

function emptyState(title, description, icon = 'i-image') {
  return `<div class="panel empty-state">
    <div class="empty-icon"><svg viewBox="0 0 24 24"><use href="#${icon}"/></svg></div>
    <h3>${esc(title)}</h3>
    <p>${esc(description)}</p>
  </div>`;
}

function renderError(error) {
  return `<div class="alert error">
    <svg viewBox="0 0 24 24"><use href="#i-alert"/></svg>
    <div><strong>请求失败</strong><p>${esc(errorText(error))}</p></div>
  </div>`;
}

function showLoading(container, label, { skeleton = 'grid' } = {}) {
  const skeletons =
    skeleton === 'grid'
      ? `<div class="skeleton-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`
      : `<div class="skeleton" style="height:300px"></div>`;
  container.innerHTML = `<div class="panel loading-panel">
    <span class="spinner dark"></span>
    <div>
      <strong>${esc(label)}</strong>
      <p>正在请求本地 API… 已等待 <span class="elapsed">0s</span></p>
    </div>
  </div>${skeletons}`;

  const elapsed = container.querySelector('.elapsed');
  const start = performance.now();
  const timer = window.setInterval(() => {
    if (!elapsed || !elapsed.isConnected) {
      window.clearInterval(timer);
      return;
    }
    elapsed.textContent = `${Math.floor((performance.now() - start) / 1000)}s`;
  }, 500);
  return () => window.clearInterval(timer);
}

function scrollToResult(container) {
  window.requestAnimationFrame(() => {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function setButtonBusy(button, busy, label = '请求中…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span><span>${esc(label)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

/* -------------------------------------------------------------------- modal */

let lastFocused = null;

function openModal({ title, body, footer = '', wide = false }) {
  lastFocused = document.activeElement;
  const modal = $('#modal');
  const card = $('#modal-card');
  $('#modal-title').textContent = title || '';
  $('#modal-body').innerHTML = body || '';
  const foot = $('#modal-foot');
  if (footer) {
    foot.innerHTML = footer;
    foot.hidden = false;
  } else {
    foot.innerHTML = '';
    foot.hidden = true;
  }
  card.classList.toggle('wide', Boolean(wide));
  modal.hidden = false;
  document.body.classList.add('modal-open');
  window.requestAnimationFrame(() => {
    const focusable = modal.querySelector('input, select, textarea, button, a[href]');
    focusable?.focus();
  });
}

function closeModal() {
  const modal = $('#modal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  lastFocused?.focus?.();
  lastFocused = null;
}

function openDetailModal(item) {
  openModal({ title: '作品详情', body: renderDetail(item), wide: true });
  bindDetail($('#modal-body'), item);
}

/* -------------------------------------------------------------- detail view */

function renderDetail(item) {
  const downloads = downloadList(item);
  const kind = mediaKind(item);
  const cover = coverOf(item);
  const isVideo = kind === 'video';
  const type = item.type || (kind === 'gallery' ? '图集' : kind === 'video' ? '视频' : '作品');
  const title = item.desc || item.id || '未命名作品';

  const badges = [
    `<span class="badge badge-accent">${esc(type)}</span>`,
    item.duration && item.duration !== '00:00:00'
      ? `<span class="badge">${esc(item.duration)}</span>`
      : '',
    Number(item.width) > 0 && Number(item.height) > 0
      ? `<span class="badge">${esc(item.width)}×${esc(item.height)}</span>`
      : '',
    Array.isArray(item.text_extra) && item.text_extra.length
      ? `<span class="badge">${item.text_extra.length} 个话题</span>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  let media;
  if (isVideo && downloads[0]) {
    const playUrl = mediaProxyUrl(downloads[0]);
    const posterUrl = mediaProxyUrl(cover);
    media = `<video class="detail-video" controls playsinline preload="metadata" src="${esc(playUrl)}" ${
      posterUrl ? `poster="${esc(posterUrl)}"` : ''
    }></video>`;
  } else if (cover) {
    const coverSrc = mediaProxyUrl(cover);
    media = `<a href="${esc(coverSrc)}" target="_blank" rel="noreferrer" title="点击查看原图">
      <img class="detail-image" src="${esc(coverSrc)}" alt="" referrerpolicy="no-referrer" onerror="this.classList.add('broken')">
    </a>`;
  } else {
    media = mediaPlaceholder('无预览内容');
  }

  const gallery =
    kind === 'gallery' && downloads.length
      ? `<div class="field">
          <span class="field-label">${isLivePhoto(item) ? '实况' : '图集'} · ${downloads.length} 个文件</span>
          <div class="media-gallery">
            ${downloads
              .map((url, index) => {
                const imageLike = !isLivePhoto(item) || isImageUrl(url);
                const tile = imageLike
                  ? `<a href="${esc(mediaProxyUrl(url))}" target="_blank" rel="noreferrer" title="查看第 ${index + 1} 张">
                      <img src="${esc(mediaProxyUrl(url))}" alt="图片 ${index + 1}" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('broken')">
                    </a>`
                  : `<a class="gallery-video" href="${esc(mediaProxyUrl(url))}" target="_blank" rel="noreferrer" title="打开实况视频">
                      <svg viewBox="0 0 24 24"><use href="#i-play"/></svg>
                      <span>视频</span>
                    </a>`;
                return `<div class="gallery-item">
                  ${tile}
                  <button type="button" class="gallery-dl" data-dl-index="${index}" title="浏览器下载第 ${index + 1} 个文件">
                    <svg viewBox="0 0 24 24"><use href="#i-download"/></svg>
                  </button>
                  <span class="gallery-index">${index + 1}</span>
                </div>`;
              })
              .join('')}
          </div>
        </div>`
      : '';

  const stats = [
    ['点赞', item.digg_count],
    ['评论', item.comment_count],
    ['收藏', item.collect_count],
    ['分享', item.share_count],
    ['播放', item.play_count],
  ]
    .filter(([, value]) => value !== undefined && value !== null && Number(value) >= 0)
    .map(
      ([label, value]) => `<div class="stat" title="${esc(value)}">
        <span class="stat-value">${fmtNum(value)}</span>
        <span class="stat-label">${label}</span>
      </div>`,
    )
    .join('');

  const tags = [
    ...(Array.isArray(item.text_extra) ? item.text_extra : []),
    ...(Array.isArray(item.tag) ? item.tag : []),
  ]
    .filter(Boolean)
    .filter((tag, index, list) => list.indexOf(tag) === index)
    .slice(0, 12)
    .map((tag) => `<span class="tag">#${esc(tag)}</span>`)
    .join('');

  const music =
    item.music_title || item.music_url
      ? `<div class="music-row">
          <svg viewBox="0 0 24 24"><use href="#i-music"/></svg>
          <div class="music-meta">
            <strong>${esc(item.music_title || '背景音乐')}</strong>
            <span>${esc(item.music_author || '')}</span>
          </div>
          ${
            item.music_url
              ? `<a class="btn btn-ghost btn-xs" href="${esc(item.music_url)}" target="_blank" rel="noreferrer">
                  <svg viewBox="0 0 24 24"><use href="#i-external"/></svg>试听
                </a>`
              : ''
          }
        </div>`
      : '';

  const serverTarget = serverDownloadTarget(item);
  const actions = [
    serverTarget
      ? `<button type="button" class="btn btn-primary" data-server-download title="由本机 TikTokDownloader 按全局配置下载到 root 目录">
          <svg viewBox="0 0 24 24"><use href="#i-folder"/></svg>服务端下载
        </button>`
      : '',
    isVideo && downloads[0]
      ? `<button type="button" class="btn" data-dl-index="0">
          <svg viewBox="0 0 24 24"><use href="#i-download"/></svg>浏览器下载视频
        </button>`
      : '',
    kind === 'gallery' && downloads.length
      ? `<span class="badge">${isLivePhoto(item) ? '实况' : '图集'}共 ${downloads.length} 个文件，可在下方逐个浏览器下载</span>`
      : '',
    downloads.length > 1
      ? `<button type="button" class="btn" data-dl-all>
          <svg viewBox="0 0 24 24"><use href="#i-download"/></svg>${
            kind === 'gallery'
              ? `浏览器下载全部 ${downloads.length} 个${isLivePhoto(item) ? '文件' : '图片'}`
              : `浏览器下载全部 ${downloads.length} 个文件`
          }
        </button>`
      : '',
    item.music_url
      ? `<button type="button" class="btn" data-dl-music>
          <svg viewBox="0 0 24 24"><use href="#i-music"/></svg>浏览器下载音乐
        </button>`
      : '',
    item.static_cover
      ? `<button type="button" class="btn" data-dl-cover>
          <svg viewBox="0 0 24 24"><use href="#i-image"/></svg>浏览器下载封面
        </button>`
      : '',
    item.share_url
      ? `<a class="btn btn-ghost" href="${esc(item.share_url)}" target="_blank" rel="noreferrer">
          <svg viewBox="0 0 24 24"><use href="#i-external"/></svg>打开原作品
        </a>`
      : '',
    item.share_url
      ? `<button type="button" class="btn btn-ghost" data-copy="${esc(item.share_url)}">
          <svg viewBox="0 0 24 24"><use href="#i-copy"/></svg>复制链接
        </button>`
      : '',
    `<button type="button" class="btn btn-ghost" data-export-detail>
      <svg viewBox="0 0 24 24"><use href="#i-save"/></svg>导出 JSON
    </button>`,
  ]
    .filter(Boolean)
    .join('');

  const metaChips = [
    item.create_time
      ? `<span class="meta-chip"><svg viewBox="0 0 24 24"><use href="#i-clock"/></svg>${esc(item.create_time)}</span>`
      : '',
    item.id ? `<span class="meta-chip">ID ${esc(item.id)}</span>` : '',
    item.share_url
      ? `<span class="meta-chip">${esc(platformOfShareUrl(item.share_url))}</span>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  return `<article class="panel detail-card">
    <div class="detail-media">${media}</div>
    <div class="detail-info">
      <div class="badges">${badges}</div>
      <h2 class="detail-title">${esc(title)}</h2>
      <div class="author">
        <div class="avatar avatar-lg" style="${avatarStyle(item.nickname || title)}">${esc(initial(item.nickname || title))}</div>
        <div class="author-meta">
          <strong>${esc(item.nickname || '未知作者')}</strong>
          <span>${item.unique_id ? `@${esc(item.unique_id)}` : item.uid ? `UID ${esc(item.uid)}` : '—'}${
            item.signature ? ` · ${esc(shortText(item.signature, 48))}` : ''
          }</span>
        </div>
      </div>
      ${metaChips ? `<div class="meta-row">${metaChips}</div>` : ''}
      ${stats ? `<div class="stat-row">${stats}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${music}
      ${gallery}
      <div class="action-row">${actions}</div>
      <details class="json-details">
        <summary>查看原始 JSON 数据</summary>
        <div class="json-view">${syntaxJson(item)}</div>
      </details>
    </div>
  </article>`;
}

function bindDetail(root, item) {
  const downloads = downloadList(item);
  const video = root.querySelector('.detail-video');
  if (video) {
    video.addEventListener('error', () => {
      const holder = video.closest('.detail-media');
      if (!holder || holder.querySelector('.media-error')) return;
      const notice = document.createElement('div');
      notice.className = 'media-error';
      notice.innerHTML = `<svg viewBox="0 0 24 24"><use href="#i-alert"/></svg>
        <span>浏览器无法直接播放该视频（可能是防盗链或编码问题），请使用下方「浏览器下载视频」或「服务端下载」。</span>`;
      holder.appendChild(notice);
    });
  }

  root.querySelector('[data-server-download]')?.addEventListener('click', (event) => {
    submitServerDownload(item, event.currentTarget);
  });
  root.querySelectorAll('[data-dl-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.dlIndex);
      const url = downloads[index];
      if (!url) {
        toast('下载链接不可用', 'error');
        return;
      }
      downloadMedia(url, fileName(item, index));
    });
  });

  root.querySelector('[data-dl-music]')?.addEventListener('click', () => {
    downloadMedia(item.music_url, fileName(item, 'music'));
  });
  root.querySelector('[data-dl-cover]')?.addEventListener('click', () => {
    downloadMedia(item.static_cover, fileName(item, 'cover'));
  });
  root.querySelector('[data-dl-all]')?.addEventListener('click', () => {
    triggerBatchDownloads(
      downloads.map((url, index) => ({
        url,
        name: fileName(item, index),
      })),
    );
  });
  root.querySelector('[data-export-detail]')?.addEventListener('click', () => {
    downloadJson(item, `DouK_detail_${item.id || 'item'}_${stamp()}.json`);
  });
}

/* ------------------------------------------------------------------ items */

function renderItemCard(item, index) {
  const downloads = downloadList(item);
  const kind = mediaKind(item);
  const cover = coverOf(item);
  const type = item.type || (kind === 'gallery' ? '图集' : '视频');
  const coverHtml = cover
    ? `<img src="${esc(mediaProxyUrl(cover))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('broken')">`
    : mediaPlaceholder('无预览图');
  const duration =
    item.duration && item.duration !== '00:00:00'
      ? `<span class="badge item-duration">${esc(item.duration)}</span>`
      : '';

  const stats = [
    ['i-heart', item.digg_count],
    ['i-comment', item.comment_count],
    ['i-star', item.collect_count],
  ]
    .filter(([, value]) => value !== undefined && value !== null && Number(value) >= 0)
    .map(
      ([icon, value]) =>
        `<span title="${esc(value)}"><svg viewBox="0 0 24 24"><use href="#${icon}"/></svg>${fmtNum(value)}</span>`,
    )
    .join('');

  return `<article class="item-card">
    <div class="item-media">
      ${coverHtml}
      <span class="badge item-type">${esc(type)}</span>
      ${duration}
      <button type="button" class="item-play" data-detail-index="${index}" aria-label="查看详情">
        <svg viewBox="0 0 24 24"><use href="#i-play"/></svg>
      </button>
    </div>
    <div class="item-body">
      <p class="item-desc" title="${esc(item.desc || '')}">${esc(item.desc || item.id || '未命名作品')}</p>
      <div class="item-meta">
        <span class="item-author">${esc(item.nickname || '')}</span>
        <span>${esc(item.create_time || '')}</span>
      </div>
      <div class="item-stats">${stats}</div>
      <div class="item-actions">
        <button type="button" class="btn btn-sm" data-detail-index="${index}">查看详情</button>
        ${
          serverDownloadTarget(item)
            ? `<button type="button" class="btn btn-sm btn-primary" data-item-server-download="${index}" title="由本机 TikTokDownloader 按全局配置下载到 root 目录">
                <svg viewBox="0 0 24 24"><use href="#i-folder"/></svg>服务端下载
              </button>`
            : ''
        }
        ${
          downloads.length
            ? `<button type="button" class="btn btn-sm" data-item-download="${index}">
                <svg viewBox="0 0 24 24"><use href="#i-download"/></svg>浏览器下载
              </button>`
            : ''
        }
      </div>
    </div>
  </article>`;
}

function bindItemCards(root, items) {
  root.querySelectorAll('[data-detail-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = items[Number(button.dataset.detailIndex)];
      if (item) openDetailModal(item);
    });
  });
  root.querySelectorAll('[data-item-server-download]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = items[Number(button.dataset.itemServerDownload)];
      if (item) submitServerDownload(item, button);
    });
  });
  root.querySelectorAll('[data-item-download]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = items[Number(button.dataset.itemDownload)];
      const url = downloadList(item)[0];
      if (!url) {
        toast('没有可下载的链接', 'error');
        return;
      }
      downloadMedia(url, fileName(item, 0));
    });
  });
}

function renderItemsResult(container, response, options) {
  const { platform, kindLabel = '作品', filename, source = false } = options;
  if (source) {
    container.innerHTML = renderRaw(`${kindLabel}原始响应`, response, response?.message || '');
    return;
  }

  const allItems = unwrapItems(response);
  const items = allItems.filter(isItemLike);

  if (!allItems.length) {
    container.innerHTML = emptyState(
      '没有获取到数据',
      response?.message || '请检查参数、Cookie 或代理设置。',
      'i-search',
    );
    return;
  }

  if (!items.length) {
    container.innerHTML = renderRaw(
      `${kindLabel}数据`,
      response,
      response?.message || '接口返回的数据不是标准作品结构',
    );
    return;
  }

  const author = items[0]?.nickname;
  const serverFolder = options.accountTab
    ? accountServerFolder(items, options.accountTab)
    : '';
  container.innerHTML = `${renderSummary({
    eyebrow: kindLabel,
    title: `共 ${items.length} 个作品`,
    message: response?.message || '',
    platform: PLATFORM_LABEL[platform] || '',
    extraActions: `<button type="button" class="btn btn-ghost btn-xs" data-batch-download>
      <svg viewBox="0 0 24 24"><use href="#i-download"/></svg>批量下载
    </button>`,
  })}
  <div class="item-grid">${items.map((item, index) => renderItemCard(item, index)).join('')}</div>`;

  bindItemCards(container, items);
  container.querySelector('[data-batch-download]')?.addEventListener('click', () => {
    openBatchModal(items, { serverFolder });
  });
  bindExportResult(
    container,
    response,
    filename || `DouK_${kindLabel}_${stamp()}.json`,
  );

  if (author) {
    const summary = container.querySelector('.summary-main');
    if (summary) {
      const node = document.createElement('span');
      node.className = 'muted small';
      node.textContent = `@${author}`;
      summary.appendChild(node);
    }
  }
}

/* ------------------------------------------------------------- user cards */

function renderUserCard(user, index, live = false) {
  const nickname = user.nickname || (live ? '未知直播间' : '未知用户');
  const avatarUrl = stripUrl(user.avatar);
  const avatar = avatarUrl
    ? `<img class="user-avatar" src="${esc(mediaProxyUrl(avatarUrl))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : `<div class="avatar user-avatar" style="${avatarStyle(nickname)}">${esc(initial(nickname))}</div>`;
  const verify =
    user.verify && user.verify !== '无'
      ? `<span class="verify-badge">${esc(user.verify)}</span>`
      : '';
  const enterprise =
    user.enterprise && user.enterprise !== '无'
      ? `<span class="verify-badge">${esc(shortText(user.enterprise, 12))}</span>`
      : '';

  const stats = [];
  if (live) {
    if (user.room_id) stats.push(`房间 ${esc(user.room_id)}`);
  } else {
    if (Number(user.follower_count) >= 0) stats.push(`粉丝 ${fmtNum(user.follower_count)}`);
    if (Number(user.total_favorited) >= 0) stats.push(`获赞 ${fmtNum(user.total_favorited)}`);
    if (user.unique_id) stats.push(`@${esc(user.unique_id)}`);
  }

  const actions = live
    ? user.room_id
      ? `<button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(user.room_id)}">
          <svg viewBox="0 0 24 24"><use href="#i-copy"/></svg>复制 room_id
        </button>`
      : ''
    : `<button type="button" class="btn btn-primary btn-sm" data-collect-user="${index}">
        <svg viewBox="0 0 24 24"><use href="#i-user"/></svg>采集作品
      </button>
      ${
        user.sec_uid
          ? `<button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(user.sec_uid)}">复制 sec_uid</button>`
          : ''
      }`;

  return `<article class="panel user-card">
    ${avatar}
    <div class="user-info">
      <div class="user-name"><span>${esc(nickname)}</span>${verify}${enterprise}</div>
      <span class="user-handle">${live ? '直播间' : user.unique_id ? `@${esc(user.unique_id)}` : esc(user.short_id || user.uid || '')}</span>
      ${user.signature ? `<p class="user-sign">${esc(user.signature)}</p>` : ''}
      ${stats.length ? `<div class="user-stats">${stats.map((text) => `<span>${text}</span>`).join('')}</div>` : ''}
    </div>
    ${actions ? `<div class="user-actions">${actions}</div>` : ''}
  </article>`;
}

function renderUserResults(container, response, options = {}) {
  const { live = false, filename, source = false } = options;
  if (source) {
    container.innerHTML = renderRaw('用户搜索原始响应', response, response?.message || '');
    return;
  }
  const items = unwrapItems(response);
  if (!items.length) {
    container.innerHTML = emptyState(
      '没有搜索到结果',
      response?.message || '换个关键词或筛选条件再试试。',
      'i-search',
    );
    return;
  }
  container.innerHTML = `${renderSummary({
    eyebrow: live ? 'LIVE SEARCH' : 'USER SEARCH',
    title: `共 ${items.length} 个${live ? '直播间' : '用户'}`,
    message: response?.message || '',
    platform: '抖音',
  })}
  <div class="user-grid">${items.map((item, index) => renderUserCard(item, index, live)).join('')}</div>`;

  bindExportResult(container, response, filename || `DouK_search_${stamp()}.json`);
  if (!live) {
    container.querySelectorAll('[data-collect-user]').forEach((button) => {
      button.addEventListener('click', () => {
        const user = items[Number(button.dataset.collectUser)];
        collectUser(user);
      });
    });
  }
}

function collectUser(user) {
  if (!user?.sec_uid) {
    toast('该用户数据缺少 sec_uid，无法采集作品', 'error');
    return;
  }
  setPlatform('douyin');
  navigate('account');
  $('#account-secuid').value = user.sec_uid;
  $('#account-tab').value = 'post';
  toast('已填入账号信息，开始采集…', 'info');
  runAccount();
}

/* ----------------------------------------------------------------- comments */

function renderComments(container, response, options = {}) {
  const { source = false, filename } = options;
  if (source) {
    container.innerHTML = renderRaw('评论原始响应', response, response?.message || '');
    return;
  }
  const items = unwrapItems(response);
  if (!items.length) {
    container.innerHTML = emptyState(
      '没有获取到评论',
      response?.message || '作品可能没有评论，或需要登录 Cookie 才能查看。',
      'i-comment',
    );
    return;
  }
  if (!items.some((item) => item && (item.cid || item.text))) {
    container.innerHTML = renderRaw('评论数据', response, response?.message || '');
    return;
  }

  const cards = items
    .map((comment) => {
      const nickname = comment.nickname || '匿名用户';
      const media = [
        comment.image
          ? `<a href="${esc(mediaProxyUrl(comment.image))}" target="_blank" rel="noreferrer"><img src="${esc(mediaProxyUrl(comment.image))}" alt="评论图片" loading="lazy" referrerpolicy="no-referrer"></a>`
          : '',
        comment.sticker
          ? `<a href="${esc(mediaProxyUrl(comment.sticker))}" target="_blank" rel="noreferrer"><img src="${esc(mediaProxyUrl(comment.sticker))}" alt="评论表情" loading="lazy" referrerpolicy="no-referrer"></a>`
          : '',
      ]
        .filter(Boolean)
        .join('');

      return `<div class="comment">
        <div class="avatar" style="${avatarStyle(nickname)}">${esc(initial(nickname))}</div>
        <div class="comment-body">
          <div class="comment-head">
            <strong>${esc(nickname)}</strong>
            ${comment.ip_label ? `<span class="badge soft">${esc(comment.ip_label)}</span>` : ''}
            <time>${esc(comment.create_time || '')}</time>
          </div>
          <p class="comment-text">${esc(comment.text || '')}</p>
          ${media ? `<div class="comment-media">${media}</div>` : ''}
          <div class="comment-foot">
            <span><svg viewBox="0 0 24 24"><use href="#i-heart"/></svg>${fmtNum(comment.digg_count)}</span>
            ${
              Number(comment.reply_comment_total) > 0
                ? `<span><svg viewBox="0 0 24 24"><use href="#i-comment"/></svg>${fmtNum(comment.reply_comment_total)}</span>`
                : ''
            }
            ${comment.cid ? `<button type="button" class="btn btn-ghost btn-xs" data-copy="${esc(comment.cid)}">复制 CID</button>` : ''}
          </div>
        </div>
      </div>`;
    })
    .join('');

  container.innerHTML = `${renderSummary({
    eyebrow: 'COMMENTS',
    title: `共 ${items.length} 条评论`,
    message: response?.message || '',
    platform: '抖音',
  })}
  <div class="comment-list panel">${cards}</div>`;
  bindExportResult(container, response, filename || `DouK_comments_${stamp()}.json`);
}

/* --------------------------------------------------------------------- live */

function collectStreams(item) {
  const streams = [];
  const pushMap = (map, protocol) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    Object.entries(map).forEach(([quality, url]) => {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        streams.push({ protocol, quality, url });
      }
    });
  };
  pushMap(item.flv_pull_url, 'FLV');
  pushMap(item.hls_pull_url_map, 'HLS');
  return streams;
}

function renderLiveResult(container, response, platform, source = false) {
  if (source) {
    container.innerHTML = renderRaw('直播原始响应', response, response?.message || '');
    return;
  }
  const item = unwrapItems(response)[0];
  if (!item || typeof item !== 'object') {
    container.innerHTML = emptyState(
      '未获取到直播数据',
      response?.message || '直播间可能未开播，或参数有误。',
      'i-live',
    );
    return;
  }

  const cover = stripUrl(item.cover);
  const nickname = item.nickname || '';
  const title = item.title || nickname || '直播间';
  const isLive = String(item.status) === '2';
  const statusText =
    item.status === undefined || item.status === null
      ? '直播信息'
      : isLive
        ? '直播中'
        : '未开播';

  const viewers = [item.total_user_str, item.user_count_str, item.user_count]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => (typeof value === 'number' ? fmtNum(value) : String(value)));

  const metaChips = [
    stripUrl(item.display_id) ? `<span class="meta-chip">@${esc(item.display_id)}</span>` : '',
    stripUrl(item.id_str) ? `<span class="meta-chip">ROOM ${esc(item.id_str)}</span>` : '',
    Number(item.like_count) >= 0
      ? `<span class="meta-chip">点赞 ${fmtNum(item.like_count)}</span>`
      : '',
    ...viewers.map((value) => `<span class="meta-chip">观看 ${esc(value)}</span>`),
    item.create_time && item.create_time !== '未知'
      ? `<span class="meta-chip">${esc(item.create_time)}</span>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const streams = collectStreams(item);
  const streamHtml = streams.length
    ? `<div class="stream-list">${streams
        .map(
          (stream) => `<div class="stream-row">
            <span class="stream-protocol">${esc(stream.protocol)}</span>
            <span class="stream-quality">${esc(stream.quality || '默认')}</span>
            <span class="stream-url" title="${esc(stream.url)}">${esc(stream.url)}</span>
            <button type="button" class="btn btn-ghost btn-xs" data-copy="${esc(stream.url)}">
              <svg viewBox="0 0 24 24"><use href="#i-copy"/></svg>复制
            </button>
            <a class="btn btn-ghost btn-xs" href="${esc(stream.url)}" target="_blank" rel="noreferrer">
              <svg viewBox="0 0 24 24"><use href="#i-external"/></svg>打开
            </a>
          </div>`,
        )
        .join('')}</div>`
    : `<div class="alert info compact">
        <svg viewBox="0 0 24 24"><use href="#i-info"/></svg>
        <span>接口没有返回可用的拉流地址，直播间可能未开播。</span>
      </div>`;

  container.innerHTML = `${renderSummary({
    eyebrow: 'LIVE ROOM',
    title: esc(title),
    message: response?.message || '',
    platform: PLATFORM_LABEL[platform] || '',
  })}
  <article class="panel live-card">
    <div class="live-cover">
      ${
        cover
          ? `<img src="${esc(mediaProxyUrl(cover))}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
          : mediaPlaceholder('无直播封面')
      }
      <span class="live-status ${isLive ? 'on' : ''}">${statusText}</span>
    </div>
    <div class="live-info">
      <h2 class="live-title">${esc(title)}</h2>
      <div class="author">
        <div class="avatar" style="${avatarStyle(nickname || title)}">${esc(initial(nickname || title))}</div>
        <div class="author-meta">
          <strong>${esc(nickname || '未知主播')}</strong>
          <span>${esc(stripUrl(item.display_id) ? `@${item.display_id}` : '')}</span>
        </div>
      </div>
      ${metaChips ? `<div class="meta-row">${metaChips}</div>` : ''}
      <div class="field"><span class="field-label">拉流地址</span>${streamHtml}</div>
      <details class="json-details">
        <summary>查看原始 JSON 数据</summary>
        <div class="json-view">${syntaxJson(item)}</div>
      </details>
    </div>
  </article>`;
}

/* ------------------------------------------------------------------ helpers */

function numOrNull(id) {
  const element = document.getElementById(id);
  if (!element) return null;
  const value = element.value.trim();
  return value === '' ? null : Number(value);
}

function dateToSlash(value) {
  const text = String(value || '').trim();
  return text ? text.replace(/-/g, '/') : null;
}

function extraOptions(prefix) {
  const output = { source: Boolean($(`#${prefix}-source`)?.checked) };
  const cookie = $(`#${prefix}-cookie`)?.value.trim();
  const proxy = $(`#${prefix}-proxy`)?.value.trim();
  if (cookie) output.cookie = cookie;
  if (proxy) output.proxy = proxy;
  return output;
}

function extractId(text, platform) {
  const raw = String(text || '').trim();
  const patterns =
    platform === 'tiktok'
      ? [
          /\/video\/(\d{15,25})/,
          /\/photo\/(\d{15,25})/,
          /(?:modal_id|item_id)=(\d{15,25})/,
        ]
      : [
          /\/video\/(\d{15,25})/,
          /\/note\/(\d{15,25})/,
          /\/slides\/(\d{15,25})/,
          /(?:modal_id|aweme_id|item_id)=(\d{15,25})/,
        ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return match[1];
  }
  if (/^\d{15,25}$/.test(raw)) return raw;
  return null;
}

function extractPossibleId(text, platform) {
  const direct = extractId(text, platform);
  if (direct) return direct;
  const raw = String(text || '').trim();
  if (/^\d{6,}$/.test(raw)) return raw;
  const match = raw.match(/(?:collection|mix|mix_id|collection_id)[=/_](\d{6,})/i);
  return match ? match[1] : null;
}

function detectPlatform(text) {
  if (/tiktok\.com|vt\.tiktok|vm\.tiktok/i.test(text)) return 'tiktok';
  if (/douyin\.com|iesdouyin/i.test(text)) return 'douyin';
  return state.platform;
}

function extractUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : '';
}

async function resolveShortLink(platform, text, proxy) {
  const payload = { text };
  if (proxy) payload.proxy = proxy;
  try {
    const share = await api(`/${platform}/share`, payload);
    return share?.url || '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------- parse */

async function runParse(inputOverride) {
  const raw = String(inputOverride ?? $('#parse-input').value).trim();
  if (!raw) {
    toast('请先粘贴作品链接或作品 ID', 'error');
    $('#parse-input').focus();
    return;
  }

  const platform = detectPlatform(raw);
  if (platform !== state.platform) setPlatform(platform);

  const result = $('#parse-result');
  const button = $('#parse-submit');
  const source = $('#parse-source').checked;
  const proxy = $('#parse-proxy').value.trim();
  const stopLoading = showLoading(result, '正在解析作品', { skeleton: 'detail' });
  setButtonBusy(button, true, '解析中…');

  try {
    let id = extractId(raw, platform);

    if (!id) {
      let resolvedUrl = await resolveShortLink(platform, raw, proxy);
      if (resolvedUrl) id = extractId(resolvedUrl, platform);
      if (!id) {
        const bare = raw.match(/(?:^|[^\d])(\d{15,25})(?!\d)/);
        if (bare) id = bare[1];
      }
      if (!id) {
        throw new Error('无法从分享内容中解析出作品 ID，请粘贴完整的作品链接或纯数字 ID。');
      }
    }

    const payload = { detail_id: id, ...extraOptions('parse') };
    const response = await api(`/${platform}/detail`, payload);

    if (source) {
      result.innerHTML = renderRaw('作品原始响应', response, response?.message || '');
      recordHistory({ platform, input: raw, id, label: id });
    } else {
      const item = Array.isArray(response?.data)
        ? response.data[0]
        : response?.data;

      if (!item || !isItemLike(item)) {
        result.innerHTML = renderRaw(
          '作品数据',
          response,
          response?.message || '接口返回的数据不是标准作品结构',
        );
        recordHistory({ platform, input: raw, id, label: id });
      } else {
        result.innerHTML = renderDetail(item);
        bindDetail(result, item);
        recordHistory({
          platform,
          input: raw,
          id,
          label: item.desc || item.id || id,
        });
      }
    }

    scrollToResult(result);
    toast('解析成功', 'success');
  } catch (error) {
    result.innerHTML = renderError(error);
    scrollToResult(result);
  } finally {
    stopLoading();
    setButtonBusy(button, false);
  }
}

/* ----------------------------------------------------------------- account */

async function runAccount() {
  const rawInput = $('#account-secuid').value.trim();
  if (!rawInput) {
    toast('请输入 sec_uid 或账号链接', 'error');
    $('#account-secuid').focus();
    return;
  }

  const platform = state.platform;
  const result = $('#account-result');
  const button = $('#account-submit');
  const source = $('#account-source').checked;
  const proxy = $('#account-proxy').value.trim();
  const stopLoading = showLoading(result, '正在采集账号作品', { skeleton: 'grid' });
  setButtonBusy(button, true, '采集中…');

  try {
    let secUid = rawInput;
    const candidate = extractUrl(rawInput) || rawInput;

    if (/^https?:\/\//i.test(candidate)) {
      let resolved = candidate;
      if (!/\/user\//i.test(resolved)) {
        const shared = await resolveShortLink(platform, rawInput, proxy);
        if (shared) resolved = shared;
      }
      const match = resolved.match(/\/user\/([^/?#\s]+)/i);
      if (match) {
        secUid = decodeURIComponent(match[1]);
      } else if (platform === 'tiktok') {
        throw new Error(
          'TikTok 主页链接不包含 secUid，请填写以 MS4wLjAB 开头的 secUid。',
        );
      } else {
        throw new Error('无法从链接中提取 sec_uid，请直接填写 sec_uid。');
      }
    }

    const payload = {
      sec_user_id: secUid,
      tab: $('#account-tab').value,
      pages: numOrNull('account-pages'),
      cursor: numOrNull('account-cursor') ?? 0,
      count: numOrNull('account-count') ?? 18,
      earliest: dateToSlash($('#account-earliest').value),
      latest: dateToSlash($('#account-latest').value),
      ...extraOptions('account'),
    };

    const response = await api(`/${platform}/account`, payload);
    renderItemsResult(result, response, {
      platform,
      kindLabel: '账号作品',
      source,
      accountTab: payload.tab,
      filename: `DouK_account_${sanitizeName(secUid).slice(0, 24)}_${stamp()}.json`,
    });
    scrollToResult(result);
  } catch (error) {
    result.innerHTML = renderError(error);
    scrollToResult(result);
  } finally {
    stopLoading();
    setButtonBusy(button, false);
  }
}

/* --------------------------------------------------------------------- mix */

async function runMix() {
  const mixRaw = $('#mix-id').value.trim();
  const detailRaw = $('#mix-detail-id').value.trim();
  if (!mixRaw && !detailRaw) {
    toast('请填写合集 ID 或作品 ID', 'error');
    $('#mix-id').focus();
    return;
  }

  const platform = state.platform;
  const result = $('#mix-result');
  const button = $('#mix-submit');
  const source = $('#mix-source').checked;
  const proxy = $('#mix-proxy').value.trim();
  const stopLoading = showLoading(result, '正在获取合集作品', { skeleton: 'grid' });
  setButtonBusy(button, true, '获取中…');

  try {
    let mixId = null;
    let detailId = null;

    if (mixRaw) {
      const candidate = extractUrl(mixRaw) || mixRaw;
      mixId = extractPossibleId(candidate, platform) || extractPossibleId(mixRaw, platform);
      if (!mixId && /^https?:\/\//i.test(candidate)) {
        const shared = await resolveShortLink(platform, mixRaw, proxy);
        if (shared) mixId = extractPossibleId(shared, platform);
      }
      if (!mixId) {
        throw new Error('无法从合集链接中解析出合集 ID，请直接填写纯数字 ID。');
      }
    }

    if (detailRaw) {
      const candidate = extractUrl(detailRaw) || detailRaw;
      detailId = extractPossibleId(candidate, platform) || extractPossibleId(detailRaw, platform);
      if (!detailId && /^https?:\/\//i.test(candidate)) {
        const shared = await resolveShortLink(platform, detailRaw, proxy);
        if (shared) detailId = extractPossibleId(shared, platform);
      }
      if (!detailId) {
        throw new Error('无法从作品链接中解析出作品 ID，请直接填写纯数字 ID。');
      }
    }

    if (platform === 'tiktok' && !mixId) {
      throw new Error('TikTok 合集接口仅支持 mix_id，请填写合辑 ID。');
    }

    const payload = {
      mix_id: mixId,
      detail_id: detailId,
      cursor: numOrNull('mix-cursor') ?? 0,
      count: numOrNull('mix-count') ?? (platform === 'tiktok' ? 30 : 12),
      ...extraOptions('mix'),
    };

    const response = await api(`/${platform}/mix`, payload);
    renderItemsResult(result, response, {
      platform,
      kindLabel: '合集作品',
      source,
      filename: `DouK_mix_${mixId || detailId}_${stamp()}.json`,
    });
    scrollToResult(result);
  } catch (error) {
    result.innerHTML = renderError(error);
    scrollToResult(result);
  } finally {
    stopLoading();
    setButtonBusy(button, false);
  }
}

/* -------------------------------------------------------------------- live */

async function runLive() {
  const rawInput = $('#live-rid').value.trim();
  if (!rawInput) {
    toast('请输入直播间 ID 或直播链接', 'error');
    $('#live-rid').focus();
    return;
  }

  const platform = state.platform;
  const result = $('#live-result');
  const button = $('#live-submit');
  const source = $('#live-source').checked;
  const proxy = $('#live-proxy').value.trim();
  const stopLoading = showLoading(result, '正在获取直播信息', { skeleton: 'detail' });
  setButtonBusy(button, true, '获取中…');

  try {
    let input = rawInput;
    const candidate = extractUrl(rawInput) || rawInput;

    if (platform === 'douyin') {
      if (
        /^https?:\/\//i.test(candidate) &&
        !/live\.douyin\.com\/\d+/i.test(candidate)
      ) {
        const shared = await resolveShortLink(platform, rawInput, proxy);
        if (shared) input = shared;
      }
      const match =
        input.match(/live\.douyin\.com\/(\d+)/i) ||
        input.match(/(?:web_rid=)(\d+)/i);
      if (match) input = match[1];
      if (!/^\d+$/.test(input)) {
        throw new Error(
          '无法识别抖音直播 web_rid，请粘贴纯数字 web_rid 或 https://live.douyin.com/<web_rid>。',
        );
      }

      const response = await api('/douyin/live', {
        web_rid: input,
        ...extraOptions('live'),
      });
      renderLiveResult(result, response, platform, source);
    } else {
      const match = candidate.match(/(?:room_id=)(\d+)/i);
      if (match) input = match[1];
      if (!/^\d+$/.test(input)) {
        throw new Error('请填写 TikTok 直播间 room_id（纯数字）。');
      }

      const response = await api('/tiktok/live', {
        room_id: input,
        ...extraOptions('live'),
      });
      renderLiveResult(result, response, platform, source);
    }

    scrollToResult(result);
  } catch (error) {
    result.innerHTML = renderError(error);
    scrollToResult(result);
  } finally {
    stopLoading();
    setButtonBusy(button, false);
  }
}

/* ----------------------------------------------------------------- comment */

async function runComment() {
  const rawInput = $('#comment-detail-id').value.trim();
  if (!rawInput) {
    toast('请输入作品 ID 或作品链接', 'error');
    $('#comment-detail-id').focus();
    return;
  }

  const result = $('#comment-result');
  const button = $('#comment-submit');
  const source = $('#comment-source').checked;
  const proxy = $('#comment-proxy').value.trim();
  const stopLoading = showLoading(result, '正在采集评论', { skeleton: 'grid' });
  setButtonBusy(button, true, '采集中…');

  try {
    const candidate = extractUrl(rawInput) || rawInput;
    let id = extractId(candidate, 'douyin') || extractId(rawInput, 'douyin');
    if (!id && /^https?:\/\//i.test(candidate)) {
      const shared = await resolveShortLink('douyin', rawInput, proxy);
      if (shared) id = extractId(shared, 'douyin');
    }
    if (!id && /^\d{15,25}$/.test(rawInput)) id = rawInput;
    if (!id) {
      throw new Error('无法识别作品 ID，请粘贴作品链接或纯数字作品 ID。');
    }

    const payload = {
      detail_id: id,
      pages: numOrNull('comment-pages') ?? 1,
      cursor: numOrNull('comment-cursor') ?? 0,
      count: numOrNull('comment-count') ?? 20,
      count_reply: numOrNull('comment-count-reply') ?? 3,
      reply: $('#comment-reply').checked,
      ...extraOptions('comment'),
    };

    const response = await api('/douyin/comment', payload);
    renderComments(result, response, {
      source,
      filename: `DouK_comments_${id}_${stamp()}.json`,
    });
    scrollToResult(result);
  } catch (error) {
    result.innerHTML = renderError(error);
    scrollToResult(result);
  } finally {
    stopLoading();
    setButtonBusy(button, false);
  }
}

/* ------------------------------------------------------------------ search */

function setSearchType(type) {
  if (!SEARCH_HINTS[type]) type = 'general';
  state.searchType = type;
  $$('#search-types .seg-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.searchType === type);
  });
  const form = $('#search-form');
  form.querySelectorAll('.filter-general').forEach((field) => {
    field.hidden = type !== 'general';
  });
  form.querySelectorAll('.filter-video').forEach((field) => {
    field.hidden = !(type === 'general' || type === 'video');
  });
  form.querySelectorAll('.filter-user').forEach((field) => {
    field.hidden = type !== 'user';
  });
  $('#search-hint').textContent = SEARCH_HINTS[type];
  $('#search-keyword').placeholder =
    type === 'user'
      ? '输入要搜索的用户昵称 / 关键词…'
      : type === 'live'
        ? '输入直播关键词…'
        : '输入搜索关键词…';
}

function numberFrom(id) {
  return Number(document.getElementById(id)?.value || 0);
}

async function runSearch() {
  const keyword = $('#search-keyword').value.trim();
  if (!keyword) {
    toast('请输入搜索关键词', 'error');
    $('#search-keyword').focus();
    return;
  }

  const type = state.searchType;
  const result = $('#search-result');
  const button = $('#search-submit');
  const source = $('#search-source').checked;
  const stopLoading = showLoading(
    result,
    `正在搜索${type === 'user' ? '用户' : type === 'live' ? '直播' : '内容'}`,
    { skeleton: 'grid' },
  );
  setButtonBusy(button, true, '搜索中…');

  try {
    const payload = {
      keyword,
      pages: numOrNull('search-pages') ?? 1,
      offset: numOrNull('search-offset') ?? 0,
      count: numOrNull('search-count') ?? 10,
      ...extraOptions('search'),
    };

    if (type === 'general' || type === 'video') {
      payload.sort_type = numberFrom('search-sort');
      payload.publish_time = numberFrom('search-publish');
      payload.duration = numberFrom('search-duration');
      payload.search_range = numberFrom('search-range');
      if (type === 'general') {
        payload.content_type = numberFrom('search-content-type');
      }
    } else if (type === 'user') {
      payload.douyin_user_fans = numberFrom('search-fans');
      payload.douyin_user_type = numberFrom('search-user-type');
    }

    const response = await api(`/douyin/search/${type}`, payload);

    if (type === 'user' || type === 'live') {
      renderUserResults(result, response, {
        live: type === 'live',
        source,
        filename: `DouK_search_${type}_${stamp()}.json`,
      });
    } else {
      renderItemsResult(result, response, {
        platform: 'douyin',
        kindLabel: '搜索结果',
        source,
        filename: `DouK_search_${type}_${stamp()}.json`,
      });
    }
    scrollToResult(result);
  } catch (error) {
    result.innerHTML = renderError(error);
    scrollToResult(result);
  } finally {
    stopLoading();
    setButtonBusy(button, false);
  }
}

/* ---------------------------------------------------------------- settings */

const UNREPORTED_KEYS = new Set([
  'timeout',
  'live_qualities',
  'douyin_platform',
  'tiktok_platform',
  'browser_info',
  'browser_info_tiktok',
]);

const SETTINGS_GROUPS = [
  {
    title: '目录与命名',
    desc: '控制下载文件的保存位置、文件夹与文件命名规则。',
    fields: [
      {
        key: 'root',
        label: '下载根目录',
        type: 'text',
        wide: true,
        hint: '建议填写绝对路径，例如 D:\\Downloads\\DouK',
      },
      {
        key: 'folder_name',
        label: '单作品下载文件夹名',
        type: 'text',
        hint: '仅用于单个作品下载；账号批量下载会自动使用 UID{uid}_{nickname}_发布作品 等专属文件夹',
      },
      {
        key: 'name_format',
        label: '文件命名格式',
        type: 'text',
        wide: true,
        hint: '使用空格分隔，可用：id / desc / create_time / nickname / mark / uid / type',
      },
      { key: 'split', label: '命名分隔符', type: 'text' },
      {
        key: 'date_format',
        label: '日期格式',
        type: 'text',
        hint: 'Python strftime 格式，例如 %Y-%m-%d %H:%M:%S',
      },
      { key: 'desc_length', label: '描述最大长度', type: 'number' },
      { key: 'name_length', label: '文件名最大长度', type: 'number' },
      {
        key: 'truncate',
        label: '进度条描述长度',
        type: 'number',
        hint: '仅影响下载时进度条的显示效果',
      },
      { key: 'folder_mode', label: '每个作品单独文件夹', type: 'bool' },
      {
        key: 'storage_format',
        label: '数据存储格式',
        type: 'select',
        options: [
          ['', '不存储'],
          ['csv', 'CSV'],
          ['xlsx', 'Excel (xlsx)'],
          ['sql', 'SQLite (sql)'],
        ],
      },
    ],
  },
  {
    title: '下载与媒体',
    desc: '控制视频、封面、音乐、直播与网络请求的行为。',
    fields: [
      { key: 'download', label: '启用下载功能', type: 'bool' },
      { key: 'music', label: '保存作品音乐', type: 'bool' },
      { key: 'dynamic_cover', label: '保存动态封面', type: 'bool' },
      { key: 'static_cover', label: '保存静态封面', type: 'bool' },
      { key: 'original_quality', label: '优先最高画质', type: 'bool' },
      {
        key: 'max_size',
        label: '文件大小上限（字节）',
        type: 'number',
        hint: '留空表示不限制',
      },
      { key: 'chunk', label: '下载分块大小（字节）', type: 'number' },
      {
        key: 'timeout',
        label: '请求超时（秒）',
        type: 'number',
        hint: '当前服务端不回显该值，留空表示不修改（默认 10 秒）',
      },
      { key: 'max_retry', label: '最大重试次数', type: 'number' },
      { key: 'max_pages', label: '最大采集页数', type: 'number' },
      {
        key: 'live_qualities',
        label: '直播默认清晰度',
        type: 'text',
        placeholder: '当前值未回显，留空不修改',
        hint: '例如 FULL_HD1、HD1、1、2',
      },
      { key: 'ffmpeg', label: 'ffmpeg 路径', type: 'text' },
      { key: 'run_command', label: '启动命令参数', type: 'text', wide: true },
    ],
  },
  {
    title: '平台与网络',
    desc: '代理、Cookie、浏览器信息与平台开关。Cookie 等字段包含敏感信息，仅在本机传输。',
    fields: [
      {
        key: 'douyin_platform',
        label: '抖音平台',
        type: 'tri',
        hint: '当前服务端不回显该值，保持现状即可',
      },
      {
        key: 'tiktok_platform',
        label: 'TikTok 平台',
        type: 'tri',
        hint: '当前服务端不回显该值，保持现状即可',
      },
      { key: 'proxy', label: '抖音代理', type: 'text', placeholder: 'http://127.0.0.1:7890' },
      { key: 'proxy_tiktok', label: 'TikTok 代理', type: 'text', placeholder: 'http://127.0.0.1:7890' },
      { key: 'twc_tiktok', label: 'TikTok ttwid', type: 'text' },
      {
        key: 'cookie',
        label: '抖音 Cookie',
        type: 'json',
        hint: 'JSON 对象或原始 Cookie 字符串；编辑前请先导出备份',
      },
      {
        key: 'cookie_tiktok',
        label: 'TikTok Cookie',
        type: 'json',
        hint: 'JSON 对象或原始 Cookie 字符串',
      },
      {
        key: 'browser_info',
        label: '抖音浏览器信息',
        type: 'json',
        hint: '接口不回显实际值；留空或 {} 不会修改服务端设置',
      },
      {
        key: 'browser_info_tiktok',
        label: 'TikTok 浏览器信息',
        type: 'json',
        hint: '接口不回显实际值；留空或 {} 不会修改服务端设置',
      },
    ],
  },
  {
    title: '视频转写',
    desc: '使用 faster-whisper 对下载的视频生成本地 TXT / SRT 字幕。',
    fields: [
      { key: 'transcribe', label: '启用视频转写', type: 'bool' },
      {
        key: 'transcription_model',
        label: '转写模型',
        type: 'text',
        placeholder: 'small',
      },
      {
        key: 'transcription_language',
        label: '转写语言',
        type: 'text',
        placeholder: 'zh / en / 留空自动识别',
      },
    ],
  },
  {
    title: '批量任务配置',
    desc: '批量下载账号、合集或收藏作品时使用的 URL 列表。仅高级用户需要修改。',
    advanced: true,
    fields: [
      { key: 'accounts_urls', label: '抖音账号列表', type: 'json' },
      { key: 'accounts_urls_tiktok', label: 'TikTok 账号列表', type: 'json' },
      { key: 'mix_urls', label: '抖音合集列表', type: 'json' },
      { key: 'mix_urls_tiktok', label: 'TikTok 合辑列表', type: 'json' },
      { key: 'owner_url', label: '抖音账号标识', type: 'json' },
      {
        key: 'owner_url_tiktok',
        label: 'TikTok 账号标识',
        type: 'json',
        readonly: true,
        hint: '当前服务端将该字段固定为 null（功能未生效），无法修改',
      },
    ],
  },
];

const SETTINGS_FIELDS = SETTINGS_GROUPS.flatMap((group) => group.fields);

function settingsDisplayValue(field) {
  if (field.type === 'tri') return '';
  const value = state.settings?.[field.key];
  if (field.type === 'json') {
    if (field.key === 'browser_info' || field.key === 'browser_info_tiktok') {
      return value ?? {};
    }
    // JSON 字段的 null 必须显示为 null，不能转成空字符串：
    // 否则 textarea 会变成 ""，保存时提交空字符串，触发服务端 422。
    return value === undefined ? null : value;
  }
  if (value === undefined || value === null) return '';
  return value;
}

function fieldControl(field) {
  const id = `setting-${field.key}`;
  const value = settingsDisplayValue(field);
  const wide = field.wide ? 'span-2' : '';

  if (field.type === 'bool') {
    return `<div class="field field-toggle ${wide}">
      <div>
        <span class="field-label">${esc(field.label)}</span>
        ${field.hint ? `<span class="hint">${esc(field.hint)}</span>` : ''}
      </div>
      <label class="switch-row">
        <input type="checkbox" id="${id}" data-setting="${esc(field.key)}" ${value ? 'checked' : ''}>
        <span class="switch-track"></span>
      </label>
    </div>`;
  }

  if (field.type === 'tri') {
    return `<div class="field">
      <label for="${id}">${esc(field.label)}</label>
      <select class="select" id="${id}" data-setting="${esc(field.key)}">
        <option value="">保持现状</option>
        <option value="true">启用</option>
        <option value="false">禁用</option>
      </select>
      ${field.hint ? `<span class="hint">${esc(field.hint)}</span>` : ''}
    </div>`;
  }

  if (field.type === 'json') {
    const text = JSON.stringify(value ?? null, null, 2);
    const readonly = field.readonly ? ' readonly' : '';
    return `<div class="field json-field">
      <label for="${id}">${esc(field.label)}</label>
      <textarea class="textarea" id="${id}" data-setting="${esc(field.key)}" spellcheck="false" rows="6"${readonly}>${esc(text)}</textarea>
      ${field.hint ? `<span class="hint">${esc(field.hint)}</span>` : ''}
    </div>`;
  }

  if (field.type === 'select') {
    return `<div class="field">
      <label for="${id}">${esc(field.label)}</label>
      <select class="select" id="${id}" data-setting="${esc(field.key)}">
        ${field.options
          .map(
            ([optionValue, label]) =>
              `<option value="${esc(optionValue)}" ${
                String(value ?? '') === String(optionValue) ? 'selected' : ''
              }>${esc(label)}</option>`,
          )
          .join('')}
      </select>
      ${field.hint ? `<span class="hint">${esc(field.hint)}</span>` : ''}
    </div>`;
  }

  const type = field.type === 'number' ? 'number' : 'text';
  return `<div class="field ${wide}">
    <label for="${id}">${esc(field.label)}</label>
    <input class="input" id="${id}" data-setting="${esc(field.key)}" type="${type}"
           value="${value === '' || value === null || value === undefined ? '' : esc(value)}"
           placeholder="${esc(field.placeholder || '')}">
    ${field.hint ? `<span class="hint">${esc(field.hint)}</span>` : ''}
  </div>`;
}

function renderSettings() {
  const root = $('#settings-root');
  if (!state.settings) return;

  root.innerHTML = `<form class="settings-form" id="settings-form">${SETTINGS_GROUPS.map(
    (group) => {
      const controls = group.fields.map(fieldControl).join('');
      if (group.advanced) {
        return `<details class="panel settings-group">
          <summary>
            <svg class="chev" viewBox="0 0 24 24"><use href="#i-chevron"/></svg>
            <div>
              <h3>${esc(group.title)}</h3>
              <p>${esc(group.desc)}</p>
            </div>
          </summary>
          <div class="form-grid">${controls}</div>
        </details>`;
      }
      return `<section class="panel settings-group">
        <div class="group-head">
          <h3>${esc(group.title)}</h3>
          <p>${esc(group.desc)}</p>
        </div>
        <div class="form-grid">${controls}</div>
      </section>`;
    },
  ).join('')}</form>`;

  $('#settings-save').disabled = false;
  $('#settings-export').disabled = false;
}

async function loadSettings(force = false) {
  if (!force && state.settings) {
    renderSettings();
    return;
  }

  const root = $('#settings-root');
  $('#settings-save').disabled = true;
  $('#settings-export').disabled = true;
  root.innerHTML = `<div class="settings-skeleton">
    <div class="skeleton"></div>
    <div class="skeleton"></div>
    <div class="skeleton"></div>
  </div>`;

  try {
    state.settings = await api('/settings');
    renderSettings();
  } catch (error) {
    root.innerHTML = renderError(error);
  }
}

function parseJsonEditor(element, field) {
  const raw = element.value.trim();
  if (!raw) {
    if (field.key === 'browser_info' || field.key === 'browser_info_tiktok') return {};
    if (field.key.startsWith('cookie')) return '';
    if (field.key.endsWith('_urls') || field.key.endsWith('_urls_tiktok')) return [];
    // owner_url 不接受 null，空值按空对象提交（服务端会视为不修改）。
    if (field.key === 'owner_url') return {};
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    if (
      field.key.startsWith('cookie') &&
      /=[^=]/.test(raw) &&
      !/[{}[\]]/.test(raw)
    ) {
      return raw;
    }
    throw new Error(`「${field.label}」不是有效的 JSON`);
  }
}

function normalizeBrowserInfo(value, field) {
  if (value === null || value === undefined || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`「${field.label}」必须是 JSON 对象`);
  }
  return value;
}

function collectSettingsChanges(form) {
  const changes = {};
  const baseline = state.settings || {};
  const nodes = new Map(
    [...form.querySelectorAll('[data-setting]')].map((element) => [
      element.dataset.setting,
      element,
    ]),
  );

  for (const field of SETTINGS_FIELDS) {
    const element = nodes.get(field.key);
    if (!element || field.readonly) continue;
    const key = field.key;

    if (field.type === 'tri') {
      if (element.value !== '') changes[key] = element.value === 'true';
      continue;
    }

    if (field.type === 'json') {
      const value = parseJsonEditor(element, field);
      if (key === 'browser_info' || key === 'browser_info_tiktok') {
        changes[key] = normalizeBrowserInfo(value, field);
      } else if (!valuesEqual(value, baseline[key])) {
        changes[key] = value;
      }
      continue;
    }

    if (field.type === 'number') {
      if (key === 'timeout') {
        if (element.value.trim() !== '') changes[key] = Number(element.value);
        continue;
      }
      const value = element.value.trim() === '' ? null : Number(element.value);
      if (!valuesEqual(value, baseline[key])) changes[key] = value;
      continue;
    }

    if (field.type === 'bool') {
      if (!valuesEqual(element.checked, baseline[key])) {
        changes[key] = element.checked;
      }
      continue;
    }

    let value = element.value;
    if (UNREPORTED_KEYS.has(key)) {
      if (key === 'live_qualities') {
        if (element.value.trim() !== '') changes[key] = element.value;
      }
      continue;
    }
    if (element.value === '' && (baseline[key] === null || baseline[key] === undefined)) {
      value = null;
    }
    if (!valuesEqual(value, baseline[key])) changes[key] = value;
  }

  if (!changes.browser_info) changes.browser_info = {};
  if (!changes.browser_info_tiktok) changes.browser_info_tiktok = {};
  return changes;
}

async function saveSettings() {
  if (!state.settings) return;
  const form = $('#settings-form');
  if (!form) return;

  let changes;
  try {
    changes = collectSettingsChanges(form);
  } catch (error) {
    toast(error.message, 'error', 5000);
    return;
  }

  const button = $('#settings-save');
  setButtonBusy(button, true, '保存中…');
  try {
    const updated = await api('/settings', changes);
    state.settings = { ...state.settings, ...(updated || {}), ...changes };
    toast('配置已保存并生效', 'success');
    refreshStatus();
  } catch (error) {
    toast(errorText(error), 'error', 5600);
  } finally {
    setButtonBusy(button, false);
  }
}

/* ------------------------------------------------------------------ history */

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem('douk.history') || '[]');
    state.history = Array.isArray(parsed)
      ? parsed.filter((item) => item && item.input).slice(0, 8)
      : [];
  } catch {
    state.history = [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem('douk.history', JSON.stringify(state.history));
  } catch {
    /* ignore */
  }
}

function recordHistory(entry) {
  const normalized = {
    platform: entry.platform,
    input: entry.input,
    id: entry.id,
    label: shortText(entry.label || entry.id || entry.input, 60),
    ts: Date.now(),
  };
  state.history = [
    normalized,
    ...state.history.filter(
      (item) =>
        item.input !== normalized.input &&
        !(normalized.id && item.id === normalized.id),
    ),
  ].slice(0, 8);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const block = $('#parse-history-block');
  const list = $('#parse-history');
  if (!block || !list) return;
  block.hidden = state.history.length === 0;

  list.innerHTML = state.history
    .map(
      (item, index) => `<button type="button" class="history-item" data-history-index="${index}">
        <span class="platform-tag ${item.platform === 'tiktok' ? 'tiktok' : ''}">${esc(PLATFORM_LABEL[item.platform] || '')}</span>
        <span class="history-label" title="${esc(item.input)}">${esc(item.label || item.id || item.input)}</span>
        <span class="history-time">${esc(relativeTime(item.ts))}</span>
      </button>`,
    )
    .join('');

  list.querySelectorAll('[data-history-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = state.history[Number(button.dataset.historyIndex)];
      if (!entry) return;
      setPlatform(entry.platform || 'douyin');
      $('#parse-input').value = entry.input;
      navigate('parse');
      runParse(entry.input);
    });
  });
}

function clearHistory() {
  state.history = [];
  saveHistory();
  renderHistory();
  toast('已清空最近解析记录', 'success');
}

/* --------------------------------------------------------------- token/api */

function updateTokenDot() {
  const dot = $('#token-dot');
  if (!dot) return;
  dot.className = 'token-dot';
  if (!state.apiOnline) {
    dot.classList.add('warn');
    dot.title = 'API 未连接';
  } else if (!state.tokenValid) {
    dot.classList.add('error');
    dot.title = '令牌无效';
  } else {
    dot.classList.add('ok');
    dot.title = '令牌有效';
  }
}

async function refreshStatus() {
  const card = $('#api-status');
  const title = $('#api-status-title');
  const subtitle = $('#api-status-sub');
  if (!card || !title || !subtitle) return;

  card.classList.remove('online', 'offline');
  title.textContent = '正在连接 API…';

  let version = '';
  try {
    const spec = await api('/openapi.json');
    state.apiOnline = true;
    version = spec?.info?.version || '';
    card.classList.add('online');
    title.textContent = 'API 已连接';
    const host = String(state.config.api_base || 'http://127.0.0.1:5555').replace(
      /^https?:\/\//i,
      '',
    );
    subtitle.textContent = `${host}${version ? ` · v${version}` : ''}`;
  } catch {
    state.apiOnline = false;
    card.classList.add('offline');
    title.textContent = 'API 未连接';
    subtitle.textContent = '请先启动 5555 端口 API 服务';
  }

  try {
    await api('/token');
    state.tokenValid = state.apiOnline;
  } catch (error) {
    state.tokenValid = !(error instanceof ApiError && error.status === 403);
  }
  updateTokenDot();
}

async function loadWebuiConfig() {
  try {
    const response = await fetch('/webui-config.json', { cache: 'no-store' });
    if (response.ok) state.config = await response.json();
  } catch {
    /* keep defaults */
  }
}

function openTokenModal() {
  const apiBase = state.config.api_base || 'http://127.0.0.1:5555';
  openModal({
    title: 'API 令牌',
    body: `<div class="stack">
      <p class="muted">项目默认无需令牌。如果服务端配置了 token 校验，请在此填写请求头 <code>token</code> 的值。</p>
      <div class="field">
        <label for="token-input">令牌</label>
        <div class="input-with-button">
          <input class="input" id="token-input" type="password" placeholder="留空则不发送令牌" value="${esc(state.token)}" autocomplete="off">
          <button class="btn btn-icon" id="token-reveal" type="button" aria-label="显示 / 隐藏令牌">
            <svg viewBox="0 0 24 24"><use href="#i-eye"/></svg>
          </button>
        </div>
        <span class="hint">API 地址：<code>${esc(apiBase)}</code></span>
      </div>
      <div class="token-status" id="token-test-result"></div>
    </div>`,
    footer: `<button class="btn btn-ghost" id="token-clear" type="button">清除令牌</button>
      <div class="spacer"></div>
      <button class="btn" id="token-test" type="button">测试连接</button>
      <button class="btn btn-primary" id="token-save" type="button">保存</button>`,
  });

  const input = $('#token-input');
  const result = $('#token-test-result');

  $('#token-reveal').addEventListener('click', () => {
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    $('#token-reveal').innerHTML = `<svg viewBox="0 0 24 24"><use href="#i-${
      visible ? 'eye' : 'eye-off'
    }"/></svg>`;
  });

  $('#token-test').addEventListener('click', async () => {
    result.className = 'token-status show';
    result.textContent = '正在验证…';
    try {
      await api('/token', undefined, { token: input.value.trim() });
      result.className = 'token-status show ok';
      result.textContent = '验证成功，令牌有效。';
    } catch (error) {
      result.className = 'token-status show error';
      result.textContent = errorText(error);
    }
  });

  const save = (value, message) => {
    state.token = value;
    if (value) localStorage.setItem('douk.token', value);
    else localStorage.removeItem('douk.token');
    closeModal();
    updateTokenDot();
    toast(message, 'success');
    refreshStatus();
  };

  $('#token-save').addEventListener('click', () => save(input.value.trim(), '令牌已保存'));
  $('#token-clear').addEventListener('click', () => save('', '令牌已清除'));
  window.setTimeout(() => input.focus(), 30);
}

/* -------------------------------------------------------------- navigation */

function setPlatform(platform) {
  state.platform = platform === 'tiktok' ? 'tiktok' : 'douyin';
  try {
    localStorage.setItem('douk.platform', state.platform);
  } catch {
    /* ignore */
  }
  const label = PLATFORM_LABEL[state.platform];

  $$('#platform-switch .seg-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.platform === state.platform);
  });

  $('#parse-platform-hint').textContent = `当前平台：${label}`;
  $('#account-platform-pill').textContent = label;
  $('#mix-platform-pill').textContent = label;
  $('#live-platform-pill').textContent = label;
  $('#parse-input').placeholder =
    state.platform === 'tiktok'
      ? '粘贴 TikTok 分享文案、作品链接或作品 ID…'
      : '粘贴抖音 / TikTok 分享文案、作品链接或作品 ID…';

  $('#account-secuid').placeholder =
    state.platform === 'tiktok'
      ? 'TikTok secUid（MS4wLjAB… 开头）'
      : 'MS4wLjAB… 或 https://www.douyin.com/user/MS4wLjAB…';

  const liveLabel = $('#live-rid-label');
  const liveInput = $('#live-rid');
  const liveHint = $('#live-rid-hint');
  const liveNote = $('#live-note');

  if (state.platform === 'douyin') {
    liveLabel.innerHTML = '<span class="req">*</span> 直播 web_rid';
    liveInput.placeholder = '例如 123456789 或 https://live.douyin.com/123456789';
    liveHint.textContent = '可从直播链接 https://live.douyin.com/<web_rid> 中获取。';
    liveNote.hidden = true;
  } else {
    liveLabel.innerHTML = '<span class="req">*</span> 直播 room_id';
    liveInput.placeholder = '输入 TikTok 直播间 room_id（纯数字）';
    liveHint.textContent = 'TikTok 直播接口需要 room_id，通常可从接口数据或直播链接参数中获取。';
    liveNote.hidden = false;
  }
}

function closeSidebar() {
  $('#sidebar')?.classList.remove('open');
  $('#sidebar-backdrop')?.classList.remove('show');
}

function openSidebar() {
  $('#sidebar')?.classList.add('open');
  $('#sidebar-backdrop')?.classList.add('show');
}

function navigate(view, { fromHash = false } = {}) {
  if (!VIEW_TITLES[view]) view = 'parse';

  if ((view === 'comment' || view === 'search') && state.platform === 'tiktok') {
    setPlatform('douyin');
    if (!fromHash) {
      toast('评论与搜索接口仅支持抖音，已切换为抖音', 'info');
    }
  }

  state.view = view;
  $$('.view').forEach((section) => {
    section.classList.toggle('active', section.dataset.view === view);
  });
  $$('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.nav === view);
  });

  const title = VIEW_TITLES[view];
  $('#page-title').textContent = title;
  document.title = `${title} · DouK Web`;

  if (!fromHash && location.hash !== `#${view}`) {
    window.history.pushState(null, '', `#${view}`);
  }

  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'auto' });

  if (view === 'settings') loadSettings();
  if (view === 'parse') renderHistory();
  if (view === 'tasks') startTasksPolling();
  else stopTasksPolling();
}

/* ------------------------------------------------------------- interactions */

function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('douk.theme', next);
  } catch {
    /* ignore */
  }
  $('#theme-btn').setAttribute(
    'aria-label',
    next === 'dark' ? '切换为浅色主题' : '切换为深色主题',
  );
}

function handleGlobalClick(event) {
  const close = event.target.closest('[data-close]');
  if (close) {
    closeModal();
    return;
  }

  const copy = event.target.closest('[data-copy]');
  if (copy) {
    copyText(copy.dataset.copy);
    return;
  }

  const rawCopy = event.target.closest('[data-raw-copy]');
  if (rawCopy) {
    const payload = rawStore.get(rawCopy.dataset.rawCopy);
    if (payload !== undefined) copyText(JSON.stringify(payload, null, 2));
    return;
  }

  const rawExport = event.target.closest('[data-raw-export]');
  if (rawExport) {
    const payload = rawStore.get(rawExport.dataset.rawExport);
    if (payload !== undefined) {
      downloadJson(payload, `DouK_response_${stamp()}.json`);
    }
  }
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    if (!$('#modal')?.hidden) {
      closeModal();
      return;
    }
    closeSidebar();
  }

  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    if (state.view === 'parse') {
      event.preventDefault();
      runParse();
    }
  }
}

function bindEvents() {
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('popstate', () => {
    navigate(location.hash.slice(1) || 'parse', { fromHash: true });
  });

  $('#platform-switch').addEventListener('click', (event) => {
    const button = event.target.closest('[data-platform]');
    if (button) setPlatform(button.dataset.platform);
  });

  $('#theme-btn').addEventListener('click', toggleTheme);
  $('#token-btn').addEventListener('click', openTokenModal);
  $('#api-status').addEventListener('click', refreshStatus);
  $('#menu-btn').addEventListener('click', openSidebar);
  $('#sidebar-backdrop').addEventListener('click', closeSidebar);

  $$('[data-nav]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(element.dataset.nav);
    });
  });

  $('#parse-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runParse();
  });
  $('#account-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runAccount();
  });
  $('#mix-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runMix();
  });
  $('#live-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runLive();
  });
  $('#comment-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runComment();
  });
  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });

  $('#search-types').addEventListener('click', (event) => {
    const button = event.target.closest('[data-search-type]');
    if (button) setSearchType(button.dataset.searchType);
  });

  $('#clear-history').addEventListener('click', clearHistory);
  $('#tasks-refresh')?.addEventListener('click', () => loadServerJobs());
  $('#settings-reload').addEventListener('click', () => loadSettings(true));
  $('#settings-save').addEventListener('click', saveSettings);
  $('#settings-export').addEventListener('click', () => {
    if (state.settings) {
      downloadJson(state.settings, `DouK_settings_${stamp()}.json`);
    }
  });
}

/* --------------------------------------------------------------------- init */

async function init() {
  const savedPlatform = localStorage.getItem('douk.platform');
  if (savedPlatform === 'tiktok' || savedPlatform === 'douyin') {
    state.platform = savedPlatform;
  }
  state.token = localStorage.getItem('douk.token') || '';
  loadHistory();

  bindEvents();
  setPlatform(state.platform);
  setSearchType('general');
  renderHistory();
  updateTokenDot();

  await loadWebuiConfig();
  refreshStatus();

  navigate(location.hash.slice(1) || 'parse', { fromHash: true });
  if (state.view !== 'tasks') loadServerJobs({ silent: true });
}

document.addEventListener('DOMContentLoaded', init);
