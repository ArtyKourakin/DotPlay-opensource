// A* on the office tile grid: 8 directions, no cutting through wall corners. All buffers are
// allocated once and reused; a generation counter replaces clearing them between searches.

const SQRT2 = Math.SQRT2;
const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];

export class Pathfinder {
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: Int32Array;
  private heapSize = 0;
  private gen = 0;

  constructor(
    private readonly walkable: Uint8Array,
    private readonly cols: number,
    private readonly rows: number,
  ) {
    const n = cols * rows;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n * 8);
  }

  isWalkable(c: number, r: number) {
    return (
      c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.walkable[r * this.cols + c] === 1
    );
  }

  /** Closest walkable tile to (c, r), searching outward ring by ring. */
  nearestWalkable(c: number, r: number): number {
    c = Math.max(0, Math.min(this.cols - 1, Math.floor(c)));
    r = Math.max(0, Math.min(this.rows - 1, Math.floor(r)));
    if (this.isWalkable(c, r)) return r * this.cols + c;
    for (let d = 1; d < Math.max(this.cols, this.rows); d++) {
      for (let dr = -d; dr <= d; dr++)
        for (let dc = -d; dc <= d; dc++) {
          if (Math.abs(dc) !== d && Math.abs(dr) !== d) continue;
          if (this.isWalkable(c + dc, r + dr)) return (r + dr) * this.cols + c + dc;
        }
    }
    return -1;
  }

  /**
   * Writes the tiles from start (exclusive) to goal (inclusive) into `out` and returns the path
   * length. Returns 0 when start equals goal and -1 when the goal cannot be reached.
   */
  find(start: number, goal: number, out: Int32Array): number {
    if (start === goal) return 0;
    if (this.walkable[goal] !== 1 || this.walkable[start] !== 1) return -1;
    const gen = ++this.gen;
    const cols = this.cols;
    const gc = goal % cols;
    const gr = (goal / cols) | 0;
    this.heapSize = 0;
    this.g[start] = 0;
    this.parent[start] = -1;
    this.seen[start] = gen;
    this.f[start] = this.h(start % cols, (start / cols) | 0, gc, gr);
    this.push(start);

    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) return this.reconstruct(start, goal, out);
      const cc = cur % cols;
      const cr = (cur / cols) | 0;
      for (let k = 0; k < 8; k++) {
        const nc = cc + DC[k]!;
        const nr = cr + DR[k]!;
        if (!this.isWalkable(nc, nr)) continue;
        if (k >= 4 && (!this.isWalkable(nc, cr) || !this.isWalkable(cc, nr))) continue;
        const next = nr * cols + nc;
        if (this.closed[next] === gen) continue;
        const cost = this.g[cur]! + (k >= 4 ? SQRT2 : 1);
        if (this.seen[next] === gen && cost >= this.g[next]!) continue;
        this.seen[next] = gen;
        this.g[next] = cost;
        this.parent[next] = cur;
        this.f[next] = cost + this.h(nc, nr, gc, gr);
        this.push(next);
      }
    }
    return -1;
  }

  private h(c: number, r: number, gc: number, gr: number) {
    const dx = Math.abs(c - gc);
    const dy = Math.abs(r - gr);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  }

  private reconstruct(start: number, goal: number, out: Int32Array) {
    let len = 0;
    for (let n = goal; n !== start; n = this.parent[n]!) len++;
    if (len > out.length) return -1;
    let i = len - 1;
    for (let n = goal; n !== start; n = this.parent[n]!) out[i--] = n;
    return len;
  }

  private push(node: number) {
    if (this.heapSize >= this.heap.length) return;
    const heap = this.heap;
    const f = this.f;
    let i = this.heapSize++;
    heap[i] = node;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[heap[p]!]! <= f[node]!) break;
      heap[i] = heap[p]!;
      i = p;
    }
    heap[i] = node;
  }

  private pop() {
    const heap = this.heap;
    const f = this.f;
    const top = heap[0]!;
    const last = heap[--this.heapSize]!;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= this.heapSize) break;
      const r = l + 1;
      const child = r < this.heapSize && f[heap[r]!]! < f[heap[l]!]! ? r : l;
      if (f[heap[child]!]! >= f[last]!) break;
      heap[i] = heap[child]!;
      i = child;
    }
    heap[i] = last;
    return top;
  }
}
