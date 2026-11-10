(function (global) {
  'use strict';

  var NS = (global.vertIPTV = global.vertIPTV || {});

  function matchesSelector(el, selector) {
    if (!el || el.nodeType !== 1) return false;
    var fn = el.matches || el.webkitMatchesSelector || el.msMatchesSelector;
    return fn ? fn.call(el, selector) : false;
  }

  function isElementVisible(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility();
    }
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && global.getComputedStyle(el).visibility !== 'hidden';
  }

  // Deterministic nearest-scroll without Chrome 61+ scrollIntoView({block}) dependency
  function scrollIntoContainerNearest(container, el) {
    if (!container || !el) return;
    var cRect = container.getBoundingClientRect();
    var eRect = el.getBoundingClientRect();
    if (eRect.top < cRect.top) {
      container.scrollTop -= cRect.top - eRect.top + 8;
    } else if (eRect.bottom > cRect.bottom) {
      container.scrollTop += eRect.bottom - cRect.bottom + 8;
    }
  }

  function updateRovingTabindex(container, activeEl, selector) {
    if (!container) return;
    var items = container.querySelectorAll(selector);
    for (var i = 0; i < items.length; i++) {
      items[i].setAttribute('tabindex', items[i] === activeEl ? '0' : '-1');
    }
    if (activeEl && typeof activeEl.focus === 'function') {
      try {
        activeEl.focus({ preventScroll: true });
      } catch (_) {
        activeEl.focus();
      }
      scrollIntoContainerNearest(container, activeEl);
    }
  }

  function findSpatialCandidate(container, currentEl, direction, selector) {
    var rawNodes = container.querySelectorAll(selector);
    var currentRect = currentEl.getBoundingClientRect();
    var tolerance = 2;
    var weight = 2.5;

    var curCx = (currentRect.left + currentRect.right) / 2;
    var curCy = (currentRect.top + currentRect.bottom) / 2;

    var bestOverlap = null;
    var bestOverlapGap = Infinity;
    var bestOverlapPerp = Infinity;

    var bestFallback = null;
    var bestFallbackScore = Infinity;

    for (var i = 0; i < rawNodes.length; i++) {
      var cand = rawNodes[i];
      if (cand === currentEl || cand.disabled || !isElementVisible(cand)) continue;
      var r = cand.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      var gap = 0;
      var overlaps = false;
      var perpOffset = 0;

      if (direction === 'right') {
        if (r.left < currentRect.right - tolerance) continue;
        gap = Math.max(0, r.left - currentRect.right);
        overlaps = Math.min(r.bottom, currentRect.bottom) > Math.max(r.top, currentRect.top);
        perpOffset = Math.abs((r.top + r.bottom) / 2 - curCy);
      } else if (direction === 'left') {
        if (r.right > currentRect.left + tolerance) continue;
        gap = Math.max(0, currentRect.left - r.right);
        overlaps = Math.min(r.bottom, currentRect.bottom) > Math.max(r.top, currentRect.top);
        perpOffset = Math.abs((r.top + r.bottom) / 2 - curCy);
      } else if (direction === 'down') {
        if (r.top < currentRect.bottom - tolerance) continue;
        gap = Math.max(0, r.top - currentRect.bottom);
        overlaps = Math.min(r.right, currentRect.right) > Math.max(r.left, currentRect.left);
        perpOffset = Math.abs((r.left + r.right) / 2 - curCx);
      } else if (direction === 'up') {
        if (r.bottom > currentRect.top + tolerance) continue;
        gap = Math.max(0, currentRect.top - r.bottom);
        overlaps = Math.min(r.right, currentRect.right) > Math.max(r.left, currentRect.left);
        perpOffset = Math.abs((r.left + r.right) / 2 - curCx);
      } else {
        continue;
      }

      if (overlaps) {
        if (gap < bestOverlapGap - 0.5 || (Math.abs(gap - bestOverlapGap) <= 0.5 && perpOffset < bestOverlapPerp)) {
          bestOverlap = cand;
          bestOverlapGap = gap;
          bestOverlapPerp = perpOffset;
        }
      } else if (!bestOverlap) {
        var score = gap + weight * perpOffset;
        if (score < bestFallbackScore) {
          bestFallbackScore = score;
          bestFallback = cand;
        }
      }
    }

    return bestOverlap || bestFallback;
  }

  function getDirectionFromEvent(e) {
    var k = e.key;
    var c = e.keyCode;
    if (k === 'ArrowLeft' || c === 37) return 'left';
    if (k === 'ArrowRight' || c === 39) return 'right';
    if (k === 'ArrowUp' || c === 38) return 'up';
    if (k === 'ArrowDown' || c === 40) return 'down';
    return '';
  }

  function attachSpatialContainer(container, selector) {
    if (!container) return;
    container.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

      var dir = getDirectionFromEvent(e);
      if (!dir) return;

      var path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
      var innerTarget = path[0] || e.target;
      if (innerTarget && innerTarget.tagName) {
        var tag = innerTarget.tagName.toUpperCase();
        // When an input is actively unlocked for text entry (!readOnly), keep Left/Right for caret movement
        if ((tag === 'INPUT' || tag === 'TEXTAREA') && !innerTarget.readOnly) {
          if (dir === 'left' || dir === 'right') return;
        }
      }

      var focused = document.activeElement;
      if (!focused || !container.contains(focused) || !matchesSelector(focused, selector)) return;

      var next = findSpatialCandidate(container, focused, dir, selector);
      if (!next) return;

      e.preventDefault();
      updateRovingTabindex(container, next, selector);
    });
  }

  NS.SpatialNav = {
    scrollIntoContainerNearest: scrollIntoContainerNearest,
    updateRovingTabindex: updateRovingTabindex,
    findSpatialCandidate: findSpatialCandidate,
    attachSpatialContainer: attachSpatialContainer
  };
})(window);
