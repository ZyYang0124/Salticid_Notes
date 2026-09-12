// 编辑器客户端脚本（UX Refresh 版）。
// 三个脚本：/studio-login.js、/studio-editor.js（观察）、/studio-note-editor.js（札记）。
// 原则：vanilla JS、无框架、只动 opacity/transform、autosave 无感但可见、发布状态单一入口。
// 注意：客户端代码不使用模板字符串，避免与外层 TS 模板字面量冲突。

// ==================== 登录 ====================

const LOGIN_JS = `
(function () {
  function $(s) { return document.querySelector(s); }
  var emailInput = $('#login-email');
  if (!emailInput) return;
  var stepEmail = $('#step-email'), stepCode = $('#step-code');
  var emailErr = $('#email-err'), codeErr = $('#code-err');
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.code-row input'));
  var resendBtn = $('#btn-resend'), resendS = $('#resend-s');
  var resendTimer = null;
  var currentEmail = '';

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Studio-Api': '1' },
      body: new URLSearchParams(body).toString(),
    }).then(function (r) { return r.json(); });
  }
  function showErr(el, msg) { el.textContent = msg; }
  function startResend() {
    var left = 48;
    resendBtn.disabled = true;
    resendS.textContent = left;
    clearInterval(resendTimer);
    resendTimer = setInterval(function () {
      left -= 1;
      resendS.textContent = left;
      if (left <= 0) { clearInterval(resendTimer); resendBtn.disabled = false; resendBtn.textContent = '重新发送'; }
    }, 1000);
  }
  function sendCode() {
    var email = emailInput.value.trim();
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { showErr(emailErr, '请输入正确的邮箱地址'); return; }
    emailErr.textContent = '';
    var btn = $('#btn-send');
    btn.disabled = true; btn.textContent = '发送中…';
    api('/studio/login/otp', { email: email }).then(function (j) {
      btn.disabled = false; btn.textContent = '发送验证码';
      if (!j.ok) { showErr(emailErr, j.message || '该邮箱不在受邀名单中'); return; }
      currentEmail = email;
      $('#code-email').textContent = email;
      stepEmail.style.display = 'none';
      stepCode.style.display = '';
      boxes[0].focus();
      startResend();
    }).catch(function () { showErr(emailErr, '网络异常，请重试'); });
  }
  $('#btn-send').addEventListener('click', sendCode);
  emailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendCode(); });

  resendBtn.addEventListener('click', function () {
    if (!currentEmail) return;
    resendBtn.disabled = true;
    api('/studio/login/otp', { email: currentEmail }).then(function (j) {
      if (!j.ok) { codeErr.textContent = j.message || '发送失败'; return; }
      startResend();
      codeErr.textContent = '';
    });
  });

  function codeValue() { return boxes.map(function (b) { return b.value; }).join(''); }
  function verify() {
    var code = codeValue();
    if (code.length !== 6) { codeErr.textContent = '请输入 6 位验证码'; return; }
    codeErr.textContent = '';
    var btn = $('#btn-verify');
    btn.disabled = true; btn.textContent = '登录中…';
    api('/studio/login/verify', { email: currentEmail, code: code }).then(function (j) {
      if (!j.ok) {
        btn.disabled = false; btn.textContent = '登录';
        codeErr.textContent = j.message || '验证码无效或已过期';
        boxes.forEach(function (b) { b.value = ''; });
        boxes[0].focus();
        return;
      }
      location.href = '/studio';
    }).catch(function () { btn.disabled = false; btn.textContent = '登录'; codeErr.textContent = '网络异常，请重试'; });
  }
  $('#btn-verify').addEventListener('click', verify);

  boxes.forEach(function (box, i) {
    box.addEventListener('input', function () {
      box.value = box.value.replace(/\\D/g, '').slice(-1);
      codeErr.textContent = '';
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
      if (codeValue().length === 6) verify(); // 填满自动提交
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
      if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
      if (e.key === 'ArrowRight' && i < boxes.length - 1) boxes[i + 1].focus();
      if (e.key === 'Enter') verify();
    });
    box.addEventListener('paste', function (e) {
      var text = (e.clipboardData || window.clipboardData).getData('text') || '';
      var digits = text.replace(/\\D/g, '');
      if (digits.length >= 4) {
        e.preventDefault();
        digits = digits.slice(0, 6);
        for (var k = 0; k < digits.length; k++) boxes[k].value = digits[k];
        boxes[Math.min(digits.length, 5)].focus();
        if (digits.length === 6) verify();
      }
    });
  });
})();
`;

// ==================== 共享：照片准备（浏览器端派生图） ====================

const UPLOAD_LIB = `
window.__sfnPrepareUpload = async function (file) {
  if (!window.createImageBitmap || !window.OffscreenCanvas) throw new Error('浏览器不支持本地图片处理，请改用现代浏览器');
  var bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // 只生成 jpg 档：主站发布会从原图统一重新生成全部格式，
  // Studio 自身只用 -480.jpg 缩略图；浏览器端 AVIF/WebP 编码极慢且无人消费，纯属拖慢上传
  var widths = [480, 768, 1280, 1920].filter(function (w) { return w <= bmp.width; });
  if (!widths.length) widths = [480];
  var variants = [];
  for (var i = 0; i < widths.length; i++) {
    var w = widths[i];
    var c = new OffscreenCanvas(w, Math.max(1, Math.round(bmp.height * w / bmp.width)));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    variants.push({ name: w + '.jpg', blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 }) });
  }
  return { original: file, width: bmp.width, height: bmp.height, variants: variants };
};
window.__sfnAppendUpload = function (fd, prepared) {
  fd.append('original', prepared.original, prepared.original.name);
  fd.append('width', String(prepared.width));
  fd.append('height', String(prepared.height));
  prepared.variants.forEach(function (v) { fd.append('variant', v.blob, v.name); });
};
window.__sfnFetch = function (url, opts, timeoutMs) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 90000);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(function () { clearTimeout(t); });
};
`;

// ==================== 观察编辑器 ====================

