export const clamp = function clamp (min, x, max) {
  return Math.max(min, Math.min(x, max))
}

export const euclideanMod = function euclideanMod (numerator, denominator) {
  const result = numerator % denominator
  return result < 0 ? result + denominator : result
}
