/**
 * 纯几何碰撞数学（无分配）
 */

/**
 * 点到线段距离平方
 */
export function ptSegDistSq(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay;
  var lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    var ex = px - ax, ey = py - ay;
    return ex * ex + ey * ey;
  }
  var t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  var qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/**
 * 两线段最近点（Christer Ericson / Real-Time Collision Detection）
 * @returns {{ distSq: number, tA: number, tB: number, qx: number, qy: number }}
 *   tB 为第二条线段参数；qx,qy 为第二条线段上的最近点
 */
export function segmentSegmentClosest(ax, ay, bx, by, cx, cy, dx, dy) {
  var ux = bx - ax, uy = by - ay;
  var vx = dx - cx, vy = dy - cy;
  var wx = ax - cx, wy = ay - cy;
  var a = ux * ux + uy * uy;
  var b = ux * vx + uy * vy;
  var c = vx * vx + vy * vy;
  var d = ux * wx + uy * wy;
  var e = vx * wx + vy * wy;
  var denom = a * c - b * b;
  var sN, sD = denom;
  var tN, tD = denom;
  var SMALL = 1e-12;

  if (denom < SMALL) {
    sN = 0; sD = 1;
    tN = e; tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) {
      sN = 0; tN = e; tD = c;
    } else if (sN > sD) {
      sN = sD; tN = e + b; tD = c;
    }
  }

  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0;
    else if (-d > a) sN = sD;
    else { sN = -d; sD = a; }
  } else if (tN > tD) {
    tN = tD;
    if ((-d + b) < 0) sN = 0;
    else if ((-d + b) > a) sN = sD;
    else { sN = -d + b; sD = a; }
  }

  var sc = Math.abs(sN) < SMALL ? 0 : sN / sD;
  var tc = Math.abs(tN) < SMALL ? 0 : tN / tD;
  var pqx = wx + sc * ux - tc * vx;
  var pqy = wy + sc * uy - tc * vy;
  var distSq = pqx * pqx + pqy * pqy;
  var qx = cx + tc * vx;
  var qy = cy + tc * vy;
  return { distSq: distSq, tA: sc, tB: tc, qx: qx, qy: qy };
}