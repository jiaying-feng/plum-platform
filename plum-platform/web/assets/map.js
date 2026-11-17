/* 三端统一地图组件：与小程序 mp-weixin/images/map_base.jpg 同一张底图、同一套锚点。
   零第三方库，零外部服务；底图由 Flask 的 /web/<name> 静态路由提供。 */
(function (global) {
  'use strict';

  // Keep in sync with PIN_ANCHORS in mp-weixin/pages/index/index.js
  // and tools/gen_map_base.py.
  var ANCHORS = [
    [15.5, 70.0], [31.0, 47.0], [44.5, 30.0],
    [55.0, 66.0], [73.0, 33.0], [86.5, 53.0]
  ];

  var LABELS = [
    { t: '䢺江', c: 'pm-river', x: 25.5, y: 52 },
    { t: '大双路', c: 'pm-road', x: 66, y: 68 },
    { t: '老街', c: 'pm-town', x: 45.5, y: 43.5 },
    { t: '青梅谷', c: 'pm-valley', x: 80, y: 15 }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function html(spots, opts) {
    var o = opts || {};
    var list = spots || [];
    var done = o.doneIds || [];

    var pins = list.map(function (s, i) {
      var a = ANCHORS[Number(s.id) - 1] || ANCHORS[i] || [12 + i * 15, 84 - i * 13];
      var isDone = done.indexOf(s.id) >= 0 || !!s.stamped;
      return '<button type="button" class="pm-pin map-pin' + (isDone ? ' done' : '') + '"' +
        ' data-spot="' + i + '" data-id="' + esc(s.id) + '" title="' + esc(s.name) + '"' +
        ' aria-label="' + esc(s.name) + '" style="left:' + a[0] + '%;top:' + a[1] + '%">' +
        (i + 1) + '</button>';
    }).join('');

    var labels = LABELS.map(function (l) {
      return '<span class="pm-label ' + l.c + '" style="left:' + l.x + '%;top:' + l.y + '%">' +
        l.t + '</span>';
    }).join('');

    return '<div class="pm-wrap">' +
      '<img class="pm-bg" src="/web/map_base.jpg" alt="䢺江镇青梅园地形示意底图" />' +
      labels +
      '<div class="pm-north"><b>N</b><i></i></div>' +
      pins +
      '<div class="pm-legend"><div class="pm-legend-row">' +
        '<i class="pm-key-dot"></i><span>采摘园</span>' +
        '<i class="pm-key-road"></i><span>道路</span>' +
        '<i class="pm-key-water"></i><span>水系</span>' +
      '</div><div class="pm-legend-note">䢺江镇地形示意 · ' + list.length + ' 个点位</div></div>' +
      '<div class="pm-scale"><span class="pm-scale-bar"><i></i></span>' +
        '<span class="pm-scale-text">0&nbsp;&nbsp;&nbsp;&nbsp;500 m</span></div>' +
      '</div>';
  }

  function bind(root, spots, onClick) {
    var scope = root || document;
    scope.querySelectorAll('.pm-pin').forEach(function (el) {
      el.onclick = function () { onClick(spots[Number(el.dataset.spot)]); };
    });
  }

  global.PlumMap = { html: html, bind: bind, anchors: ANCHORS };
})(window);