const OBS_EDITOR_JS = `
(function () {
  var boot = window.__EDITOR_BOOT || {};
  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  var statusEl = $('#save-status'), barStatus = $('#bar-status');
  var publicId = boot.publicId || null;
  var status = boot.status || 'draft'; // draft | published | private | archived（发布=立即公开，§1）
  var LS_KEY = 'sfn-obs-' + (boot.publicId || 'new');
  var saveTimer = null, saving = false, offline = false;
  var saveChain = Promise.resolve(), saveQueued = false;
  var photos = $all('#photo-grid .photo').map(function (n) { return n.getAttribute('data-pid'); });
  // 发布时刻的内容快照：之后的保存若与快照一致，不再提示「主站未同步」
  var lastPublishedSnapshot = null;
  function snapshotNow() {
    var p = fields();
    p.species_taxon_slug = taxonSlug();
    return JSON.stringify(p);
  }
  function isPublished() { return status === 'published'; }

  function readJson(r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { return { ok: false, error: '服务异常（' + r.status + '）' }; }
    });
  }
  function setStatus(s, err, isHtml) {
    if (statusEl) { if (isHtml) { statusEl.innerHTML = s; } else { statusEl.textContent = s; } statusEl.className = err ? 'err' : ''; }
    if (barStatus) { if (isHtml) { barStatus.innerHTML = s; } else { barStatus.textContent = s; } barStatus.style.color = err ? 'var(--terra)' : 'var(--faint)'; }
  }
  // 操作区状态机（§3/§6）：draft=[保存草稿][发布]；published=[保存修改][⋯]；
  // private=[保存][发布]；archived=[恢复为草稿][保存]
  function updateActions() {
    var pub = $('#btn-publish'), draft = $('#btn-savedraft'), more = $('#btn-more'), hint = $('#pub-hint');
    if (!pub) return;
    if (status === 'published') {
      pub.textContent = '保存修改'; pub.disabled = false;
      draft.hidden = true; if (more) more.hidden = false;
      if (hint) hint.hidden = true;
    } else if (status === 'private') {
      pub.textContent = '发布'; pub.disabled = false;
      draft.textContent = '保存'; draft.hidden = false;
      if (more) more.hidden = true;
      if (hint) hint.hidden = true;
    } else if (status === 'archived') {
      pub.textContent = '恢复为草稿'; pub.disabled = false;
      draft.textContent = '保存'; draft.hidden = false;
      if (more) more.hidden = true;
      if (hint) hint.hidden = true;
    } else {
      pub.textContent = '发布'; pub.disabled = false;
      draft.textContent = '保存草稿'; draft.hidden = false;
      if (more) more.hidden = true;
      if (hint) hint.hidden = false;
    }
  }
  function postAction(act) {
    var m = $('#status-menu');
    if (m) m.hidden = true;
    return fetch('/studio/api/observations/' + publicId + '/' + act, { method: 'POST' })
      .then(readJson)
      .then(function (j) {
        if (j && j.ok) location.reload();
        else setStatus('操作失败：' + ((j && j.error) || ''), true);
      })
      .catch(function () { setStatus('网络异常，请重试', true); });
  }
  function fields() {
    var o = {};
    $all('[data-field]').forEach(function (el) { o[el.getAttribute('data-field')] = el.value; });
    return o;
  }
  function taxonSlug() {
    var w = window.__chosenSlug;
    return w || '';
  }
  // 发布时刻的字段快照：之后的保存若与快照一致，不再误报「有未发布修改」
  var lastPublishedSnapshot = null;
  function snapshotNow() {
    var p = fields();
    p.species_taxon_slug = taxonSlug();
    return JSON.stringify(p);
  }
  function lsSave() { try { localStorage.setItem(LS_KEY, JSON.stringify(fields())); } catch (e) {} }
  function lsClear() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }

  function create() {
    // 失败必须可见：会话过期/网络错误不能静默成「点了没反应」
    return window.__sfnFetch('/studio/api/observations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(function (r) {
      return r.json().catch(function () { throw new Error('服务返回异常（' + r.status + '）'); }).then(function (j) {
        if (r.status === 401 || j.error === '未登录') throw new Error('登录已过期，请刷新页面重新登录');
        if (!r.ok || !j.public_id) throw new Error('创建记录失败（' + r.status + (j.error ? '：' + j.error : '') + '）');
        publicId = j.public_id;
        history.replaceState(null, '', '/studio/observations/' + publicId + '/edit');
        $('h1').textContent = publicId;
        return publicId;
      });
    });
  }

  function saveNow(silent, explicit) {
    if (saving) { saveQueued = true; return saveChain; } // 已有保存 in-flight：登记尾随保存，避免发布与保存竞态
    saving = true;
    var ensure = publicId ? Promise.resolve(publicId) : create();
    saveChain = ensure.then(function (pid) {
      if (!pid) { saving = false; return; }
      var payload = fields();
      payload.species_taxon_slug = taxonSlug();
      payload.place_id = placeId;
      if (explicit) payload.explicit = true;
      var snap = JSON.stringify(payload);
      return fetch('/studio/api/observations/' + pid, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
        .then(readJson)
        .then(function (j) {
          if (j.ok) {
            offline = false;
            if (isPublished()) {
              // 已发布记录：内容与主站快照不一致时，提醒点「保存修改」同步主站
              if (snap !== lastPublishedSnapshot) setStatus('已保存 · 主站未同步，点「保存修改」更新');
              else setStatus('已保存 ' + (j.saved_at || ''));
            } else setStatus('已保存 ' + (j.saved_at || ''));
            lsClear();
          } else setStatus('保存失败：' + (j.error || ''), true);
        })
        .catch(function () {
          offline = true;
          setStatus('暂时离线，更改已留在本机，恢复后重试', true);
        });
    }).then(function () {
      saving = false;
      if (saveQueued) { saveQueued = false; return saveNow(silent, explicit); }
    });
    return saveChain;
  }
  function scheduleSave() {
    setStatus('正在保存…');
    lsSave();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveNow(true); }, 1200);
  }

  // ---- 启动填充 ----
  var d = boot.data || {};
  $all('[data-field]').forEach(function (el) {
    var k = el.getAttribute('data-field');
    var v = d[k];
    if (el.tagName === 'SELECT') { if (v) el.value = v; }
    else if (v !== null && v !== undefined && v !== '') el.value = v;
  });
  if (!boot.publicId && !$('[data-field="observed_at"]').value) {
    $('[data-field="observed_at"]').value = new Date().toISOString().slice(0, 10);
  }
  // 国家不预填：由地图选点/EXIF 的逆地理编码按坐标填写（避免非中国记录被静默标成中国）
  window.__chosenSlug = d.species_taxon_slug || '';
  // renderChosen 延迟到物种选择器变量初始化之后调用（见下方 spInput 声明后）
  if (!boot.publicId) {
    try {
      var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (saved) {
        Object.keys(saved).forEach(function (k) {
          var el = document.querySelector('[data-field="' + k + '"]');
          if (el && saved[k]) el.value = saved[k];
        });
        setStatus('已恢复上次未保存的内容');
      }
    } catch (e) {}
  }
  updateActions();
  $all('[data-field]').forEach(function (el) { el.addEventListener('input', scheduleSave); });

  // ---- 物种选择器：本地类群 + WSC 预测（属→种级联 + 中文名）----
  var spInput = $('#species-search'), pop = $('#species-pop'), wrap = $('#species-wrap');
  renderChosen();
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtName(t) {
    return t.cn ? '<span class="cn">' + escHtml(t.cn) + '</span><span class="sn">' + escHtml(t.name) + (t.rank !== 'species' && t.rank !== 'subspecies' ? ' sp.' : '') + '</span>'
                : '<span class="cn" style="font-style:italic">' + escHtml(t.name) + '</span>';
  }
  function searchTaxa(q) {
    q = q.trim().toLowerCase();
    var list = boot.taxa || [];
    if (!q) return list.slice(0, 8);
    return list.filter(function (t) {
      return t.name.toLowerCase().indexOf(q) !== -1
        || (t.cn && t.cn.toLowerCase().indexOf(q) !== -1)
        || t.slug.indexOf(q) !== -1
        || t.name.toLowerCase().split(' ')[0].indexOf(q) !== -1;
    }).slice(0, 8);
  }
  function renderChosen() {
    var slug = window.__chosenSlug;
    var t = (boot.taxa || []).filter(function (x) { return x.slug === slug; })[0];
    var host = $('.species-wrap');
    var old = host.querySelector('.chosen-taxa');
    if (old) old.remove();
    if (t) {
      var div = document.createElement('div');
      div.className = 'chosen-taxa';
      div.innerHTML = '<span class="cn">' + escHtml(t.cn || (t.working ? '工作编号' : '')) + '</span><span class="sn">' + escHtml(t.name) + '</span><button type="button" id="sp-clear">更改</button>';
      host.insertBefore(div, spInput);
      spInput.style.display = 'none';
      div.querySelector('#sp-clear').addEventListener('click', function () {
        window.__chosenSlug = '';
        div.remove();
        spInput.style.display = '';
        spInput.value = '';
        spInput.focus();
        scheduleSave();
      });
    } else {
      spInput.style.display = '';
    }
  }

  // ---- WSC 预测：属前缀 → 属列表；属名 → 该属 ACCEPTED 种列表（D1 缓存于服务端）----
  var wscCache = {}, wscTimer = null;
  function fetchWsc(type, q, cb) {
    var key = type + ':' + q.toLowerCase();
    if (wscCache[key] !== undefined) { cb(wscCache[key]); return; }
    clearTimeout(wscTimer);
    wscTimer = setTimeout(function () {
      fetch('/studio/api/wsc/complete?type=' + type + '&q=' + encodeURIComponent(q))
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (j) {
          var items = (j && j.ok && j.items) ? j.items : [];
          wscCache[key] = items;
          cb(items);
        })
        .catch(function () { cb([]); });
    }, 320);
  }
  function ensureWorkingTaxon(name, cn, cb) {
    var known = boot.taxa.filter(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })[0];
    if (known) { cb(known); return; }
    fetch('/studio/api/taxa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name: name, chinese_name: cn || null })
    }).then(readJson).then(function (j) {
      if (j && j.ok) {
        if (!boot.taxa.some(function (t) { return t.slug === j.taxon.slug; })) boot.taxa.push(j.taxon);
        cb(j.taxon);
      } else cb(null);
    }).catch(function () { cb(null); });
  }
  function chooseTaxon(t) {
    window.__chosenSlug = t.slug;
    pop.classList.remove('open');
    if (t.rank === 'genus') {
      spInput.value = t.name + ' ';
      window.__chosenSlug = t.slug;
      renderChosen();
      scheduleSave();
      openPop(spInput.value);
      spInput.focus();
      return;
    }
    spInput.value = '';
    renderChosen();
    scheduleSave();
  }

  window.__spLog = [];
  function openPop(rawQ) {
    var raw = (rawQ || '');
    var hasSpace = /\\s/.test(raw); // 尾随空格 = 显式进入种级联
    var q = raw.replace(/\s+$/, '');
    if (hasSpace && !q) { pop.classList.remove('open'); return; }
    var list = searchTaxa(q);
    var qLower = q.trim().toLowerCase();
    var exact = q && list.some(function (t) { return t.name.toLowerCase() === qLower; });
    var nameLike = /^[A-Za-z][A-Za-z. -]{1,79}$/.test(q.trim());
    var createOpt = q && nameLike && !exact
      ? '<div class="opt place-new" data-new-taxon="1">＋ 建立工作编号「' + escHtml(q.trim()) + '」</div>'
      : '';
    var localHtml = list.map(function (t) { return '<div class="opt" data-slug="' + escHtml(t.slug) + '">' + fmtName(t) + '</div>'; }).join('');

    function finishRender(wscSection) {
      pop.innerHTML = localHtml + (wscSection || '') + createOpt;
      pop.classList.add('open');
      Array.prototype.slice.call(pop.querySelectorAll('.opt[data-slug]')).forEach(function (el) {
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var slug = el.getAttribute('data-slug');
          var t = (boot.taxa || []).filter(function (x) { return x.slug === slug; })[0];
          if (t && t.rank === 'genus' && !hasSpace) { chooseTaxon(t); return; }
          window.__chosenSlug = slug;
          pop.classList.remove('open');
          spInput.value = '';
          renderChosen();
          scheduleSave();
        });
      });
      Array.prototype.slice.call(pop.querySelectorAll('[data-new-taxon]')).forEach(function (el) {
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var name = spInput.value.trim();
          if (!name) return;
          var cn = /[\u4e00-\u9fa5]/.test(name) ? name : null;
          if (cn) { setStatus('中文名请在选定学名后补充，或到「类群管理」维护', true); return; }
          createWorkingAndSelect(name, null);
        });
      });
    }
    function createWorkingAndSelect(name, cn) {
      setStatus('正在登记「' + name + '」…');
      ensureWorkingTaxon(name, cn, function (t) {
        if (!t) { setStatus('无法登记工作编号', true); return; }
        window.__chosenSlug = t.slug;
        pop.classList.remove('open');
        spInput.value = '';
        renderChosen();
        setStatus('已登记「' + name + '」');
        scheduleSave();
      });
    }

    if (!list.length && !createOpt && !hasSpace) {
      pop.innerHTML = '<div class="none">没有匹配——继续输入将查询 WSC 属名</div>';
      pop.classList.add('open');
    }

    if (hasSpace) {
      // 属已定 → 种级联：WSC 该属 ACCEPTED 种
      var genus = q.split(/\\s+/)[0];
      fetchWsc('species', genus, function (items) {
        if (!items || !items.length) { finishRender('<div class="none wsc-none">WSC 查无更多匹配</div>'); return; }
        var accepted = items.filter(function (i2) { return i2.status === 'ACCEPTED'; });
        var rows = accepted.map(function (i2) {
          var full = genus + ' ' + i2.epithet;
          return '<div class="opt" data-wscname="' + escHtml(full) + '"><span class="cn" style="font-style:italic">' + escHtml(genus) + ' ' + escHtml(i2.epithet) + '</span></div>';
        }).join('');
        finishRender(rows ? '<div class="none wsc-head">WSC 有效种</div>' + rows : '<div class="none wsc-none">WSC 查无更多匹配</div>');
        bindWscSpecies(genus);
      });
  } else if (/^[A-Za-z]{2,}$/.test(q.replace(/\\s/g, ''))) {
      // 属前缀预测
      fetchWsc('genus', q, function (items) {
        var wrows = items.filter(function (g) {
          return !list.some(function (t) { return t.name.toLowerCase() === g.name.toLowerCase(); });
        }).map(function (g) {
          return '<div class="opt" data-wscgenus="' + escHtml(g.name) + '"><span class="cn" style="font-style:italic">' + escHtml(g.name) + '</span><span class="meta">' + escHtml(g.author || 'WSC') + '</span></div>';
        }).join('');
        var sec = wrows ? '<div class="none wsc-head">WSC 属</div>' + wrows : '';
        finishRender(sec);
        Array.prototype.slice.call(pop.querySelectorAll('[data-wscgenus]')).forEach(function (el) {
          el.addEventListener('mousedown', function (e) {
            e.preventDefault();
            var gname = el.getAttribute('data-wscgenus');
            ensureWorkingTaxon(gname, null, function (t) {
              if (!t) { setStatus('无法登记该属', true); return; }
              chooseTaxon(t);
            });
          });
        });
      });
    } else {
      finishRender('');
    }

    function bindWscSpecies(genus) {
      Array.prototype.slice.call(pop.querySelectorAll('.opt[data-wscname]')).forEach(function (el) {
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          createWorkingAndSelect(el.getAttribute('data-wscname'), null);
        });
      });
    }
  }
  spInput.addEventListener('focus', function () { openPop(spInput.value); });
  spInput.addEventListener('input', function () { openPop(spInput.value); });
  spInput.addEventListener('blur', function () { setTimeout(function () { pop.classList.remove('open'); }, 150); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') pop.classList.remove('open'); });

  // ---- 坐标：粘贴自动解析 + 地图 ----
  var latEl = $('[data-field="latitude"]'), lngEl = $('[data-field="longitude"]');
  // ---- 地点 ComboBox（§16-§18）：搜索已有 → 选中挂接；或直接填下方信息新建 ----
  var placeId = boot.placeId || null;
  var placeSearch = $('#place-search'), placePop = $('#place-pop');
  function placeHintText() {
    return placeId ? '已挂接地点，发布后归入该地点' : '未选择地点——下方手工填写的信息会在保存时自动创建地点';
  }
  function refreshPlaceHint() {
    var el = $('#place-hint');
    if (el) el.textContent = placeHintText();
  }
  function fillPlaceFields(p) {
    if (!p) return;
    var set = function (k, v) { var el = document.querySelector('[data-field="' + k + '"]'); if (el && v != null) el.value = v; };
    set('country_name', p.country);
    set('admin1', p.admin1); set('admin2', p.admin2);
    set('locality', p.locality); set('site_name', p.site_name);
    if (p.latitude != null) { latEl.value = p.latitude; }
    if (p.longitude != null) { lngEl.value = p.longitude; }
    scheduleSave();
  }
  function renderPlacePop(list) {
    if (!placePop) return;
    placePop.innerHTML = list.length
      ? list.map(function (p) {
          var sub = [p.admin1, p.admin2, p.locality].filter(Boolean).join(' · ');
          return '<div class="opt place-opt" data-pid="' + p.id + '"><span class="cn">' + escHtml(p.name) + '</span>' +
            (sub ? '<span class="sn">' + escHtml(sub) + '</span>' : '') + '</div>';
        }).join('') + (placeSearch.value.trim() ? '<div class="opt place-new" data-new="1">＋ 新建地点「' + escHtml(placeSearch.value.trim()) + '」</div>' : '')
      : (placeSearch.value.trim() ? '<div class="opt place-new" data-new="1">＋ 新建地点「' + escHtml(placeSearch.value.trim()) + '」</div>' : '');
    placePop.classList.add('open');
    Array.prototype.slice.call(placePop.querySelectorAll('.place-opt')).forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        placeId = Number(el.getAttribute('data-pid'));
        var p = list.filter(function (x) { return x.id === placeId; })[0];
        if (p) fillPlaceFields(p);
        placeSearch.value = p ? p.name : '';
        placePop.classList.remove('open');
        refreshPlaceHint();
        scheduleSave();
      });
    });
    Array.prototype.slice.call(placePop.querySelectorAll('.place-new')).forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        placeId = null;
        placePop.classList.remove('open');
        refreshPlaceHint();
        document.querySelector('[data-field="locality"]').focus();
      });
    });
  }
  if (placeSearch) {
    var placeTimer = null;
    placeSearch.addEventListener('input', function () {
      placeId = null; // 手动改动即视为未挂接，保存时按下方信息自动建点
      refreshPlaceHint();
      clearTimeout(placeTimer);
      placeTimer = setTimeout(function () {
        var q = placeSearch.value.trim();
        if (!q) { placePop.classList.remove('open'); return; }
        fetch('/studio/api/places?q=' + encodeURIComponent(q)).then(readJson).then(function (j) {
          if (j && j.ok) renderPlacePop(j.places || []);
        }).catch(function () {});
      }, 250);
    });
    placeSearch.addEventListener('blur', function () { setTimeout(function () { placePop.classList.remove('open'); }, 180); });
    refreshPlaceHint();
  }
  // 半球字母跟随输入符号：北纬 N/南纬 S，东经 E/西经 W
  function updateHemi() {
    var lh = $('#lat-hemi'), lh2 = $('#lng-hemi');
    if (lh) lh.textContent = parseFloat(latEl.value) < 0 ? 'S' : 'N';
    if (lh2) lh2.textContent = parseFloat(lngEl.value) < 0 ? 'W' : 'E';
  }
  [latEl, lngEl].forEach(function (el) {
    el.addEventListener('input', updateHemi);
    el.addEventListener('change', updateHemi);
  });
  updateHemi();

  // ---- 未来日期提示（§11）：非阻塞，仅提醒；记录仍会照常保存 ----
  var dateEl = $('[data-field="observed_at"]');
  function updateDateWarn() {
    if (!dateEl) return;
    var v = String(dateEl.value || '');
    var now = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var todayStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var bad = v && v > todayStr;
    var w = $('#date-warn');
    if (!w) {
      w = document.createElement('div');
      w.id = 'date-warn';
      w.style.cssText = 'color:#b3541e;font-size:12px;margin-top:4px;letter-spacing:.02em;';
      dateEl.parentNode.insertBefore(w, dateEl.nextSibling);
    }
    w.textContent = bad ? '观察日期在未来——记录仍会保存，请确认日期是否输入有误' : '';
  }
  if (dateEl) {
    dateEl.addEventListener('input', updateDateWarn);
    dateEl.addEventListener('change', updateDateWarn);
  }
  updateDateWarn();

  function tryParsePair(text) {
    var m = String(text).match(/(-?\\d+(?:\\.\\d+)?)\\s*[,，\\s]\\s*(-?\\d+(?:\\.\\d+)?)/);
    if (!m) return false;
    var a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (Math.abs(a) > 90 || Math.abs(b) > 180) return false;
    latEl.value = a; lngEl.value = b;
    scheduleSave();
    return true;
  }
  [latEl, lngEl].forEach(function (el) {
    el.addEventListener('paste', function (e) {
      var text = (e.clipboardData || window.clipboardData).getData('text') || '';
      if (tryParsePair(text)) e.preventDefault();
    });
  });
  var mapBox = $('#map-box'), mapLoaded = false, mapObj = null, marker = null;

  // ---- 地址逆匹配：选点后自动填写空缺的地点信息（OSM Nominatim；地图瓦片同为 OSM 服务） ----
  var geoTimer = null;
  function matchAddress(lat, lng) {
    clearTimeout(geoTimer);
    geoTimer = setTimeout(function () {
      var hint = document.querySelector('#map-box .map-hint');
      if (hint) hint.textContent = '正在识别地址…';
      var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=zh-CN&lat=' + lat + '&lon=' + lng;
      window.__sfnFetch(url, {}, 15000).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var a = j && j.address;
        if (!a) { if (hint) hint.textContent = '未能识别地址——可手动填写'; return; }
        // 只填空字段：手工填过的内容绝不覆盖（与 EXIF 坐标同一策略）
        var picks = [
          ['country_name', a.country || a.country_name],
          ['admin1', a.state || a.province || a.region],
          ['admin2', a.county || a.district || a.city_district],
          ['locality', a.city || a.town || a.village || a.municipality],
        ];
        var filled = [];
        picks.forEach(function (kv) {
          if (!kv[1]) return;
          var el = document.querySelector('[data-field="' + kv[0] + '"]');
          if (el && !el.value) { el.value = kv[1]; filled.push(kv[1]); }
        });
        if (filled.length) {
          scheduleSave();
          if (hint) hint.textContent = '已按坐标填入：' + filled.join(' · ') + '（仅空缺字段，可修改）';
        } else if (hint) {
          hint.textContent = '已识别：' + [a.country, a.state, a.county || a.city].filter(Boolean).join(' · ') + '（地点信息已填写，未改动）';
        }
      }).catch(function () { if (hint) hint.textContent = '地址识别失败（网络）——可手动填写'; });
    }, 700); // 防抖：拖动/连续点击时只在停下后请求一次（Nominatim 限速 1 次/秒）
  }

  $('#btn-map').addEventListener('click', function () {
    if (!mapBox.hidden) { mapBox.hidden = true; return; }
    mapBox.hidden = false;
    if (mapLoaded) { setTimeout(function () { if (mapObj) mapObj.invalidateSize(); }, 60); return; }
    mapBox.className = 'loading';
    mapBox.textContent = '地图加载中…';
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    var js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = function () {
      mapLoaded = true;
      mapBox.className = '';
      mapBox.innerHTML = '<div class="map-inner" id="map-inner"></div><div class="map-hint">点击或拖动标记调整坐标（WGS84）</div>';
      var lat = parseFloat(latEl.value) || 30.0, lng = parseFloat(lngEl.value) || 105.0;
      mapObj = L.map('map-inner', { zoomControl: false }).setView([lat, lng], latEl.value ? 13 : 4);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapObj);
      marker = L.marker([lat, lng], { draggable: true }).addTo(mapObj);
      function apply() {
        var p = marker.getLatLng();
        latEl.value = Math.round(p.lat * 1e6) / 1e6;
        lngEl.value = Math.round(p.lng * 1e6) / 1e6;
        scheduleSave();
        matchAddress(latEl.value, lngEl.value);
      }
      marker.on('dragend', apply);
      mapObj.on('click', function (e) { marker.setLatLng(e.latlng); apply(); });
    };
    document.head.appendChild(js);
  });

  // ---- 照片：选择 / 上传 / 面板 / 排序 ----
  var grid = $('#photo-grid'), dropBig = $('#drop-big'), addBtn = $('#photo-add');
  var camInput = $('#photo-camera'), libInput = $('#photo-library');
  var photoErr = $('#photo-err'), panel = $('#photo-panel');
  function pickInput() { return libInput; }
  function openPicker() { libInput.click(); }
  dropBig.addEventListener('click', openPicker);
  addBtn.addEventListener('click', openPicker);
  dropBig.addEventListener('dragover', function (e) { e.preventDefault(); });
  dropBig.addEventListener('drop', function (e) { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  libInput.addEventListener('change', function () { handleFiles(libInput.files); libInput.value = ''; });
  camInput.addEventListener('change', function () { handleFiles(camInput.files); camInput.value = ''; });

  function showPhotoErr(m) { photoErr.textContent = m; photoErr.classList.add('show'); }
  function clearPhotoErr() { photoErr.classList.remove('show'); }

  function thumbOf(pid) { return '/media/derivatives/' + pid + '-480.jpg'; }
  function rerenderGrid() {
    grid.innerHTML = photos.map(function (pid, i) {
      var cover = i === 0;
      return '<div class="photo' + (cover ? ' cover' : '') + '" data-pid="' + pid + '">' +
        '<img src="' + thumbOf(pid) + '" alt="" /><span class="badge">' + (cover ? '★' : (i + 1)) + '</span></div>';
    }).join('') ;
    addBtn.hidden = false;
    dropBig.hidden = photos.length > 0;
    bindGrid();
  }
  function bindGrid() {
    $all('#photo-grid .photo').forEach(function (n) {
      n.setAttribute('draggable', 'true');
      n.addEventListener('click', function () { openPanel(n.getAttribute('data-pid')); });
      n.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', n.getAttribute('data-pid')); });
      n.addEventListener('dragover', function (e) { e.preventDefault(); });
      n.addEventListener('drop', function (e) {
        e.preventDefault();
        var dragPid = e.dataTransfer.getData('text/plain');
        var pid = n.getAttribute('data-pid');
        if (!dragPid || dragPid === pid || !publicId) return;
        var rest = photos.filter(function (x) { return x !== dragPid; });
        var idx = rest.indexOf(pid);
        photos = rest.slice(0, idx).concat([dragPid], rest.slice(idx));
        rerenderGrid();
        pushOrder();
      });
    });
  }
  function pushOrder() {
    if (!publicId) return;
    lastPublishedSnapshot = null; // 照片顺序变化视为发布后修改
    return fetch('/studio/api/observations/' + publicId + '/photos/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: photos }),
    });
  }
  var panelPid = null;
  function openPanel(pid) {
    panelPid = pid;
    var idx = photos.indexOf(pid);
    panel.hidden = false;
    panel.innerHTML =
      '<div class="pp-head"><img src="' + thumbOf(pid) + '" alt="" /><b>' + escHtml(pid) + '</b></div>' +
      '<div class="field"><label>图注</label><input id="pp-caption" placeholder="这张照片在说什么" /></div>' +
      '<div class="field"><label>摄影者</label><input id="pp-photographer" placeholder="默认为记录人" /></div>' +
      '<div class="pp-actions">' +
      '<button type="button" class="ghost" id="pp-cover">' + (idx === 0 ? '★ 代表图' : '设为代表图') + '</button>' +
      '<button type="button" class="ghost" id="pp-del">删除</button>' +
      '<button type="button" class="ghost" id="pp-close">收起</button></div>' +
      '<div class="pp-type"><label>类型</label><select id="pp-vt">' +
      [['live_dorsal','活体·背面'],['live_frontal','活体·正面'],['live_lateral','活体·侧面'],['behavior','行为'],['habitat','生境'],['specimen_dorsal','标本·背面'],['specimen_ventral','标本·腹面'],['male_palp','雄性触肢器'],['epigyne','外雌器'],['vulva','阴门'],['microscopy','镜检'],['other','其他']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (window.__photoMeta[pid] && window.__photoMeta[pid].view_type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></div>';
    var cap = panel.querySelector('#pp-caption'), ph = panel.querySelector('#pp-photographer');
    cap.value = window.__photoMeta[pid] ? (window.__photoMeta[pid].caption || '') : '';
    ph.value = window.__photoMeta[pid] ? (window.__photoMeta[pid].photographer_name || '') : '';
    cap.addEventListener('change', function () { patchMedia(pid, { caption: cap.value }); });
    ph.addEventListener('change', function () { patchMedia(pid, { photographer_name: ph.value }); });
    var vt = panel.querySelector('#pp-vt');
    if (vt) {
      if (window.__photoMeta[pid] && window.__photoMeta[pid].view_type) vt.value = window.__photoMeta[pid].view_type;
      vt.addEventListener('change', function () { patchMedia(pid, { view_type: vt.value }); });
    }
    panel.querySelector('#pp-cover').addEventListener('click', function () {
      var rest = photos.filter(function (x) { return x !== pid; });
      photos = [pid].concat(rest);
      rerenderGrid();
      pushOrder();
      openPanel(pid);
    });
    panel.querySelector('#pp-del').addEventListener('click', function () {
      fetch('/studio/api/media/' + pid, { method: 'DELETE' }).then(function (r) {
        if (r.ok) {
          photos = photos.filter(function (x) { return x !== pid; });
          delete window.__photoMeta[pid];
          lastPublishedSnapshot = null; // 删照片视为发布后修改
          rerenderGrid();
          panel.hidden = true;
          setStatus('已删除 ' + pid);
        }
      });
    });
    panel.querySelector('#pp-close').addEventListener('click', function () { panel.hidden = true; });
  }
  function patchMedia(pid, body) {
    return fetch('/studio/api/media/' + pid, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (r) { if (r.ok) setStatus('已保存'); });
  }
  window.__photoMeta = {};
  // 从服务端渲染的缩略图初始化元信息（boot 注入）
  (boot.photoMeta || []).forEach(function (m) { window.__photoMeta[m.public_id] = m; });
  if (photos.length) bindGrid();

  function handleFiles(fileList) {
    var all = Array.prototype.slice.call(fileList || []);
    var files = all.filter(function (f) { return /image\\/(jpeg|png)/.test(f.type); });
    // 被类型过滤掉的照片必须可见（iPhone HEIC 默认不被接受——这就是「点了没反应」的常见来源）
    if (all.length && !files.length) {
      showPhotoErr('所选照片都不是 JPG/PNG（iPhone 相机默认 HEIC 不受支持，可在相机设置改为「兼容性最佳」）。');
      return;
    }
    if (!files.length) return;
    clearPhotoErr();
    if (addBtn) addBtn.disabled = true;
    dropBig.style.pointerEvents = 'none';
    var ensure = publicId ? Promise.resolve(publicId) : create();
    ensure.then(function (pid) {
      if (!pid) { setStatus('创建记录失败', true); return; }
      var first = files[0];
      var fd0 = new FormData();
      fd0.append('photo', first);
      setStatus('读取照片信息…');
      return window.__sfnFetch('/studio/api/exif-preview', { method: 'POST', body: fd0 }, 30000)
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (xj) {
          var x = xj.results && xj.results[0];
          if (!x) return;
          // §14：EXIF 不静默覆盖——给出「使用 / 忽略」建议条
          var bar = $('#exif-suggest');
          if (!bar) return;
          var chips = [];
          var dateEl = document.querySelector('[data-field="observed_at"]');
          if (x.date) chips.push({ key: 'date', text: '拍摄时间 ' + x.date, apply: function () { if (dateEl) { dateEl.value = x.date; scheduleSave(); } } });
          if (x.gps) chips.push({ key: 'gps', text: '坐标 ' + x.gps.lat + ', ' + x.gps.lng, apply: function () { latEl.value = x.gps.lat; lngEl.value = x.gps.lng; scheduleSave(); matchAddress(x.gps.lat, x.gps.lng); } });
          if (!chips.length) return;
          bar.hidden = false;
          bar.innerHTML = '<span>从照片读取到：</span>' + chips.map(function (c, i) {
            return '<span>' + escHtml(c.text) + '</span><button type="button" class="use" data-i="' + i + '">使用</button>';
          }).join('') + '<button type="button" data-dismiss="1">忽略</button>';
          Array.prototype.slice.call(bar.querySelectorAll('button')).forEach(function (btn) {
            btn.addEventListener('click', function () {
              var i2 = btn.getAttribute('data-i');
              if (i2 != null) chips[+i2].apply();
              bar.hidden = true;
            });
          });
          var cam = $('#exif-cam');
          if (cam && x.camera) cam.textContent = '相机：' + x.camera;
        })
        .catch(function () {})
        .then(async function () {
          var added = [], failed = 0;
          for (var i = 0; i < files.length; i++) {
            var prepared;
            try { prepared = await window.__sfnPrepareUpload(files[i]); }
            catch (err) { showPhotoErr(err.message || '图片处理失败'); failed++; continue; }
            var fd = new FormData();
            window.__sfnAppendUpload(fd, prepared);
            setStatus('上传照片 ' + (i + 1) + '/' + files.length + '…');
            try {
              var r = await window.__sfnFetch('/studio/observations/' + pid + '/photos', { method: 'POST', body: fd });
              var j = await r.json().catch(function () { return {}; });
              if (r.status === 401) { showPhotoErr('登录已过期，请刷新页面重新登录'); failed++; break; }
              if (!r.ok || !j.ok) { showPhotoErr('照片上传失败：' + ((j && j.error) || '请重试')); failed++; continue; }
              (j.added || []).forEach(function (pid2) {
                added.push(pid2);
                photos.push(pid2);
                window.__photoMeta[pid2] = { caption: '', photographer_name: '', view_type: 'other' };
                rerenderGrid();
              });
            } catch (e2) {
              showPhotoErr(e2 && e2.name === 'AbortError' ? '上传超时，请检查网络后重试' : '上传失败，请检查网络后重试');
              failed++;
            }
          }
          if (added.length) {
            lastPublishedSnapshot = null; // 新照片视为发布后修改
            lsClear();
            setStatus('已添加 ' + added.length + ' 张照片' + (failed ? '，' + failed + ' 张失败' : ''));
            await saveNow(true);
          } else if (!failed) {
            setStatus('没有照片被添加', true);
          }
        });
    }).catch(function (e) {
      showPhotoErr(e && e.message ? e.message : '上传未能开始，请重试');
    }).finally(function () {
      if (addBtn) addBtn.disabled = false;
      dropBig.style.pointerEvents = '';
    });
  }
  [$('[data-field="observed_at"]')].forEach(function (el) {
    el.addEventListener('input', function () { el.dataset.touched = '1'; });
  });

  // ---- 发布 / 保存 / 快捷键（发布 = 立即公开上线） ----
  $('#btn-savedraft').addEventListener('click', function () {
    // published：仅保存内容并同步主站；private/archived：保存但保持不公开
    saveNow(true, isPublished()).then(function () {
      if (isPublished() && !offline) return fetch('/studio/api/sync', { method: 'POST' }).then(readJson).then(function (j) {
        if (j && j.ok) setStatus('已保存 · 主站已更新');
        return null;
      }).catch(function () { return null; });
      return null;
    }).then(function () { location.href = '/studio'; });
  });
  $('#btn-publish').addEventListener('click', function () {
    var btn = $('#btn-publish');
    btn.disabled = true;
    // 已归档：恢复为草稿（§20，不直接公开）
    if (status === 'archived') {
      postAction('restore').then(function () { updateActions(); });
      return;
    }
    var publishing = status !== 'published'; // draft/private → 发布上线；published → 保存修改
    setStatus(publishing ? '正在检查…（含 WSC 学名校验）' : '正在保存…');
    saveNow(true, !publishing).then(function () {
      if (!publicId) { btn.disabled = false; setStatus('保存失败，无法发布', true); return; }
      if (publishing) {
        return fetch('/studio/api/observations/' + publicId + '/publish', { method: 'POST' }).then(readJson).then(function (j) {
          if (j && j.ok && j.warnings && j.warnings.length) {
            // WSC 建议（不阻塞发布）：醒目展示
            setStatus(j.warnings[0], true);
            if (j.warnings.length > 1) alert(j.warnings.join('；'));
          }
          return j;
        });
      }
      // 保存修改：显式保存已在 PATCH 中带 explicit，服务端负责审计与同步
      return fetch('/studio/api/observations/' + publicId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ explicit: true }),
      }).then(readJson).then(function (j) {
        btn.disabled = false;
        if (j && j.ok && j.sync === 'queued') setStatus('已保存 · 主站更新中');
        else if (j && j.ok) setStatus('已保存 ' + (j.saved_at || ''));
        else setStatus('保存失败：' + ((j && j.error) || ''), true);
        updateActions();
        return null;
      });
    }).then(function (j) {
      if (!j) return; // 保存失败/保存修改分支已处理
      btn.disabled = false;
      if (j && j.ok) {
        status = 'published';
        lastPublishedSnapshot = snapshotNow();
        updateActions();
        lsClear();
        // 发布闭环（§35）：全屏成功面板
        var done = $('#publish-done');
        if (done) {
          var siteBase = location.origin.indexOf('studio.') !== -1 ? 'https://salticidnotes.cn' : '';
          var pubLink = done.querySelector('.pd-actions a.primary');
          if (pubLink) pubLink.href = siteBase + (j.public_url || ('/observations/' + publicId + '/'));
          var warn = $('#pd-warn');
          if (warn && j.warnings && j.warnings.length) {
            warn.hidden = false;
            warn.textContent = 'WSC 提示：' + j.warnings.join(' ');
          }
          done.hidden = false;
          $('#pd-continue').addEventListener('click', function () { done.hidden = true; });
          window.scrollTo(0, 0);
        } else {
          setStatus('已发布 ✓', false, true);
        }
      } else {
        setStatus('无法发布：' + ((j && j.error) || '请检查照片、时间与坐标'), true);
      }
    }).catch(function () {
      btn.disabled = false;
      setStatus('发布失败（网络），请重试', true);
    });
  });
  // 次级菜单：设为私密 / 归档（仅 published 出现 ⋯）
  var moreBtn = $('#btn-more'), menu = $('#status-menu');
  if (moreBtn && menu) {
    moreBtn.addEventListener('click', function () { menu.hidden = !menu.hidden; });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== moreBtn) menu.hidden = true;
    });
    Array.prototype.slice.call(menu.querySelectorAll('button')).forEach(function (b) {
      b.addEventListener('click', function () { b.disabled = true; postAction(b.getAttribute('data-act')); });
    });
  }
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('#btn-publish').click();
  });
})();
`;

