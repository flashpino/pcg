// {{$nome}} ou {{nome}} — o $ é opcional (usuários digitam as duas formas na prática).
// Substituição simples, sem condicional/loop; suficiente pra mensagem de alerta curta.
export function renderTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{\$?(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
}
