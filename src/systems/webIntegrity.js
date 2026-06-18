import { DistanceConstraint } from '../engine/constraints.js';

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
export function cellCovered(gx, gy, spiderweb, coverD) {
  if (!spiderweb) return false;
  var D2 = coverD * coverD;
  var cs = spiderweb.constraints;
  for (var i = 0; i < cs.length; i++) {
    var c = cs[i];
    if (!(c instanceof DistanceConstraint)) continue;
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
 * 扫描当前有效格子数
 */
export function scanWebCells(webGridList, spiderweb, coverD) {
  if (!webGridList || webGridList.length === 0) return 0;
  var covered = 0;
  for (var k = 0; k < webGridList.length; k++) {
    if (cellCovered(webGridList[k].x, webGridList[k].y, spiderweb, coverD)) covered++;
  }
  return covered;
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
export function countIsolatedParticles(spiderweb) {
  if (!spiderweb) return 0;
  var connected = {};
  var _pid = 0;
  for (var i = 0; i < spiderweb.constraints.length; i++) {
    var c = spiderweb.constraints[i];
    if (!(c instanceof DistanceConstraint)) continue;
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