// ==================== 札记编辑器 ====================

const NOTE_EDITOR_JS = `
(function () {
  function $(s) { return document.querySelector(s); }
  var statusEl = $('#save-status'), barStatus = $('#bar-status');
  var title = $('#n-title'), sub = $('#n-subtitle'), body = $('#n-body');
  var slugEl = $('#n-slug');
  var slug = slugEl.value || null;
  var published = (window.__NOTE_BOOT && window.__NOTE_BOOT.status) === 'published';
  var LS_KEY = 'sfn-note-' + (slug || 'new');
  var timer = null, saving = false, previewing = false, dirty = false;
  var saveChain = Promise.resolve(), saveQueued = false;

  function readJson(r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { return { ok: false, error: '服务异常（' + r.status + '）' }; }
    });
  }

  function setStatus(html, err) {
    if (statusEl) { statusEl.innerHTML = html; statusEl.className = err ? 'err' : ''; }
    if (barStatus) { barStatus.innerHTML = html; barStatus.style.color = err ? 'var(--terra)' : 'var(--faint)'; }
  }
  function setPubBtn() {
    var btn = $('#btn-publish-note');
    if (published && !dirty) { btn.textContent = '已发布 ✓'; btn.disabled = true; }
    else { btn.textContent = published ? '保存修改' : '发布'; btn.disabled = false; }
  }
  function payload() { return { title: title.value, subtitle: sub.value, body_md: body.value }; }
  // 发布时刻的内容快照：之后的保存若与快照一致，不再误报「有未发布修改」
  var lastPublishedSnapshot = null;
  function snapshotNow() {
    var p = payload();
    p.related_observation_public_ids = ($('#n-related') && $('#n-related').value) || '';
    return JSON.stringify(p);
  }
  function lsSave() { try { localStorage.setItem(LS_KEY, JSON.stringify(payload())); } catch (e) {} }
  function lsClear() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }

  function create() {
    return fetch('/studio/api/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.slug) {
          slug = j.slug;
          slugEl.value = slug;
          history.replaceState(null, '', '/studio/notes/' + slug + '/edit');
        }
        return slug;
      });
  }
  function saveNow(silent, explicit) {
    if (saving) { saveQueued = true; return saveChain; } // 已有保存 in-flight：登记尾随保存，避免发布与保存竞态
    saving = true;
    var ensure = slug ? Promise.resolve(slug) : create();
    saveChain = ensure.then(function (s) {
      if (!s) { setStatus('创建失败', true); saving = false; return; }
      var p = payload();
      p.related_observation_public_ids = ($('#n-related') && $('#n-related').value) || '';
      if (explicit) p.explicit = true;
      var snap = JSON.stringify(p);
      return fetch('/studio/api/notes/' + s, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
      })
        .then(readJson)
        .then(function (j) {
          if (j.ok) {
            if (published && snap !== lastPublishedSnapshot) { dirty = true; setStatus('已保存 · 主站未同步，点「保存修改」更新'); }
            else if (!published) setStatus('已保存 ' + (j.saved_at || ''));
            lsClear();
          } else setStatus('保存失败：' + (j.error || ''), true);
          setPubBtn();
        })
        .catch(function () { setStatus('暂时离线，内容留在本机', true); });
    }).then(function () {
      saving = false;
      if (saveQueued) { saveQueued = false; return saveNow(silent); }
    });
    return saveChain;
  }
  function schedule() {
    dirty = true;
    if (published) setStatus('有未发布修改');
    else setStatus('正在保存…');
    setPubBtn();
    lsSave();
    clearTimeout(timer);
    timer = setTimeout(function () { saveNow(true); }, 1400);
  }
  [title, sub, body].forEach(function (el) { el.addEventListener('input', schedule); });
  var relInput = $('#n-related');
  if (relInput) relInput.addEventListener('change', schedule);
  setPubBtn();

  // ---- 块菜单（＋ / /） ----
  var fab = $('#fab-add'), menu = $('#block-menu');
  function toggleMenu(force) {
    var open = force !== undefined ? force : !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    if (open) {
      var firstBtn = menu.querySelector('button');
      if (firstBtn) firstBtn.focus();
    }
  }
  fab.addEventListener('click', function () { toggleMenu(); });
  document.addEventListener('click', function (e) {
    if (!menu.contains(e.target) && e.target !== fab) toggleMenu(false);
  });
  function insertBlock(text) {
    var at = body.selectionStart;
    var before = body.value.slice(0, at), after = body.value.slice(body.selectionEnd);
    var pad = before && !before.endsWith('\\n\\n') ? (before.endsWith('\\n') ? '\\n' : '\\n\\n') : '';
    var ins = pad + text + '\\n\\n';
    body.value = before + ins + after;
    var pos = (before + ins).length;
    body.focus();
    body.selectionStart = body.selectionEnd = pos;
    schedule();
    if (text === '__IMAGE__') insertImage();
    if (text === '__OBS__') insertAsk('观察编号（如 SFN-2026-000001）', 'observation');
    if (text === '__TRIP__') insertAsk('调查 slug（见公开站 /trips/…）', 'trip');
  }
  function insertAsk(promptText, kind) {
    var v = window.prompt(promptText, '');
    if (!v || !v.trim()) return;
    var tag = '{{' + kind + ':' + v.trim() + '}}\\n\\n';
    var at = body.selectionStart;
    body.value = body.value.slice(0, at) + tag + body.value.slice(at);
    schedule();
  }
  function insertImage() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png';
    inp.addEventListener('change', function () {
      var f = inp.files[0];
      if (!f) return;
      setStatus('正在处理图片…');
      window.__sfnPrepareUpload(f).then(function (prepared) {
        var fd = new FormData();
        window.__sfnAppendUpload(fd, prepared);
        return window.__sfnFetch('/studio/api/media/upload', { method: 'POST', body: fd }).then(function (r) { return r.json(); });
      }).then(function (j) {
        if (!j.ok) { setStatus(j.error ? '图片上传失败：' + j.error : '图片上传失败', true); return; }
        var cap = window.prompt('图注（可留空）', '') || '';
        var ref = '\\n![' + cap + '](media:' + j.public_id + ')\\n\\n';
        body.value += ref;
        setStatus('已插入 ' + j.public_id);
        schedule();
      }).catch(function () { setStatus('图片上传失败', true); });
    });
    inp.click();
  }
  Array.prototype.slice.call(menu.querySelectorAll('button')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      toggleMenu(false);
      var ins = btn.getAttribute('data-ins');
      // 哨兵项直接唤起对应流程，不把字面量插进正文
      if (ins === '__IMAGE__') { insertImage(); return; }
      if (ins === '__OBS__') { insertAsk('观察编号（如 SFN-2026-000001）', 'observation'); return; }
      if (ins === '__TRIP__') { insertAsk('调查 slug（见公开站 /trips/…）', 'trip'); return; }
      insertBlock(ins.replace(/&gt;/g, '>'));
    });
  });
  // 行首 "/" 呼出
  body.addEventListener('input', function () {
    var upto = body.value.slice(0, body.selectionStart);
    if (/(^|\\n)\\/$/.test(upto)) {
      body.value = body.value.slice(0, body.selectionStart - 1) + body.value.slice(body.selectionStart);
      toggleMenu(true);
    }
  });

  // ---- 格式工具栏：不懂 markdown 也能排版 ----
  var nbt = $('#nb-toolbar');
  function surround(before, after, placeholder) {
    var s = body.selectionStart, e = body.selectionEnd;
    var sel = body.value.slice(s, e) || placeholder;
    body.value = body.value.slice(0, s) + before + sel + after + body.value.slice(e);
    body.focus();
    body.selectionStart = s + before.length;
    body.selectionEnd = s + before.length + sel.length;
    schedule(); schedulePreview();
  }
  function prefixLines(prefix) {
    var s = body.selectionStart, e = body.selectionEnd;
    var NL = String.fromCharCode(10);
    var start = body.value.lastIndexOf(NL, s - 1) + 1;
    var end = body.value.indexOf(NL, e); if (end < 0) end = body.value.length;
    var lines = body.value.slice(start, end).split(NL);
    var all = lines.length && lines.every(function (l) { return l.startsWith(prefix); });
    var out = lines.map(function (l) { return all ? l.slice(prefix.length) : prefix + l; }).join(NL);
    body.value = body.value.slice(0, start) + out + body.value.slice(end);
    body.focus();
    body.selectionStart = start; body.selectionEnd = start + out.length;
    schedule(); schedulePreview();
  }
  if (nbt) {
    nbt.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cmd]');
      if (!b) return;
      e.preventDefault();
      var c = b.getAttribute('data-cmd');
      if (c === 'h2') prefixLines('## ');
      else if (c === 'h3') prefixLines('### ');
      else if (c === 'quote') prefixLines('> ');
      else if (c === 'ul') prefixLines('- ');
      else if (c === 'bold') surround('**', '**', '加粗文字');
      else if (c === 'hr') insertBlock('---');
      else if (c === 'image') insertBlock('__IMAGE__');
      else if (c === 'obs') insertBlock('__OBS__');
    });
  }

  // ---- 编辑 ⇄ 预览（宽屏左写右排 · 边写边排版）----
  var paneEdit = $('#pane-edit'), panePrev = $('#pane-preview');
  var pvTitle = panePrev.querySelector('.pv-title'), pvSub = panePrev.querySelector('.pv-sub'), pvBody = panePrev.querySelector('.pv-body');
  var seg = $('#note-seg');
  var splitQuery = window.matchMedia('(min-width:1100px)');
  var previewTimer = null, previewSeq = 0;

  function renderPreview() {
    var seq = ++previewSeq;
    return fetch('/studio/api/notes/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body_md: body.value }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (seq !== previewSeq) return; // 过期响应丢弃
        pvTitle.textContent = title.value || '（无标题）';
        pvSub.textContent = sub.value || '';
        pvSub.style.display = sub.value ? '' : 'none';
        pvBody.innerHTML = j.html || '<p style="color:var(--faint)">（正文为空）</p>';
      })
      .catch(function () { setStatus('预览生成失败（网络）', true); });
  }
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 450);
  }
  // 输入即排版（防抖 450ms）
  body.addEventListener('input', schedulePreview);
  title.addEventListener('input', schedulePreview);
  sub.addEventListener('input', schedulePreview);
  // 滚动同步：编辑栏滚动比例映射到排版栏
  body.addEventListener('scroll', function () {
    if (!splitQuery.matches) return;
    var max = body.scrollHeight - body.clientHeight;
    if (max <= 0) return;
    panePrev.scrollTop = (panePrev.scrollHeight - panePrev.clientHeight) * (body.scrollTop / max);
  });

  function setView(v) {
    Array.prototype.slice.call(seg.querySelectorAll('button')).forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === v);
    });
    if (splitQuery.matches) {
      // 宽屏分栏：双栏常驻，切换器不可见，永远不隐藏编辑栏
      paneEdit.hidden = false;
      panePrev.hidden = false;
      fab.style.display = 'none';
      renderPreview();
      previewing = true;
      return;
    }
    if (v === 'preview') {
      setStatus('正在生成预览…');
      renderPreview().then(function () {
        paneEdit.hidden = true;
        panePrev.hidden = false;
        fab.style.display = 'none';
        setStatus('预览 · 由 Article Engine 自动排版');
        window.scrollTo(0, 0);
      });
      previewing = true;
    } else {
      previewing = false;
      panePrev.hidden = true;
      paneEdit.hidden = false;
      fab.style.display = '';
    }
  }
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  Array.prototype.slice.call(seg.querySelectorAll('button')).forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });
  $('#btn-preview2').addEventListener('click', function () {
    setView(previewing ? 'edit' : 'preview');
  });
  // 初始与宽度跨越时同步视图
  splitQuery.addEventListener('change', function () { setView(splitQuery.matches ? 'preview' : 'edit'); });
  if (splitQuery.matches) { panePrev.hidden = false; fab.style.display = 'none'; renderPreview(); previewing = true; }

  // ---- 设置抽屉 ----
  $('#btn-settings').addEventListener('click', function () { document.body.classList.add('drawer-open'); });
  $('#drawer-mask').addEventListener('click', function () { document.body.classList.remove('drawer-open'); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { document.body.classList.remove('drawer-open'); toggleMenu(false); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('#btn-publish-note').click();
  });

  // ---- 右栏（§8）：分节状态 ✓ + 按钮联动 + Ctrl+S ----
  var railNav = $('#rail-nav'), railPub = $('#rail-publish'), railDraft = $('#rail-savedraft');
  function updateRail() {
    if (!railNav) return;
    var done = {
      photos: photos.length > 0,
      time: !!$('[data-field="observed_at"]').value && !!latEl.value && !!lngEl.value,
      id: !!window.__chosenSlug,
      note: !!$('[data-field="field_note"]').value,
    };
    Array.prototype.slice.call(railNav.querySelectorAll('a')).forEach(function (a) {
      a.classList.toggle('done', !!done[a.getAttribute('data-sec')]);
    });
  }
  // 在既有 scheduleSave 之上挂一个轻量钩子：每次输入后刷新 ✓
  $all('[data-field]').forEach(function (el) {
    el.addEventListener('input', function () { setTimeout(updateRail, 0); });
  });
  if (railNav) {
    railNav.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      var t = document.querySelector(a.getAttribute('href'));
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  function railClick(action) {
    var map = { savedraft: $('#btn-savedraft'), publish: $('#btn-publish') };
    var target = map[action];
    if (target) target.click();
  }
  // 已发布记录：右栏主按钮文案跟随「保存修改」（§37）
  if (railPub && status === 'published') railPub.textContent = '保存修改';
  if (railPub && status === 'archived') railPub.textContent = '恢复为草稿';
  if (railDraft) railDraft.addEventListener('click', function () { railClick('savedraft'); });
  if (railPub) railPub.addEventListener('click', function () { railClick('publish'); });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); $('#btn-savedraft').click(); }
  });
  updateRail();

  // ---- 发布 ----
  $('#btn-publish-note').addEventListener('click', function () {
    var btn = $('#btn-publish-note');
    btn.disabled = true;
    if (published) {
      // 保存修改：显式保存已发布札记并同步主站（§6/§29）
      setStatus('正在保存…');
      saveNow(true, true).then(function () {
        return fetch('/studio/api/sync', { method: 'POST' }).then(readJson).catch(function () { return { ok: false, detail: '网络异常' }; });
      }).then(function (r) {
        btn.disabled = false;
        if (r && r.ok) { dirty = false; setPubBtn(); setStatus('已保存 · 主站更新中'); }
        else setStatus('主站同步失败：' + ((r && r.detail) || '请用工作台「同步到公开站」重试'), true);
      });
      return;
    }
    setStatus('正在发布…');
    saveNow(true).then(function () {
      if (!slug) { btn.disabled = false; setStatus('保存失败，无法发布', true); return; }
      return fetch('/studio/api/notes/' + slug + '/publish', { method: 'POST' }).then(readJson);
    }).then(function (j) {
      if (!j) return; // 保存失败分支已处理
      btn.disabled = false;
      if (j && j.ok) {
        published = true; dirty = false;
        lastPublishedSnapshot = snapshotNow();
        setPubBtn();
        var syncNote = j.sync === 'queued' ? ' · 公开站自动同步中' : '';
        setStatus('已发布 ✓ <a href="' + escHtml(j.public_url || '') + '" target="_blank" rel="noopener">查看 →</a>' + syncNote);
        lsClear();
      } else setStatus('无法发布：' + ((j && j.error) || ''), true);
    }).catch(function () { btn.disabled = false; setStatus('发布失败（网络），请重试', true); });
  });
})();
`;

