import { LEVELS } from '../lib/risk'

export default function LevelBadge({ level }: { level: number }) {
  const { label, color } = LEVELS[level]
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  )
}
