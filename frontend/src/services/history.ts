import type { HistorySample } from '../types/mission'
export function plotSamples(history: HistorySample[]) {
  const byTime = new Map<number, HistorySample>()
  history.forEach((sample) => byTime.set(sample.simulated_time_seconds, sample))
  return [...byTime.values()]
    .sort((a, b) => a.simulated_time_seconds - b.simulated_time_seconds)
    .slice(-600)
}
