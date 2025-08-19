export function canonicalName(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // acentos
    .replace(/\b(ufv|sfv|fot|usina|planta)\b/g, " ")  // termos comuns
    .replace(/[^\w\s]/g, " ")                         // pontuação
    .replace(/\s+/g, " ")                             // espaços
    .trim();
}
