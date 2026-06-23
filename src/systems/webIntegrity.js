import { DistanceConstraint } from '../engine/constraints.js';
import { ptSegDistSq } from '../physics/CollisionMath.js';
import { isWebConstraintAlive } from '../physics/SpatialIndexService.js';

/**
 * 网完整性检测系统
 * 用格子覆盖率算法检测网面积损失
 */

/**
 * 点到线段距离的平方
 */
export function ptToSegDist2(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay;
  var lenSq = dx * dx + dy * dy;
  if (lenSq < 0.0001) return (px - ax) * (px - ax) + (py - ay) * (py - ay);
  var t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  var qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/**
 * 判断格子是否被约束覆盖
 */
export function cellCovered(gx, gy, spiderweb, coverD, spatialIndex) {
  if (!spiderweb) return false;
  var D2 = coverD * coverD;
  var cs = spiderweb.constraints;
  for (var i = 0; i < cs.length; i++) {
    var c = cs[i];
    if (!(c instanceof DistanceConstraint)) continue;
    if (spatialIndex && !isWebConstraintAlive(c, spatialIndex)) continue;
    if (ptToSegDist2(gx, gy, c.a.pos.x, c.a.pos.y, c.b.pos.x, c.b.pos.y) < D2) return true;
  }
  return false;
}

/**
 * 构建格子列表
 */
export function buildWebGridList(webCx, webCy, webRad, gridStep) {
  var list = [];
  var r = webRad * 1.05;
  var x0 = Math.floor((webCx - r) / gridStep) * gridStep;
  var y0 = Math.floor((webCy - r) / gridStep) * gridStep;
  for (var gy = y0; gy <= webCy + r; gy += gridStep) {
    for (var gx = x0; gx <= webCx + r; gx += gridStep) {
      var dx = gx - webCx, dy = gy - webCy;
      if (dx * dx + dy * dy <= r * r) list.push({ x: gx, y: gy });
    }
  }
  return list;
}

/**
 * 扫描当前有效格子数（全量，仅供初始化或紧急触发使用）
 */
export function scanWebCells(webGridList, spiderweb, coverD) {
  if (!webGridList || webGridList.length === 0) return 0;
  var covered = 0;
  for (var k = 0; k < webGridList.length; k++) {
    if (cellCovered(webGridList[k].x, webGridList[k].y, spiderweb, coverD)) covered++;
  }
  return covered;
}

/** 建网时分批扫描（warmup） */
export const WEB_BUILD_BATCH = 50;

/**
 * 断丝后运行时重扫：每帧最多 batchSize 格，worst-case 比较次数 ≈ batchSize × 约束数
 * Phase A 目标：≤5000 次/帧 → batchSize=7（660 约束时约 4620）
 */
export const WEB_RESCAN_BATCH = 7;

/**
 * 分批扫描格子，返回本批覆盖数与下一索引
 * @returns {{ covered: number, nextIdx: number, done: boolean }}
 */
/**
 * 通过 Spatial Index 判断格点是否被覆盖（Phase B）
 */
export function cellCoveredSpatial(gx, gy, spatialIndex, queryBuf, coverD) {
  if (!spatialIndex) return false;
  var d2 = coverD * coverD;
  var count = spatialIndex.queryAABB(gx - coverD, gx + coverD, gy - coverD, gy + coverD, queryBuf);
  for (var i = 0; i < count; i++) {
    var id = queryBuf[i];
    if (!spatialIndex.isAliveId(id)) continue;
    var c = spatialIndex.getConstraint(id);
    if (!c || !isWebConstraintAlive(c, spatialIndex)) continue;
    if (ptSegDistSq(gx, gy, c.a.pos.x, c.a.pos.y, c.b.pos.x, c.b.pos.y) < d2) return true;
  }
  return false;
}

/**
 * 断丝后标记受影响完整度格（线段 AABB 外扩 coverD）
 */
export function markDirtyCellsFromSegment(ax, ay, bx, by, pad, webGridList) {
  var minX = (ax < bx ? ax : bx) - pad;
  var maxX = (ax > bx ? ax : bx) + pad;
  var minY = (ay < by ? ay : by) - pad;
  var maxY = (ay > by ? ay : by) + pad;
  return markDirtyRegionFromAABB(minX, minY, maxX, maxY, webGridList);
}

/**
 * 矩形区域批量标记 dirty 格（AoE 断丝等）
 */
export function markDirtyRegionFromAABB(minX, minY, maxX, maxY, webGridList) {
  var dirty = [];
  if (!webGridList || !webGridList.length) return dirty;
  for (var k = 0; k < webGridList.length; k++) {
    var g = webGridList[k];
    if (g.x >= minX && g.x <= maxX && g.y >= minY && g.y <= maxY) dirty.push(k);
  }
  return dirty;
}

/**
 * 处理 dirty 格队列（每帧最多 batchSize 个）
 * @returns {{ done: boolean, comparisons: number }}
 */
export function tickDirtyCells(state, spatialIndex, queryBuf, coverD, batchSize) {
  var dirty = state.dirtyIndices;
  if (!dirty.length || !state.webGridList) return { done: true, comparisons: 0 };
  var comparisons = 0;
  var processed = 0;
  while (processed < batchSize && dirty.length) {
    var idx = dirty.shift();
    if (state.dirtyFlags) state.dirtyFlags[idx] = 0;
    var g = state.webGridList[idx];
    var was = state.cellCovered[idx];
    var count = spatialIndex.queryAABB(
      g.x - coverD, g.x + coverD, g.y - coverD, g.y + coverD, queryBuf
    );
    comparisons += count;
    var now = false;
    var d2 = coverD * coverD;
    for (var i = 0; i < count; i++) {
      var id = queryBuf[i];
      if (!spatialIndex.isAliveId(id)) continue;
      var c = spatialIndex.getConstraint(id);
      if (!c || !isWebConstraintAlive(c, spatialIndex)) continue;
      comparisons++;
      if (ptSegDistSq(g.x, g.y, c.a.pos.x, c.a.pos.y, c.b.pos.x, c.b.pos.y) < d2) {
        now = true;
        break;
      }
    }
    var nowVal = now ? 1 : 0;
    state.cellCovered[idx] = nowVal;
    if (was && !nowVal) state.coveredCount--;
    else if (!was && nowVal) state.coveredCount++;
    processed++;
  }
  return { done: dirty.length === 0, comparisons: comparisons };
}

export function scanWebCellsBatch(webGridList, spiderweb, coverD, startIdx, batchSize, spatialIndex) {
  if (!webGridList || webGridList.length === 0) {
    return { covered: 0, nextIdx: 0, done: true };
  }
  var covered = 0;
  var end = Math.min(startIdx + batchSize, webGridList.length);
  for (var k = startIdx; k < end; k++) {
    if (cellCovered(webGridList[k].x, webGridList[k].y, spiderweb, coverD, spatialIndex)) covered++;
  }
  return { covered: covered, nextIdx: end, done: end >= webGridList.length };
}

/**
 * 预算扫描器：每帧只扫描 quotaPerFrame 个格子，
 * 返回当前已知覆盖格子数（滚动累积，一轮扫完更新 lastFullCovered）
 */
export function createBudgetScanner(quotaPerFrame) {
  var _cursor = 0;
  var _partialCovered = 0;
  var _lastFullCovered = 0;
  var _quota = quotaPerFrame || 30;

  return {
    setQuota: function (q) { _quota = q; },

    reset: function () {
      _cursor = 0;
      _partialCovered = 0;
      _lastFullCovered = 0;
    },

    tick: function (webGridList, spiderweb, coverD) {
      if (!webGridList || webGridList.length === 0) return _lastFullCovered;
      var total = webGridList.length;
      var end = Math.min(_cursor + _quota, total);
      for (var k = _cursor; k < end; k++) {
        if (cellCovered(webGridList[k].x, webGridList[k].y, spiderweb, coverD)) _partialCovered++;
      }
      _cursor = end;
      if (_cursor >= total) {
        _lastFullCovered = _partialCovered;
        _cursor = 0;
        _partialCovered = 0;
      }
      return _lastFullCovered;
    },

    getLastFullCovered: function () { return _lastFullCovered; }
  };
}

/**
 * 统计 DistanceConstraint 数量
 */
export function countWebDC(spiderweb) {
  if (!spiderweb) return 0;
  var n = 0;
  for (var i = 0; i < spiderweb.constraints.length; i++)
    if (spiderweb.constraints[i] instanceof DistanceConstraint) n++;
  return n;
}

/**
 * 统计孤立粒子数
 */
export function countIsolatedParticles(spiderweb, spatialIndex) {
  if (!spiderweb) return 0;
  var connected = {};
  var _pid = 0;
  for (var i = 0; i < spiderweb.constraints.length; i++) {
    var c = spiderweb.constraints[i];
    if (!(c instanceof DistanceConstraint)) continue;
    if (spatialIndex && !isWebConstraintAlive(c, spatialIndex)) continue;
    var idA = c.a.__pid || (c.a.__pid = ++_pid);
    var idB = c.b.__pid || (c.b.__pid = ++_pid);
    connected[idA] = true;
    connected[idB] = true;
  }
  var isolated = 0;
  for (var j = 0; j < spiderweb.particles.length; j++) {
    var p = spiderweb.particles[j];
    var pid = p.__pid || (p.__pid = ++_pid);
    if (!connected[pid]) isolated++;
  }
  return isolated;
}
