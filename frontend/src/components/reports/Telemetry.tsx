import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HistorySample } from '../../types/mission'
import { PanelTitle } from '../ui/Primitives'
import { number } from '../../utils/format'
import { plotSamples } from '../../services/history'
export default function Telemetry({ history }: { history: HistorySample[] }) {
  const [page, setPage] = useState(0)
  const samples = useMemo(
    () =>
      plotSamples(history).map((sample) => ({
        time: sample.simulated_time_seconds,
        uptime: sample.metrics.communication_uptime_percent ?? null,
        equipment: sample.metrics.equipment_availability_percent ?? null,
        resources: sample.systems.resource_level ?? null,
        power: sample.systems.power_availability ?? null,
      })),
    [history],
  )
  const pages = Math.max(1, Math.ceil(history.length / 100)),
    currentPage = Math.min(page, pages - 1)
  return (
    <section className="panel">
      <PanelTitle
        title="Recorded telemetry"
        meta={`${history.length} samples`}
      />
      {!history.length ? (
        <p className="cg-empty">No telemetry samples recorded.</p>
      ) : (
        <>
          <div
            className="cg-chart"
            role="img"
            aria-label="Recorded communication uptime, equipment availability, resource level, and power availability. Exact values are in the telemetry table."
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={samples} accessibilityLayer>
                <CartesianGrid stroke="#24313d" strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickCount={6}
                  tickFormatter={(value) => number(Number(value))}
                  tick={{ fill: '#91a0af', fontSize: 11 }}
                  name="Simulated seconds"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: '#91a0af', fontSize: 11 }}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    background: '#111b25',
                    borderColor: '#435460',
                    fontSize: 12,
                  }}
                  labelFormatter={(label) =>
                    `${number(Number(label))} simulated seconds`
                  }
                />
                <Line
                  type="linear"
                  dataKey="uptime"
                  name="Communication uptime"
                  stroke="#76c8d8"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="equipment"
                  name="Equipment availability"
                  stroke="#87b59d"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="resources"
                  name="Resources"
                  stroke="#dbb576"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="power"
                  name="Power availability"
                  stroke="#b3a6dc"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="cg-chart-legend">
            Cyan: historical communication uptime · Green: equipment · Amber:
            resources · Violet: power. Uptime differs from instantaneous
            communication health. Latest 600 unique timestamps; the last
            confirmed sample at a duplicate timestamp is plotted.
          </p>
          <details className="cg-details">
            <summary>Complete telemetry table</summary>
            <div className="cg-table-wrap">
              <table className="cg-table">
                <caption>
                  All confirmed samples are retained, including duplicate
                  timestamps.
                </caption>
                <thead>
                  <tr>
                    <th>Seconds</th>
                    <th>Uptime %</th>
                    <th>Equipment %</th>
                    <th>Resources %</th>
                    <th>Power %</th>
                  </tr>
                </thead>
                <tbody>
                  {history
                    .slice(currentPage * 100, currentPage * 100 + 100)
                    .map((sample, index) => (
                      <tr key={index}>
                        <td>{number(sample.simulated_time_seconds)}</td>
                        <td>
                          {number(sample.metrics.communication_uptime_percent)}
                        </td>
                        <td>
                          {number(
                            sample.metrics.equipment_availability_percent,
                          )}
                        </td>
                        <td>{number(sample.systems.resource_level)}</td>
                        <td>{number(sample.systems.power_availability)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="cg-actions">
              <button
                className="button"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous samples
              </button>
              <span>
                Page {currentPage + 1} of {pages}
              </span>
              <button
                className="button"
                disabled={currentPage >= pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                Next samples
              </button>
            </div>
          </details>
        </>
      )}
    </section>
  )
}
