// {{$nome}} — substituição simples, sem condicional/loop; suficiente pra mensagem de alerta
// curta, sem precisar de um engine de template completo.
export function renderTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{\$(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
}
