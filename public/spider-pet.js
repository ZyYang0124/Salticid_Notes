// 小跳蛛页宠（参考「果蝇乐园」桌宠概念）：一只跳蛛在页面底部散步、
// 好奇地看鼠标、可以撸。自包含，无依赖；尊重 prefers-reduced-motion。
// 不影响布局与内容：position: fixed，仅蜘蛛本体响应指针。
(function () {
  if (window.__sfnPet) return;
  window.__sfnPet = true;

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var css = [
    '.sfn-pet{position:fixed;bottom:0;left:0;right:0;height:64px;z-index:210;pointer-events:none;}',
    '.sfn-pet *{pointer-events:none;}',
    '.sfn-pet .pet-body{position:absolute;bottom:6px;width:46px;height:38px;cursor:pointer;pointer-events:auto;transition:opacity .6s ease;opacity:0;}',
    '.sfn-pet.awake .pet-body{opacity:1;}',
    '.sfn-pet .pet-svg{width:100%;height:100%;overflow:visible;display:block;}',
    '.sfn-pet .leg{transform-origin:23px 22px;}',
    '.sfn-pet.walking .leg.l1{animation:pet-leg-a .42s ease-in-out infinite;}',
    '.sfn-pet.walking .leg.r1{animation:pet-leg-b .42s ease-in-out infinite;}',
    '.sfn-pet.walking .leg.l2{animation:pet-leg-b .42s ease-in-out infinite .12s;}',
    '.sfn-pet.walking .leg.r2{animation:pet-leg-a .42s ease-in-out infinite .12s;}',
    '.sfn-pet.walking .leg.l3{animation:pet-leg-a .42s ease-in-out infinite .06s;}',
    '.sfn-pet.walking .leg.r3{animation:pet-leg-b .42s ease-in-out infinite .06s;}',
    '.sfn-pet.walking .leg.l4{animation:pet-leg-b .42s ease-in-out infinite .18s;}',
    '.sfn-pet.walking .leg.r4{animation:pet-leg-a .42s ease-in-out infinite .18s;}',
    '@keyframes pet-leg-a{0%,100%{transform:rotate(0deg);}50%{transform:rotate(-16deg);}}',
    '@keyframes pet-leg-b{0%,100%{transform:rotate(0deg);}50%{transform:rotate(14deg);}}',
    '.sfn-pet .pupils{transition:transform .18s ease;}',
    '.sfn-pet .pet-body.hop{animation:pet-hop .5s cubic-bezier(.22,1,.36,1);}',
    '@keyframes pet-hop{0%{transform:translateY(0) scaleX(var(--flip,1));}38%{transform:translateY(-14px) scaleX(var(--flip,1));}70%{transform:translateY(0) scaleX(var(--flip,1));}84%{transform:translateY(-3px) scaleX(var(--flip,1));}100%{transform:translateY(0) scaleX(var(--flip,1));}}',
    '.sfn-pet .heart{position:absolute;font-size:13px;color:#b5402c;pointer-events:none;animation:pet-heart 1s ease-out forwards;}',
    '@keyframes pet-heart{0%{opacity:0;transform:translateY(0) scale(.6);}25%{opacity:1;}100%{opacity:0;transform:translateY(-30px) scale(1.15);}}',
    '.sfn-pet .bubble{position:absolute;bottom:52px;white-space:nowrap;background:#fff;border:1px solid #e2dac8;border-radius:10px;border-bottom-left-radius:2px;padding:6px 12px;font-size:12px;color:#6f675c;box-shadow:0 4px 14px rgba(38,34,28,.12);opacity:0;transform:translateY(4px);transition:opacity .25s ease,transform .25s ease;pointer-events:none;}',
    '.sfn-pet .bubble.show{opacity:1;transform:translateY(0);}',
    '@media (prefers-reduced-motion: reduce){',
    '  .sfn-pet.walking .leg{animation:none;}',
    '  .sfn-pet .pet-body.hop{animation:none;}',
    '  .sfn-pet .pet-body{transition:none;}',
    '}'
  ].join('\n');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---- SVG 跳蛛（俯视 Q 版）：前 2 对大眼 + 4 对腿（每条腿独立分组，可做步行摆动） ----
  var BS = '#3a332a';
  function leg(cls, pts) {
    return '<g class="leg ' + cls + '"><polyline points="' + pts + '" fill="none" stroke="' + BS + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>';
  }
  var svg =
    '<svg class="pet-svg" viewBox="0 0 46 46" aria-hidden="true">' +
    '<g class="legs">' +
    leg('l1', '17,18 8,12 3,4') +
    leg('l2', '15,22 5,20 0,14') +
    leg('l3', '15,26 5,28 0,34') +
    leg('l4', '17,29 8,34 4,42') +
    leg('r1', '29,18 38,12 43,4') +
    leg('r2', '31,22 41,20 46,14') +
    leg('r3', '31,26 41,28 46,34') +
    leg('r4', '29,29 38,34 42,42') +
    '</g>' +
    '<ellipse cx="23" cy="30" rx="9.5" ry="11" fill="#4a4234"/>' +
    '<ellipse cx="23" cy="31" rx="5.5" ry="7" fill="#5c5240"/>' +
    '<circle cx="23" cy="18" r="8.5" fill="' + BS + '"/>' +
    '<circle cx="19.4" cy="15.4" r="4" fill="#14110c"/>' +
    '<circle cx="26.6" cy="15.4" r="4" fill="#14110c"/>' +
    '<g class="pupils">' +
    '<circle cx="19.4" cy="14.6" r="1.7" fill="#fff" opacity=".92"/>' +
    '<circle cx="26.6" cy="14.6" r="1.7" fill="#fff" opacity=".92"/>' +
    '</g>' +
    '<circle cx="15.6" cy="17.6" r="1.4" fill="#14110c"/>' +
    '<circle cx="30.4" cy="17.6" r="1.4" fill="#14110c"/>' +
    '<rect x="21.2" y="22" width="1.6" height="3.4" rx=".8" fill="#2a251d"/>' +
    '<rect x="23.2" y="22" width="1.6" height="3.4" rx=".8" fill="#2a251d"/>' +
    '</svg>';

  var root = document.createElement('div');
  root.className = 'sfn-pet awake';
  root.setAttribute('aria-hidden', 'true');
  var body = document.createElement('div');
  body.className = 'pet-body';
  body.title = '一只常驻跳蛛（点它一下）';
  body.innerHTML = svg;
  var bubble = document.createElement('div');
  bubble.className = 'bubble';
  body.appendChild(bubble);
  root.appendChild(body);
  document.body.appendChild(root);

  if (reduced) return; // 静态降级：显示但不活动

  // ---- 状态机：idle（张望）/ walk（散步）/ curious（看鼠标 + 小跳）----
  var x = Math.max(8, window.innerWidth * 0.72);
  var dir = -1;
  var mode = 'idle';
  var until = Date.now() + 2200;
  var SPEED = 28; // px/s
  var walking = false;
  var pets = parseInt(localStorage.getItem('sfn-pet-pets') || '0', 10) || 0;

  var LINES = [
    '嗨，我是本站常驻跳蛛。',
    '盯着你看很久了。',
    '别怕，我只扑蚊子。',
    '今天也替你盯梢。',
    '撸够了，去看观察吧。',
    '我跳一次，记一次观察。'
  ];

  function place() {
    body.style.left = x + 'px';
    root.style.setProperty('--flip', dir === 1 ? '1' : '-1');
    body.style.transform = 'scaleX(var(--flip,1))';
  }
  function setWalking(on) {
    if (on === walking) return;
    walking = on;
    root.classList.toggle('walking', on);
  }
  function say(text, ms) {
    bubble.textContent = text;
    bubble.classList.add('show');
    setTimeout(function () { bubble.classList.remove('show'); }, ms || 2600);
  }
  function hop() {
    body.classList.remove('hop');
    void body.offsetWidth;
    body.classList.add('hop');
  }
  function spawnHeart() {
    var h = document.createElement('span');
    h.className = 'heart';
    h.textContent = '♥';
    h.style.left = (x + 12 + Math.random() * 18) + 'px';
    h.style.bottom = (28 + Math.random() * 12) + 'px';
    root.appendChild(h);
    setTimeout(function () { h.remove(); }, 1100);
  }

  // 眼珠追鼠标：靠近才追，返回是否进入好奇范围
  var mouseX = -9999, mouseY = -9999;
  document.addEventListener('mousemove', function (e) { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });
  function lookAtMouse() {
    var r = body.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + 14;
    var dx = mouseX - cx, dy = mouseY - cy;
    var d = Math.sqrt(dx * dx + dy * dy);
    var g = root.querySelector('.pupils');
    if (d < 300) {
      var k = Math.min(1, d / 60);
      if (g) g.style.transform = 'translate(' + (d ? (dx / d) * 2 * k : 0).toFixed(1) + 'px,' + (d ? (dy / d) * 1.4 * k : 0).toFixed(1) + 'px)';
    }
    return d;
  }

  function tick() {
    if (!document.hidden) {
      var now = Date.now();
      var d = lookAtMouse();

      if (d < 110 && mode !== 'curious') {
        mode = 'curious';
        until = now + 1400;
        setWalking(false);
        hop();
        if (Math.random() < 0.2) say('发现猎物……哦不对，是读者。');
      }
      if (mode === 'curious' && now > until) mode = 'idle';

      if (mode === 'walk') {
        x += dir * SPEED / 60;
        if (x < 8) { x = 8; dir = 1; }
        if (x > window.innerWidth - 54) { x = window.innerWidth - 54; dir = -1; }
        setWalking(true);
        if (now > until) { mode = 'idle'; until = now + 1800 + Math.random() * 2800; setWalking(false); }
      } else if (mode === 'idle' && now > until) {
        mode = 'walk';
        until = now + 1400 + Math.random() * 2600;
        if (Math.random() < 0.5) dir = -dir;
      }
      place();
    } else {
      setWalking(false);
    }
    requestAnimationFrame(tick);
  }
  place();
  requestAnimationFrame(tick);

  // ---- 撸 ----
  body.addEventListener('click', function (e) {
    e.stopPropagation();
    pets += 1;
    localStorage.setItem('sfn-pet-pets', String(pets));
    hop();
    spawnHeart();
    if (pets === 1) say('好啦好啦，第一次被撸。');
    else if (pets === 10) say('十连撸！你是认真的吗。');
    else if (pets === 42) say('42。这是终极答案。');
    else if (pets === 100) say('一百次……授予你「本站最闲读者」称号。');
    else if (Math.random() < 0.3) say(LINES[Math.floor(Math.random() * LINES.length)]);
  });
})();
