const MAX_ISSUES = 40

export function capIssues(list: string[], kind: string): string[] {
  if (list.length <= MAX_ISSUES) return list
  const extra = list.length - (MAX_ISSUES - 1)
  return [...list.slice(0, MAX_ISSUES - 1), `…and ${extra} more ${kind}`]
}

export function addUnique(list: string[], message: string) {
  if (!list.includes(message)) list.push(message)
}