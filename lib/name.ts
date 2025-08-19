// lib/name.ts
// Normalização forte de nomes + similaridade básica (Levenshtein)

const DROP_PREFIXES = [
  "ufv", "sfv", "fot", "usina", "planta", "solar", "pv",
];
const DROP_WORDS = [
  "comercial", "residencial", "gsm", "gd", "gdg", "gd-i", "gd-ii", "gd-iii",
  "grupo", "energia", "ambiental", "otimização", "otimizacao",
];
const PARENS_RE = /\((?:[^()]+|\([^()]*\))*\)/g; // remove conteúdo entre parênteses (inclusive aninhados)
const LOTE_RE = /\b(lote|quadra|quadra\/lote|qdr)\s*[a-z0-9\-\/]+/gi;
const CEP_RE = /\bcep[:\s-]*\d{2}\.?\d{3}-?\d{3}\b/gi;
const NUM_ADDR_RE = /\b[nrº°#]\s*\d+\b/gi;
const MULTISPACE_RE = /\s+/g;

// (I…X) simples → número (até 20 resolve 99% dos casos)
const ROMAN_TABLE: Record<string, number> = {
  M:1000, CM:900, D:500, CD:400, C:100, XC:90, L:50, XL:40,
  X:10, IX:9, V:5, IV:4, I:1
};
function romanToInt(s: string): number {
  let i = 0, n = 0;
  const up = s.toUpperCase();
  while (i < up.length) {
    const two = up.slice(i, i + 2);
    if (ROMAN_TABLE[two] != null) { n += ROMAN_TABLE[two]; i += 2; continue; }
    const one = up[i];
    if (ROMAN_TABLE[one] != null) { n += ROMAN_TABLE[one]; i += 1; continue; }
    return NaN;
  }
  return n;
}
function replaceStandaloneRomans(input: string): string {
  return input.replace(/\b[ivxlcdm]{1,6}\b/gi, (m) => {
    const val = romanToInt(m);
    return Number.isFinite(val) && val > 0 ? String(val) : m;
  });
}

export function canonicalName(raw: string): string {
  if (!raw) return "";

  // 1) remove parênteses (ex.: "(GSM Lote 29)")
  let s = raw.replace(PARENS_RE, " ");

  // 2) baixa tudo, tira acento
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  // 3) troca separadores por espaço
  s = s.replace(/[_\-.,;/]+/g, " ");

  // 4) remove CEP, indicações de lote/quadra e números de endereço
  s = s.replace(CEP_RE, " ").replace(LOTE_RE, " ").replace(NUM_ADDR_RE, " ");

  // 5) converte algarismos romanos “soltos” para números (ii → 2, iii → 3…)
  s = replaceStandaloneRomans(s);

  // 6) remove prefixos e palavras irrelevantes
  let parts = s.split(MULTISPACE_RE).filter(Boolean);

  // drop prefixos (apenas no começo)
  while (parts.length && DROP_PREFIXES.includes(parts[0])) parts.shift();

  // drop palavras “ruído” em qualquer posição
  parts = parts.filter(w => !DROP_WORDS.includes(w));

  // 7) monta, remove tudo que não for [a-z0-9 espaço], compacta espaços
  s = parts.join(" ");
  s = s.replace(/[^a-z0-9 ]+/g, " ").replace(MULTISPACE_RE, " ").trim();

  return s;
}

// Levenshtein distance
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let prev = i, tmp = 0;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      tmp = Math.min(
        dp[j] + 1,      // deletion
        prev + 1,       // insertion
        dp[j - 1] + cost // substitution
      );
      dp[j - 1] = prev;
      prev = tmp;
    }
    dp[b.length] = prev;
  }
  return dp[b.length];
}

export function similarity(a: string, b: string): number {
  const A = canonicalName(a);
  const B = canonicalName(b);
  if (!A && !B) return 1;
  if (!A || !B) return 0;
  const d = lev(A, B);
  const maxLen = Math.max(A.length, B.length);
  return maxLen ? 1 - d / maxLen : 0;
}
