export const MAX_SIMULATION_SPEED = 3600

export const capSimulationSpeed = (speed: number) =>
  Math.min(speed, MAX_SIMULATION_SPEED)

export const simulationSpeedHelp =
  '1× is real time. Maximum speed is 3600×: one simulated hour per real second. Higher values are capped at 3600×.'