// ==================== 个人资料 ====================

export const PROFILE_SCRIPT = UPLOAD_LIB + `
(function () {
  function $(s) { return document.querySelector(s); }
  function readJson(r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { return { ok: false, error: '服务异常' }; }
    });
  }
  function setStatus(s, isErr) {
    var el = $('#profile-status');
    if (el) { el.textContent = s; el.style.color = isErr ? 'var(--terra)' : 'var(--faint)'; }
  }
  var photoPublicId = null;
  var slot = $('#photo-slot');

  slot.addEventListener('click', function () {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png';
    inp.addEventListener('change', function () {
      var f = inp.files[0];
      if (!f) return;
      setStatus('正在处理照片…');
      window.__sfnPrepareUpload(f).then(function (prepared) {
        var fd = new FormData();
        window.__sfnAppendUpload(fd, prepared);
        return window.__sfnFetch('/studio/api/media/upload', { method: 'POST', body: fd }).then(readJson);
      }).then(function (j) {
        if (!j || !j.ok) { setStatus(j && j.error ? '照片上传失败：' + j.error : '照片上传失败', true); return; }
        photoPublicId = j.public_id;
        slot.innerHTML = '<img src="/media/derivatives/' + j.public_id + '-480.jpg" alt="" />';
        slot.removeAttribute('data-empty');
        setStatus('照片已上传 · 记得点「保存资料」');
      }).catch(function () { setStatus('照片处理失败', true); });
    });
    inp.click();
  });

  $('#btn-save-profile').addEventListener('click', function () {
    var btn = $('#btn-save-profile');
    var name = $('#p-name').value.trim();
    if (!name) { setStatus('公开名称不能为空', true); return; }
    btn.disabled = true;
    setStatus('正在保存…');
    fetch('/studio/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: name, title: $('#p-title').value, bio: $('#p-bio').value, photo_public_id: photoPublicId }),
    })
      .then(readJson)
      .then(function (j) {
        btn.disabled = false;
        if (j && j.ok) setStatus('已保存 · 主站伙伴页更新中（约 1-2 分钟）');
        else setStatus('保存失败：' + ((j && j.error) || ''), true);
      })
      .catch(function () { btn.disabled = false; setStatus('网络异常，请重试', true); });
  });
})();
`;

export const LOGIN_SCRIPT = LOGIN_JS;
export const OBS_EDITOR_SCRIPT = UPLOAD_LIB + OBS_EDITOR_JS;
export const NOTE_EDITOR_SCRIPT = UPLOAD_LIB + NOTE_EDITOR_JS;
