export function localDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
export function elapsed(seconds: number) {
  const integer = Math.floor(seconds)
  return [
    Math.floor(integer / 3600),
    Math.floor(integer / 60) % 60,
    integer % 60,
  ]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}
export function simulationClock(seconds: number) {
  return elapsed(seconds).replace(/^00:/, '')
}
export const number = (value: number | undefined, unit = '') =>
  value === undefined
    ? 'No data'
    : `${Number.isInteger(value) ? value : value.toFixed(2)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`
