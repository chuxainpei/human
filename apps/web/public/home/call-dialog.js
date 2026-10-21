/* call-dialog.js — 嘟囔首页“和陈老师面对面”弹窗。
   点击首页的通话按钮后，弹出一个复古窗口：陈老师（有声）开场，下面一个“开始上课”按钮直达学习工作台。
   不打开摄像头和麦克风，也不发任何网络请求（视频为站内文件）。 */
(function () {
  var BASE = '/human/';
  var LEARN = BASE + 'learn?start=1';
  var VIDEO = BASE + 'home/video/hero-chen-audio.mp4';
  var POSTER = BASE + 'home/video/hero-chen-audio.jpg';
  var dlg, video, state, lastFocus, timer;
  // 像素风图标（内联 SVG，不依赖表情字体）
  var ICON_ON = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges" fill="#140206"><path d="M2 6h3l4-3v10l-4-3H2z"/><path d="M11 5h1v6h-1zM13 3h1v10h-1z"/></svg>';
  var ICON_OFF = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges" fill="#140206"><path d="M2 6h3l4-3v10l-4-3H2z"/><path d="M11 5h1v1h-1zM12 6h1v1h-1zM13 7h1v2h-1zM12 9h1v1h-1zM11 10h1v1h-1zM14 6h1v1h-1zM14 9h1v1h-1z"/></svg>';
  var ICON_REPLAY = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges" fill="#140206"><path d="M5 3h6v2H5zM3 5h2v6H3zM5 11h6v2H5zM11 9h2v2h-2zM11 5h2v1h-2zM12 3h1v4h-4V6h3z"/></svg>';
  function setSound(btn) { btn.innerHTML = video.muted ? ICON_OFF : ICON_ON; btn.setAttribute('aria-pressed', String(video.muted)); btn.setAttribute('aria-label', video.muted ? '打开声音' : '静音'); }
  function build() {
    dlg = document.createElement('div');
    dlg.className = 'dn-call'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', '和陈老师面对面');
    dlg.innerHTML =
      '<div class="dn-call__win">' +
        '<div class="dn-call__bar"><span class="dn-call__lines"></span><span class="dn-call__title">和陈老师面对面</span><span class="dn-call__lines"></span>' +
        '<button class="dn-call__min" type="button" aria-label="缩小"><svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" shape-rendering="crispEdges"><path d="M1 7h8v1.4H1z" fill="#140206"/></svg></button>' +
        '<button class="dn-call__x" type="button" aria-label="关闭"><svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#140206" stroke-width="1.4"/></svg></button></div>' +
        '<div class="dn-call__stage">' +
          '<video src="' + VIDEO + '" poster="' + POSTER + '" playsinline preload="none"></video>' +
          '<div class="dn-call__badge"><i></i><span class="dn-call__state">正在接通陈老师<span class="dn-call__dots"></span></span></div>' +
          '<div class="dn-call__ctrl">' +
            '<button class="dn-call__sound" type="button" aria-pressed="false" aria-label="静音">' + ICON_ON + '</button>' +
            '<button class="dn-call__replay" type="button" aria-label="重播">' + ICON_REPLAY + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="dn-call__foot">' +
          '<p class="dn-call__sub">陈老师先打个招呼。准备好了就开始上课：讲解、答疑、和买家谈判，约 20 分钟。</p>' +
          '<div class="dn-call__btns"><a class="dn-call__btn" href="' + LEARN + '">开始上课</a>' +
          '<button class="dn-call__btn is-ghost dn-call__close2" type="button">稍后再说</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    video = dlg.querySelector('video'); state = dlg.querySelector('.dn-call__state');
    video.addEventListener('playing', function () { state.textContent = '陈老师正在说话'; dlg.classList.add('is-live'); });
    video.addEventListener('ended', function () { state.textContent = '陈老师在等你开始上课'; dlg.classList.remove('is-live'); });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('.dn-call__x,.dn-call__close2')) return close();
      if (e.target.closest('.dn-call__min')) return dlg.classList.toggle('is-min');
      if (e.target.closest('.dn-call__replay')) { video.currentTime = 0; play(); return; }
      var s = e.target.closest('.dn-call__sound');
      if (s) { video.muted = !video.muted; setSound(s); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg.classList.contains('is-open')) close(); });
  }
  function play() {
    var p = video.play();
    if (p && p.catch) p.catch(function () { video.muted = true; var q = video.play(); if (q && q.catch) q.catch(function () {}); setSound(dlg.querySelector('.dn-call__sound')); });
  }
  function open(e) {
    if (e) e.preventDefault();
    if (!dlg) build();
    lastFocus = document.activeElement;
    dlg.classList.remove('is-min', 'is-live');
    state.innerHTML = '正在接通陈老师<span class="dn-call__dots"></span>';
    dlg.classList.add('is-open'); document.documentElement.classList.add('dn-call-lock');
    video.preload = 'auto'; video.muted = false; video.currentTime = 0; setSound(dlg.querySelector('.dn-call__sound'));
    play(); // 点击即播放：浏览器允许带声音
    clearTimeout(timer);
    dlg.querySelector('.dn-call__x').focus({ preventScroll: true });
  }
  function close() {
    dlg.classList.remove('is-open', 'is-live'); document.documentElement.classList.remove('dn-call-lock');
    video.pause(); clearTimeout(timer);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#dn-call-button,[data-dn-call]');
    if (t) open(e);
  });
  window.dnCall = { open: function () { open(); }, close: function () { if (dlg) close(); } };
})();

// 理念区视频窗口：最小化按钮收起/展开画面
(function () {
  document.querySelectorAll('[data-dn-vwin]').forEach(function (w) {
    var b = w.querySelector('.dn-vwin__min'); var v = w.querySelector('video');
    if (!b) return;
    b.addEventListener('click', function () {
      var min = w.classList.toggle('is-min');
      b.setAttribute('aria-expanded', String(!min)); b.setAttribute('aria-label', min ? '展开窗口' : '收起窗口');
      b.querySelector('path').setAttribute('d', min ? 'M2 5h6M5 2v6' : 'M2 5h6');
      if (v) { if (min) v.pause(); else v.play().catch(function () {}); }
    });
  });
})();
