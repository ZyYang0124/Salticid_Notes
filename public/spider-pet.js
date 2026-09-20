// 小跳蛛页宠（参考「果蝇乐园」桌宠概念）：本体用站标手绘跳蛛（logo-mark.png）。
// 在页面底部散步、好奇地看鼠标、可以撸。自包含，无依赖；尊重 prefers-reduced-motion。
// 不影响布局与内容：position: fixed，仅蜘蛛本体响应指针。
(function () {
  if (window.__sfnPet) return;
  window.__sfnPet = true;

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var css = [
    '.sfn-pet{position:fixed;bottom:0;left:0;right:0;height:76px;z-index:210;pointer-events:none;}',
    '.sfn-pet *{pointer-events:none;}',
    '.sfn-pet .pet-body{position:absolute;bottom:2px;width:46px;cursor:pointer;pointer-events:auto;transition:opacity .6s ease;opacity:0;transform:scaleX(var(--flip,1));}',
    '.sfn-pet.awake .pet-body{opacity:1;}',
    '.sfn-pet .pet-body img{width:100%;height:auto;display:block;overflow:visible;}',
    // 散步：轻微起伏（手绘腿不动，整体颠步）
    '.sfn-pet.walking .pet-body img{animation:pet-bob .34s ease-in-out infinite;}',
    '@keyframes pet-bob{0%,100%{transform:translateY(0) rotate(-2deg);}50%{transform:translateY(-3px) rotate(2deg);}}',
    // 好奇小跳
    '.sfn-pet .pet-body.hop{animation:pet-hop .55s cubic-bezier(.22,1,.36,1);}',
    '@keyframes pet-hop{0%{translate:0 0;}38%{translate:0 -16px;}70%{translate:0 0;}84%{translate:0 -4px;}100%{translate:0 0;}}',
    // 心心与气泡
    '.sfn-pet .heart{position:absolute;font-size:13px;color:#b5402c;pointer-events:none;animation:pet-heart 1s ease-out forwards;}',
    '@keyframes pet-heart{0%{opacity:0;transform:translateY(0) scale(.6);}25%{opacity:1;}100%{opacity:0;transform:translateY(-30px) scale(1.15);}}',
    '.sfn-pet .bubble{position:absolute;bottom:56px;white-space:nowrap;background:#fff;border:1px solid #e2dac8;border-radius:10px;border-bottom-left-radius:2px;padding:6px 12px;font-size:12px;color:#6f675c;box-shadow:0 4px 14px rgba(38,34,28,.12);opacity:0;transform:translateY(4px);transition:opacity .25s ease,transform .25s ease;pointer-events:none;}',
    '.sfn-pet .bubble.show{opacity:1;transform:translateY(0);}',
    '@media (prefers-reduced-motion: reduce){',
    '  .sfn-pet.walking .pet-body img{animation:none;}',
    '  .sfn-pet .pet-body.hop{animation:none;}',
    '  .sfn-pet .pet-body{transition:none;}',
    '}'
  ].join('\n');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var root = document.createElement('div');
  root.className = 'sfn-pet awake';
  root.setAttribute('aria-hidden', 'true');
  var body = document.createElement('div');
  body.className = 'pet-body';
  body.title = '一只常驻跳蛛（点它一下）';
  var img = document.createElement('img');
  img.src = '/logo-mark.png';
  img.alt = '';
  body.appendChild(img);
  var bubble = document.createElement('div');
  bubble.className = 'bubble';
  body.appendChild(bubble);
  root.appendChild(body);
  document.body.appendChild(root);

  if (reduced) return; // 静态降级：显示但不活动

  // ---- 状态机：idle（张望）/ walk（散步）/ curious（好奇小跳）----
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
    h.style.bottom = (34 + Math.random() * 12) + 'px';
    root.appendChild(h);
    setTimeout(function () { h.remove(); }, 1100);
  }

  // 好奇：鼠标靠近时小跳（站标没有眼珠，跳与朝向即回应）
  var mouseX = -9999;
  document.addEventListener('mousemove', function (e) { mouseX = e.clientX; }, { passive: true });
  function distToMouse() {
    var r = body.getBoundingClientRect();
    return Math.abs(mouseX - (r.left + r.width / 2));
  }

  function tick() {
    if (!document.hidden) {
      var now = Date.now();
      var d = distToMouse();

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
