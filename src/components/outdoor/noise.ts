// Small, seeded 2D simplex noise (after Stefan Gustavson's public-domain
// version) plus fractal sums. Enough for terrain, forests and lakes.

const GRADIENTS = [
    [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function permutation(seed: number) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    let s = seed >>> 0;
    for (let i = 255; i > 0; i--) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const j = s % (i + 1);
        [p[i], p[j]] = [p[j], p[i]];
    }
    return Uint8Array.from([...p, ...p]);
}

const perm = permutation(20261022);

/** Simplex noise in [-1, 1]. */
export function noise2(x: number, y: number) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const corners = [
        [x0, y0, 0, 0],
        [x0 - i1 + G2, y0 - j1 + G2, i1, j1],
        [x0 - 1 + 2 * G2, y0 - 1 + 2 * G2, 1, 1],
    ];
    let total = 0;
    for (const [cx, cy, di, dj] of corners) {
        const falloff = 0.5 - cx * cx - cy * cy;
        if (falloff <= 0) continue;
        const gradient = GRADIENTS[perm[((i + di) & 255) + perm[(j + dj) & 255]] & 7];
        total += falloff ** 4 * (gradient[0] * cx + gradient[1] * cy);
    }
    return 70 * total;
}

/** Fractal noise: several octaves of simplex noise, roughly in [-1, 1]. */
export function fbm(x: number, y: number, octaves = 4) {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let octave = 0; octave < octaves; octave++) {
        sum += amplitude * noise2(x * frequency, y * frequency);
        norm += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return sum / norm;
}

/** Deterministic pseudo-random number in [0, 1) for integer coordinates. */
export function hash2(x: number, y: number, salt = 0) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
