/** A key that names a price or a cost (D-27): the SDK never exposes one. */
// Substring matching may also drop a record key that is user data (say a field named "price_list"): that fails safe,
// since a hidden field is better than a leaked price (D-27).
const PRICED = /cost|price/i

type IsPriced<K> = K extends string
  ? Lowercase<K> extends `${string}cost${string}` | `${string}price${string}`
    ? true
    : false
  : false

/** `T` without any price or cost field, at every depth. */
export type WithoutPrices<T> = T extends readonly (infer U)[]
  ? WithoutPrices<U>[]
  : T extends object
    ? { [K in keyof T as IsPriced<K> extends true ? never : K]: WithoutPrices<T[K]> }
    : T

/** Drops every price or cost key from a decoded JSON value, at every depth. */
export function withoutPrices<T>(value: T): WithoutPrices<T> {
  if (Array.isArray(value)) return value.map(withoutPrices) as WithoutPrices<T>
  if (typeof value !== 'object' || value === null) return value as WithoutPrices<T>

  const kept = Object.entries(value).filter(([name]) => !PRICED.test(name))

  return Object.fromEntries(kept.map(([name, inner]) => [name, withoutPrices(inner)])) as WithoutPrices<T>
}
