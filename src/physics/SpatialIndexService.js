import { DistanceConstraint } from '../engine/constraints.js';

export var SPATIAL_CELL_SIZE = 35;

var _nextWebId = 1;

/**
 * 为网约束分配稳定 ID（断丝后不复用，靠 isAlive 位图过滤）
 */
export function assignWebConstraintIds(spiderweb) {
  if (!spiderweb) return;
  var cs = spiderweb.constraints;
  for (var i = 0; i < cs.length; i++) {
    cs[i].__ci = i;
    var c = cs[i];
    if (!(c instanceof DistanceConstraint)) continue;
    if (c.__webGlobal) continue;
    if (c.__webId == null) c.__webId = _nextWebId++;
  }
}

export function resetWebConstraintIds() {
  _nextWebId = 1;
}

export function SpatialIndexService() {
  this.cellSize = SPATIAL_CELL_SIZE;
  this.minX = 0;
  this.minY = 0;
  this.cols = 0;
  this.rows = 0;
  this.cells = [];
  this.isAlive = new Uint8Array(2048);
  this.idToConstraint = [];
  this._seenGen = new Int32Array(2048);
  this._queryGen = 1;
  this._maxId = 0;
}

SpatialIndexService.prototype._ensureCapacity = function (id) {
  if (id < this.isAlive.length) return;
  var nlen = Math.max(id + 1, this.isAlive.length * 2);
  var na = new Uint8Array(nlen);
  na.set(this.isAlive);
  this.isAlive = na;
  var ns = new Int32Array(nlen);
  ns.set(this._seenGen);
  this._seenGen = ns;
};

SpatialIndexService.prototype.isAliveId = function (id) {
  return id > 0 && id < this.isAlive.length && this.isAlive[id] === 1;
};

/** 网线段是否仍存活（无 __webId 的约束视为存活，兼容 Pin 等） */
export function isWebConstraintAlive(c, index) {
  if (!c || c.__webId == null) return true;
  return index && index.isAliveId(c.__webId);
}

SpatialIndexService.prototype.getConstraint = function (id) {
  return this.idToConstraint[id] || null;
};

SpatialIndexService.prototype.removeConstraint = function (id) {
  if (!id) return;
  this._ensureCapacity(id);
  this.isAlive[id] = 0;
};

SpatialIndexService.prototype._cellIndex = function (col, row) {
  if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1;
  return row * this.cols + col;
};

SpatialIndexService.prototype._insertId = function (cellIdx, id) {
  var bucket = this.cells[cellIdx];
  if (!bucket) {
    bucket = [];
    this.cells[cellIdx] = bucket;
  }
  bucket.push(id);
};

/**
 * 每帧 bulk rebuild（Phase B）
 */
SpatialIndexService.prototype.build = function (spiderweb, bounds) {
  if (!spiderweb) return;
  var cs = spiderweb.constraints;
  var pad = 8;
  this.minX = bounds.minX - pad;
  this.minY = bounds.minY - pad;
  var maxX = bounds.maxX + pad;
  var maxY = bounds.maxY + pad;
  this.cols = Math.max(1, Math.ceil((maxX - this.minX) / this.cellSize));
  this.rows = Math.max(1, Math.ceil((maxY - this.minY) / this.cellSize));
  var cellCount = this.cols * this.rows;

  if (this.cells.length < cellCount) this.cells.length = cellCount;
  for (var ci = 0; ci < cellCount; ci++) {
    var b = this.cells[ci];
    if (b) b.length = 0;
    else this.cells[ci] = null;
  }

  this.idToConstraint.length = 0;
  this._maxId = 0;

  for (var i = 0; i < cs.length; i++) {
    var c = cs[i];
    if (!(c instanceof DistanceConstraint)) continue;
    var id = c.__webId;
    if (!id) continue;
    this._ensureCapacity(id);
    if (!this.isAlive[id]) continue;

    this.idToConstraint[id] = c;
    if (id > this._maxId) this._maxId = id;

    var ax = c.a.pos.x, ay = c.a.pos.y;
    var bx = c.b.pos.x, by = c.b.pos.y;
    var segMinX = ax < bx ? ax : bx;
    var segMaxX = ax > bx ? ax : bx;
    var segMinY = ay < by ? ay : by;
    var segMaxY = ay > by ? ay : by;

    var startCol = Math.floor((segMinX - this.minX) / this.cellSize);
    var endCol = Math.floor((segMaxX - this.minX) / this.cellSize);
    var startRow = Math.floor((segMinY - this.minY) / this.cellSize);
    var endRow = Math.floor((segMaxY - this.minY) / this.cellSize);

    for (var row = startRow; row <= endRow; row++) {
      for (var col = startCol; col <= endCol; col++) {
        var idx = this._cellIndex(col, row);
        if (idx >= 0) this._insertId(idx, id);
      }
    }
  }
};

/**
 * AABB 查询，去重后写入 outArray，返回命中 ID 数量
 */
SpatialIndexService.prototype.queryAABB = function (minX, maxX, minY, maxY, outArray) {
  this._queryGen++;
  if (this._queryGen > 0x7fffffff) {
    this._seenGen.fill(0);
    this._queryGen = 1;
  }

  var startCol = Math.floor((minX - this.minX) / this.cellSize);
  var endCol = Math.floor((maxX - this.minX) / this.cellSize);
  var startRow = Math.floor((minY - this.minY) / this.cellSize);
  var endRow = Math.floor((maxY - this.minY) / this.cellSize);

  var count = 0;
  var gen = this._queryGen;

  for (var row = startRow; row <= endRow; row++) {
    for (var col = startCol; col <= endCol; col++) {
      var idx = this._cellIndex(col, row);
      if (idx < 0) continue;
      var bucket = this.cells[idx];
      if (!bucket) continue;
      for (var bi = 0; bi < bucket.length; bi++) {
        var id = bucket[bi];
        if (!this.isAliveId(id)) continue;
        if (this._seenGen[id] === gen) continue;
        this._seenGen[id] = gen;
        outArray[count++] = id;
        if (count >= outArray.length) return count;
      }
    }
  }
  return count;
};

/** 建网后初始化存活位图 */
SpatialIndexService.prototype.syncAliveFromWeb = function (spiderweb) {
  if (!spiderweb) return;
  var cs = spiderweb.constraints;
  for (var i = 0; i < cs.length; i++) {
    var c = cs[i];
    if (!(c instanceof DistanceConstraint)) continue;
    var id = c.__webId;
    if (!id) continue;
    this._ensureCapacity(id);
    this.isAlive[id] = 1;
  }
};

export var spatialIndex = new SpatialIndexService();

/** 预分配查询缓冲（落脚/粘网/完整度共用） */
export var spatialQueryBuf = new Int32Array(1024);