export interface RankedCandidate<T> {
  id: string
  value: T
}

export interface FusedCandidate<T> {
  id: string
  value: T
  score: number
  channels: string[]
}

/** Reciprocal Rank Fusion：只比较各路名次，避免关键词 rank 与余弦分数尺度混用。 */
export function reciprocalRankFusion<T>(
  channels: Array<{ name: string; candidates: RankedCandidate<T>[] }>,
  limit: number,
  rankConstant = 60
): FusedCandidate<T>[] {
  const fused = new Map<string, FusedCandidate<T>>()
  for (const channel of channels) {
    channel.candidates.forEach((candidate, index) => {
      const contribution = 1 / (rankConstant + index + 1)
      const existing = fused.get(candidate.id)
      if (existing) {
        existing.score += contribution
        if (!existing.channels.includes(channel.name)) existing.channels.push(channel.name)
      } else {
        fused.set(candidate.id, {
          id: candidate.id,
          value: candidate.value,
          score: contribution,
          channels: [channel.name]
        })
      }
    })
  }
  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit))
}
